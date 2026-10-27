import { AuditService, centsToDecimal, FinanceService, ModuleSettingsService, TenantDb, toCents, ZodPipe } from '@all/core';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import {
  acquisitionPeriods,
  computePayslip,
  computeThirteenth,
  employeeInput,
  leaveDaysBetween,
  leaveInput,
  monthCalendar,
  payrollCreate,
  payrollItemUpdate,
  payrollRecalculate,
  round2,
  terminationInput,
  thirteenthAvos,
  thirteenthCreate,
  thirteenthItemUpdate,
  vacationDaysBetween,
  vacationInput,
  vacationPay,
  type Employee,
  type EmployeeInput,
  type Leave,
  type LeaveInput,
  type Payroll,
  type PayrollCreate,
  type PayrollItem,
  type PayrollItemUpdate,
  type Payslip,
  type TerminationInput,
  type ThirteenthCreate,
  type ThirteenthItemUpdate,
  type Vacation,
  type VacationInput,
} from '../contracts';
import { hrEmployees, hrLeaves, hrPayrollItems, hrPayrolls, hrTerminations, hrVacations } from '../db/schema';
import type { HrSettings } from '../manifest';
import {
  addDays,
  badRequest,
  closedItem,
  employeeOrFail,
  findPayroll,
  lastDayOf,
  localToday,
  MODULE,
  nextMonth,
  normalizePayslip,
  PAYROLL_SOURCE,
  payrollOrFail,
  pgCode,
  tablesOf,
  variableAverage,
  type EmployeeRow,
  type PayrollRow,
} from './shared';
import { TerminationService } from './termination.service';

type ManualInputs = Pick<PayrollItemUpdate, 'overtime50Hours' | 'overtime100Hours' | 'commissions' | 'otherEarnings' | 'otherDeductions' | 'absences' | 'dsrLostDays'>;
const noManual: ManualInputs = { overtime50Hours: 0, overtime100Hours: 0, commissions: 0, otherEarnings: 0, otherDeductions: 0, absences: 0, dsrLostDays: 0 };

/** Dias de contrato no mês (mês cheio = 30) e o intervalo de datas correspondente. */
function contractInMonth(e: Pick<EmployeeRow, 'admissionDate' | 'terminationDate'>, competence: string) {
  const start = `${competence}-01`;
  const end = lastDayOf(competence);
  const fromDate = e.admissionDate > start ? e.admissionDate : start;
  const toDate = e.terminationDate && e.terminationDate < end ? e.terminationDate : end;
  const from = Number(fromDate.slice(8));
  const to = toDate === end ? 30 : Number(toDate.slice(8));
  const daysWorked = from === 1 && to === 30 ? 30 : Math.max(0, Math.min(30, to) - from + 1);
  return { daysWorked, fromDate, toDate };
}

