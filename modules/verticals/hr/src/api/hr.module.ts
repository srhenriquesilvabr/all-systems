import { AuditService, centsToDecimal, FinanceService, ModuleSettingsService, TenantDb, toCents, ZodPipe } from '@all/core';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  acquisitionPeriods,
  computePayslip,
  employeeInput,
  payrollItemUpdate,
  vacationInput,
  vacationPay,
  type Employee,
  type EmployeeInput,
  type Payroll,
  type PayrollItem,
  type PayrollItemUpdate,
  type Payslip,
  type TaxTables,
  type Vacation,
  type VacationInput,
} from '../contracts';
import { hrEmployees, hrPayrollItems, hrPayrolls, hrVacations } from '../db/schema';
import type { HrSettings } from '../manifest';

const MODULE = 'hr';
const SOURCE = 'hr_payroll';
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lastDayOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const nextMonth = (ym: string, day: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m, day));
  return d.toISOString().slice(0, 10);
};

type EmployeeRow = typeof hrEmployees.$inferSelect;

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
      return rows.map((r) => toEmployee(r, vacations));
    });
  }

  getEmployee(id: string): Promise<Employee> {
    return this.tdb.run(async (tx) => {
      const row = await this.employeeOrFail(tx, id);
      const vacations = await tx.select().from(hrVacations).where(and(eq(hrVacations.employeeId, id), eq(hrVacations.status, 'scheduled')));
      return toEmployee(row, vacations);
    });
  }

  saveEmployee(id: string | null, input: EmployeeInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      if (input.status === 'terminated' && !input.terminationDate) throw badRequest('TERMINATION_DATE', 'Informe a data do desligamento');
      const values = { ...input, salary: centsToDecimal(toCents(input.salary)), birthDate: input.birthDate ?? null, terminationDate: input.terminationDate ?? null };
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
        const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
        if (code === '23505') throw new ConflictException({ code: 'CPF_TAKEN', message: 'Já existe um colaborador com este CPF' });
        throw err;
      }
    });
  }

  // ---- Férias ---------------------------------------------------------------------------------

  vacations(employeeId: string): Promise<Vacation[]> {
    return this.tdb.run(async (tx) => {
      const emp = await this.employeeOrFail(tx, employeeId);
      const rows = await tx.select().from(hrVacations).where(eq(hrVacations.employeeId, employeeId)).orderBy(desc(hrVacations.startOn));
      return rows.map((v) => toVacation(v, Number(emp.salary)));
    });
  }

  /** Agenda férias de um período aquisitivo já completo, dentro do saldo. */
  scheduleVacation(input: VacationInput): Promise<Vacation> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const emp = await this.employeeOrFail(tx, input.employeeId);
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

  // ---- Folha ----------------------------------------------------------------------------------

  payrolls() {
    return this.tdb.run(async (tx) => {
      const rows = await tx.select().from(hrPayrolls).orderBy(desc(hrPayrolls.competence)).limit(36);
      return Promise.all(rows.map(async (p) => ({ id: p.id, competence: p.competence, status: p.status, closedAt: p.closedAt?.toISOString() ?? null, totals: (await this.detailInTx(tx, p.id)).totals })));
    });
  }

  getPayroll(id: string): Promise<Payroll> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  /** Abre a folha do mês com todos que trabalharam no período (proporcional na admissão e no desligamento). */
  createPayroll(competence: string): Promise<Payroll> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      const start = `${competence}-01`;
      const end = lastDayOf(competence);
      let payroll;
      try {
        [payroll] = await tx.insert(hrPayrolls).values({ tenantId, competence, tables }).returning();
      } catch (err) {
        const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
        if (code === '23505') throw new ConflictException({ code: 'PAYROLL_EXISTS', message: 'A folha deste mês já existe' });
        throw err;
      }
      const employees = (await tx.select().from(hrEmployees)).filter((e) => e.admissionDate <= end && (!e.terminationDate || e.terminationDate >= start));
      if (!employees.length) throw badRequest('NO_EMPLOYEES', 'Nenhum colaborador no mês');
      for (const e of employees) {
        const from = e.admissionDate > start ? Number(e.admissionDate.slice(8)) : 1;
        const to = e.terminationDate && e.terminationDate < end ? Number(e.terminationDate.slice(8)) : 30;
        const daysWorked = from === 1 && to === 30 ? 30 : Math.max(0, Math.min(30, to) - from + 1);
        const input = { salary: Number(e.salary), weeklyHours: e.weeklyHours, daysWorked, overtime50Hours: 0, overtime100Hours: 0, otherEarnings: 0, otherDeductions: 0, dependents: e.dependents };
        await tx.insert(hrPayrollItems).values({
          tenantId,
          payrollId: payroll!.id,
          employeeId: e.id,
          salary: e.salary,
          dependents: e.dependents,
          daysWorked,
          result: computePayslip(input, tables),
        });
      }
      await this.audit.log(tx, { action: 'hr.payroll.created', entity: 'hr_payroll', entityId: payroll!.id, data: { competence } });
      return this.detailInTx(tx, payroll!.id);
    });
  }

  updateItem(payrollId: string, itemId: string, input: PayrollItemUpdate): Promise<Payroll> {
    return this.tdb.run(async (tx) => {
      const payroll = await this.payrollOrFail(tx, payrollId);
      if (payroll.status === 'closed') throw badRequest('PAYROLL_CLOSED', 'Folha fechada não pode ser alterada');
      const [item] = await tx.select({ i: hrPayrollItems, weeklyHours: hrEmployees.weeklyHours }).from(hrPayrollItems).innerJoin(hrEmployees, eq(hrEmployees.id, hrPayrollItems.employeeId)).where(and(eq(hrPayrollItems.id, itemId), eq(hrPayrollItems.payrollId, payrollId)));
      if (!item) throw new NotFoundException({ code: 'ITEM_NOT_FOUND', message: 'Colaborador não está nesta folha' });
      const result = computePayslip({ salary: Number(item.i.salary), weeklyHours: item.weeklyHours, dependents: item.i.dependents, ...input }, payroll.tables as TaxTables);
      if (result.net < 0) throw badRequest('NEGATIVE_NET', 'Os descontos passam do salário');
      await tx
        .update(hrPayrollItems)
        .set({
          daysWorked: input.daysWorked,
          overtime50Hours: input.overtime50Hours.toFixed(2),
          overtime100Hours: input.overtime100Hours.toFixed(2),
          otherEarnings: centsToDecimal(toCents(input.otherEarnings)),
          otherDeductions: centsToDecimal(toCents(input.otherDeductions)),
          notes: input.notes ?? null,
          result,
        })
        .where(eq(hrPayrollItems.id, itemId));
      return this.detailInTx(tx, payrollId);
    });
  }

  /**
   * Fecha a folha e lança no financeiro: salários líquidos (dia de pagamento do mês seguinte),
   * INSS + IRRF retidos e FGTS (dia 20 do mês seguinte).
   */
  closePayroll(id: string): Promise<Payroll> {
    const { userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const payroll = await this.payrollOrFail(tx, id);
      if (payroll.status === 'closed') throw badRequest('PAYROLL_CLOSED', 'Folha já fechada');
      const { payDay } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      const detail = await this.detailInTx(tx, id);
      const [y, m] = payroll.competence.split('-');
      const entries = [
        { description: `Salários ${m}/${y} (${detail.totals.employees} colaboradores)`, amount: detail.totals.net, dueDate: nextMonth(payroll.competence, payDay), categoryKey: 'payroll' },
        { description: `INSS e IRRF retidos ${m}/${y} (DCTFWeb)`, amount: Math.round((detail.totals.inss + detail.totals.irrf) * 100) / 100, dueDate: nextMonth(payroll.competence, 20), categoryKey: 'taxes' },
        { description: `FGTS ${m}/${y}`, amount: detail.totals.fgts, dueDate: nextMonth(payroll.competence, 20), categoryKey: 'payroll' },
      ];
      for (const e of entries) {
        if (e.amount <= 0) continue;
        await this.finance.recordInTx(tx, { kind: 'expense', status: 'pending', ...e, sourceType: SOURCE, sourceId: id });
      }
      await tx.update(hrPayrolls).set({ status: 'closed', closedAt: new Date(), closedById: userId ?? null }).where(eq(hrPayrolls.id, id));
      await this.audit.log(tx, { action: 'hr.payroll.closed', entity: 'hr_payroll', entityId: id, data: detail.totals });
      return this.detailInTx(tx, id);
    });
  }

  private async detailInTx(tx: Tx, id: string): Promise<Payroll> {
    const p = await this.payrollOrFail(tx, id);
    const items = await tx
      .select({ i: hrPayrollItems, e: hrEmployees })
      .from(hrPayrollItems)
      .innerJoin(hrEmployees, eq(hrEmployees.id, hrPayrollItems.employeeId))
      .where(eq(hrPayrollItems.payrollId, id))
      .orderBy(asc(hrEmployees.name));
    const list: PayrollItem[] = items.map(({ i, e }) => ({
      id: i.id,
      employee: { id: e.id, name: e.name, cpf: e.cpf, position: e.position, admissionDate: e.admissionDate, dependents: i.dependents },
      salary: Number(i.salary),
      daysWorked: i.daysWorked,
      overtime50Hours: Number(i.overtime50Hours),
      overtime100Hours: Number(i.overtime100Hours),
      otherEarnings: Number(i.otherEarnings),
      notes: i.notes,
      ...(i.result as Payslip),
    }));
    const sum = (k: keyof Payslip) => Math.round(list.reduce((s, x) => s + (x[k] as number), 0) * 100) / 100;
    return {
      id: p.id,
      competence: p.competence,
      status: p.status,
      closedAt: p.closedAt?.toISOString() ?? null,
      tablesLabel: (p.tables as TaxTables).label,
      totals: { gross: sum('gross'), inss: sum('inss'), irrf: sum('irrf'), net: sum('net'), fgts: sum('fgts'), employees: list.length },
      items: list,
    };
  }

  private async payrollOrFail(tx: Tx, id: string) {
    const [p] = await tx.select().from(hrPayrolls).where(eq(hrPayrolls.id, id));
    if (!p) throw new NotFoundException({ code: 'PAYROLL_NOT_FOUND', message: 'Folha não encontrada' });
    return p;
  }

  private async employeeOrFail(tx: Tx, id: string) {
    const [e] = await tx.select().from(hrEmployees).where(eq(hrEmployees.id, id));
    if (!e) throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: 'Colaborador não encontrado' });
    return e;
  }
}

