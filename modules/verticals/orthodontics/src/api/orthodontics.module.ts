import { addMonths, AuditService, centsToDecimal, CustomersService, FinanceService, ModuleHooks, TenantDb, toCents, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { MedicalRecordsModule, MedicalRecordsService } from '@all/medical-records';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { SchedulingModule, SchedulingService } from '@all/scheduling';
import { schServices } from '@all/scheduling/schema';
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  applianceLabel,
  cancelTreatmentInput,
  COVERED_CATEGORY,
  extendInput,
  finishInput,
  orthoForms,
  treatmentInput,
  type Installment,
  type Treatment,
  type TreatmentDetail,
  type TreatmentInput,
} from '../contracts';
import { orthoTreatments } from '../db/schema';

const MODULE = 'orthodontics';
/** Mensalidades e taxa de entrada ficam em origens separadas: o painel conta só as mensalidades. */
const SOURCE = 'ortho_treatment';
const SOURCE_FEE = 'ortho_entry_fee';

const SERVICES = [
  { name: 'Avaliação ortodôntica', category: 'Avaliação', durationMin: 40, price: '100.00' },
  { name: 'Documentação ortodôntica', category: 'Avaliação', durationMin: 30, price: '250.00' },
  { name: 'Instalação de aparelho', category: 'Tratamento', durationMin: 90, price: '500.00' },
  { name: 'Manutenção mensal', category: COVERED_CATEGORY, durationMin: 30, price: '180.00' },
  { name: 'Colagem de bráquete', category: 'Tratamento', durationMin: 20, price: '60.00' },
  { name: 'Remoção de aparelho', category: 'Tratamento', durationMin: 60, price: '300.00' },
  { name: 'Contenção', category: 'Tratamento', durationMin: 30, price: '250.00' },
];

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Vencimento da `n`-ésima mensalidade (1 = mês seguinte ao início), no dia escolhido. */
export function installmentDue(startedOn: string, dueDay: number, n: number): string {
  const first = addMonths(`${startedOn.slice(0, 8)}01`, n);
  return `${first.slice(0, 8)}${String(dueDay).padStart(2, '0')}`;
}

type TreatmentRow = typeof orthoTreatments.$inferSelect;

