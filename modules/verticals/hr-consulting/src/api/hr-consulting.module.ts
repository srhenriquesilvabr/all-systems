import { AuditService, centsToDecimal, CustomersService, FinanceService, TenantDb, toCents, ZodPipe } from '@all/core';
import type { Tx } from '@all/db';
import { HrEmployersRegistry, HrModule, type ClosedEmployerPayroll, type ConfirmedEmployerTermination } from '@all/hr';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { BadRequestException, Body, Controller, Get, Injectable, Module, OnModuleInit, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { clientFeeInput, FEE_SOURCE, feeFor, type ClientFee, type ClientFeeInput } from '../contracts';
import { hrcClients } from '../db/schema';

export const MODULE = 'hr_consulting';

/** Dia `day` do mês seguinte à competência "AAAA-MM". */
const nextMonth = (ym: string, day: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
};
const mmYyyy = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type ClientRow = typeof hrcClients.$inferSelect;
const toFee = (r: ClientRow): ClientFee => ({
  customerId: r.customerId,
  feeMode: r.feeMode,
  feeAmount: Number(r.feeAmount),
  feeDueDay: r.feeDueDay,
  thirteenthFee: r.thirteenthFee,
  terminationFee: Number(r.terminationFee),
  notes: r.notes,
});

/**
 * Consultoria de RH: as empresas atendidas são os clientes do tipo empresa; colaboradores e folhas
 * delas ficam no RH, com o empregador (registro no HrEmployersRegistry). Aqui ficam os honorários:
 * ao fechar a folha de uma empresa atendida (ou confirmar uma rescisão), lança a receita no financeiro.
 * Salários e guias da empresa atendida não passam pelo financeiro da consultoria.
 */
@Injectable()
export class HrConsultingService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
    private readonly employers: HrEmployersRegistry,
  ) {}

  onModuleInit() {
    this.employers.register({
      moduleKey: MODULE,
      onPayrollClosed: (tx, p) => this.payrollClosed(tx, p),
      onTerminationConfirmed: (tx, t) => this.terminationConfirmed(tx, t),
    });
  }

  listFees(): Promise<ClientFee[]> {
    return this.tdb.run(async (tx) => (await tx.select().from(hrcClients).orderBy(asc(hrcClients.createdAt))).map(toFee));
  }

  /** Grava (ou cria) os honorários de uma empresa atendida. Vale para as próximas folhas fechadas. */
  saveFee(customerId: string, input: ClientFeeInput): Promise<ClientFee> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const customer = await this.customers.findInTx(tx, customerId);
      if (!customer || customer.anonymizedAt) throw new BadRequestException({ code: 'CUSTOMER_NOT_FOUND', message: 'Empresa não encontrada no cadastro de clientes' });
      if (customer.type !== 'company') throw new BadRequestException({ code: 'NOT_COMPANY', message: 'Honorários de folha são para clientes do tipo empresa' });
      const values = {
        feeMode: input.feeMode,
        feeAmount: centsToDecimal(toCents(input.feeAmount)),
        feeDueDay: input.feeDueDay,
        thirteenthFee: input.thirteenthFee,
        terminationFee: centsToDecimal(toCents(input.terminationFee)),
        notes: input.notes ?? null,
      };
      const [row] = await tx
        .insert(hrcClients)
        .values({ ...values, tenantId, customerId })
        .onConflictDoUpdate({ target: [hrcClients.tenantId, hrcClients.customerId], set: values })
        .returning();
      await this.audit.log(tx, { action: 'hr_consulting.fee.saved', entity: 'customer', entityId: customerId, data: { feeMode: input.feeMode, feeAmount: input.feeAmount } });
      return toFee(row!);
    });
  }

  private async feeOf(tx: Tx, customerId: string): Promise<ClientFee | null> {
    const [row] = await tx.select().from(hrcClients).where(eq(hrcClients.customerId, customerId));
    return row ? toFee(row) : null;
  }

  /** Folha mensal (ou 2ª parcela do 13º, se combinado) fechada: honorário a receber da empresa. */
  private async payrollClosed(tx: Tx, p: ClosedEmployerPayroll) {
    const label = p.type === 'monthly' ? `Folha ${mmYyyy(p.competence)} fechada` : `13º ${p.competence.slice(0, 4)} (${p.type === 'thirteenth_1' ? '1ª' : '2ª'} parcela) fechado`;
    await this.customers.addTimeline(tx, { customerId: p.employerCustomerId, moduleKey: MODULE, type: 'hr_consulting.payroll_closed', title: `${label}: ${p.totals.employees} colaboradores`, entity: 'hr_payroll', entityId: p.payrollId });

    const fee = await this.feeOf(tx, p.employerCustomerId);
    if (!fee) return;
    const charge = p.type === 'monthly' || (p.type === 'thirteenth_2' && fee.thirteenthFee);
    const amount = charge ? feeFor(fee, p.totals.employees) : 0;
    if (amount <= 0) return;
    const what = p.type === 'monthly' ? `folha ${mmYyyy(p.competence)}` : `13º salário ${p.competence.slice(0, 4)}`;
    const detail = fee.feeMode === 'per_employee' ? ` (${p.totals.employees} × ${brl(fee.feeAmount)})` : '';
    await this.finance.recordInTx(tx, {
      kind: 'income',
      status: 'pending',
      description: `Honorários de ${what} — ${p.employerName}${detail}`,
      amount,
      dueDate: nextMonth(p.competence, fee.feeDueDay),
      customerId: p.employerCustomerId,
      sourceType: FEE_SOURCE,
      sourceId: p.payrollId,
      settleInFinance: true,
      categoryKey: 'services',
    });
  }

  /** Rescisão confirmada: honorário por rescisão, se combinado. */
  private async terminationConfirmed(tx: Tx, t: ConfirmedEmployerTermination) {
    await this.customers.addTimeline(tx, { customerId: t.employerCustomerId, moduleKey: MODULE, type: 'hr_consulting.termination', title: `Rescisão de ${t.employeeName}`, entity: 'hr_termination', entityId: t.terminationId });
    const fee = await this.feeOf(tx, t.employerCustomerId);
    if (!fee || fee.terminationFee <= 0) return;
    await this.finance.recordInTx(tx, {
      kind: 'income',
      status: 'pending',
      description: `Honorários de rescisão — ${t.employeeName} (${t.employerName})`,
      amount: fee.terminationFee,
      dueDate: nextMonth(t.terminationDate.slice(0, 7), fee.feeDueDay),
      customerId: t.employerCustomerId,
      sourceType: FEE_SOURCE,
      sourceId: t.terminationId,
      settleInFinance: true,
      categoryKey: 'services',
    });
  }
}

@Controller('hr-consulting')
@ModuleRoute(MODULE)
export class HrConsultingController {
  constructor(private readonly service: HrConsultingService) {}

  @Get('clients')
  @RequirePermission('hr.read')
  fees() {
    return this.service.listFees();
  }

  @Put('clients/:customerId')
  @RequirePermission('hr_consulting.fees.manage')
  saveFee(@Param('customerId', ParseUUIDPipe) customerId: string, @Body(new ZodPipe(clientFeeInput)) body: ClientFeeInput) {
    return this.service.saveFee(customerId, body);
  }
}

@Module({ imports: [HrModule], controllers: [HrConsultingController], providers: [HrConsultingService] })
export class HrConsultingModule {}
