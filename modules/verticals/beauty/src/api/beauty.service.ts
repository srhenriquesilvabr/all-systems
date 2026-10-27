import { AuditService, ModuleHooks, TenantDb, centsToNumber, toCents } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { utcToLocal } from '@all/scheduling';
import { schAppointments, schAppointmentServices, schResources, schServices } from '@all/scheduling/schema';
import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { CommissionReport, CommissionRules, CommissionRulesInput } from '../contracts';
import { beautyCommissionRules } from '../db/schema';

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

@Injectable()
export class BeautyService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
    private readonly hooks: ModuleHooks,
  ) {}

  onModuleInit() {
    this.hooks.register('beauty', { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
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
   * Comissões do período: atendimentos concluídos, linha a linha, com o percentual do serviço
   * (ou o padrão do profissional) sobre o preço cobrado.
   */
  report(from: string, to: string): Promise<CommissionReport> {
    return this.tdb.run(async (tx) => {
      const start = sql`(${from}::date)::timestamp at time zone 'America/Sao_Paulo'`;
      const end = sql`((${to}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;
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
          })
          .from(schAppointmentServices)
          .innerJoin(schAppointments, eq(schAppointments.id, schAppointmentServices.appointmentId))
          .innerJoin(schResources, eq(schResources.id, schAppointments.resourceId))
          .innerJoin(customers, eq(customers.id, schAppointments.customerId))
          .where(and(eq(schAppointments.status, 'done'), gte(schAppointments.startsAt, start), lt(schAppointments.startsAt, end)))
          .orderBy(asc(schResources.name), asc(schAppointments.startsAt)),
        tx.select().from(beautyCommissionRules),
      ]);

      const rateOf = (resourceId: string, serviceId: string | null) =>
        Number(
          rules.find((r) => r.resourceId === resourceId && r.serviceId && r.serviceId === serviceId)?.rate ??
            rules.find((r) => r.resourceId === resourceId && !r.serviceId)?.rate ??
            0,
        );

      const byResource = new Map<string, CommissionReport['professionals'][number] & { ids: Set<string>; revenueCents: number; commissionCents: number }>();
      for (const l of lines) {
        const entry =
          byResource.get(l.resourceId) ??
          { resourceId: l.resourceId, name: l.resourceName, appointments: 0, revenue: 0, commission: 0, lines: [], ids: new Set<string>(), revenueCents: 0, commissionCents: 0 };
        const rate = rateOf(l.resourceId, l.serviceId);
        const price = toCents(l.price);
        const commission = Math.round((price * rate) / 100);
        entry.ids.add(l.appointmentId);
        entry.revenueCents += price;
        entry.commissionCents += commission;
        entry.lines.push({ date: utcToLocal(l.startsAt).date, customer: l.customer, service: l.service, price: centsToNumber(price), rate, commission: centsToNumber(commission) });
        byResource.set(l.resourceId, entry);
      }
      return {
        period: { from, to },
        professionals: [...byResource.values()].map(({ ids, revenueCents, commissionCents, ...p }) => ({
          ...p,
          appointments: ids.size,
          revenue: centsToNumber(revenueCents),
          commission: centsToNumber(commissionCents),
        })),
      };
    });
  }

  /** Serviços típicos de salão, só se a agenda ainda não tiver nenhum (idempotente). */
  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: schServices.id }).from(schServices).where(eq(schServices.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(schServices).values(SALON_SERVICES.map((s) => ({ ...s, tenantId })));
  }
}
