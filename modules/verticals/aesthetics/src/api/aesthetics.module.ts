import { addMonths, AuditService, CustomersService, FinanceService, ModuleHooks, ModuleSettingsService, OutboxHandlers, TenantDb, ZodPipe, centsToDecimal, splitCents, toCents } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { MedicalRecordsModule, MedicalRecordsService } from '@all/medical-records';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { SchedulingModule, SchedulingService, STATUS_CHANGED, type AppointmentStatusChanged } from '@all/scheduling';
import { schServices } from '@all/scheduling/schema';
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aestheticsForms, cancelPackageInput, packageInput, type PackageInput, type SessionPackage } from '../contracts';
import { aesPackages, aesPackageSessions } from '../db/schema';
import type { AestheticsSettings } from '../manifest';

const MODULE = 'aesthetics';
const SOURCE = 'aes_package';

const SERVICES = [
  { name: 'Avaliação estética', category: 'Avaliação', durationMin: 30, price: '50.00' },
  { name: 'Limpeza de pele', category: 'Facial', durationMin: 90, price: '180.00' },
  { name: 'Peeling químico', category: 'Facial', durationMin: 60, price: '250.00' },
  { name: 'Microagulhamento', category: 'Facial', durationMin: 60, price: '350.00' },
  { name: 'Drenagem linfática', category: 'Corporal', durationMin: 60, price: '140.00' },
  { name: 'Massagem modeladora', category: 'Corporal', durationMin: 60, price: '140.00' },
  { name: 'Radiofrequência', category: 'Corporal', durationMin: 45, price: '200.00' },
  { name: 'Criolipólise', category: 'Corporal', durationMin: 60, price: '600.00' },
  { name: 'Depilação a laser (área pequena)', category: 'Depilação', durationMin: 30, price: '150.00' },
];