@Injectable()
export class OrthodonticsService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
    private readonly records: MedicalRecordsService,
    private readonly scheduling: SchedulingService,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    for (const form of orthoForms) this.records.registerForm(form);
    // Manutenção de quem está em tratamento já é paga na mensalidade: R$ 0 na agenda.
    this.scheduling.registerPricer({
      moduleKey: MODULE,
      price: async (tx, ctx) => {
        const [service] = await tx.select({ category: schServices.category }).from(schServices).where(eq(schServices.id, ctx.serviceId));
        if (service?.category !== COVERED_CATEGORY) return null;
        const [active] = await tx
          .select({ id: orthoTreatments.id })
          .from(orthoTreatments)
          .where(and(eq(orthoTreatments.customerId, ctx.customerId), eq(orthoTreatments.status, 'active')))
          .limit(1);
        return active ? { price: 0, label: 'no tratamento' } : null;
      },
    });
  }

  list(opts: { customerId?: string; status?: 'active' | 'finished' | 'cancelled' }): Promise<Treatment[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.query(tx)
        .where(and(opts.customerId ? eq(orthoTreatments.customerId, opts.customerId) : undefined, opts.status ? eq(orthoTreatments.status, opts.status) : undefined))
        .orderBy(desc(orthoTreatments.createdAt));
      return this.toDtos(tx, rows);
    });
  }

  get(id: string): Promise<TreatmentDetail> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  start(input: TreatmentInput): Promise<TreatmentDetail> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const customer = await this.customers.findInTx(tx, input.customerId);
      if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Paciente não encontrado');
      const [running] = await tx
        .select({ id: orthoTreatments.id })
        .from(orthoTreatments)
        .where(and(eq(orthoTreatments.customerId, customer.id), eq(orthoTreatments.status, 'active')))
        .limit(1);
      if (running) throw badRequest('TREATMENT_ACTIVE', 'Este paciente já tem um tratamento em andamento');

      const [row] = await tx
        .insert(orthoTreatments)
        .values({
          tenantId,
          customerId: customer.id,
          appliance: input.appliance,
          startedOn: input.startedOn,
          expectedMonths: input.expectedMonths,
          entryFee: centsToDecimal(toCents(input.entryFee)),
          monthlyFee: centsToDecimal(toCents(input.monthlyFee)),
          dueDay: input.dueDay,
          notes: input.notes ?? null,
        })
        .returning();
      if (input.entryFee > 0) {
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: 'pending',
          description: `Ortodontia: documentação e instalação (${applianceLabel[input.appliance]})`,
          amount: input.entryFee,
          dueDate: input.startedOn,
          customerId: customer.id,
          sourceType: SOURCE_FEE,
          settleInFinance: true,
          sourceId: row!.id,
          categoryKey: 'services',
        });
      }
      await this.addInstallments(tx, row!, 1, input.expectedMonths);
      await this.customers.addTimeline(tx, {
        customerId: customer.id,
        moduleKey: MODULE,
        type: 'treatment.started',
        title: `Tratamento ortodôntico iniciado: ${applianceLabel[input.appliance]}, ${input.expectedMonths} meses`,
        entity: 'ortho_treatment',
        entityId: row!.id,
      });
      await this.audit.log(tx, { action: 'orthodontics.treatment.started', entity: 'ortho_treatment', entityId: row!.id });
      return this.detailInTx(tx, row!.id);
    });
  }

  /** Mais meses de tratamento: novas mensalidades depois da última. */
  extend(id: string, months: number): Promise<TreatmentDetail> {
    return this.tdb.run(async (tx) => {
      const t = await this.activeOrFail(tx, id);
      await this.addInstallments(tx, t, t.expectedMonths + 1, months);
      await tx.update(orthoTreatments).set({ expectedMonths: t.expectedMonths + months }).where(eq(orthoTreatments.id, id));
      await this.audit.log(tx, { action: 'orthodontics.treatment.extended', entity: 'ortho_treatment', entityId: id, data: { months } });
      return this.detailInTx(tx, id);
    });
  }

  finish(id: string, cancelFutureInstallments: boolean): Promise<TreatmentDetail> {
    return this.tdb.run(async (tx) => {
      const t = await this.activeOrFail(tx, id);
      const now = today();
      if (cancelFutureInstallments) await this.finance.cancelPendingBySourceInTx(tx, SOURCE, id, { dueAfter: now });
      await tx.update(orthoTreatments).set({ status: 'finished', finishedOn: now }).where(eq(orthoTreatments.id, id));
      await this.customers.addTimeline(tx, { customerId: t.customerId, moduleKey: MODULE, type: 'treatment.finished', title: 'Tratamento ortodôntico concluído', entity: 'ortho_treatment', entityId: id });
      await this.audit.log(tx, { action: 'orthodontics.treatment.finished', entity: 'ortho_treatment', entityId: id, data: { cancelFutureInstallments } });
      return this.detailInTx(tx, id);
    });
  }

  cancel(id: string, reason: string): Promise<TreatmentDetail> {
    return this.tdb.run(async (tx) => {
      const t = await this.activeOrFail(tx, id);
      await this.finance.cancelPendingBySourceInTx(tx, SOURCE, id);
      await this.finance.cancelPendingBySourceInTx(tx, SOURCE_FEE, id);
      await tx.update(orthoTreatments).set({ status: 'cancelled', cancelReason: reason, finishedOn: today() }).where(eq(orthoTreatments.id, id));
      await this.customers.addTimeline(tx, { customerId: t.customerId, moduleKey: MODULE, type: 'treatment.cancelled', title: `Tratamento ortodôntico cancelado (${reason})`, entity: 'ortho_treatment', entityId: id });
      await this.audit.log(tx, { action: 'orthodontics.treatment.cancelled', entity: 'ortho_treatment', entityId: id, data: { reason } });
      return this.detailInTx(tx, id);
    });
  }

  private async addInstallments(tx: Tx, t: TreatmentRow, from: number, count: number) {
    const total = t.expectedMonths + (from > t.expectedMonths ? count : 0);
    for (let n = from; n < from + count; n++) {
      await this.finance.recordInTx(tx, {
        kind: 'income',
        status: 'pending',
        description: `Ortodontia: mensalidade ${n}/${total}`,
        amount: Number(t.monthlyFee),
        dueDate: installmentDue(t.startedOn, t.dueDay, n),
        customerId: t.customerId,
        sourceType: SOURCE,
        settleInFinance: true,
        sourceId: t.id,
        categoryKey: 'services',
      });
    }
  }

  private async activeOrFail(tx: Tx, id: string) {
    const [t] = await tx.select().from(orthoTreatments).where(eq(orthoTreatments.id, id)).for('update');
    if (!t) throw new NotFoundException({ code: 'TREATMENT_NOT_FOUND', message: 'Tratamento não encontrado' });
    if (t.status !== 'active') throw badRequest('TREATMENT_CLOSED', 'Este tratamento já foi encerrado');
    return t;
  }

  private async detailInTx(tx: Tx, id: string): Promise<TreatmentDetail> {
    const [row] = await this.query(tx).where(eq(orthoTreatments.id, id));
    if (!row) throw new NotFoundException({ code: 'TREATMENT_NOT_FOUND', message: 'Tratamento não encontrado' });
    const [dto] = await this.toDtos(tx, [row]);
    const entries = [...(await this.finance.listBySourceInTx(tx, SOURCE_FEE, id)), ...(await this.finance.listBySourceInTx(tx, SOURCE, id))];
    return { ...dto!, installments: entries.map((e): Installment => ({ id: e.id, description: e.description, amount: e.amount, dueDate: e.dueDate, status: e.status })) };
  }

  private query(tx: Tx) {
    return tx
      .select({ t: orthoTreatments, customer: { id: customers.id, name: customers.name } })
      .from(orthoTreatments)
      .innerJoin(customers, eq(customers.id, orthoTreatments.customerId))
      .$dynamic();
  }

  private async toDtos(tx: Tx, rows: { t: TreatmentRow; customer: { id: string; name: string } }[]): Promise<Treatment[]> {
    const now = today();
    const ids = rows.map((r) => r.t.id);
    const [monthly, fees] = await Promise.all([this.finance.listBySourceInTx(tx, SOURCE, ids), this.finance.listBySourceInTx(tx, SOURCE_FEE, ids)]);
    const out: Treatment[] = [];
    for (const { t, customer } of rows) {
      const entries = monthly.filter((e) => e.sourceId === t.id && e.status !== 'cancelled');
      const overdue = [...entries, ...fees.filter((e) => e.sourceId === t.id)].filter((e) => e.status === 'pending' && e.dueDate < now);
      out.push({
        id: t.id,
        customer,
        appliance: t.appliance,
        startedOn: t.startedOn,
        expectedMonths: t.expectedMonths,
        entryFee: Number(t.entryFee),
        monthlyFee: Number(t.monthlyFee),
        dueDay: t.dueDay,
        status: t.status,
        finishedOn: t.finishedOn,
        cancelReason: t.cancelReason,
        notes: t.notes,
        paidInstallments: entries.filter((e) => e.status === 'paid').length,
        totalInstallments: entries.length,
        overdueAmount: overdue.reduce((sum, e) => sum + toCents(e.amount), 0) / 100,
        createdAt: t.createdAt.toISOString(),
      });
    }
    return out;
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: schServices.id }).from(schServices).where(eq(schServices.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(schServices).values(SERVICES.map((s) => ({ ...s, tenantId })));
  }
}

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });

