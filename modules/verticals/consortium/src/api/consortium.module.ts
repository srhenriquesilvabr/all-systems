import { BankingModule, BankingService, PROPOSAL_UPDATED, type ProposalUpdated } from '@all/banking';
import { addMonths, AuditService, coreSchema, CustomersService, FinanceService, ModuleSettingsService, nextSequence, OutboxHandlers, TenantDb, toCents, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { NotificationsModule, NotificationsService } from '@all/notifications';
import { CREDIT_BUREAU, CreditBureauModule, CreditBureauService } from '@all/credit-bureau';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  assemblyInput,
  assemblyResultsInput,
  assemblyScheduleInput,
  assemblyStatuses,
  assemblyUpdateInput,
  quotaInput,
  sellerInput,
  type Assembly,
  type AssemblyInput,
  type AssemblyResultsInput,
  type AssemblyScheduleInput,
  type Plan,
  type Quota,
  type QuotaInput,
  type QuotasSummary,
  type QuotaStatus,
} from '../contracts';
import { consAdministrators, consAssemblies, consBids, consPlans, consQuotas } from '../db/schema';
import type { ConsortiumSettings } from '../manifest';
import {
  badRequest,
  brl,
  commissionCents,
  commissionPercentInTx,
  effectiveCommission,
  ensureAdministratorInTx,
  ensureGroupInTx,
  firstDueAfter,
  generateInstallmentsInTx,
  installmentOf,
  localDate,
  localToday,
  MODULE,
  openCreditInTx,
  REVERSAL_SOURCE,
  settleBidsInTx,
  SOURCE,
  type PlanRow,
  type QuotaRow,
} from './shared';
import { TrackingController, TrackingService } from './tracking';
import { MetaGraphHttp, MetaLeadsAdapter } from './leads/ads';
import { LeadChannelsService } from './leads/channels.service';
import { LeadsController, LeadWebhooksController, PublicSimulatorController } from './leads/leads.controller';
import { LeadsService } from './leads/leads.service';
import { PublicSimulatorService } from './leads/public.service';

