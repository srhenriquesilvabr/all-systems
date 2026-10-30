import { AuditService, FinanceService, ModuleHooks, TenantDb, centsToDecimal, centsToNumber, toCents } from '@all/core';
import { customers, teamMembers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { SchedulingService, utcToLocal } from '@all/scheduling';
import { schAppointments, schAppointmentServices, schResources, schServices } from '@all/scheduling/schema';
import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { CommissionPayout, CommissionPayoutInput, CommissionReport, CommissionRules, CommissionRulesInput, MyCommission } from '../contracts';
import { beautyCommissionLines, beautyCommissionPayouts, beautyCommissionRules } from '../db/schema';

const MODULE = 'beauty';
/** Origem do lançamento no financeiro: a despesa de comissão de um profissional num período. */
const SOURCE = 'beauty_commission';

const SALON_SERVICES = [
  { name: 'Corte feminino', category: 'Cabelo', durationMin: 60, price: '90.00' },
  { name: 'Corte masculino', category: 'Cabelo', durationMin: 30, price: '45.00' },
  { name: 'Escova', category: 'Cabelo', durationMin: 45, price: '60.00' },
  { name: 'Coloração', category: 'Cabelo', durationMin: 120, price: '180.00' },
  { name: 'Hidratação', category: 'Cabelo', durationMin: 45, price: '80.00' },
  { name: 'Barba', category: 'Barbearia', durationMin: 30, price: '35.00' },
  { name: 'Manicure', category: 'Unhas', durationMin: 45, price: '35.00' },
  { name: 'Pedicure', category: 'Unhas', durationMin: 45, price: '40.00' },
  { name: 'Design de sobrancelha', category: 'Estética', durationMin: 30, price: '40.00' },
];

const brDate = (iso: string) => iso.split('-').reverse().join('/');
const periodStart = (from: string) => sql`(${from}::date)::timestamp at time zone 'America/Sao_Paulo'`;
const periodEnd = (to: string) => sql`((${to}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;

type RuleRow = typeof beautyCommissionRules.$inferSelect;

/** Percentual do serviço, ou o padrão do profissional, ou zero. */
function rateFrom(rules: RuleRow[], resourceId: string, serviceId: string | null) {
  return Number(
    rules.find((r) => r.resourceId === resourceId && r.serviceId && r.serviceId === serviceId)?.rate ??
      rules.find((r) => r.resourceId === resourceId && !r.serviceId)?.rate ??
      0,
  );
}

@Injectable()
export class BeautyService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
    private readonly hooks: ModuleHooks,
    private readonly finance: FinanceService,
    private readonly scheduling: SchedulingService,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    // Concluído: o percentual fica gravado, na mesma transação. Mudar a regra depois não mexe nele.
    this.scheduling.registerStatusHook({
      moduleKey: MODULE,
      onStatus: async (tx, ctx) => {
        if (ctx.status === 'done') await this.freezeLines(tx, [ctx.appointmentId]);
      },
    });
  }

  rules(): Promise<CommissionRules[]> {
    return this.tdb.run(async (tx) => {
      const [resources, rules] = await Promise.all([
        tx.select({ id: schResources.id }).from(schResources).where(eq(schResources.kind, 'professional')),
        tx.select().from(beautyCommissionRules),
      ]);
      return resources.map((r) => {
        const mine = rules.filter((x) => x.resourceId === r.id);
        return {
          resourceId: r.id,
          defaultRate: Number(mine.find((x) => !x.serviceId)?.rate ?? 0),
          services: mine.filter((x) => x.serviceId).map((x) => ({ serviceId: x.serviceId!, rate: Number(x.rate) })),
        };
      });
    });
  }

  setRules(resourceId: string, input: CommissionRulesInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [resource] = await tx.select({ id: schResources.id }).from(schResources).where(eq(schResources.id, resourceId));
      if (!resource) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Profissional não encontrado' });
      await tx.delete(beautyCommissionRules).where(eq(beautyCommissionRules.resourceId, resourceId));
      await tx.insert(beautyCommissionRules).values([
        { tenantId, resourceId, serviceId: null, rate: input.defaultRate.toFixed(2) },
        ...input.services.map((s) => ({ tenantId, resourceId, serviceId: s.serviceId, rate: s.rate.toFixed(2) })),
      ]);
      await this.audit.log(tx, { action: 'beauty.commissions.updated', entity: 'sch_resource', entityId: resourceId, data: input });
    });
  }

  /**
   * Comissões do período: atendimentos concluídos, linha a linha, com o percentual gravado na
   * conclusão sobre o preço cobrado. Atendimento antigo ainda sem percentual gravado usa o atual
   * (o backfill grava os antigos; a primeira vez que entram no financeiro também).
   */
  report(from: string, to: string): Promise<CommissionReport> {
    return this.tdb.run((tx) => this.reportInTx(tx, from, to));
  }

  /** O próprio profissional: só as linhas dele, pelo usuário ligado ao profissional ou à pessoa da equipe. */
  mine(from: string, to: string): Promise<MyCommission> {
    const { userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const resources = await this.resourcesOfUser(tx, userId!);
      if (!resources.length) return { linked: false, period: { from, to }, professionals: [] };
      return { linked: true, ...(await this.reportInTx(tx, from, to, resources)) };
    });
  }

  /**
   * Lança a comissão a pagar como despesa, uma por profissional. Só entram as linhas do período que
   * ainda não foram lançadas (travadas até o fim da transação), então repetir o período, ou lançar
   * um período que cruza outro, não duplica nada.
   */
  createPayouts(input: CommissionPayoutInput): Promise<CommissionPayout[]> {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const inPeriod = and(
        eq(schAppointments.status, 'done'),
        gte(schAppointments.startsAt, periodStart(input.from)),
        lt(schAppointments.startsAt, periodEnd(input.to)),
        input.resourceId ? eq(schAppointments.resourceId, input.resourceId) : undefined,
      );
      // Antigo sem percentual gravado: grava o atual agora (daqui em diante não muda mais).
      const open = await tx
        .selectDistinct({ id: schAppointments.id })
        .from(schAppointments)
        .innerJoin(schAppointmentServices, eq(schAppointmentServices.appointmentId, schAppointments.id))
        .leftJoin(beautyCommissionLines, eq(beautyCommissionLines.appointmentServiceId, schAppointmentServices.id))
        .where(and(inPeriod, isNull(beautyCommissionLines.id)));
      await this.freezeLines(tx, open.map((a) => a.id));

      const lines = await tx
        .select({ id: beautyCommissionLines.id, resourceId: beautyCommissionLines.resourceId, commission: beautyCommissionLines.commission, resourceName: schResources.name })
        .from(beautyCommissionLines)
        .innerJoin(schAppointments, eq(schAppointments.id, beautyCommissionLines.appointmentId))
        .innerJoin(schResources, eq(schResources.id, beautyCommissionLines.resourceId))
        .where(and(inPeriod, isNull(beautyCommissionLines.payoutId), gt(beautyCommissionLines.commission, '0')))
        .for('update', { of: beautyCommissionLines });
      if (!lines.length) throw new ConflictException({ code: 'NOTHING_TO_LAUNCH', message: 'Não há comissão a lançar neste período: já foi lançada ou está zerada' });

      const byResource = new Map<string, { name: string; cents: number; ids: string[] }>();
      for (const l of lines) {
        const acc = byResource.get(l.resourceId) ?? { name: l.resourceName, cents: 0, ids: [] };
        acc.cents += toCents(l.commission);
        acc.ids.push(l.id);
        byResource.set(l.resourceId, acc);
      }

      const created: string[] = [];
      for (const [resourceId, acc] of byResource) {
        const [payout] = await tx
          .insert(beautyCommissionPayouts)
          .values({ tenantId, resourceId, periodFrom: input.from, periodTo: input.to, amount: centsToDecimal(acc.cents), dueDate: input.dueDate, createdBy: userId ?? null })
          .returning();
        const entry = await this.finance.recordInTx(tx, {
          kind: 'expense',
          status: 'pending',
          description: `Comissão de ${acc.name}: ${brDate(input.from)} a ${brDate(input.to)}`,
          amount: centsToNumber(acc.cents),
          dueDate: input.dueDate,
          sourceType: SOURCE,
          settleInFinance: true,
          sourceId: payout!.id,
          categoryKey: 'payroll',
        });
        await tx.update(beautyCommissionPayouts).set({ finEntryId: entry.id }).where(eq(beautyCommissionPayouts.id, payout!.id));
        await tx.update(beautyCommissionLines).set({ payoutId: payout!.id }).where(inArray(beautyCommissionLines.id, acc.ids));
        await this.audit.log(tx, { action: 'beauty.commissions.launched', entity: 'beauty_commission_payout', entityId: payout!.id, data: { resourceId, from: input.from, to: input.to, amount: centsToNumber(acc.cents), lines: acc.ids.length } });
        created.push(payout!.id);
      }
      return this.payoutDtos(tx, inArray(beautyCommissionPayouts.id, created));
    });
  }

  listPayouts(from: string, to: string): Promise<CommissionPayout[]> {
    return this.tdb.run((tx) => this.payoutDtos(tx, and(lt(beautyCommissionPayouts.periodFrom, sql`(${to}::date + 1)`), gte(beautyCommissionPayouts.periodTo, from))));
  }

  /** Lançou errado: enquanto não foi pago, cancela a despesa e as linhas voltam a ficar a lançar. */
  cancelPayout(id: string, reason: string): Promise<CommissionPayout> {
    return this.tdb.run(async (tx) => {
      const [payout] = await tx.select().from(beautyCommissionPayouts).where(eq(beautyCommissionPayouts.id, id)).for('update');
      if (!payout) throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', message: 'Lançamento de comissão não encontrado' });
      if (payout.status === 'cancelled') throw new ConflictException({ code: 'PAYOUT_CANCELLED', message: 'Este lançamento já foi cancelado' });
      const cancelled = await this.finance.cancelPendingBySourceInTx(tx, SOURCE, id);
      if (!cancelled) throw new ConflictException({ code: 'PAYOUT_PAID', message: 'Esta comissão já foi paga no financeiro e não pode ser cancelada aqui' });
      await tx.update(beautyCommissionPayouts).set({ status: 'cancelled', cancelReason: reason }).where(eq(beautyCommissionPayouts.id, id));
      await tx.update(beautyCommissionLines).set({ payoutId: null }).where(eq(beautyCommissionLines.payoutId, id));
      await this.audit.log(tx, { action: 'beauty.commissions.launch_cancelled', entity: 'beauty_commission_payout', entityId: id, data: { reason, amount: Number(payout.amount) } });
      return (await this.payoutDtos(tx, eq(beautyCommissionPayouts.id, id)))[0]!;
    });
  }

  // ---- internos -------------------------------------------------------------------------------

  /** Grava percentual e valor das linhas ainda sem gravação (idempotente), com a regra de agora. */
  private async freezeLines(tx: Tx, appointmentIds: string[]) {
    if (!appointmentIds.length) return;
    const { tenantId } = requestContext.requireTenant();
    const lines = await tx
      .select({ id: schAppointmentServices.id, appointmentId: schAppointmentServices.appointmentId, serviceId: schAppointmentServices.serviceId, price: schAppointmentServices.price, resourceId: schAppointments.resourceId })
      .from(schAppointmentServices)
      .innerJoin(schAppointments, eq(schAppointments.id, schAppointmentServices.appointmentId))
      .where(inArray(schAppointmentServices.appointmentId, appointmentIds));
    if (!lines.length) return;
    const rules = await tx.select().from(beautyCommissionRules).where(inArray(beautyCommissionRules.resourceId, [...new Set(lines.map((l) => l.resourceId))]));
    await tx
      .insert(beautyCommissionLines)
      .values(
        lines.map((l) => {
          const rate = rateFrom(rules, l.resourceId, l.serviceId);
          return {
            tenantId,
            appointmentServiceId: l.id,
            appointmentId: l.appointmentId,
            resourceId: l.resourceId,
            serviceId: l.serviceId,
            rate: rate.toFixed(2),
            commission: centsToDecimal(Math.round((toCents(l.price) * rate) / 100)),
          };
        }),
      )
      .onConflictDoNothing({ target: beautyCommissionLines.appointmentServiceId });
  }

  private async reportInTx(tx: Tx, from: string, to: string, resourceIds?: string[]): Promise<CommissionReport> {
    const [lines, rules] = await Promise.all([
      tx
        .select({
          appointmentId: schAppointments.id,
          startsAt: schAppointments.startsAt,
          resourceId: schAppointments.resourceId,
          resourceName: schResources.name,
          customer: customers.name,
          serviceId: schAppointmentServices.serviceId,
          service: schAppointmentServices.name,
          price: schAppointmentServices.price,
          frozenRate: beautyCommissionLines.rate,
          frozenCommission: beautyCommissionLines.commission,
          payoutId: beautyCommissionLines.payoutId,
        })
        .from(schAppointmentServices)
        .innerJoin(schAppointments, eq(schAppointments.id, schAppointmentServices.appointmentId))
        .innerJoin(schResources, eq(schResources.id, schAppointments.resourceId))
        .innerJoin(customers, eq(customers.id, schAppointments.customerId))
        .leftJoin(beautyCommissionLines, eq(beautyCommissionLines.appointmentServiceId, schAppointmentServices.id))
        .where(
          and(
            eq(schAppointments.status, 'done'),
            gte(schAppointments.startsAt, periodStart(from)),
            lt(schAppointments.startsAt, periodEnd(to)),
            resourceIds ? inArray(schAppointments.resourceId, resourceIds) : undefined,
          ),
        )
        .orderBy(asc(schResources.name), asc(schAppointments.startsAt)),
      tx.select().from(beautyCommissionRules),
    ]);

    const byResource = new Map<string, CommissionReport['professionals'][number] & { ids: Set<string>; revenueCents: number; commissionCents: number; launchedCents: number }>();
    for (const l of lines) {
      const entry =
        byResource.get(l.resourceId) ??
        { resourceId: l.resourceId, name: l.resourceName, appointments: 0, revenue: 0, commission: 0, launched: 0, toLaunch: 0, lines: [], ids: new Set<string>(), revenueCents: 0, commissionCents: 0, launchedCents: 0 };
      const rate = l.frozenRate !== null ? Number(l.frozenRate) : rateFrom(rules, l.resourceId, l.serviceId);
      const price = toCents(l.price);
      const commission = l.frozenCommission !== null ? toCents(l.frozenCommission) : Math.round((price * rate) / 100);
      entry.ids.add(l.appointmentId);
      entry.revenueCents += price;
      entry.commissionCents += commission;
      if (l.payoutId) entry.launchedCents += commission;
      entry.lines.push({ date: utcToLocal(l.startsAt).date, customer: l.customer, service: l.service, price: centsToNumber(price), rate, commission: centsToNumber(commission), launched: !!l.payoutId });
      byResource.set(l.resourceId, entry);
    }
    return {
      period: { from, to },
      professionals: [...byResource.values()].map(({ ids, revenueCents, commissionCents, launchedCents, ...p }) => ({
        ...p,
        appointments: ids.size,
        revenue: centsToNumber(revenueCents),
        commission: centsToNumber(commissionCents),
        launched: centsToNumber(launchedCents),
        toLaunch: centsToNumber(commissionCents - launchedCents),
      })),
    };
  }

  private async resourcesOfUser(tx: Tx, userId: string) {
    const rows = await tx
      .select({ id: schResources.id })
      .from(schResources)
      .leftJoin(teamMembers, eq(teamMembers.id, schResources.teamMemberId))
      .where(and(eq(schResources.kind, 'professional'), or(eq(schResources.userId, userId), eq(teamMembers.userId, userId))));
    return rows.map((r) => r.id);
  }

  private async payoutDtos(tx: Tx, where: SQL | undefined): Promise<CommissionPayout[]> {
    const rows = await tx
      .select({ p: beautyCommissionPayouts, resourceName: schResources.name })
      .from(beautyCommissionPayouts)
      .innerJoin(schResources, eq(schResources.id, beautyCommissionPayouts.resourceId))
      .where(where)
      .orderBy(desc(beautyCommissionPayouts.createdAt));
    const entries = rows.length ? await this.finance.listBySourceInTx(tx, SOURCE, rows.map((r) => r.p.id)) : [];
    return rows.map(({ p, resourceName }) => ({
      id: p.id,
      resourceId: p.resourceId,
      resourceName,
      from: p.periodFrom,
      to: p.periodTo,
      amount: Number(p.amount),
      dueDate: p.dueDate,
      status: p.status,
      paid: entries.some((e) => e.sourceId === p.id && e.status === 'paid'),
      cancelReason: p.cancelReason,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  /** Serviços típicos de salão, só se a agenda ainda não tiver nenhum (idempotente). */
  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: schServices.id }).from(schServices).where(eq(schServices.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(schServices).values(SALON_SERVICES.map((s) => ({ ...s, tenantId })));
  }
}