function toEmployee(r: EmployeeRow, vacations: (typeof hrVacations.$inferSelect)[]): Employee {
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
    status: r.status,
    terminationDate: r.terminationDate,
    pixKey: r.pixKey,
    notes: r.notes,
    periods,
    vacationBalance: periods.reduce((s, p) => s + p.balance, 0),
    overdueVacation: r.status !== 'terminated' && periods.some((p) => p.overdue),
  };
}

function toVacation(v: typeof hrVacations.$inferSelect, salary: number): Vacation {
  return {
    id: v.id,
    periodStart: v.periodStart,
    startOn: v.startOn,
    endOn: addDays(v.startOn, v.days - 1),
    days: v.days,
    soldDays: v.soldDays,
    status: v.status,
    pay: vacationPay(salary, v.days, v.soldDays),
    payBy: addDays(v.startOn, -2),
  };
}

const competence = z.object({ competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM') });

@Controller('hr')
@ModuleRoute('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

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
  create(@Body(new ZodPipe(competence)) body: { competence: string }) {
    return this.hr.createPayroll(body.competence);
  }

  @Patch('payrolls/:id/items/:itemId')
  @RequirePermission('hr.payroll')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(payrollItemUpdate)) body: PayrollItemUpdate) {
    return this.hr.updateItem(id, itemId, body);
  }

  @Post('payrolls/:id/close')
  @HttpCode(200)
  @RequirePermission('hr.payroll')
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.closePayroll(id);
  }
}

@Module({ controllers: [HrController], providers: [HrService] })
export class HrModule {}