@Injectable()
export class HrService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
  ) {}

  // ---- Colaboradores --------------------------------------------------------------------------

  listEmployees(opts: { status?: string }): Promise<Employee[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select()
        .from(hrEmployees)
        .where(opts.status ? eq(hrEmployees.status, opts.status as EmployeeRow['status']) : undefined)
        .orderBy(asc(hrEmployees.name));
      const vacations = await tx.select().from(hrVacations).where(eq(hrVacations.status, 'scheduled'));
      return rows.map((r) => toEmployee(r, vacations, null));
    });
  }

  getEmployee(id: string): Promise<Employee> {
    return this.tdb.run(async (tx) => {
      const row = await employeeOrFail(tx, id);
      const vacations = await tx.select().from(hrVacations).where(and(eq(hrVacations.employeeId, id), eq(hrVacations.status, 'scheduled')));
      const [term] = await tx.select({ id: hrTerminations.id, type: hrTerminations.type, terminationDate: hrTerminations.terminationDate }).from(hrTerminations).where(eq(hrTerminations.employeeId, id));
      return toEmployee(row, vacations, term ?? null);
    });
  }

  saveEmployee(id: string | null, input: EmployeeInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      if (input.status === 'terminated' && !input.terminationDate) throw badRequest('TERMINATION_DATE', 'Informe a data do desligamento');
      if (input.experienceEnd && input.experienceEnd < input.admissionDate) throw badRequest('EXPERIENCE_END', 'O fim da experiência deve ser depois da admissão');
      const values = {
        ...input,
        salary: centsToDecimal(toCents(input.salary)),
        birthDate: input.birthDate ?? null,
        experienceEnd: input.experienceEnd ?? null,
        terminationDate: input.terminationDate ?? null,
      };
      try {
        if (id) {
          const [row] = await tx.update(hrEmployees).set(values).where(eq(hrEmployees.id, id)).returning({ id: hrEmployees.id });
          if (!row) throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: 'Colaborador não encontrado' });
          await this.audit.log(tx, { action: 'hr.employee.updated', entity: 'hr_employee', entityId: id, data: { fields: Object.keys(input) } });
          return { id };
        }
        const [row] = await tx.insert(hrEmployees).values({ ...values, tenantId }).returning({ id: hrEmployees.id });
        await this.audit.log(tx, { action: 'hr.employee.created', entity: 'hr_employee', entityId: row!.id });
        return { id: row!.id };
      } catch (err) {
        if (pgCode(err) === '23505') throw new ConflictException({ code: 'CPF_TAKEN', message: 'Já existe um colaborador com este CPF' });
        throw err;
      }
    });
  }

  // ---- Férias ---------------------------------------------------------------------------------

  vacations(employeeId: string): Promise<Vacation[]> {
    return this.tdb.run(async (tx) => {
      const emp = await employeeOrFail(tx, employeeId);
      const rows = await tx.select().from(hrVacations).where(eq(hrVacations.employeeId, employeeId)).orderBy(desc(hrVacations.startOn));
      return rows.map((v) => toVacation(v, Number(emp.salary)));
    });
  }

  /** Agenda férias de um período aquisitivo já completo, dentro do saldo. */
  scheduleVacation(input: VacationInput): Promise<Vacation> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const emp = await employeeOrFail(tx, input.employeeId);
      if (emp.status === 'terminated') throw badRequest('EMPLOYEE_TERMINATED', 'Colaborador desligado');
      const used = await tx.select().from(hrVacations).where(and(eq(hrVacations.employeeId, emp.id), eq(hrVacations.status, 'scheduled')));
      const period = acquisitionPeriods(emp.admissionDate, localToday(), used.map((u) => ({ periodStart: u.periodStart, days: u.days + u.soldDays }))).find((p) => p.start === input.periodStart);
      if (!period || !period.earned) throw badRequest('PERIOD_NOT_EARNED', 'Período aquisitivo ainda não completo');
      if (input.days + input.soldDays > period.balance) throw badRequest('NOT_ENOUGH_BALANCE', `Saldo do período: ${period.balance} dias`);
      if (input.soldDays > 0 && used.some((u) => u.periodStart === input.periodStart && u.soldDays > 0)) throw badRequest('ALREADY_SOLD', 'O abono deste período já foi usado');
      const end = addDays(input.startOn, input.days - 1);
      const overlap = used.some((u) => u.startOn <= end && addDays(u.startOn, u.days - 1) >= input.startOn);
      if (overlap) throw badRequest('VACATION_OVERLAP', 'Já há férias marcadas nestas datas');
      const [row] = await tx.insert(hrVacations).values({ tenantId, employeeId: emp.id, periodStart: input.periodStart, startOn: input.startOn, days: input.days, soldDays: input.soldDays }).returning();
      const v = toVacation(row!, Number(emp.salary));
      // Férias são pagas antes do início: lança a despesa com vencimento 2 dias antes.
      await this.finance.recordInTx(tx, {
        kind: 'expense',
        status: 'pending',
        description: `Férias de ${emp.name} (${input.days} dias${input.soldDays ? ` + ${input.soldDays} vendidos` : ''})`,
        amount: Math.round((v.pay.vacation + v.pay.allowance) * 100) / 100,
        dueDate: v.payBy,
        sourceType: 'hr_vacation',
        settleInFinance: true,
        sourceId: row!.id,
        categoryKey: 'payroll',
      });
      await this.audit.log(tx, { action: 'hr.vacation.scheduled', entity: 'hr_vacation', entityId: row!.id });
      return v;
    });
  }

  cancelVacation(id: string) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx.update(hrVacations).set({ status: 'cancelled' }).where(and(eq(hrVacations.id, id), eq(hrVacations.status, 'scheduled'))).returning();
      if (!row) throw new NotFoundException({ code: 'VACATION_NOT_FOUND', message: 'Férias não encontradas' });
      if (row.startOn <= localToday()) throw badRequest('VACATION_STARTED', 'Férias já iniciadas não podem ser canceladas');
      await this.finance.cancelPendingBySourceInTx(tx, 'hr_vacation', id);
      await this.audit.log(tx, { action: 'hr.vacation.cancelled', entity: 'hr_vacation', entityId: id });
    });
  }

  // ---- Afastamentos ---------------------------------------------------------------------------

  leaves(employeeId: string): Promise<Leave[]> {
    return this.tdb.run(async (tx) => {
      await employeeOrFail(tx, employeeId);
      const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      const rows = await tx.select().from(hrLeaves).where(eq(hrLeaves.employeeId, employeeId)).orderBy(desc(hrLeaves.startOn));
      return rows.map((l) => toLeave(l, tables.sickLeaveCompanyDays));
    });
  }

  /** Registra um afastamento. A folha do mês considera os dias ao abrir ou recalcular. */
  createLeave(input: LeaveInput): Promise<Leave> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const emp = await employeeOrFail(tx, input.employeeId);
      if (emp.status === 'terminated') throw badRequest('EMPLOYEE_TERMINATED', 'Colaborador desligado');
      if (input.startOn < emp.admissionDate) throw badRequest('LEAVE_BEFORE_ADMISSION', 'O afastamento começa antes da admissão');
      // Licença-maternidade: 120 dias (CLT, art. 392); Empresa Cidadã (180) pode ser informada no fim.
      const endOn = input.endOn ?? addDays(input.startOn, 119);
      const existing = await tx.select().from(hrLeaves).where(eq(hrLeaves.employeeId, emp.id));
      if (existing.some((l) => l.startOn <= endOn && l.endOn >= input.startOn)) throw badRequest('LEAVE_OVERLAP', 'Já há afastamento nestas datas');
      const [row] = await tx.insert(hrLeaves).values({ tenantId, employeeId: emp.id, type: input.type, startOn: input.startOn, endOn, notes: input.notes ?? null }).returning();
      await this.audit.log(tx, { action: 'hr.leave.created', entity: 'hr_leave', entityId: row!.id, data: { type: input.type } });
      const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      return toLeave(row!, tables.sickLeaveCompanyDays);
    });
  }

  deleteLeave(id: string) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx.delete(hrLeaves).where(eq(hrLeaves.id, id)).returning({ id: hrLeaves.id });
      if (!row) throw new NotFoundException({ code: 'LEAVE_NOT_FOUND', message: 'Afastamento não encontrado' });
      await this.audit.log(tx, { action: 'hr.leave.deleted', entity: 'hr_leave', entityId: id });
    });
  }

  // ---- Folha ----------------------------------------------------------------------------------

  payrolls() {
    return this.tdb.run(async (tx) => {
      const rows = await tx.select().from(hrPayrolls).orderBy(desc(hrPayrolls.competence), asc(hrPayrolls.type)).limit(60);
      return Promise.all(
        rows.map(async (p) => ({ id: p.id, competence: p.competence, type: p.type, status: p.status, closedAt: p.closedAt?.toISOString() ?? null, totals: (await this.detailInTx(tx, p.id)).totals })),
      );
    });
  }

  getPayroll(id: string): Promise<Payroll> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  /**
   * Abre a folha mensal com todos que trabalharam no período (proporcional na admissão e no
   * desligamento). Quem tem rescisão no mês fica de fora: o saldo de salário vai no termo.
   */
  createPayroll(body: PayrollCreate): Promise<Payroll> {
    const { tenantId } = requestContext.require();
    const { competence, holidays } = body;
    return this.tdb.run(async (tx) => {
      const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      const start = `${competence}-01`;
      const end = lastDayOf(competence);
      const payroll = await this.insertPayroll(tx, { tenantId, competence, type: 'monthly', holidays, tables }, 'A folha deste mês já existe');
      const terminated = new Set((await tx.select({ e: hrTerminations.employeeId }).from(hrTerminations).where(lte(hrTerminations.terminationDate, end))).map((r) => r.e));
      const employees = (await tx.select().from(hrEmployees)).filter((e) => e.admissionDate <= end && (!e.terminationDate || e.terminationDate >= start) && !terminated.has(e.id));
      if (!employees.length) throw badRequest('NO_EMPLOYEES', 'Nenhum colaborador no mês');
      for (const e of employees) {
        const { daysWorked } = contractInMonth(e, competence);
        const result = await this.monthlyResult(tx, payroll, e, daysWorked, Number(e.salary), e.dependents, noManual);
        await tx.insert(hrPayrollItems).values({ tenantId, payrollId: payroll.id, employeeId: e.id, salary: e.salary, dependents: e.dependents, daysWorked, result });
      }
      await this.audit.log(tx, { action: 'hr.payroll.created', entity: 'hr_payroll', entityId: payroll.id, data: { competence, type: 'monthly' } });
      return this.detailInTx(tx, payroll.id);
    });
  }

  /**
   * Folha do 13º: 1ª parcela (competência 11, paga até 30/11) ou 2ª (competência 12, até 20/12).
   * Entra quem tem pelo menos 1 avo no ano e não foi desligado até dezembro (o desligado recebe
   * o 13º proporcional no termo de rescisão). Médias: folhas mensais fechadas de janeiro a
   * outubro (1ª) ou novembro (2ª); a diferença das variáveis de dezembro fica para um ajuste
   * manual em janeiro (simplificação).
   */
  createThirteenth(body: ThirteenthCreate): Promise<Payroll> {
    const { tenantId } = requestContext.require();
    const { year, installment } = body;
    return this.tdb.run(async (tx) => {
      const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      const competence = `${year}-${installment === 1 ? '11' : '12'}`;
      const type = installment === 1 ? 'thirteenth_1' : 'thirteenth_2';
      if (installment === 2) {
        const first = await findPayroll(tx, `${year}-11`, 'thirteenth_1');
        if (first?.status === 'draft') throw badRequest('FIRST_INSTALLMENT_OPEN', 'Feche a folha da 1ª parcela antes de calcular a 2ª');
      }
      const payroll = await this.insertPayroll(tx, { tenantId, competence, type, holidays: 0, tables }, `A folha do 13º (${installment}ª parcela) de ${year} já existe`);
      const yearEnd = `${year}-12-31`;
      const admittedBy = installment === 1 ? `${year}-11-30` : yearEnd;
      const employees = (await tx.select().from(hrEmployees)).filter((e) => e.admissionDate <= admittedBy && !(e.terminationDate && e.terminationDate <= yearEnd));
      const leaves = await tx.select().from(hrLeaves);
      let count = 0;
      for (const e of employees) {
        // Avos contados até dezembro (na 1ª parcela, projetados).
        const avos = thirteenthAvos(year, e.admissionDate, yearEnd, leaves.filter((l) => l.employeeId === e.id), tables.sickLeaveCompanyDays);
        if (avos === 0) continue;
        const average = await variableAverage(tx, e.id, `${year}-01`, `${year}-${installment === 1 ? '10' : '11'}`);
        const result = await this.thirteenthResult(tx, installment, year, e, Number(e.salary), e.dependents, avos, average, tablesOf(payroll.tables));
        await tx.insert(hrPayrollItems).values({ tenantId, payrollId: payroll.id, employeeId: e.id, salary: e.salary, dependents: e.dependents, daysWorked: 30, avos, variableAverage: centsToDecimal(toCents(average)), result });
        count++;
      }
      if (!count) throw badRequest('NO_EMPLOYEES', 'Nenhum colaborador com avos de 13º no ano');
      await this.audit.log(tx, { action: 'hr.payroll.created', entity: 'hr_payroll', entityId: payroll.id, data: { competence, type } });
      return this.detailInTx(tx, payroll.id);
    });
  }

  /** Refaz os cálculos da folha mensal aberta (afastamentos, férias e feriados novos), mantendo os lançamentos. */
  recalculate(id: string, body: { holidays?: number }): Promise<Payroll> {
    return this.tdb.run(async (tx) => {
      let payroll = await payrollOrFail(tx, id);
      if (payroll.status === 'closed') throw badRequest('PAYROLL_CLOSED', 'Folha fechada não pode ser alterada');
      if (payroll.type !== 'monthly') throw badRequest('NOT_MONTHLY', 'Só a folha mensal é recalculada; no 13º, ajuste avos e médias por colaborador');
      if (body.holidays !== undefined && body.holidays !== payroll.holidays) {
        [payroll] = (await tx.update(hrPayrolls).set({ holidays: body.holidays }).where(eq(hrPayrolls.id, id)).returning()) as [PayrollRow];
      }
      const items = await tx.select({ i: hrPayrollItems, e: hrEmployees }).from(hrPayrollItems).innerJoin(hrEmployees, eq(hrEmployees.id, hrPayrollItems.employeeId)).where(eq(hrPayrollItems.payrollId, id));
      for (const { i, e } of items) {
        const result = await this.monthlyResult(tx, payroll, e, i.daysWorked, Number(i.salary), i.dependents, manualOf(i));
        await tx.update(hrPayrollItems).set({ result }).where(eq(hrPayrollItems.id, i.id));
      }
      return this.detailInTx(tx, id);
    });
  }

  updateItem(payrollId: string, itemId: string, input: PayrollItemUpdate): Promise<Payroll> {
    return this.tdb.run(async (tx) => {
      const payroll = await payrollOrFail(tx, payrollId);
      if (payroll.status === 'closed') throw badRequest('PAYROLL_CLOSED', 'Folha fechada não pode ser alterada');
      if (payroll.type !== 'monthly') throw badRequest('NOT_MONTHLY', 'Lançamentos de horas e faltas são da folha mensal');
      const [item] = await tx.select({ i: hrPayrollItems, e: hrEmployees }).from(hrPayrollItems).innerJoin(hrEmployees, eq(hrEmployees.id, hrPayrollItems.employeeId)).where(and(eq(hrPayrollItems.id, itemId), eq(hrPayrollItems.payrollId, payrollId)));
      if (!item) throw new NotFoundException({ code: 'ITEM_NOT_FOUND', message: 'Colaborador não está nesta folha' });
      const cal = monthCalendar(payroll.competence, payroll.holidays);
      if (input.dsrLostDays > cal.restDays) throw badRequest('DSR_LOST', `O mês tem ${cal.restDays} dias de repouso`);
      const result = await this.monthlyResult(tx, payroll, item.e, input.daysWorked, Number(item.i.salary), item.i.dependents, input);
      if (result.net < 0) throw badRequest('NEGATIVE_NET', 'Os descontos passam do salário');
      await tx
        .update(hrPayrollItems)
        .set({
          daysWorked: input.daysWorked,
          overtime50Hours: input.overtime50Hours.toFixed(2),
          overtime100Hours: input.overtime100Hours.toFixed(2),
          commissions: centsToDecimal(toCents(input.commissions)),
          otherEarnings: centsToDecimal(toCents(input.otherEarnings)),
          otherDeductions: centsToDecimal(toCents(input.otherDeductions)),
          absences: input.absences,
          dsrLostDays: input.dsrLostDays,
          notes: input.notes ?? null,
          result,
        })
        .where(eq(hrPayrollItems.id, itemId));
      return this.detailInTx(tx, payrollId);
    });
  }

  /** Ajusta avos e média das variáveis de um colaborador na folha do 13º. */
  updateThirteenthItem(payrollId: string, itemId: string, input: ThirteenthItemUpdate): Promise<Payroll> {
    return this.tdb.run(async (tx) => {
      const payroll = await payrollOrFail(tx, payrollId);
      if (payroll.status === 'closed') throw badRequest('PAYROLL_CLOSED', 'Folha fechada não pode ser alterada');
      if (payroll.type !== 'thirteenth_1' && payroll.type !== 'thirteenth_2') throw badRequest('NOT_THIRTEENTH', 'Esta folha não é de 13º');
      const [item] = await tx.select({ i: hrPayrollItems, e: hrEmployees }).from(hrPayrollItems).innerJoin(hrEmployees, eq(hrEmployees.id, hrPayrollItems.employeeId)).where(and(eq(hrPayrollItems.id, itemId), eq(hrPayrollItems.payrollId, payrollId)));
      if (!item) throw new NotFoundException({ code: 'ITEM_NOT_FOUND', message: 'Colaborador não está nesta folha' });
      const year = Number(payroll.competence.slice(0, 4));
      const result = await this.thirteenthResult(tx, payroll.type === 'thirteenth_1' ? 1 : 2, year, item.e, Number(item.i.salary), item.i.dependents, input.avos, input.variableAverage, tablesOf(payroll.tables));
      await tx
        .update(hrPayrollItems)
        .set({ avos: input.avos, variableAverage: centsToDecimal(toCents(input.variableAverage)), notes: input.notes ?? null, result })
        .where(eq(hrPayrollItems.id, itemId));
      return this.detailInTx(tx, payrollId);
    });
  }

  /**
   * Fecha a folha e lança no financeiro (baixa no financeiro):
   * - mensal: líquidos no dia de pagamento do mês seguinte; INSS + IRRF e FGTS no dia 20;
   * - 13º 1ª parcela: líquido até 30/11; FGTS em 20/12;
   * - 13º 2ª parcela: líquido até 20/12; INSS do 13º em 20/12 (DCTFWeb da competência 13);
   *   IRRF e FGTS em 20/01 do ano seguinte.
   * Rescisões não fecham aqui: cada uma é lançada ao confirmar.
   */
  closePayroll(id: string): Promise<Payroll> {
    const { userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const payroll = await payrollOrFail(tx, id);
      if (payroll.status === 'closed') throw badRequest('PAYROLL_CLOSED', 'Folha já fechada');
      if (payroll.type === 'termination') throw badRequest('TERMINATION_PAYROLL', 'Rescisões são lançadas no financeiro ao confirmar cada uma');
      const { payDay } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      const detail = await this.detailInTx(tx, id);
      const [y, m] = payroll.competence.split('-');
      const t = detail.totals;
      const nextJan20 = `${Number(y) + 1}-01-20`;
      const entries =
        payroll.type === 'monthly'
          ? [
              { description: `Salários ${m}/${y} (${t.employees} colaboradores)`, amount: t.net, dueDate: nextMonth(payroll.competence, payDay), categoryKey: 'payroll' },
              { description: `INSS e IRRF retidos ${m}/${y} (DCTFWeb)`, amount: round2(t.inss + t.irrf), dueDate: nextMonth(payroll.competence, 20), categoryKey: 'taxes' },
              { description: `FGTS ${m}/${y}`, amount: t.fgts, dueDate: nextMonth(payroll.competence, 20), categoryKey: 'payroll' },
            ]
          : payroll.type === 'thirteenth_1'
            ? [
                { description: `13º salário ${y} — 1ª parcela (${t.employees} colaboradores)`, amount: t.net, dueDate: `${y}-11-30`, categoryKey: 'payroll' },
                { description: `FGTS 13º ${y} — 1ª parcela`, amount: t.fgts, dueDate: `${y}-12-20`, categoryKey: 'payroll' },
              ]
            : [
                { description: `13º salário ${y} — 2ª parcela (${t.employees} colaboradores)`, amount: t.net, dueDate: `${y}-12-20`, categoryKey: 'payroll' },
                { description: `INSS sobre 13º ${y} (DCTFWeb competência 13)`, amount: t.inss, dueDate: `${y}-12-20`, categoryKey: 'taxes' },
                { description: `IRRF sobre 13º ${y}`, amount: t.irrf, dueDate: nextJan20, categoryKey: 'taxes' },
                { description: `FGTS 13º ${y} — 2ª parcela`, amount: t.fgts, dueDate: nextJan20, categoryKey: 'payroll' },
              ];
      for (const e of entries) {
        if (e.amount <= 0) continue;
        await this.finance.recordInTx(tx, { kind: 'expense', status: 'pending', ...e, sourceType: PAYROLL_SOURCE, sourceId: id, settleInFinance: true });
      }
      await tx.update(hrPayrolls).set({ status: 'closed', closedAt: new Date(), closedById: userId ?? null }).where(eq(hrPayrolls.id, id));
      await this.audit.log(tx, { action: 'hr.payroll.closed', entity: 'hr_payroll', entityId: id, data: { type: payroll.type, ...detail.totals } });
      return this.detailInTx(tx, id);
    });
  }

  private async insertPayroll(tx: Tx, values: typeof hrPayrolls.$inferInsert, conflictMessage: string): Promise<PayrollRow> {
    try {
      const [row] = await tx.insert(hrPayrolls).values(values).returning();
      return row!;
    } catch (err) {
      if (pgCode(err) === '23505') throw new ConflictException({ code: 'PAYROLL_EXISTS', message: conflictMessage });
      throw err;
    }
  }

  /** Holerite mensal com afastamentos, férias do mês e calendário do DSR. */
  private async monthlyResult(tx: Tx, payroll: PayrollRow, e: EmployeeRow, daysWorked: number, salary: number, dependents: number, manual: ManualInputs): Promise<Payslip> {
    const tables = tablesOf(payroll.tables);
    const start = `${payroll.competence}-01`;
    const end = lastDayOf(payroll.competence);
    const { fromDate, toDate } = contractInMonth(e, payroll.competence);
    const leaves = await tx.select().from(hrLeaves).where(and(eq(hrLeaves.employeeId, e.id), lte(hrLeaves.startOn, end), gte(hrLeaves.endOn, start)));
    const vacations = await tx.select().from(hrVacations).where(and(eq(hrVacations.employeeId, e.id), eq(hrVacations.status, 'scheduled')));
    const { inssDays, maternityDays } = leaveDaysBetween(leaves, fromDate, toDate, tables.sickLeaveCompanyDays, true);
    const vacationDays = vacationDaysBetween(vacations, fromDate, toDate, true);
    const cal = monthCalendar(payroll.competence, payroll.holidays);
    const slip = computePayslip(
      {
        salary,
        weeklyHours: e.weeklyHours,
        daysWorked,
        dependents,
        ...manual,
        inssLeaveDays: inssDays,
        maternityDays,
        vacationDays,
        restDays: cal.restDays,
        workingDays: cal.workingDays,
        apprentice: e.category === 'apprentice',
      },
      tables,
    );
    const receipts = vacations
      .map((v) => ({ v, payBy: addDays(v.startOn, -2) }))
      .filter(({ payBy }) => payBy >= start && payBy <= end)
      .map(({ v, payBy }) => {
        const pay = vacationPay(salary, v.days, v.soldDays);
        return { startOn: v.startOn, days: v.days, soldDays: v.soldDays, payBy, amount: round2(pay.vacation + pay.allowance) };
      });
    return receipts.length ? { ...slip, vacationReceipts: receipts } : slip;
  }

  private async thirteenthResult(tx: Tx, installment: 1 | 2, year: number, e: EmployeeRow, salary: number, dependents: number, avos: number, average: number, tables: ReturnType<typeof tablesOf>): Promise<Payslip> {
    const advance = installment === 2 ? ((await closedItem(tx, e.id, `${year}-11`, 'thirteenth_1'))?.gross ?? 0) : 0;
    return computeThirteenth(installment, { salary, variableAverage: average, avos, dependents, advance, apprentice: e.category === 'apprentice' }, tables);
  }

  private async detailInTx(tx: Tx, id: string): Promise<Payroll> {
    const p = await payrollOrFail(tx, id);
    const items = await tx
      .select({ i: hrPayrollItems, e: hrEmployees })
      .from(hrPayrollItems)
      .innerJoin(hrEmployees, eq(hrEmployees.id, hrPayrollItems.employeeId))
      .where(eq(hrPayrollItems.payrollId, id))
      .orderBy(asc(hrEmployees.name));
    const terminations =
      p.type === 'termination' && items.length
        ? await tx.select({ id: hrTerminations.id, employeeId: hrTerminations.employeeId }).from(hrTerminations).where(inArray(hrTerminations.employeeId, items.map(({ e }) => e.id)))
        : [];
    const list: PayrollItem[] = items.map(({ i, e }) => ({
      ...normalizePayslip(i.result),
      id: i.id,
      employee: { id: e.id, name: e.name, cpf: e.cpf, position: e.position, admissionDate: e.admissionDate, dependents: i.dependents, category: e.category },
      salary: Number(i.salary),
      daysWorked: i.daysWorked,
      overtime50Hours: Number(i.overtime50Hours),
      overtime100Hours: Number(i.overtime100Hours),
      commissions: Number(i.commissions),
      otherEarnings: Number(i.otherEarnings),
      otherDeductions: Number(i.otherDeductions),
      absences: i.absences,
      dsrLostDays: i.dsrLostDays,
      avos: i.avos ?? undefined,
      variableAverage: Number(i.variableAverage),
      notes: i.notes,
      terminationId: terminations.find((t) => t.employeeId === e.id)?.id ?? null,
    }));
    const sum = (k: 'gross' | 'inss' | 'irrf' | 'net' | 'fgts' | 'maternity') => round2(list.reduce((s, x) => s + ((x[k] as number | undefined) ?? 0), 0));
    const cal = monthCalendar(p.competence, p.holidays);
    return {
      id: p.id,
      competence: p.competence,
      type: p.type,
      status: p.status,
      closedAt: p.closedAt?.toISOString() ?? null,
      tablesLabel: tablesOf(p.tables).label,
      holidays: p.holidays,
      calendar: { days: cal.days, sundays: cal.sundays, restDays: cal.restDays, workingDays: cal.workingDays },
      totals: { gross: sum('gross'), inss: sum('inss'), irrf: sum('irrf'), net: sum('net'), fgts: sum('fgts'), maternity: sum('maternity'), employees: list.length },
      items: list,
    };
  }
}

