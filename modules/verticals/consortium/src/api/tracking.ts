import { AuditService, CustomersService, ModuleSettingsService, ScheduledJobs, TenantDb, toCents, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { Body, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  bidInput,
  bidStatusInput,
  commissionRateInput,
  creditInput,
  groupInput,
  installmentPayInput,
  installmentsGenerateInput,
  normalizeCode,
  type Bid,
  type BidInput,
  type CommissionTable,
  type CreditInput,
  type CreditUsage,
  type Group,
  type GroupInput,
  type Installment,
  type InstallmentPayInput,
  type InstallmentsGenerateInput,
  type LateQuota,
  type QuotaInstallments,
  type QuotaStatus,
} from '../contracts';
import { consAdministrators, consAssemblies, consBids, consCredits, consGroups, consInstallments, consPlans, consQuotas } from '../db/schema';
import type { ConsortiumSettings } from '../manifest';
import { badRequest, brDate, brl, daysBetween, effectiveCommission, generateInstallmentsInTx, installmentOf, localToday, MODULE, monthsBetween, normCode, scheduledAssemblyInTx, type PlanRow, type QuotaRow } from './shared';

type InstallmentRow = typeof consInstallments.$inferSelect;
type BidRow = typeof consBids.$inferSelect;
type CreditRow = typeof consCredits.$inferSelect;
type GroupRow = typeof consGroups.$inferSelect;

const OPEN_QUOTA: QuotaStatus[] = ['active', 'contemplated'];
const notFound = (code: string, message: string) => new NotFoundException({ code, message });

/**
 * Acompanhamento das cotas pela corretora: parcelas (só registro, a administradora é quem cobra),
 * inadimplência com aviso ao cliente, lances, uso do crédito, grupos e tabela de comissões.
 */
@Injectable()
export class TrackingService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly jobs: ScheduledJobs,
    private readonly settings: ModuleSettingsService,
    private readonly notifications: NotificationsService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.jobs.every('consortium.late-notices', 60 * 60_000, () => this.sendLateNotices());
  }

  // ---- Parcelas -------------------------------------------------------------------------------

  installments(quotaId: string): Promise<QuotaInstallments> {
    return this.tdb.run(async (tx) => {
      const { q, plan } = await this.quotaOrFail(tx, quotaId);
      const rows = await tx.select().from(consInstallments).where(eq(consInstallments.quotaId, quotaId)).orderBy(asc(consInstallments.seq));
      const today = localToday();
      const items = rows.map((r) => toInstallment(r, q.status, today));
      const sum = (list: Installment[], f: (i: Installment) => number) => Math.round(list.reduce((s, i) => s + toCents(f(i)), 0)) / 100;
      const paid = items.filter((i) => i.status === 'paid');
      const late = items.filter((i) => i.status === 'late');
      return {
        quotaId,
        monthly: installmentOf(plan),
        dueDay: q.dueDay,
        generated: rows.length > 0,
        total: items.length,
        paidCount: paid.length,
        paidAmount: sum(paid, (i) => i.paidAmount ?? i.amount),
        lateCount: late.length,
        lateAmount: sum(late, (i) => i.amount),
        nextDue: items.find((i) => i.status === 'upcoming' || i.status === 'late') ?? null,
        items,
      };
    });
  }

  /** Gera (ou refaz) o calendário de parcelas da cota: só sem parcelas pagas. */
  generateInstallments(quotaId: string, input: InstallmentsGenerateInput): Promise<QuotaInstallments> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb
      .run(async (tx) => {
        const { q, plan } = await this.quotaOrFail(tx, quotaId, true);
        if (!OPEN_QUOTA.includes(q.status)) throw badRequest('QUOTA_NOT_ACTIVE', 'Só cotas ativas ou contempladas têm parcelas');
        const dueDay = Number(input.firstDueOn.slice(8, 10));
        const count = await generateInstallmentsInTx(tx, tenantId, q, plan, input);
        if (dueDay !== q.dueDay) await tx.update(consQuotas).set({ dueDay }).where(eq(consQuotas.id, q.id));
        await this.audit.log(tx, { action: 'consortium.installments.generated', entity: 'cons_quota', entityId: q.id, data: { ...input, count } });
      })
      .then(() => this.installments(quotaId));
  }

  /** Registra o pagamento informado pelo cliente ou pela administradora. Não gera lançamento no financeiro. */
  payInstallment(id: string, input: InstallmentPayInput): Promise<Installment> {
    const { userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const { i, q } = await this.installmentOrFail(tx, id);
      if (!OPEN_QUOTA.includes(q.status)) throw badRequest('QUOTA_CLOSED', 'Cota cancelada ou fora de acompanhamento');
      if (i.paidOn) throw badRequest('INSTALLMENT_PAID', 'Parcela já registrada como paga');
      if (input.paidOn > localToday()) throw badRequest('PAID_IN_FUTURE', 'A data do pagamento não pode ser futura');
      const [row] = await tx
        .update(consInstallments)
        .set({ paidOn: input.paidOn, paidAmount: (input.amount ?? Number(i.amount)).toFixed(2), notes: input.notes ?? i.notes, paidBy: userId ?? null })
        .where(eq(consInstallments.id, id))
        .returning();
      await this.audit.log(tx, { action: 'consortium.installment.paid', entity: 'cons_installment', entityId: id, data: { quotaId: q.id, seq: i.seq, ...input } });
      return toInstallment(row!, q.status, localToday());
    });
  }

  /** Desfaz um pagamento registrado por engano. */
  unpayInstallment(id: string): Promise<Installment> {
    return this.tdb.run(async (tx) => {
      const { i, q } = await this.installmentOrFail(tx, id);
      if (!i.paidOn) throw badRequest('INSTALLMENT_NOT_PAID', 'Parcela não está registrada como paga');
      const [row] = await tx.update(consInstallments).set({ paidOn: null, paidAmount: null, paidBy: null }).where(eq(consInstallments.id, id)).returning();
      await this.audit.log(tx, { action: 'consortium.installment.unpaid', entity: 'cons_installment', entityId: id, data: { quotaId: q.id, seq: i.seq, paidOn: i.paidOn } });
      return toInstallment(row!, q.status, localToday());
    });
  }

  /** Inadimplência: cotas ativas ou contempladas com parcelas vencidas sem pagamento registrado. */
  late(opts: { minDays?: number } = {}): Promise<LateQuota[]> {
    return this.tdb.run(async (tx) => {
      const today = localToday();
      const rows = await this.lateRows(tx, today);
      const byQuota = groupBy(rows, (r) => r.q.id);
      const list: LateQuota[] = [];
      for (const items of byQuota.values()) {
        const { q, plan, customer } = items[0]!;
        const installments = items.map(({ i }) => ({ id: i.id, seq: i.seq, dueOn: i.dueOn, amount: Number(i.amount), daysLate: daysBetween(i.dueOn, today) }));
        const notices = items.map(({ i }) => i.lateNoticeSentAt).filter((d): d is Date => d != null);
        list.push({
          quota: { id: q.id, number: q.number, groupCode: q.groupCode, quotaNumber: q.quotaNumber, planName: plan.name, institution: plan.institution, status: q.status },
          customer,
          lateCount: installments.length,
          lateAmount: Math.round(installments.reduce((s, x) => s + toCents(x.amount), 0)) / 100,
          oldestDueOn: installments[0]!.dueOn,
          daysLate: installments[0]!.daysLate,
          lastNoticeAt: notices.length ? new Date(Math.max(...notices.map((d) => d.getTime()))).toISOString() : null,
          installments,
        });
      }
      return list.filter((l) => !opts.minDays || l.daysLate >= opts.minDays).sort((a, b) => b.daysLate - a.daysLate || a.customer.name.localeCompare(b.customer.name));
    });
  }

  /** Aviso de atraso agora, sem esperar o prazo da configuração (ex.: botão na tela de inadimplência). */
  notifyLate(quotaId: string): Promise<{ sent: boolean }> {
    return this.tdb.run(async (tx) => {
      const today = localToday();
      const rows = (await this.lateRows(tx, today)).filter((r) => r.q.id === quotaId);
      if (!rows.length) throw badRequest('QUOTA_NOT_LATE', 'Esta cota não tem parcelas em atraso');
      await this.sendLateNoticeInTx(tx, rows, rows, today);
      return { sent: true };
    });
  }

  /** Job: avisa o cliente uma vez por parcela quando ela passa de N dias em atraso (N nas configurações). */
  async sendLateNotices() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const { lateNoticeDays } = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
          if (!lateNoticeDays) return;
          const today = localToday();
          for (const rows of groupBy(await this.lateRows(tx, today), (r) => r.q.id).values()) {
            const due = rows.filter((r) => !r.i.lateNoticeSentAt && daysBetween(r.i.dueOn, today) >= lateNoticeDays);
            if (due.length) await this.sendLateNoticeInTx(tx, rows, due, today);
          }
        }),
      );
    }
  }

  private async sendLateNoticeInTx(tx: Tx, allLate: LateRow[], toMark: LateRow[], today: string) {
    const { q, i } = toMark[0]!;
    await tx
      .update(consInstallments)
      .set({ lateNoticeSentAt: new Date() })
      .where(inArray(consInstallments.id, toMark.map((r) => r.i.id)));
    await this.notifications.enqueueInTx(tx, {
      templateKey: 'consortium.installment_late',
      customerId: q.customerId,
      related: { entity: 'cons_quota', id: q.id },
      data: {
        cota: { grupo: q.groupCode ?? '', numero: q.quotaNumber ?? String(q.number) },
        parcela: { numero: String(i.seq), valor: brl.format(Number(i.amount)), vencimento: brDate(i.dueOn), dias: String(daysBetween(i.dueOn, today)), atrasadas: String(allLate.length) },
      },
    });
  }

  lateRows(tx: Tx, today: string) {
    return tx
      .select({ i: consInstallments, q: consQuotas, plan: consPlans, customer: { id: customers.id, name: customers.name, phone: customers.phone } })
      .from(consInstallments)
      .innerJoin(consQuotas, eq(consQuotas.id, consInstallments.quotaId))
      .innerJoin(consPlans, eq(consPlans.id, consQuotas.planId))
      .innerJoin(customers, eq(customers.id, consQuotas.customerId))
      .where(and(isNull(consInstallments.paidOn), lt(consInstallments.dueOn, today), inArray(consQuotas.status, OPEN_QUOTA)))
      .orderBy(asc(consInstallments.dueOn), asc(consInstallments.seq))
      .limit(5000);
  }

  // ---- Lances ---------------------------------------------------------------------------------

  bids(quotaId: string): Promise<Bid[]> {
    return this.tdb.run(async (tx) => {
      await this.quotaOrFail(tx, quotaId);
      const rows = await tx
        .select({ b: consBids, a: consAssemblies })
        .from(consBids)
        .innerJoin(consAssemblies, eq(consAssemblies.id, consBids.assemblyId))
        .where(eq(consBids.quotaId, quotaId))
        .orderBy(desc(consAssemblies.heldOn));
      return rows.map((r) => toBid(r.b, r.a));
    });
  }

  /** Lance da cota para a próxima assembleia (agendada) do grupo dela. Percentual ou valor: o outro é calculado. */
  addBid(quotaId: string, input: BidInput): Promise<Bid> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const { q, plan } = await this.quotaOrFail(tx, quotaId, true);
      if (q.status !== 'active') throw badRequest('QUOTA_NOT_ACTIVE', 'Só cotas ativas (não contempladas) dão lance');
      const assembly = await scheduledAssemblyInTx(tx, input.assemblyId, q.groupCode, plan.connectionId);
      const creditCents = toCents(plan.creditValue);
      const amountCents = input.amount != null ? toCents(input.amount) : Math.round((creditCents * input.percent!) / 100);
      const percent = input.percent ?? Math.round((amountCents / creditCents) * 10_000) / 100;
      if (amountCents > creditCents || percent > 100) throw badRequest('BID_TOO_HIGH', 'O lance não pode passar do valor do crédito');
      const [dup] = await tx.select({ id: consBids.id }).from(consBids).where(and(eq(consBids.quotaId, q.id), eq(consBids.assemblyId, assembly.id)));
      if (dup) throw badRequest('BID_EXISTS', 'Já há lance desta cota para esta assembleia');
      const [row] = await tx
        .insert(consBids)
        .values({ tenantId, quotaId: q.id, assemblyId: assembly.id, type: input.type, percent: percent.toFixed(2), amount: (amountCents / 100).toFixed(2), notes: input.notes ?? null, createdBy: userId ?? null })
        .returning();
      await this.audit.log(tx, { action: 'consortium.bid.created', entity: 'cons_bid', entityId: row!.id, data: { quotaId: q.id, assemblyId: assembly.id, type: input.type, percent } });
      return toBid(row!, assembly);
    });
  }

  /** Registrado ↔ enviado à administradora (antes do resultado). */
  setBidStatus(id: string, status: 'registered' | 'sent'): Promise<Bid> {
    return this.tdb.run(async (tx) => {
      const { b, a } = await this.openBidOrFail(tx, id);
      const [row] = await tx.update(consBids).set({ status, updatedAt: new Date() }).where(eq(consBids.id, id)).returning();
      await this.audit.log(tx, { action: 'consortium.bid.status', entity: 'cons_bid', entityId: id, data: { from: b.status, to: status } });
      return toBid(row!, a);
    });
  }

  deleteBid(id: string): Promise<void> {
    return this.tdb.run(async (tx) => {
      const { b } = await this.openBidOrFail(tx, id);
      await tx.delete(consBids).where(eq(consBids.id, id));
      await this.audit.log(tx, { action: 'consortium.bid.deleted', entity: 'cons_bid', entityId: id, data: { quotaId: b.quotaId, assemblyId: b.assemblyId } });
    });
  }

  private async openBidOrFail(tx: Tx, id: string) {
    const [row] = await tx.select({ b: consBids, a: consAssemblies }).from(consBids).innerJoin(consAssemblies, eq(consAssemblies.id, consBids.assemblyId)).where(eq(consBids.id, id)).for('update');
    if (!row) throw notFound('BID_NOT_FOUND', 'Lance não encontrado');
    if (row.a.status !== 'scheduled' || (row.b.status !== 'registered' && row.b.status !== 'sent')) throw badRequest('BID_CLOSED', 'A assembleia deste lance já tem resultado');
    return row;
  }

  // ---- Crédito --------------------------------------------------------------------------------

  credit(quotaId: string): Promise<CreditUsage | null> {
    return this.tdb.run(async (tx) => {
      await this.quotaOrFail(tx, quotaId);
      const [row] = await tx.select().from(consCredits).where(eq(consCredits.quotaId, quotaId));
      return row ? toCredit(row) : null;
    });
  }

  /** Acompanhamento do crédito da cota contemplada: documentação, liberação e bem adquirido. */
  saveCredit(quotaId: string, input: CreditInput): Promise<CreditUsage> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const { q, plan } = await this.quotaOrFail(tx, quotaId, true);
      if (q.status !== 'contemplated') throw badRequest('QUOTA_NOT_CONTEMPLATED', 'Só cotas contempladas têm crédito a acompanhar');
      const [current] = await tx.select().from(consCredits).where(eq(consCredits.quotaId, quotaId));
      const values = {
        status: input.status,
        amount: (input.amount ?? Number(current?.amount ?? plan.creditValue)).toFixed(2),
        releasedOn: input.status === 'awaiting_docs' ? (input.releasedOn ?? null) : input.releasedOn!,
        assetDescription: input.assetDescription ?? null,
        acquiredOn: input.acquiredOn ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      };
      const [row] = current
        ? await tx.update(consCredits).set(values).where(eq(consCredits.id, current.id)).returning()
        : await tx.insert(consCredits).values({ tenantId, quotaId, ...values }).returning();
      if (current?.status !== input.status && input.status !== 'awaiting_docs') {
        const title = input.status === 'released' ? `Consórcio: crédito liberado (${brl.format(Number(values.amount))})` : `Consórcio: bem adquirido — ${values.assetDescription}`;
        await this.customers.addTimeline(tx, { customerId: q.customerId, moduleKey: MODULE, type: `quota.credit_${input.status}`, title, entity: 'cons_quota', entityId: q.id });
      }
      await this.audit.log(tx, { action: 'consortium.credit.updated', entity: 'cons_quota', entityId: q.id, data: { from: current?.status ?? null, ...input } });
      return toCredit(row!);
    });
  }

  // ---- Grupos ---------------------------------------------------------------------------------

  groups(): Promise<Group[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ g: consGroups, plan: { id: consPlans.id, name: consPlans.name, institution: consPlans.institution }, institution: consAdministrators.institution })
        .from(consGroups)
        .leftJoin(consPlans, eq(consPlans.id, consGroups.planId))
        .leftJoin(consAdministrators, eq(consAdministrators.connectionId, consGroups.connectionId))
        .orderBy(asc(consGroups.groupCode))
        .limit(1000);
      const stats = await this.groupStats(tx, rows.map((r) => r.g));
      return rows.map((r) => toGroup(r.g, r.plan, r.institution ?? r.plan?.institution ?? '', stats));
    });
  }

  /** Grupo da cota (pela administradora do plano e pelo código do grupo). Sem cadastro, só as estatísticas. */
  quotaGroup(quotaId: string): Promise<Group | null> {
    return this.tdb.run(async (tx) => {
      const { q, plan } = await this.quotaOrFail(tx, quotaId);
      if (!q.groupCode) return null;
      const [g] = await tx.select().from(consGroups).where(and(eq(consGroups.connectionId, plan.connectionId), eq(normCode(consGroups.groupCode), normalizeCode(q.groupCode))));
      const stats = await this.groupStats(tx, [{ connectionId: plan.connectionId, groupCode: q.groupCode }]);
      const groupPlan = g?.planId && g.planId !== plan.id ? (await tx.select().from(consPlans).where(eq(consPlans.id, g.planId)))[0] : plan;
      return toGroup(g ?? { id: null, connectionId: plan.connectionId, groupCode: q.groupCode, members: null, monthsRemaining: null, monthsRemainingOn: null, notes: null }, groupPlan ?? plan, plan.institution, stats);
    });
  }

  /** Cadastra ou atualiza o grupo (administradora do plano + código). */
  saveGroup(input: GroupInput): Promise<Group> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const [plan] = await tx.select().from(consPlans).where(eq(consPlans.id, input.planId));
      if (!plan) throw notFound('PLAN_NOT_FOUND', 'Plano não encontrado');
      const values = {
        planId: plan.id,
        members: input.members ?? null,
        monthsRemaining: input.monthsRemaining ?? null,
        monthsRemainingOn: input.monthsRemaining != null ? localToday() : null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      };
      // "012" e "12" são o mesmo grupo: atualiza o cadastro que já existe, sem reescrever o código.
      const [same] = await tx.select({ id: consGroups.id }).from(consGroups).where(and(eq(consGroups.connectionId, plan.connectionId), eq(normCode(consGroups.groupCode), normalizeCode(input.groupCode))));
      const [g] = same
        ? await tx.update(consGroups).set(values).where(eq(consGroups.id, same.id)).returning()
        : await tx.insert(consGroups).values({ tenantId, connectionId: plan.connectionId, groupCode: input.groupCode, ...values }).returning();
      await this.audit.log(tx, { action: 'consortium.group.saved', entity: 'cons_group', entityId: g!.id, data: input });
      return toGroup(g!, plan, plan.institution, await this.groupStats(tx, [g!]));
    });
  }

  /**
   * Assembleias realizadas (lances vencedores), próxima agendada e cotas da carteira, por grupo:
   * administradora + código normalizado. Assembleia antiga sem administradora conta nos grupos com o código.
   */
  private async groupStats(tx: Tx, groups: { connectionId: string; groupCode: string }[]): Promise<Map<string, GroupStats>> {
    const map = new Map<string, GroupStats>();
    if (!groups.length) return map;
    for (const g of groups) map.set(groupKey(g.connectionId, g.groupCode), { held: 0, bids: [], next: null, ourQuotas: 0 });
    const codes = [...new Set(groups.map((g) => normalizeCode(g.groupCode)))];
    const connections = [...new Set(groups.map((g) => g.connectionId))];
    const assemblies = await tx
      .select({ id: consAssemblies.id, connectionId: consAssemblies.connectionId, groupCode: consAssemblies.groupCode, heldOn: consAssemblies.heldOn, status: consAssemblies.status, bids: consAssemblies.bids })
      .from(consAssemblies)
      .where(and(inArray(normCode(consAssemblies.groupCode), codes), sql`(${consAssemblies.status} = 'held' or ${consAssemblies.heldOn} >= ${localToday()})`))
      .orderBy(asc(consAssemblies.heldOn));
    for (const a of assemblies) {
      for (const c of a.connectionId ? [a.connectionId] : connections) {
        const s = map.get(groupKey(c, a.groupCode));
        if (!s) continue;
        if (a.status === 'held') {
          s.held++;
          s.bids.push(...a.bids.map((b) => Number(b.percent)));
        } else if (!s.next) s.next = { id: a.id, heldOn: a.heldOn };
      }
    }
    const quotas = await tx
      .select({ connectionId: consPlans.connectionId, code: normCode(consQuotas.groupCode), n: sql<number>`count(*)`.mapWith(Number) })
      .from(consQuotas)
      .innerJoin(consPlans, eq(consPlans.id, consQuotas.planId))
      .where(and(inArray(normCode(consQuotas.groupCode), codes), inArray(consQuotas.status, OPEN_QUOTA)))
      .groupBy(consPlans.connectionId, normCode(consQuotas.groupCode));
    for (const q of quotas) {
      const s = map.get(groupKey(q.connectionId, q.code));
      if (s) s.ourQuotas = q.n;
    }
    return map;
  }

  // ---- Comissões ------------------------------------------------------------------------------

  commissions(): Promise<CommissionTable> {
    return this.tdb.run((tx) => this.commissionsInTx(tx));
  }

  /** Comissão da administradora (vale para os planos dela sem percentual próprio). null = usar a padrão. */
  setInstitutionCommission(connectionId: string, percent: number | null): Promise<CommissionTable> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const [plan] = await tx.select({ institution: consPlans.institution }).from(consPlans).where(eq(consPlans.connectionId, connectionId)).limit(1);
      const [admin] = await tx.select().from(consAdministrators).where(eq(consAdministrators.connectionId, connectionId));
      if (!plan && !admin) throw notFound('ADMINISTRATOR_NOT_FOUND', 'Administradora sem planos sincronizados');
      const values = { commissionPercent: percent == null ? null : percent.toFixed(3), updatedAt: new Date() };
      if (admin) await tx.update(consAdministrators).set(values).where(eq(consAdministrators.id, admin.id));
      else await tx.insert(consAdministrators).values({ tenantId, connectionId, institution: plan!.institution, ...values });
      await this.audit.log(tx, { action: 'consortium.commission.institution', entity: 'cons_administrator', entityId: connectionId, data: { from: admin?.commissionPercent ?? null, to: percent } });
      return this.commissionsInTx(tx);
    });
  }

  /** Comissão de um plano (prevalece sobre a da administradora). null = herdar. Cotas já ativas mantêm a gravada. */
  setPlanCommission(planId: string, percent: number | null): Promise<CommissionTable> {
    return this.tdb.run(async (tx) => {
      const [plan] = await tx
        .update(consPlans)
        .set({ commissionPercent: percent == null ? null : percent.toFixed(3) })
        .where(eq(consPlans.id, planId))
        .returning({ id: consPlans.id });
      if (!plan) throw notFound('PLAN_NOT_FOUND', 'Plano não encontrado');
      await this.audit.log(tx, { action: 'consortium.commission.plan', entity: 'cons_plan', entityId: planId, data: { to: percent } });
      return this.commissionsInTx(tx);
    });
  }

  private async commissionsInTx(tx: Tx): Promise<CommissionTable> {
    const settings = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
    const admins = await tx.select().from(consAdministrators);
    const plans = await tx.select().from(consPlans).orderBy(asc(consPlans.institution), asc(consPlans.creditValue), asc(consPlans.termMonths));
    const byConnection = new Map<string, CommissionTable['institutions'][number]>();
    for (const a of admins) byConnection.set(a.connectionId, { connectionId: a.connectionId, institution: a.institution, percent: a.commissionPercent == null ? null : Number(a.commissionPercent), plans: [] });
    for (const p of plans) {
      let inst = byConnection.get(p.connectionId);
      if (!inst) byConnection.set(p.connectionId, (inst = { connectionId: p.connectionId, institution: p.institution, percent: null, plans: [] }));
      const adminPercent = admins.find((a) => a.connectionId === p.connectionId)?.commissionPercent;
      inst.plans.push({
        id: p.id,
        name: p.name,
        creditValue: Number(p.creditValue),
        termMonths: p.termMonths,
        active: p.active,
        percent: p.commissionPercent == null ? null : Number(p.commissionPercent),
        effectivePercent: effectiveCommission(p.commissionPercent, adminPercent, settings.commissionPercent),
      });
    }
    return {
      defaultPercent: settings.commissionPercent,
      reversalMonths: settings.reversalMonths,
      institutions: [...byConnection.values()].sort((a, b) => a.institution.localeCompare(b.institution)),
    };
  }

  // ---- internos -------------------------------------------------------------------------------

  private async quotaOrFail(tx: Tx, id: string, lock = false): Promise<{ q: QuotaRow; plan: PlanRow }> {
    const query = tx.select({ q: consQuotas, plan: consPlans }).from(consQuotas).innerJoin(consPlans, eq(consPlans.id, consQuotas.planId)).where(eq(consQuotas.id, id));
    const [row] = lock ? await query.for('update', { of: consQuotas }) : await query;
    if (!row) throw notFound('QUOTA_NOT_FOUND', 'Cota não encontrada');
    return row;
  }

  private async installmentOrFail(tx: Tx, id: string) {
    const [row] = await tx
      .select({ i: consInstallments, q: consQuotas })
      .from(consInstallments)
      .innerJoin(consQuotas, eq(consQuotas.id, consInstallments.quotaId))
      .where(eq(consInstallments.id, id))
      .for('update', { of: consInstallments });
    if (!row) throw notFound('INSTALLMENT_NOT_FOUND', 'Parcela não encontrada');
    return row;
  }
}

