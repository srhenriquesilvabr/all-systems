import { BankingModule, BankingService, consortiumInstallment, PROPOSAL_UPDATED, type ProposalUpdated } from '@all/banking';
import { AuditService, coreSchema, CustomersService, FinanceService, ModuleSettingsService, nextSequence, OutboxHandlers, TenantDb, toCents, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { NotificationsModule, NotificationsService } from '@all/notifications';
import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assemblyInput, quotaInput, type Assembly, type AssemblyInput, type Plan, type Quota, type QuotaInput, type QuotaStatus } from '../contracts';
import { consAssemblies, consPlans, consQuotas } from '../db/schema';
import type { ConsortiumSettings } from '../manifest';

const MODULE = 'consortium';
const SOURCE = 'consortium_quota';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

type PlanRow = typeof consPlans.$inferSelect;

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
      const [quota] = await tx
        .insert(consQuotas)
        .values({ tenantId, number: await nextSequence(tx, tenantId, 'cons_quota'), customerId: customer.id, planId: plan.id, dueDay: input.dueDay, sellerId: userId ?? null })
        .returning();
      await this.customers.addTimeline(tx, { customerId: customer.id, moduleKey: MODULE, type: 'quota.sold', title: `Consórcio: adesão ao plano ${plan.name} (${plan.institution})`, entity: 'cons_quota', entityId: quota!.id });
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

  list(opts: { status?: string; customerId?: string; groupCode?: string }): Promise<Quota[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.quotaQuery(tx)
        .where(
          and(
            opts.status ? eq(consQuotas.status, opts.status as QuotaStatus) : undefined,
            opts.customerId ? eq(consQuotas.customerId, opts.customerId) : undefined,
            opts.groupCode ? eq(consQuotas.groupCode, opts.groupCode) : undefined,
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

  cancel(id: string, reason: string): Promise<Quota> {
    return this.tdb.run(async (tx) => {
      const [q] = await tx.update(consQuotas).set({ status: 'cancelled', statusMessage: reason }).where(and(eq(consQuotas.id, id), inArray(consQuotas.status, ['proposal', 'active']))).returning();
      if (!q) throw badRequest('QUOTA_NOT_CANCELLABLE', 'Só cotas em análise ou ativas podem ser canceladas');
      await this.audit.log(tx, { action: 'consortium.quota.cancelled', entity: 'cons_quota', entityId: id, data: { reason } });
      return id;
    }).then((qid) => this.get(qid));
  }

  /** Assembleia do grupo: cotas da carteira sorteadas ou com lance vencedor ficam contempladas e o cliente é avisado. */
  recordAssembly(input: AssemblyInput): Promise<Assembly> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [existing] = await tx.select({ id: consAssemblies.id }).from(consAssemblies).where(and(eq(consAssemblies.groupCode, input.groupCode), eq(consAssemblies.heldOn, input.heldOn)));
      if (existing) throw badRequest('ASSEMBLY_EXISTS', 'Esta assembleia já foi lançada');
      const [row] = await tx
        .insert(consAssemblies)
        .values({ tenantId, groupCode: input.groupCode, heldOn: input.heldOn, drawn: input.drawn, bids: input.bids, notes: input.notes ?? null })
        .returning();
      const winners = [...input.drawn.map((n) => ({ n, type: 'draw' as const, percent: null })), ...input.bids.map((b) => ({ n: b.quotaNumber, type: 'bid' as const, percent: b.percent }))];
      if (winners.length) {
        const ours = await tx
          .select({ q: consQuotas, plan: consPlans })
          .from(consQuotas)
          .innerJoin(consPlans, eq(consPlans.id, consQuotas.planId))
          .where(and(eq(consQuotas.groupCode, input.groupCode), eq(consQuotas.status, 'active'), inArray(consQuotas.quotaNumber, winners.map((w) => w.n))));
        for (const { q, plan } of ours) {
          const w = winners.find((x) => x.n === q.quotaNumber)!;
          await tx
            .update(consQuotas)
            .set({ status: 'contemplated', contemplatedOn: input.heldOn, contemplationType: w.type, bidPercent: w.percent != null ? w.percent.toFixed(2) : null })
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
      await this.audit.log(tx, { action: 'consortium.assembly.recorded', entity: 'cons_assembly', entityId: row!.id });
      return (await this.assembliesInTx(tx, row!.id))[0]!;
    });
  }

  assemblies(): Promise<Assembly[]> {
    return this.tdb.run((tx) => this.assembliesInTx(tx));
  }

  private async assembliesInTx(tx: Tx, id?: string): Promise<Assembly[]> {
    const rows = await tx.select().from(consAssemblies).where(id ? eq(consAssemblies.id, id) : undefined).orderBy(desc(consAssemblies.heldOn)).limit(200);
    const contemplated = rows.length
      ? await tx
          .select({ q: consQuotas, customer: customers.name })
          .from(consQuotas)
          .innerJoin(customers, eq(customers.id, consQuotas.customerId))
          .where(and(eq(consQuotas.status, 'contemplated'), inArray(consQuotas.groupCode, [...new Set(rows.map((r) => r.groupCode))])))
      : [];
    return rows.map((r) => ({
      id: r.id,
      groupCode: r.groupCode,
      heldOn: r.heldOn,
      drawn: r.drawn,
      bids: r.bids,
      notes: r.notes,
      ourWinners: contemplated
        .filter((c) => c.q.groupCode === r.groupCode && c.q.contemplatedOn === r.heldOn)
        .map((c) => ({ quotaId: c.q.id, customer: c.customer, quotaNumber: c.q.quotaNumber!, type: c.q.contemplationType! })),
    }));
  }

  /** Resposta da administradora à adesão. Aceita: cota ativa com grupo e número, e comissão a receber. */
  private onAdhesion(e: ProposalUpdated) {
    if (e.sourceType !== SOURCE) return Promise.resolve();
    return this.tdb.run(async (tx) => {
      const [row] = await tx.select({ q: consQuotas, plan: consPlans }).from(consQuotas).innerJoin(consPlans, eq(consPlans.id, consQuotas.planId)).where(eq(consQuotas.id, e.sourceId));
      if (!row || row.q.status !== 'proposal') return;
      const { q, plan } = row;
      if (e.status === 'rejected' || e.status === 'cancelled') {
        await tx.update(consQuotas).set({ status: 'rejected', statusMessage: 'Adesão não aceita pela administradora' }).where(eq(consQuotas.id, q.id));
        return;
      }
      if (e.status !== 'approved' && e.status !== 'contracted') return;
      const groupCode = String(e.result.groupCode ?? '');
      const quotaNumber = String(e.result.quotaNumber ?? '');
      await tx.update(consQuotas).set({ status: 'active', groupCode: groupCode || null, quotaNumber: quotaNumber || null, statusMessage: null }).where(eq(consQuotas.id, q.id));
      const { commissionPercent } = await this.settings.getInTx<ConsortiumSettings>(tx, MODULE);
      const commission = Math.round((toCents(plan.creditValue) * commissionPercent) / 100);
      if (commission > 0) {
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: 'pending',
          description: `Comissão de consórcio — cota nº ${q.number} (${plan.institution})`,
          amount: commission / 100,
          dueDate: localToday(),
          sourceType: SOURCE,
          sourceId: q.id,
          categoryKey: 'services',
        });
      }
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
      .select({ q: consQuotas, plan: consPlans, customer: { id: customers.id, name: customers.name, phone: customers.phone }, sellerName: coreSchema.users.name })
      .from(consQuotas)
      .innerJoin(consPlans, eq(consPlans.id, consQuotas.planId))
      .innerJoin(customers, eq(customers.id, consQuotas.customerId))
      .leftJoin(coreSchema.users, eq(coreSchema.users.id, consQuotas.sellerId))
      .$dynamic();
  }
}

const installmentOf = (p: PlanRow) => consortiumInstallment(Number(p.creditValue), p.termMonths, Number(p.adminFeePercent), Number(p.reserveFundPercent), Number(p.insurancePercent));

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

function toQuota(row: { q: typeof consQuotas.$inferSelect; plan: PlanRow; customer: Quota['customer']; sellerName: string | null }, commissionPercent: number): Quota {
  const { q, plan } = row;
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
    commission: Math.round(Number(plan.creditValue) * commissionPercent) / 100,
    sellerName: row.sellerName,
    createdAt: q.createdAt.toISOString(),
  };
}

const plansQuery = z.object({ assetType: z.string().max(20).optional(), minCredit: z.coerce.number().positive().optional(), maxCredit: z.coerce.number().positive().optional() });
const quotasQuery = z.object({ status: z.string().max(20).optional(), customerId: z.string().uuid().optional(), groupCode: z.string().max(20).optional() });

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

  @Post('quotas/:id/cancel')
  @HttpCode(200)
  @RequirePermission('consortium.manage')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3).max(300) }))) body: { reason: string }) {
    return this.consortium.cancel(id, body.reason);
  }

  @Get('assemblies')
  @RequirePermission('consortium.read')
  assemblies() {
    return this.consortium.assemblies();
  }

  @Post('assemblies')
  @RequirePermission('consortium.manage')
  record(@Body(new ZodPipe(assemblyInput)) body: AssemblyInput) {
    return this.consortium.recordAssembly(body);
  }
}

@Module({ imports: [BankingModule, NotificationsModule], controllers: [ConsortiumController], providers: [ConsortiumService] })
export class ConsortiumModule {}