const manualOf = (i: typeof hrPayrollItems.$inferSelect): ManualInputs => ({
  overtime50Hours: Number(i.overtime50Hours),
  overtime100Hours: Number(i.overtime100Hours),
  commissions: Number(i.commissions),
  otherEarnings: Number(i.otherEarnings),
  otherDeductions: Number(i.otherDeductions),
  absences: i.absences,
  dsrLostDays: i.dsrLostDays,
});

function toEmployee(r: EmployeeRow, vacations: (typeof hrVacations.$inferSelect)[], termination: Employee['termination']): Employee {
  const periods = acquisitionPeriods(
    r.admissionDate,
    r.terminationDate ?? localToday(),
    vacations.filter((v) => v.employeeId === r.id).map((v) => ({ periodStart: v.periodStart, days: v.days + v.soldDays })),
  );
  return {
    id: r.id,
    name: r.name,
    cpf: r.cpf,
    birthDate: r.birthDate,
    email: r.email,
    phone: r.phone,
    position: r.position,
    department: r.department,
    admissionDate: r.admissionDate,
    salary: Number(r.salary),
    weeklyHours: r.weeklyHours,
    dependents: r.dependents,
    category: r.category,
    experienceEnd: r.experienceEnd,
    status: r.status,
    terminationDate: r.terminationDate,
    pixKey: r.pixKey,
    notes: r.notes,
    periods,
    vacationBalance: periods.reduce((s, p) => s + p.balance, 0),
    overdueVacation: r.status !== 'terminated' && periods.some((p) => p.overdue),
    termination,
  };
}