type LateRow = Awaited<ReturnType<TrackingService['lateRows']>>[number];
interface GroupStats {
  held: number;
  bids: number[];
  next: { id: string; heldOn: string } | null;
  ourQuotas: number;
}

const groupKey = (connectionId: string, groupCode: string) => `${connectionId}|${normalizeCode(groupCode)}`;

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

function toInstallment(r: InstallmentRow, quotaStatus: QuotaStatus, today: string): Installment {
  const status = r.paidOn ? 'paid' : !OPEN_QUOTA.includes(quotaStatus) ? 'cancelled' : r.dueOn < today ? 'late' : 'upcoming';
  return {
    id: r.id,
    seq: r.seq,
    dueOn: r.dueOn,
    amount: Number(r.amount),
    status,
    paidOn: r.paidOn,
    paidAmount: r.paidAmount == null ? null : Number(r.paidAmount),
    daysLate: status === 'late' ? daysBetween(r.dueOn, today) : 0,
    notes: r.notes,
    lateNoticeSentAt: r.lateNoticeSentAt?.toISOString() ?? null,
  };
}

function toBid(b: BidRow, a: typeof consAssemblies.$inferSelect): Bid {
  return {
    id: b.id,
    quotaId: b.quotaId,
    assembly: { id: a.id, groupCode: a.groupCode, heldOn: a.heldOn, status: a.status },
    type: b.type,
    percent: Number(b.percent),
    amount: Number(b.amount),
    status: b.status,
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
  };
}