const dayStart = (date: string) => sql`(${date}::date)::timestamp at time zone 'America/Sao_Paulo'`;
const dayEnd = (date: string) => sql`((${date}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;
/** Período do resumo: sem datas, o mês corrente. */
const periodOf = (from?: string, to?: string) => {
  const today = localToday();
  const [y, m] = today.split('-').map(Number) as [number, number];
  return { from: from ?? `${today.slice(0, 7)}-01`, to: to ?? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};

type AssemblyRow = typeof consAssemblies.$inferSelect;

@Injectable()
export class ConsortiumService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly banking: BankingService,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly notifications: NotificationsService,
    private readonly settings: ModuleSettingsService,
    private readonly handlers: OutboxHandlers,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly credit: CreditBureauService,
  ) {}

  onModuleInit() {
    this.handlers.on<ProposalUpdated>(PROPOSAL_UPDATED, 'consortium.adhesion', (e) => this.onAdhesion(e.payload));
  }

  /** Busca os planos nas administradoras ativas e atualiza o catálogo local. */
  async syncPlans(): Promise<Plan[]> {
    const { tenantId } = requestContext.require();
    const offers = await this.banking.consortiumPlans();
    return this.tdb.run(async (tx) => {
      for (const o of offers) {
        const values = {
          institution: o.institution,
          name: o.name,
          assetType: o.assetType,
          creditValue: o.creditValue.toFixed(2),
          termMonths: o.termMonths,
          adminFeePercent: o.adminFeePercent.toFixed(3),
          reserveFundPercent: o.reserveFundPercent.toFixed(3),
          insurancePercent: o.insurancePercent.toFixed(3),
          active: true,
          syncedAt: new Date(),
        };
        await tx
          .insert(consPlans)
          .values({ ...values, tenantId, connectionId: o.connectionId, externalId: o.externalId })
          .onConflictDoUpdate({ target: [consPlans.tenantId, consPlans.connectionId, consPlans.externalId], set: values });
      }
      // Administradoras que oferecem planos entram na tabela de comissões.
      for (const [connectionId, institution] of new Map(offers.map((o) => [o.connectionId, o.institution]))) await ensureAdministratorInTx(tx, tenantId, connectionId, institution);
      // Planos que a administradora deixou de oferecer saem do simulador (cotas vendidas continuam).
      const seen = offers.map((o) => `${o.connectionId}|${o.externalId}`);
      const all = await tx.select({ id: consPlans.id, key: sql<string>`${consPlans.connectionId}::text || '|' || ${consPlans.externalId}` }).from(consPlans);
      const stale = all.filter((p) => !seen.includes(p.key)).map((p) => p.id);
      if (stale.length) await tx.update(consPlans).set({ active: false }).where(inArray(consPlans.id, stale));
      await this.audit.log(tx, { action: 'consortium.plans.synced', entity: 'cons_plan', entityId: 'all', data: { count: offers.length } });
      return (await tx.select().from(consPlans).where(eq(consPlans.active, true)).orderBy(asc(consPlans.creditValue))).map(toPlan);
    });
  }

  /** Simulador: planos ativos, filtrados pelo tipo de bem e pela faixa de crédito. */
  plans(opts: { assetType?: string; minCredit?: number; maxCredit?: number }): Promise<Plan[]> {
    return this.tdb.run(async (tx) =>
      (
        await tx
          .select()
          .from(consPlans)
          .where(
            and(
              eq(consPlans.active, true),
              opts.assetType ? eq(consPlans.assetType, opts.assetType as PlanRow['assetType']) : undefined,
              opts.minCredit ? gte(consPlans.creditValue, opts.minCredit.toFixed(2)) : undefined,
              opts.maxCredit ? lte(consPlans.creditValue, opts.maxCredit.toFixed(2)) : undefined,
            ),
          )
          .orderBy(asc(consPlans.creditValue), asc(consPlans.termMonths))
      ).map(toPlan),
    );
  }

  /** Venda da cota: grava a cota e envia a adesão para a administradora pela integração. */
  async sell(input: QuotaInput): Promise<Quota> {
    const { tenantId, userId } = requestContext.requireTenant();
    const quotaId = await this.tdb.run(async (tx) => {
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
      const [plan] = await tx.select().from(consPlans).where(and(eq(consPlans.id, input.planId), eq(consPlans.active, true)));
      if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'Plano não encontrado ou fora de oferta' });
      if (input.sellerId) await this.checkSeller(tx, tenantId, input.sellerId);
      await this.assertCreditCheckInTx(tx, input.applicant.document);
      const [quota] = await tx
        .insert(consQuotas)
        .values({ tenantId, number: await nextSequence(tx, tenantId, 'cons_quota'), customerId: customer.id, planId: plan.id, dueDay: input.dueDay, sellerId: input.sellerId ?? userId ?? null })
        .returning();
      await this.customers.addTimeline(tx, { customerId: customer.id, moduleKey: MODULE, type: 'quota.sold', title: `Consórcio: adesão ao plano ${plan.name} (${plan.institution})`, entity: 'cons_quota', entityId: quota!.id });
      // Venda a partir de um lead: o lead vai para "proposta" ligado à cota (vira venda quando a adesão for aceita).
      if (input.leadId) await this.leads.linkQuotaInTx(tx, input.leadId, { id: quota!.id, number: quota!.number, customerId: customer.id });
      return quota!.id;
    });
    const [plan] = await this.tdb.run((tx) => tx.select().from(consPlans).where(eq(consPlans.id, input.planId)));
    // A proposta roda na transação dela: se a administradora recusar o envio, a cota fica registrada como recusada.
    try {
      const proposal = await this.banking.submit({
        connectionId: plan!.connectionId,
        product: 'consortium',
        sourceType: SOURCE,
        sourceId: quotaId,
        customerId: input.customerId,
        amount: Number(plan!.creditValue),
        termMonths: plan!.termMonths,
        applicant: input.applicant,
        details: { planExternalId: plan!.externalId, planName: plan!.name, dueDay: input.dueDay },
      });
      await this.tdb.run((tx) => tx.update(consQuotas).set({ proposalId: proposal.id }).where(eq(consQuotas.id, quotaId)));
    } catch (err) {
      await this.tdb.run((tx) => tx.update(consQuotas).set({ status: 'rejected', statusMessage: (err as Error).message }).where(eq(consQuotas.id, quotaId)));
      throw err;
    }
    return this.get(quotaId);
  }

  list(opts: { status?: string; customerId?: string; groupCode?: string; sellerId?: string }): Promise<Quota[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.quotaQuery(tx)
        .where(
          and(
            opts.status ? eq(consQuotas.status, opts.status as QuotaStatus) : undefined,
            opts.customerId ? eq(consQuotas.customerId, opts.customerId) : undefined,
            opts.groupCode ? eq(consQuotas.groupCode, opts.groupCode) : undefined,
            opts.sellerId === 'none' ? isNull(consQuotas.sellerId) : opts.sellerId ? eq(consQuotas.sellerId, opts.sellerId) : undefined,
          ),
        )
        .orderBy(desc(consQuotas.createdAt))
        .limit(500);
      const settings = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
      return rows.map((r) => toQuota(r, settings.commissionPercent));
    });
  }

  get(id: string): Promise<Quota> {
    return this.tdb.run(async (tx) => {
      const [row] = await this.quotaQuery(tx).where(eq(consQuotas.id, id));
      if (!row) throw new NotFoundException({ code: 'QUOTA_NOT_FOUND', message: 'Cota não encontrada' });
      const settings = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
      return toQuota(row, settings.commissionPercent);
    });
  }

  /**
   * Cancela a cota. Se estava ativa e o cancelamento acontece dentro do prazo de estorno, a comissão
   * volta: a pendente é cancelada e a já recebida vira uma despesa de estorno a acertar no financeiro.
   */
  cancel(id: string, reason: string): Promise<Quota> {
    return this.tdb
      .run(async (tx) => {
        const [row] = await tx.select({ q: consQuotas, plan: consPlans }).from(consQuotas).innerJoin(consPlans, eq(consPlans.id, consQuotas.planId)).where(eq(consQuotas.id, id)).for('update');
        if (!row || (row.q.status !== 'proposal' && row.q.status !== 'active')) throw badRequest('QUOTA_NOT_CANCELLABLE', 'Só cotas em análise ou ativas podem ser canceladas');
        await tx.update(consQuotas).set({ status: 'cancelled', statusMessage: reason, cancelledAt: new Date() }).where(eq(consQuotas.id, id));
        const reversal = row.q.status === 'active' ? await this.reverseCommissionInTx(tx, row.q, row.plan) : null;
        await this.audit.log(tx, { action: 'consortium.quota.cancelled', entity: 'cons_quota', entityId: id, data: { reason, reversal } });
        return id;
      })
      .then((qid) => this.get(qid));
  }

  private async reverseCommissionInTx(tx: Tx, q: QuotaRow, plan: PlanRow) {
    const { reversalMonths } = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
    if (!reversalMonths) return null;
    const today = localToday();
    if (today >= addMonths(localDate(q.activatedAt ?? q.createdAt), reversalMonths)) return null;
    const entries = (await this.finance.listBySourceInTx(tx, SOURCE, q.id)).filter((e) => e.kind === 'income');
    const pendingCents = entries.filter((e) => e.status === 'pending').reduce((s, e) => s + toCents(e.amount), 0);
    const paidCents = entries.filter((e) => e.status === 'paid').reduce((s, e) => s + toCents(e.amount), 0);
    if (!pendingCents && !paidCents) return null;
    // Ainda não recebida: a administradora não vai pagar; some do "a receber".
    if (pendingCents) await this.finance.cancelPendingBySourceInTx(tx, SOURCE, q.id);
    // Já recebida: a administradora desconta; fica uma despesa a acertar (a baixa é no financeiro).
    if (paidCents) {
      await this.finance.recordInTx(tx, {
        kind: 'expense',
        status: 'pending',
        description: `Estorno de comissão de consórcio — cota nº ${q.number} (${plan.institution})`,
        amount: paidCents / 100,
        dueDate: today,
        sourceType: REVERSAL_SOURCE,
        sourceId: q.id,
        settleInFinance: true,
        categoryKey: 'other_expense',
      });
    }
    await tx.update(consQuotas).set({ commissionReversedAt: new Date() }).where(eq(consQuotas.id, q.id));
    return { cancelledPending: pendingCents / 100, reversedPaid: paidCents / 100 };
  }

  /** Troca o vendedor de uma cota ainda em andamento (em análise, ativa ou contemplada). */
  assignSeller(id: string, sellerId: string): Promise<Quota> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb
      .run(async (tx) => {
        const [q] = await tx.select().from(consQuotas).where(eq(consQuotas.id, id)).for('update');
        if (!q) throw new NotFoundException({ code: 'QUOTA_NOT_FOUND', message: 'Cota não encontrada' });
        if (q.status === 'rejected' || q.status === 'cancelled') throw badRequest('QUOTA_CLOSED', 'Cota recusada ou cancelada');
        await this.checkSeller(tx, tenantId, sellerId);
        await tx.update(consQuotas).set({ sellerId }).where(eq(consQuotas.id, id));
        await this.audit.log(tx, { action: 'consortium.quota.seller_changed', entity: 'cons_quota', entityId: id, data: { from: q.sellerId, to: sellerId } });
      })
      .then(() => this.get(id));
  }

  /** Por vendedor, cotas vendidas no período: em análise, aceitas (com o crédito) e perdidas. */
  summary(opts: { from?: string; to?: string }): Promise<QuotasSummary> {
    const { from, to } = periodOf(opts.from, opts.to);
    const won = sql`${consQuotas.status} in ('active', 'contemplated')`;
    return this.tdb.run(async (tx) => {
      const sellers = await tx
        .select({
          sellerId: consQuotas.sellerId,
          sellerName: coreSchema.users.name,
          open: sql<number>`count(*) filter (where ${consQuotas.status} = 'proposal')`.mapWith(Number),
          won: sql<number>`count(*) filter (where ${won})`.mapWith(Number),
          wonValue: sql<number>`coalesce(sum(${consPlans.creditValue}) filter (where ${won}), 0)`.mapWith(Number),
          lost: sql<number>`count(*) filter (where ${consQuotas.status} in ('rejected', 'cancelled'))`.mapWith(Number),
        })
        .from(consQuotas)
        .innerJoin(consPlans, eq(consPlans.id, consQuotas.planId))
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, consQuotas.sellerId))
        .where(and(gte(consQuotas.createdAt, dayStart(from)), lt(consQuotas.createdAt, dayEnd(to))))
        .groupBy(consQuotas.sellerId, coreSchema.users.name);
      sellers.sort((a, b) => b.wonValue - a.wonValue || b.open - a.open || (a.sellerName ?? '').localeCompare(b.sellerName ?? ''));
      return { from, to, sellers };
    });
  }

  /**
   * Com a consulta de crédito contratada e a exigência ligada nas configurações: a venda precisa de
   * uma consulta do CPF/CNPJ do proponente nos últimos 30 dias, com a decisão "seguir".
   */
  private async assertCreditCheckInTx(tx: Tx, document: string) {
    if (!requestContext.get().modules?.has(CREDIT_BUREAU)) return;
    const { requireCreditApproval } = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
    if (!requireCreditApproval) return;
    const last = await this.credit.latestForDocumentInTx(tx, document, 30);
    if (!last) throw badRequest('CREDIT_CHECK_REQUIRED', 'Faça a consulta de crédito do proponente (com a autorização dele) antes de enviar a adesão');
    if (last.decision === 'rejected') throw badRequest('CREDIT_REJECTED', 'A consulta de crédito deste proponente foi reprovada');
    if (last.decision !== 'approved') throw badRequest('CREDIT_DECISION_PENDING', 'Registre a decisão da consulta de crédito ("seguir com a venda") antes de enviar a adesão');
  }

  /** O vendedor tem de estar ativo na equipe desta empresa. */
  private async checkSeller(tx: Tx, tenantId: string, userId: string) {
    const [m] = await tx
      .select({ id: coreSchema.memberships.id })
      .from(coreSchema.memberships)
      .where(and(eq(coreSchema.memberships.tenantId, tenantId), eq(coreSchema.memberships.userId, userId), eq(coreSchema.memberships.status, 'active')));
    if (!m) throw badRequest('SELLER_NOT_MEMBER', 'Vendedor não faz parte da equipe ativa');
  }

  // ---- Assembleias ----------------------------------------------------------------------------

  /**
   * Resultado da assembleia por grupo + data. Se ela estava agendada, o resultado entra nela (e
   * acerta os lances); se não existia, é criada já realizada. Realizada de novo: erro.
   */
  recordAssembly(input: AssemblyInput): Promise<Assembly> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [existing] = await tx.select().from(consAssemblies).where(and(eq(consAssemblies.groupCode, input.groupCode), eq(consAssemblies.heldOn, input.heldOn))).for('update');
      if (existing && existing.status === 'held') throw badRequest('ASSEMBLY_EXISTS', 'Esta assembleia já foi lançada');
      const row =
        existing ??
        (await tx
          .insert(consAssemblies)
          .values({ tenantId, groupCode: input.groupCode, heldOn: input.heldOn, status: 'held', drawn: input.drawn, bids: input.bids, notes: input.notes ?? null })
          .returning())[0]!;
      return this.applyResultsInTx(tx, tenantId, row, input);
    });
  }

  /** Resultado de uma assembleia agendada (pelo id). */
  recordResults(id: string, input: AssemblyResultsInput): Promise<Assembly> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [row] = await tx.select().from(consAssemblies).where(eq(consAssemblies.id, id)).for('update');
      if (!row) throw new NotFoundException({ code: 'ASSEMBLY_NOT_FOUND', message: 'Assembleia não encontrada' });
      if (row.status === 'held') throw badRequest('ASSEMBLY_EXISTS', 'Esta assembleia já foi lançada');
      return this.applyResultsInTx(tx, tenantId, row, input);
    });
  }

  /** Cotas da carteira sorteadas ou com lance vencedor ficam contempladas, os lances são acertados e o cliente é avisado. */
  private async applyResultsInTx(tx: Tx, tenantId: string, row: AssemblyRow, input: AssemblyResultsInput): Promise<Assembly> {
    await tx
      .update(consAssemblies)
      .set({ status: 'held', drawn: input.drawn, bids: input.bids, notes: input.notes ?? row.notes })
      .where(eq(consAssemblies.id, row.id));
    const winners = [...input.drawn.map((n) => ({ n, type: 'draw' as const, percent: null })), ...input.bids.map((b) => ({ n: b.quotaNumber, type: 'bid' as const, percent: b.percent }))];
    const contemplated = new Map<string, { q: QuotaRow; plan: PlanRow; type: 'draw' | 'bid' }>();
    if (winners.length) {
      const ours = await tx
        .select({ q: consQuotas, plan: consPlans })
        .from(consQuotas)
        .innerJoin(consPlans, eq(consPlans.id, consQuotas.planId))
        .where(and(eq(consQuotas.groupCode, row.groupCode), eq(consQuotas.status, 'active'), inArray(consQuotas.quotaNumber, winners.map((w) => w.n))));
      for (const { q, plan } of ours) {
        const w = winners.find((x) => x.n === q.quotaNumber)!;
        contemplated.set(q.id, { q, plan, type: w.type });
        await tx
          .update(consQuotas)
          .set({ status: 'contemplated', contemplatedOn: row.heldOn, contemplationType: w.type, bidPercent: w.percent != null ? w.percent.toFixed(2) : null })
          .where(eq(consQuotas.id, q.id));
        await this.customers.addTimeline(tx, { customerId: q.customerId, moduleKey: MODULE, type: 'quota.contemplated', title: `Cota ${q.quotaNumber} contemplada (${w.type === 'draw' ? 'sorteio' : 'lance'})`, entity: 'cons_quota', entityId: q.id });
        await this.notifications.enqueueInTx(tx, {
          templateKey: 'consortium.contemplated',
          customerId: q.customerId,
          related: { entity: 'cons_quota', id: q.id },
          data: { cota: { grupo: q.groupCode, numero: q.quotaNumber, credito: brl.format(Number(plan.creditValue)), forma: w.type === 'draw' ? 'sorteio' : 'lance' } },
        });
      }
    }
    const won = await settleBidsInTx(tx, row.id, {
      quotaIds: new Set(contemplated.keys()),
      bidQuotaIds: new Set([...contemplated.values()].filter((c) => c.type === 'bid').map((c) => c.q.id)),
    });
    for (const { q, plan } of contemplated.values()) {
      const bid = won.get(q.id);
      await openCreditInTx(tx, tenantId, q.id, plan.creditValue, bid?.type === 'embedded' ? bid.amount : null);
    }
    await this.audit.log(tx, { action: 'consortium.assembly.recorded', entity: 'cons_assembly', entityId: row.id });
    return (await this.assembliesInTx(tx, { id: row.id }))[0]!;
  }

  /** Agenda a próxima assembleia do grupo (sem resultado), para o calendário e para receber lances. */
  scheduleAssembly(input: AssemblyScheduleInput): Promise<Assembly> {
    const { tenantId } = requestContext.require();
    if (input.heldOn < localToday()) throw badRequest('ASSEMBLY_IN_PAST', 'Para assembleia que já aconteceu, lance o resultado');
    return this.tdb.run(async (tx) => {
      await this.assertFreeDate(tx, input.groupCode, input.heldOn);
      const [row] = await tx
        .insert(consAssemblies)
        .values({ tenantId, groupCode: input.groupCode, heldOn: input.heldOn, status: 'scheduled', drawn: [], bids: [], notes: input.notes ?? null })
        .returning();
      await this.audit.log(tx, { action: 'consortium.assembly.scheduled', entity: 'cons_assembly', entityId: row!.id, data: { groupCode: input.groupCode, heldOn: input.heldOn } });
      return (await this.assembliesInTx(tx, { id: row!.id }))[0]!;
    });
  }

  /** Remarca (data) ou anota uma assembleia ainda agendada; os lances acompanham. */
  updateAssembly(id: string, input: z.infer<typeof assemblyUpdateInput>): Promise<Assembly> {
    return this.tdb.run(async (tx) => {
      const row = await this.scheduledOrFail(tx, id);
      if (input.heldOn && input.heldOn !== row.heldOn) {
        if (input.heldOn < localToday()) throw badRequest('ASSEMBLY_IN_PAST', 'Para assembleia que já aconteceu, lance o resultado');
        await this.assertFreeDate(tx, row.groupCode, input.heldOn);
      }
      await tx
        .update(consAssemblies)
        .set({ heldOn: input.heldOn ?? row.heldOn, notes: input.notes === undefined ? row.notes : input.notes })
        .where(eq(consAssemblies.id, id));
      await this.audit.log(tx, { action: 'consortium.assembly.updated', entity: 'cons_assembly', entityId: id, data: { from: row.heldOn, to: input.heldOn ?? row.heldOn } });
      return (await this.assembliesInTx(tx, { id }))[0]!;
    });
  }

  /** Tira do calendário uma assembleia agendada que ainda não tem lances. */
  deleteAssembly(id: string): Promise<void> {
    return this.tdb.run(async (tx) => {
      await this.scheduledOrFail(tx, id);
      const [bid] = await tx.select({ id: consBids.id }).from(consBids).where(eq(consBids.assemblyId, id)).limit(1);
      if (bid) throw badRequest('ASSEMBLY_HAS_BIDS', 'Há lances registrados para esta assembleia: remarque em vez de excluir');
      await tx.delete(consAssemblies).where(eq(consAssemblies.id, id));
      await this.audit.log(tx, { action: 'consortium.assembly.deleted', entity: 'cons_assembly', entityId: id });
    });
  }

  private async scheduledOrFail(tx: Tx, id: string) {
    const [row] = await tx.select().from(consAssemblies).where(eq(consAssemblies.id, id)).for('update');
    if (!row) throw new NotFoundException({ code: 'ASSEMBLY_NOT_FOUND', message: 'Assembleia não encontrada' });
    if (row.status !== 'scheduled') throw badRequest('ASSEMBLY_HELD', 'Esta assembleia já tem resultado');
    return row;
  }

  private async assertFreeDate(tx: Tx, groupCode: string, heldOn: string) {
    const [dup] = await tx.select({ id: consAssemblies.id }).from(consAssemblies).where(and(eq(consAssemblies.groupCode, groupCode), eq(consAssemblies.heldOn, heldOn)));
    if (dup) throw badRequest('ASSEMBLY_EXISTS', 'Já existe assembleia deste grupo nesta data');
  }

  assemblies(opts: { from?: string; to?: string; status?: string; groupCode?: string } = {}): Promise<Assembly[]> {
    return this.tdb.run((tx) => this.assembliesInTx(tx, opts));
  }

  private async assembliesInTx(tx: Tx, opts: { id?: string; from?: string; to?: string; status?: string; groupCode?: string }): Promise<Assembly[]> {
    const rows = await tx
      .select()
      .from(consAssemblies)
      .where(
        and(
          opts.id ? eq(consAssemblies.id, opts.id) : undefined,
          opts.from ? gte(consAssemblies.heldOn, opts.from) : undefined,
          opts.to ? lte(consAssemblies.heldOn, opts.to) : undefined,
          opts.status ? eq(consAssemblies.status, opts.status as AssemblyRow['status']) : undefined,
          opts.groupCode ? eq(consAssemblies.groupCode, opts.groupCode) : undefined,
        ),
      )
      .orderBy(desc(consAssemblies.heldOn))
      .limit(200);
    const contemplated = rows.length
      ? await tx
          .select({ q: consQuotas, customer: customers.name })
          .from(consQuotas)
          .innerJoin(customers, eq(customers.id, consQuotas.customerId))
          .where(and(eq(consQuotas.status, 'contemplated'), inArray(consQuotas.groupCode, [...new Set(rows.map((r) => r.groupCode))])))
      : [];
    const bids = rows.length
      ? await tx
          .select({ b: consBids, quotaNumber: consQuotas.quotaNumber, customer: customers.name })
          .from(consBids)
          .innerJoin(consQuotas, eq(consQuotas.id, consBids.quotaId))
          .innerJoin(customers, eq(customers.id, consQuotas.customerId))
          .where(inArray(consBids.assemblyId, rows.map((r) => r.id)))
          .orderBy(asc(consBids.createdAt))
      : [];
    return rows.map((r) => ({
      id: r.id,
      groupCode: r.groupCode,
      heldOn: r.heldOn,
      status: r.status,
      drawn: r.drawn,
      bids: r.bids,
      notes: r.notes,
      ourWinners:
        r.status === 'held'
          ? contemplated
              .filter((c) => c.q.groupCode === r.groupCode && c.q.contemplatedOn === r.heldOn)
              .map((c) => ({ quotaId: c.q.id, customer: c.customer, quotaNumber: c.q.quotaNumber!, type: c.q.contemplationType! }))
          : [],
      ourBids: bids
        .filter((x) => x.b.assemblyId === r.id)
        .map((x) => ({ id: x.b.id, quotaId: x.b.quotaId, customer: x.customer, quotaNumber: x.quotaNumber, type: x.b.type, percent: Number(x.b.percent), amount: Number(x.b.amount), status: x.b.status })),
    }));
  }

  /**
   * Resposta da administradora à adesão. Aceita: cota ativa com grupo e número, comissão a receber
   * (percentual do plano, da administradora ou o padrão), calendário de parcelas e grupo cadastrado.
   */
  private onAdhesion(e: ProposalUpdated) {
    if (e.sourceType !== SOURCE) return Promise.resolve();
    return this.tdb.run(async (tx) => {
      const [row] = await tx.select({ q: consQuotas, plan: consPlans }).from(consQuotas).innerJoin(consPlans, eq(consPlans.id, consQuotas.planId)).where(eq(consQuotas.id, e.sourceId));
      if (!row || row.q.status !== 'proposal') return;
      const { q, plan } = row;
      if (e.status === 'rejected' || e.status === 'cancelled') {
        await tx.update(consQuotas).set({ status: 'rejected', statusMessage: 'Adesão não aceita pela administradora' }).where(eq(consQuotas.id, q.id));
        await this.leads.quotaOutcomeInTx(tx, q.id, 'rejected');
        return;
      }
      if (e.status !== 'approved' && e.status !== 'contracted') return;
      const groupCode = String(e.result.groupCode ?? '');
      const quotaNumber = String(e.result.quotaNumber ?? '');
      const settings = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
      const percent = await commissionPercentInTx(tx, plan, settings.commissionPercent);
      const commission = commissionCents(plan.creditValue, percent);
      const now = new Date();
      const [active] = await tx
        .update(consQuotas)
        .set({
          status: 'active',
          groupCode: groupCode || null,
          quotaNumber: quotaNumber || null,
          statusMessage: null,
          activatedAt: now,
          commissionPercent: percent.toFixed(3),
          commissionAmount: (commission / 100).toFixed(2),
        })
        .where(eq(consQuotas.id, q.id))
        .returning();
      if (commission > 0) {
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: 'pending',
          description: `Comissão de consórcio — cota nº ${q.number} (${plan.institution})`,
          amount: commission / 100,
          dueDate: localToday(),
          sourceType: SOURCE,
          settleInFinance: true,
          sourceId: q.id,
          categoryKey: 'services',
        });
      }
      // Acompanhamento: parcelas a partir do próximo vencimento (ajustável na cota) e o grupo.
      await generateInstallmentsInTx(tx, q.tenantId, active!, plan, { firstDueOn: firstDueAfter(localDate(now), q.dueDay) });
      if (groupCode) await ensureGroupInTx(tx, q.tenantId, plan, groupCode);
      await ensureAdministratorInTx(tx, q.tenantId, plan.connectionId, plan.institution);
      await this.leads.quotaOutcomeInTx(tx, q.id, 'won');
      await this.notifications.enqueueInTx(tx, {
        templateKey: 'consortium.active',
        customerId: q.customerId,
        related: { entity: 'cons_quota', id: q.id },
        data: { cota: { grupo: groupCode, numero: quotaNumber, credito: brl.format(Number(plan.creditValue)), parcela: brl.format(installmentOf(plan)) } },
      });
    });
  }

  private quotaQuery(tx: Tx) {
    return tx
      .select({
        q: consQuotas,
        plan: consPlans,
        adminPercent: consAdministrators.commissionPercent,
        customer: { id: customers.id, name: customers.name, phone: customers.phone },
        sellerName: coreSchema.users.name,
      })
      .from(consQuotas)
      .innerJoin(consPlans, eq(consPlans.id, consQuotas.planId))
      .innerJoin(customers, eq(customers.id, consQuotas.customerId))
      .leftJoin(consAdministrators, eq(consAdministrators.connectionId, consPlans.connectionId))
      .leftJoin(coreSchema.users, eq(coreSchema.users.id, consQuotas.sellerId))
      .$dynamic();
  }
}

function toPlan(p: PlanRow): Plan {
  const installment = installmentOf(p);
  return {
    id: p.id,
    institution: p.institution,
    connectionId: p.connectionId,
    name: p.name,
    assetType: p.assetType,
    creditValue: Number(p.creditValue),
    termMonths: p.termMonths,
    adminFeePercent: Number(p.adminFeePercent),
    reserveFundPercent: Number(p.reserveFundPercent),
    insurancePercent: Number(p.insurancePercent),
    installment,
    totalCost: Math.round((installment * p.termMonths - Number(p.creditValue)) * 100) / 100,
    active: p.active,
  };
}

function toQuota(row: { q: QuotaRow; plan: PlanRow; adminPercent: string | null; customer: Quota['customer']; sellerName: string | null }, defaultPercent: number): Quota {
  const { q, plan } = row;
  // Gravada na ativação; antes dela (ou cotas antigas), a vigente.
  const percent = q.commissionPercent != null ? Number(q.commissionPercent) : effectiveCommission(plan.commissionPercent, row.adminPercent, defaultPercent);
  const commission = q.commissionAmount != null ? Number(q.commissionAmount) : commissionCents(plan.creditValue, percent) / 100;
  return {
    id: q.id,
    number: q.number,
    customer: row.customer,
    plan: { id: plan.id, name: plan.name, institution: plan.institution, creditValue: Number(plan.creditValue), termMonths: plan.termMonths, installment: installmentOf(plan), assetType: plan.assetType },
    status: q.status,
    statusMessage: q.statusMessage,
    groupCode: q.groupCode,
    quotaNumber: q.quotaNumber,
    dueDay: q.dueDay,
    contemplatedOn: q.contemplatedOn,
    contemplationType: q.contemplationType,
    bidPercent: q.bidPercent === null ? null : Number(q.bidPercent),
    commissionPercent: percent,
    commission,
    commissionReversed: q.commissionReversedAt != null,
    sellerId: q.sellerId,
    sellerName: row.sellerName,
    activatedAt: q.activatedAt?.toISOString() ?? null,
    cancelledAt: q.cancelledAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
  };
}

const plansQuery = z.object({ assetType: z.string().max(20).optional(), minCredit: z.coerce.number().positive().optional(), maxCredit: z.coerce.number().positive().optional() });
const quotasQuery = z.object({
  status: z.string().max(20).optional(),
  customerId: z.string().uuid().optional(),
  groupCode: z.string().max(20).optional(),
  /** 'none' = cotas sem vendedor. */
  sellerId: z.string().uuid().or(z.literal('none')).optional(),
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const summaryQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() }).refine((q) => !q.from || !q.to || q.from <= q.to, 'Período inválido');
const assembliesQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), status: z.enum(assemblyStatuses).optional(), groupCode: z.string().max(20).optional() });

@Controller('consortium')
@ModuleRoute('consortium')
export class ConsortiumController {
  constructor(private readonly consortium: ConsortiumService) {}

  @Get('plans')
  @RequirePermission('consortium.read')
  plans(@Query(new ZodPipe(plansQuery)) q: z.infer<typeof plansQuery>) {
    return this.consortium.plans(q);
  }

  @Post('plans/sync')
  @HttpCode(200)
  @RequirePermission('consortium.manage')
  sync() {
    return this.consortium.syncPlans();
  }

  @Get('quotas')
  @RequirePermission('consortium.read')
  quotas(@Query(new ZodPipe(quotasQuery)) q: z.infer<typeof quotasQuery>) {
    return this.consortium.list(q);
  }

  /** Declarada antes de quotas/:id para "summary" não cair no ParseUUIDPipe. */
  @Get('quotas/summary')
  @RequirePermission('consortium.read')
  summary(@Query(new ZodPipe(summaryQuery)) q: z.infer<typeof summaryQuery>) {
    return this.consortium.summary(q);
  }

  @Get('quotas/:id')
  @RequirePermission('consortium.read')
  quota(@Param('id', ParseUUIDPipe) id: string) {
    return this.consortium.get(id);
  }

  @Post('quotas')
  @RequirePermission('consortium.sell')
  sell(@Body(new ZodPipe(quotaInput)) body: QuotaInput) {
    return this.consortium.sell(body);
  }

  @Patch('quotas/:id/seller')
  @RequirePermission('consortium.manage')
  assignSeller(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sellerInput)) body: z.infer<typeof sellerInput>) {
    return this.consortium.assignSeller(id, body.sellerId);
  }

  @Post('quotas/:id/cancel')
  @HttpCode(200)
  @RequirePermission('consortium.manage')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3).max(300) }))) body: { reason: string }) {
    return this.consortium.cancel(id, body.reason);
  }

  @Get('assemblies')
  @RequirePermission('consortium.read')
  assemblies(@Query(new ZodPipe(assembliesQuery)) q: z.infer<typeof assembliesQuery>) {
    return this.consortium.assemblies(q);
  }

  /** Resultado por grupo + data (preenche a agendada, se houver). */
  @Post('assemblies')
  @RequirePermission('consortium.manage')
  record(@Body(new ZodPipe(assemblyInput)) body: AssemblyInput) {
    return this.consortium.recordAssembly(body);
  }

  @Post('assemblies/schedule')
  @RequirePermission('consortium.manage')
  schedule(@Body(new ZodPipe(assemblyScheduleInput)) body: AssemblyScheduleInput) {
    return this.consortium.scheduleAssembly(body);
  }

  @Patch('assemblies/:id')
  @RequirePermission('consortium.manage')
  updateAssembly(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(assemblyUpdateInput)) body: z.infer<typeof assemblyUpdateInput>) {
    return this.consortium.updateAssembly(id, body);
  }

  @Delete('assemblies/:id')
  @HttpCode(204)
  @RequirePermission('consortium.manage')
  deleteAssembly(@Param('id', ParseUUIDPipe) id: string) {
    return this.consortium.deleteAssembly(id);
  }

  @Post('assemblies/:id/results')
  @HttpCode(200)
  @RequirePermission('consortium.manage')
  results(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(assemblyResultsInput)) body: AssemblyResultsInput) {
    return this.consortium.recordResults(id, body);
  }
}

@Module({
  imports: [BankingModule, NotificationsModule, CreditBureauModule],
  controllers: [ConsortiumController, TrackingController, LeadsController, PublicSimulatorController, LeadWebhooksController],
  providers: [ConsortiumService, TrackingService, LeadsService, LeadChannelsService, PublicSimulatorService, MetaLeadsAdapter, MetaGraphHttp],
})
export class ConsortiumModule {}