function toVacation(v: typeof hrVacations.$inferSelect, salary: number): Vacation {
  const endOn = addDays(v.startOn, v.days - 1);
  return {
    id: v.id,
    periodStart: v.periodStart,
    startOn: v.startOn,
    endOn,
    days: v.days,
    soldDays: v.soldDays,
    // Gozadas: derivado da data (não precisa de rotina para virar o status).
    status: v.status === 'scheduled' && endOn < localToday() ? 'taken' : v.status,
    pay: vacationPay(salary, v.days, v.soldDays),
    payBy: addDays(v.startOn, -2),
  };
}

function toLeave(l: typeof hrLeaves.$inferSelect, companyDays: number): Leave {
  const days = Math.round((Date.parse(`${l.endOn}T12:00:00Z`) - Date.parse(`${l.startOn}T12:00:00Z`)) / 86_400_000) + 1;
  const inssDays = l.type === 'sick' ? Math.max(0, days - companyDays) : 0;
  return { id: l.id, type: l.type, startOn: l.startOn, endOn: l.endOn, days, companyDays: days - inssDays, inssDays, notes: l.notes };
}

@Controller('hr')
@ModuleRoute('hr')
export class HrController {
  constructor(
    private readonly hr: HrService,
    private readonly terminations: TerminationService,
  ) {}