function toCredit(c: CreditRow): CreditUsage {
  return {
    quotaId: c.quotaId,
    status: c.status,
    amount: Number(c.amount),
    releasedOn: c.releasedOn,
    assetDescription: c.assetDescription,
    acquiredOn: c.acquiredOn,
    notes: c.notes,
    updatedAt: c.updatedAt.toISOString(),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function toGroup(
  g: Pick<GroupRow, 'connectionId' | 'groupCode' | 'members' | 'monthsRemaining' | 'monthsRemainingOn' | 'notes'> & { id: string | null },
  plan: { id: string; name: string } | null,
  institution: string,
  stats: Map<string, GroupStats>,
): Group {
  const s = stats.get(groupKey(g.connectionId, g.groupCode)) ?? { held: 0, bids: [], next: null, ourQuotas: 0 };
  const elapsed = g.monthsRemainingOn ? Math.max(0, monthsBetween(g.monthsRemainingOn, localToday())) : 0;
  return {
    id: g.id,
    connectionId: g.connectionId,
    institution,
    plan: plan ? { id: plan.id, name: plan.name } : null,
    groupCode: g.groupCode,
    members: g.members,
    monthsRemaining: g.monthsRemaining == null ? null : Math.max(0, g.monthsRemaining - elapsed),
    notes: g.notes,
    assembliesHeld: s.held,
    averageWinningBid: s.bids.length ? round2(s.bids.reduce((a, b) => a + b, 0) / s.bids.length) : null,
    minWinningBid: s.bids.length ? Math.min(...s.bids) : null,
    maxWinningBid: s.bids.length ? Math.max(...s.bids) : null,
    nextAssembly: s.next,
    ourQuotas: s.ourQuotas,
  };
}

const lateQuery = z.object({ minDays: z.coerce.number().int().min(0).max(3650).optional() });

@Controller('consortium')
@ModuleRoute('consortium')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  // Parcelas
  @Get('quotas/:id/installments')
  @RequirePermission('consortium.read')
  installments(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.installments(id);
  }

  @Post('quotas/:id/installments')
  @HttpCode(200)
  @RequirePermission('consortium.manage')
  generate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(installmentsGenerateInput)) body: InstallmentsGenerateInput) {
    return this.tracking.generateInstallments(id, body);
  }

  @Post('installments/:id/pay')
  @HttpCode(200)
  @RequirePermission('consortium.track')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(installmentPayInput)) body: InstallmentPayInput) {
    return this.tracking.payInstallment(id, body);
  }

  @Post('installments/:id/unpay')
  @HttpCode(200)
  @RequirePermission('consortium.track')
  unpay(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.unpayInstallment(id);
  }

  @Get('installments/late')
  @RequirePermission('consortium.read')
  late(@Query(new ZodPipe(lateQuery)) q: z.infer<typeof lateQuery>) {
    return this.tracking.late(q);
  }

  @Post('quotas/:id/late-notice')
  @HttpCode(200)
  @RequirePermission('consortium.track')
  notifyLate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.notifyLate(id);
  }

  // Lances
  @Get('quotas/:id/bids')
  @RequirePermission('consortium.read')
  bids(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.bids(id);
  }

  @Post('quotas/:id/bids')
  @RequirePermission('consortium.track')
  addBid(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(bidInput)) body: BidInput) {
    return this.tracking.addBid(id, body);
  }

  @Patch('bids/:id')
  @RequirePermission('consortium.track')
  bidStatus(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(bidStatusInput)) body: z.infer<typeof bidStatusInput>) {
    return this.tracking.setBidStatus(id, body.status);
  }

  @Delete('bids/:id')
  @HttpCode(204)
  @RequirePermission('consortium.track')
  deleteBid(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.deleteBid(id);
  }

  // Crédito
  @Get('quotas/:id/credit')
  @RequirePermission('consortium.read')
  credit(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.credit(id);
  }

  @Put('quotas/:id/credit')
  @RequirePermission('consortium.track')
  saveCredit(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(creditInput)) body: CreditInput) {
    return this.tracking.saveCredit(id, body);
  }

  // Grupos
  @Get('groups')
  @RequirePermission('consortium.read')
  groups() {
    return this.tracking.groups();
  }

  @Put('groups')
  @RequirePermission('consortium.manage')
  saveGroup(@Body(new ZodPipe(groupInput)) body: GroupInput) {
    return this.tracking.saveGroup(body);
  }

  @Get('quotas/:id/group')
  @RequirePermission('consortium.read')
  quotaGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.quotaGroup(id);
  }

  // Comissões
  @Get('commissions')
  @RequirePermission('consortium.manage')
  commissions() {
    return this.tracking.commissions();
  }

  @Put('commissions/institutions/:connectionId')
  @RequirePermission('consortium.manage')
  institutionCommission(@Param('connectionId', ParseUUIDPipe) connectionId: string, @Body(new ZodPipe(commissionRateInput)) body: z.infer<typeof commissionRateInput>) {
    return this.tracking.setInstitutionCommission(connectionId, body.percent);
  }

  @Put('commissions/plans/:planId')
  @RequirePermission('consortium.manage')
  planCommission(@Param('planId', ParseUUIDPipe) planId: string, @Body(new ZodPipe(commissionRateInput)) body: z.infer<typeof commissionRateInput>) {
    return this.tracking.setPlanCommission(planId, body.percent);
  }
}