const listQuery = z.object({ customerId: z.string().uuid().optional(), status: z.enum(['active', 'finished', 'cancelled']).optional() });

@Controller('orthodontics/treatments')
@ModuleRoute('orthodontics')
export class OrthodonticsController {
  constructor(private readonly ortho: OrthodonticsService) {}

  @Get()
  @RequirePermission('orthodontics.treatments.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.ortho.list(q);
  }

  @Get(':id')
  @RequirePermission('orthodontics.treatments.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.ortho.get(id);
  }

  @Post()
  @RequirePermission('orthodontics.treatments.manage')
  start(@Body(new ZodPipe(treatmentInput)) body: TreatmentInput) {
    return this.ortho.start(body);
  }

  @Post(':id/extend')
  @RequirePermission('orthodontics.treatments.manage')
  extend(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(extendInput)) body: { months: number }) {
    return this.ortho.extend(id, body.months);
  }

  @Post(':id/finish')
  @RequirePermission('orthodontics.treatments.manage')
  finish(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(finishInput)) body: { cancelFutureInstallments: boolean }) {
    return this.ortho.finish(id, body.cancelFutureInstallments);
  }

  @Post(':id/cancel')
  @RequirePermission('orthodontics.treatments.manage')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelTreatmentInput)) body: { reason: string }) {
    return this.ortho.cancel(id, body.reason);
  }
}

@Module({ imports: [MedicalRecordsModule, SchedulingModule], controllers: [OrthodonticsController], providers: [OrthodonticsService] })
export class OrthodonticsModule {}