  @Get('employees')
  @RequirePermission('hr.read')
  employees(@Query(new ZodPipe(z.object({ status: z.string().max(20).optional() }))) q: { status?: string }) {
    return this.hr.listEmployees(q);
  }

  @Get('employees/:id')
  @RequirePermission('hr.read')
  employee(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.getEmployee(id);
  }

  @Post('employees')
  @RequirePermission('hr.manage')
  createEmployee(@Body(new ZodPipe(employeeInput)) body: EmployeeInput) {
    return this.hr.saveEmployee(null, body);
  }

  @Patch('employees/:id')
  @RequirePermission('hr.manage')
  updateEmployee(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(employeeInput)) body: EmployeeInput) {
    return this.hr.saveEmployee(id, body);
  }

  @Get('employees/:id/vacations')
  @RequirePermission('hr.read')
  vacations(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.vacations(id);
  }

  @Get('employees/:id/leaves')
  @RequirePermission('hr.read')
  leaves(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.leaves(id);
  }

  @Get('employees/:id/termination')
  @RequirePermission('hr.read')
  termination(@Param('id', ParseUUIDPipe) id: string) {
    return this.terminations.get(id);
  }

  @Post('employees/:id/termination/preview')
  @HttpCode(200)
  @RequirePermission('hr.payroll')
  previewTermination(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(terminationInput)) body: TerminationInput) {
    return this.terminations.preview(id, body);
  }

  @Post('employees/:id/termination')
  @RequirePermission('hr.payroll')
  terminate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(terminationInput)) body: TerminationInput) {
    return this.terminations.confirm(id, body);
  }

  @Post('vacations')
  @RequirePermission('hr.manage')
  schedule(@Body(new ZodPipe(vacationInput)) body: VacationInput) {
    return this.hr.scheduleVacation(body);
  }

  @Post('vacations/:id/cancel')
  @HttpCode(204)
  @RequirePermission('hr.manage')
  cancelVacation(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.cancelVacation(id);
  }

  @Post('leaves')
  @RequirePermission('hr.manage')
  createLeave(@Body(new ZodPipe(leaveInput)) body: LeaveInput) {
    return this.hr.createLeave(body);
  }

  @Delete('leaves/:id')
  @HttpCode(204)
  @RequirePermission('hr.manage')
  deleteLeave(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.deleteLeave(id);
  }

  @Get('payrolls')
  @RequirePermission('hr.read')
  payrolls() {
    return this.hr.payrolls();
  }

  @Get('payrolls/:id')
  @RequirePermission('hr.read')
  payroll(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.getPayroll(id);
  }

  @Post('payrolls')
  @RequirePermission('hr.payroll')
  create(@Body(new ZodPipe(payrollCreate)) body: PayrollCreate) {
    return this.hr.createPayroll(body);
  }

  @Post('payrolls/thirteenth')
  @RequirePermission('hr.payroll')
  createThirteenth(@Body(new ZodPipe(thirteenthCreate)) body: ThirteenthCreate) {
    return this.hr.createThirteenth(body);
  }

  @Post('payrolls/:id/recalculate')
  @HttpCode(200)
  @RequirePermission('hr.payroll')
  recalculate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(payrollRecalculate)) body: { holidays?: number }) {
    return this.hr.recalculate(id, body);
  }

  @Patch('payrolls/:id/items/:itemId')
  @RequirePermission('hr.payroll')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(payrollItemUpdate)) body: PayrollItemUpdate) {
    return this.hr.updateItem(id, itemId, body);
  }

  @Patch('payrolls/:id/thirteenth-items/:itemId')
  @RequirePermission('hr.payroll')
  updateThirteenthItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(thirteenthItemUpdate)) body: ThirteenthItemUpdate) {
    return this.hr.updateThirteenthItem(id, itemId, body);
  }

  @Post('payrolls/:id/close')
  @HttpCode(200)
  @RequirePermission('hr.payroll')
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.closePayroll(id);
  }
}

@Module({ controllers: [HrController], providers: [HrService, TerminationService] })
export class HrModule {}