@Injectable()
export class AestheticsService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly handlers: OutboxHandlers,
    private readonly settings: ModuleSettingsService,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
    private readonly records: MedicalRecordsService,
    private readonly scheduling: SchedulingService,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    for (const form of aestheticsForms) this.records.registerForm(form);
    // Sessão coberta por pacote: R$ 0 na agenda e a sessão fica reservada para o horário.
    this.scheduling.registerPricer({ moduleKey: MODULE, price: (tx, ctx) => this.reserveSession(tx, ctx) });
    this.handlers.on<AppointmentStatusChanged>(STATUS_CHANGED, 'aesthetics.package-sessions', (e) => this.onStatusChanged(e.payload));
  }

  list(opts: { customerId?: string; status?: string }): Promise<SessionPackage[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.query(tx)
        .where(and(opts.customerId ? eq(aesPackages.customerId, opts.customerId) : undefined, opts.status ? eq(aesPackages.status, opts.status as 'active') : undefined))
        .orderBy(desc(aesPackages.createdAt));
      return this.toDtos(tx, rows);
    });
  }

  sell(input: PackageInput): Promise<SessionPackage> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
      const [service] = await tx.select().from(schServices).where(eq(schServices.id, input.serviceId));
      if (!service) throw badRequest('SERVICE_NOT_FOUND', 'Procedimento não encontrado');
      if (input.expiresOn && input.expiresOn < input.firstDueOn) throw badRequest('INVALID_EXPIRY', 'A validade não pode ser antes do primeiro vencimento');

      const [pkg] = await tx
        .insert(aesPackages)
        .values({
          tenantId,
          customerId: customer.id,
          serviceId: service.id,
          totalSessions: input.totalSessions,
          price: centsToDecimal(toCents(input.price)),
          expiresOn: input.expiresOn,
          notes: input.notes ?? null,
        })
        .returning();
      const parts = splitCents(toCents(input.price), input.installments);
      for (const [i, cents] of parts.entries()) {
        if (cents <= 0) continue;
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: 'pending',
          description: `Pacote ${service.name} (${input.totalSessions} sessões)${parts.length > 1 ? ` — parcela ${i + 1}/${parts.length}` : ''}`,
          amount: cents / 100,
          dueDate: addMonths(input.firstDueOn, i),
          customerId: customer.id,
          sourceType: SOURCE,
          settleInFinance: true,
          sourceId: pkg!.id,
          categoryKey: 'services',
        });
      }
      await this.customers.addTimeline(tx, {
        customerId: customer.id,
        moduleKey: MODULE,
        type: 'package.sold',
        title: `Pacote vendido: ${input.totalSessions} sessões de ${service.name}`,
        entity: 'aes_package',
        entityId: pkg!.id,
      });
      await this.audit.log(tx, { action: 'aesthetics.package.sold', entity: 'aes_package', entityId: pkg!.id, data: { price: input.price, installments: input.installments } });
      return (await this.toDtos(tx, await this.query(tx).where(eq(aesPackages.id, pkg!.id))))[0]!;
    });
  }

  cancel(id: string, reason: string): Promise<SessionPackage> {
    return this.tdb.run(async (tx) => {
      const [pkg] = await tx.select().from(aesPackages).where(eq(aesPackages.id, id)).for('update');
      if (!pkg) throw new NotFoundException({ code: 'PACKAGE_NOT_FOUND', message: 'Pacote não encontrado' });
      if (pkg.status !== 'active') throw badRequest('PACKAGE_CLOSED', 'Este pacote já foi encerrado');
      const [reserved] = await tx
        .select({ id: aesPackageSessions.id })
        .from(aesPackageSessions)
        .where(and(eq(aesPackageSessions.packageId, id), eq(aesPackageSessions.status, 'reserved')))
        .limit(1);
      if (reserved) throw badRequest('PACKAGE_HAS_BOOKINGS', 'Há horários marcados usando este pacote: cancele ou conclua antes');
      await tx.update(aesPackages).set({ status: 'cancelled', cancelReason: reason }).where(eq(aesPackages.id, id));
      const cancelled = await this.finance.cancelPendingBySourceInTx(tx, SOURCE, id);
      await this.audit.log(tx, { action: 'aesthetics.package.cancelled', entity: 'aes_package', entityId: id, data: { reason, cancelledInstallments: cancelled } });
      return (await this.toDtos(tx, await this.query(tx).where(eq(aesPackages.id, id))))[0]!;
    });
  }

  /** Pacote ativo e com saldo do cliente para o serviço: reserva uma sessão para o horário. */
  private async reserveSession(tx: Tx, ctx: { appointmentId: string; customerId: string; serviceId: string }) {
    const today = sql`(now() at time zone 'America/Sao_Paulo')::date`;
    const candidates = await tx
      .select()
      .from(aesPackages)
      .where(
        and(
          eq(aesPackages.customerId, ctx.customerId),
          eq(aesPackages.serviceId, ctx.serviceId),
          eq(aesPackages.status, 'active'),
          or(isNull(aesPackages.expiresOn), gte(aesPackages.expiresOn, today)),
        ),
      )
      .orderBy(asc(aesPackages.createdAt))
      // Duas marcações ao mesmo tempo não podem gastar a mesma última sessão.
      .for('update');
    for (const pkg of candidates) {
      const taken = await this.takenSessions(tx, pkg.id);
      if (taken >= pkg.totalSessions) continue;
      await tx.insert(aesPackageSessions).values({ tenantId: pkg.tenantId, packageId: pkg.id, appointmentId: ctx.appointmentId });
      return { price: 0, label: `pacote ${taken + 1}/${pkg.totalSessions}` };
    }
    return null;
  }

  private onStatusChanged(e: AppointmentStatusChanged) {
    if (!['done', 'cancelled', 'no_show'].includes(e.status)) return Promise.resolve();
    return this.tdb.run(async (tx) => {
      const sessions = await tx
        .select()
        .from(aesPackageSessions)
        .where(and(eq(aesPackageSessions.appointmentId, e.appointmentId), eq(aesPackageSessions.status, 'reserved')));
      if (!sessions.length) return;
      let next: 'used' | 'released' = e.status === 'done' ? 'used' : 'released';
      if (e.status === 'no_show') {
        const { noShowConsumesSession } = await this.settings.getInTx<AestheticsSettings>(tx, MODULE);
        if (noShowConsumesSession) next = 'used';
      }
      await tx.update(aesPackageSessions).set({ status: next }).where(inArray(aesPackageSessions.id, sessions.map((s) => s.id)));
      if (next !== 'used') return;
      for (const s of sessions) {
        const [pkg] = await tx.select().from(aesPackages).where(eq(aesPackages.id, s.packageId));
        const [{ used }] = (await tx
          .select({ used: sql<number>`count(*)::int` })
          .from(aesPackageSessions)
          .where(and(eq(aesPackageSessions.packageId, s.packageId), eq(aesPackageSessions.status, 'used')))) as [{ used: number }];
        if (pkg && pkg.status === 'active' && used >= pkg.totalSessions) {
          await tx.update(aesPackages).set({ status: 'finished' }).where(eq(aesPackages.id, pkg.id));
          await this.customers.addTimeline(tx, { customerId: pkg.customerId, moduleKey: MODULE, type: 'package.finished', title: 'Pacote concluído: todas as sessões realizadas', entity: 'aes_package', entityId: pkg.id });
        }
      }
    });
  }

  private async takenSessions(tx: Tx, packageId: string) {
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aesPackageSessions)
      .where(and(eq(aesPackageSessions.packageId, packageId), inArray(aesPackageSessions.status, ['reserved', 'used'])))) as [{ n: number }];
    return n;
  }

  private query(tx: Tx) {
    return tx
      .select({ pkg: aesPackages, customer: { id: customers.id, name: customers.name }, service: { id: schServices.id, name: schServices.name } })
      .from(aesPackages)
      .innerJoin(customers, eq(customers.id, aesPackages.customerId))
      .innerJoin(schServices, eq(schServices.id, aesPackages.serviceId))
      .$dynamic();
  }

  private async toDtos(
    tx: Tx,
    rows: { pkg: typeof aesPackages.$inferSelect; customer: { id: string; name: string }; service: { id: string; name: string } }[],
  ): Promise<SessionPackage[]> {
    const ids = rows.map((r) => r.pkg.id);
    const counts = ids.length
      ? await tx
          .select({ packageId: aesPackageSessions.packageId, status: aesPackageSessions.status, n: sql<number>`count(*)::int` })
          .from(aesPackageSessions)
          .where(inArray(aesPackageSessions.packageId, ids))
          .groupBy(aesPackageSessions.packageId, aesPackageSessions.status)
      : [];
    const countOf = (id: string, status: string) => counts.find((c) => c.packageId === id && c.status === status)?.n ?? 0;
    return rows.map(({ pkg, customer, service }) => ({
      id: pkg.id,
      customer,
      service,
      totalSessions: pkg.totalSessions,
      usedSessions: countOf(pkg.id, 'used'),
      reservedSessions: countOf(pkg.id, 'reserved'),
      price: Number(pkg.price),
      expiresOn: pkg.expiresOn,
      status: pkg.status,
      notes: pkg.notes,
      cancelReason: pkg.cancelReason,
      createdAt: pkg.createdAt.toISOString(),
    }));
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: schServices.id }).from(schServices).where(eq(schServices.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(schServices).values(SERVICES.map((s) => ({ ...s, tenantId })));
  }
}

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });

const listQuery = z.object({ customerId: z.string().uuid().optional(), status: z.enum(['active', 'finished', 'cancelled']).optional() });

@Controller('aesthetics/packages')
@ModuleRoute('aesthetics')
export class AestheticsController {
  constructor(private readonly aesthetics: AestheticsService) {}

  @Get()
  @RequirePermission('aesthetics.packages.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.aesthetics.list(q);
  }

  @Post()
  @RequirePermission('aesthetics.packages.sell')
  sell(@Body(new ZodPipe(packageInput)) body: PackageInput) {
    return this.aesthetics.sell(body);
  }

  @Post(':id/cancel')
  @RequirePermission('aesthetics.packages.sell')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelPackageInput)) body: { reason: string }) {
    return this.aesthetics.cancel(id, body.reason);
  }
}

@Module({ imports: [MedicalRecordsModule, SchedulingModule], controllers: [AestheticsController], providers: [AestheticsService] })
export class AestheticsModule {}
