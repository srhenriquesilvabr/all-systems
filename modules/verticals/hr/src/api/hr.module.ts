import { AuditService, centsToDecimal, FinanceService, ModuleSettingsService, splitName, TeamLinksRegistry, TeamService, TenantDb, toCents, ZodPipe, type TeamMemberPatch } from '@all/core';
import { customers, teamMemberName, teamMembers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  acquisitionPeriods,
  employerFilter,
  type EmployerFilter,
  type EmployersResponse,
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
import { HrEmployersRegistry } from './employers';
import {
  addDays,
  badRequest,
  closedItem,
  employeeOrFail,
  employerOrFail,
  employerRef,
  employerWhere,
  sameEmployer,
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
  employeesQuery,
  type ContractRow,
  type EmployeeRow,
  type PayrollRow,
} from './shared';
import { TerminationService } from './termination.service';

type ManualInputs = Pick<PayrollItemUpdate, 'overtime50Hours' | 'overtime100Hours' | 'commissions' | 'otherEarnings' | 'otherDeductions' | 'absences' | 'dsrLostDays'>;
const noManual: ManualInputs = { overtime50Hours: 0, overtime100Hours: 0, commissions: 0, otherEarnings: 0, otherDeductions: 0, absences: 0, dsrLostDays: 0 };

/** Dias de contrato no mês (mês cheio = 30) e o intervalo de datas correspondente. */
function contractInMonth(e: Pick<ContractRow, 'admissionDate' | 'terminationDate'>, competence: string) {
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
export class HrService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
    private readonly team: TeamService,
    private readonly teamLinks: TeamLinksRegistry,
    private readonly employers: HrEmployersRegistry,
  ) {}

  // ---- Colaboradores --------------------------------------------------------------------------

  onModuleInit() {
    // No cadastro da pessoa (core): "Colaborador (RH)" ou, na consultoria, "Colaborador (RH) — Empresa".
    this.teamLinks.register({
      moduleKey: MODULE,
      find: async (tx, ids) =>
        (
          await tx
            .select({ id: hrEmployees.id, teamMemberId: hrEmployees.teamMemberId, status: hrEmployees.status, employer: customers.name })
            .from(hrEmployees)
            .leftJoin(customers, eq(customers.id, hrEmployees.employerCustomerId))
            .where(inArray(hrEmployees.teamMemberId, ids))
        ).map((e) => ({
          teamMemberId: e.teamMemberId,
          label: e.employer ? `Colaborador (RH) — ${e.employer}` : 'Colaborador (RH)',
          path: `/rh/colaboradores/${e.id}`,
          active: e.status !== 'terminated',
        })),
    });
  }

  /**
   * Empresas que podem empregar colaboradores (clientes do tipo empresa), com colaboradores ativos e
   * a última folha. Só quando um ramo ativo liga o recurso (ex.: Consultoria de RH).
   */
  listEmployers(): Promise<EmployersResponse> {
    if (!this.employers.enabled(requestContext.require().modules)) return Promise.resolve({ enabled: false, items: [] });
    return this.tdb.run(async (tx) => {
      const companies = await tx
        .select({ id: customers.id, name: customers.name, document: customers.document, email: customers.email, phone: customers.phone })
        .from(customers)
        .where(and(eq(customers.type, 'company'), isNull(customers.anonymizedAt)))
        .orderBy(asc(customers.name));
      const active = await tx
        .select({ employer: hrEmployees.employerCustomerId, n: count() })
        .from(hrEmployees)
        .where(and(isNotNull(hrEmployees.employerCustomerId), ne(hrEmployees.status, 'terminated')))
        .groupBy(hrEmployees.employerCustomerId);
      const last = await tx
        .selectDistinctOn([hrPayrolls.employerCustomerId], { employer: hrPayrolls.employerCustomerId, id: hrPayrolls.id, competence: hrPayrolls.competence, type: hrPayrolls.type, status: hrPayrolls.status })
        .from(hrPayrolls)
        .where(isNotNull(hrPayrolls.employerCustomerId))
        .orderBy(hrPayrolls.employerCustomerId, desc(hrPayrolls.competence), desc(hrPayrolls.createdAt));
      return {
        enabled: true,
        items: companies.map((c) => {
          const p = last.find((x) => x.employer === c.id);
          return {
            ...c,
            activeEmployees: active.find((a) => a.employer === c.id)?.n ?? 0,
            lastPayroll: p ? { id: p.id, competence: p.competence, type: p.type, status: p.status } : null,
          };
        }),
      };
    });
  }

  /** Confere se o tenant pode ter empregadores de fora e se o cliente pode ser um. */
  private async assertEmployer(tx: Tx, customerId: string) {
    if (!this.employers.enabled(requestContext.require().modules)) {
      throw badRequest('EMPLOYERS_DISABLED', 'Colaboradores de empresas-clientes só no ramo Consultoria de RH');
    }
    return employerOrFail(tx, customerId);
  }

  listEmployees(opts: { status?: string; employer?: EmployerFilter }): Promise<Employee[]> {
    return this.tdb.run(async (tx) => {
      const rows = await employeesQuery(tx)
        .where(and(opts.status ? eq(hrEmployees.status, opts.status as EmployeeRow['status']) : undefined, employerWhere(hrEmployees.employerCustomerId, opts.employer)))
        .orderBy(asc(teamMemberName));
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

  /**
   * Admissão e edição. Os dados pessoais (nome, CPF, nascimento, e-mail, telefone) vão para a pessoa
   * da equipe: a escolhida na ficha (teamMemberId), a já ligada ao colaborador ou, na admissão, quem
   * já tem este CPF na equipe (ex.: um profissional da agenda). A admissão preenche "início na
   * empresa" e o desligamento, "data de encerramento".
   *
   * Empregador (consultoria de RH): a mesma pessoa pode ter um contrato em cada empresa-cliente (e um
   * na própria consultoria). Os contratos de empresas-clientes não mexem no início/encerramento da
   * pessoa, que são da equipe da própria empresa (e o encerramento desativa o profissional da agenda).
   */
  saveEmployee(id: string | null, input: EmployeeInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      if (input.status === 'terminated' && !input.terminationDate) throw badRequest('TERMINATION_DATE', 'Informe a data do desligamento');
      if (input.experienceEnd && input.experienceEnd < input.admissionDate) throw badRequest('EXPERIENCE_END', 'O fim da experiência deve ser depois da admissão');
      const { name, cpf, birthDate, email, phone, teamMemberId, employerCustomerId, ...contract } = input;
      const current = id ? await employeeOrFail(tx, id) : null;

      // Ausente na edição: mantém o empregador. Trocar só antes da primeira folha (as folhas são por empregador).
      const employerId = employerCustomerId === undefined ? (current?.employerCustomerId ?? null) : employerCustomerId;
      if (employerId !== (current?.employerCustomerId ?? null)) {
        if (employerId) await this.assertEmployer(tx, employerId);
        if (current) {
          const [inPayroll] = await tx.select({ id: hrPayrollItems.id }).from(hrPayrollItems).where(eq(hrPayrollItems.employeeId, current.id)).limit(1);
          if (inPayroll) throw badRequest('EMPLOYER_LOCKED', 'O colaborador já está em folhas deste empregador. Para mudar de empresa, registre o desligamento e admita na outra.');
        }
      }

      const memberId = teamMemberId ?? current?.teamMemberId ?? (await this.team.findByCpfInTx(tx, cpf))?.id ?? null;
      const existing = memberId ? await this.team.findOrFailInTx(tx, memberId) : null;
      if (memberId) {
        const [other] = await tx
          .select({ id: hrEmployees.id })
          .from(hrEmployees)
          .where(and(eq(hrEmployees.teamMemberId, memberId), sameEmployer(hrEmployees.employerCustomerId, employerId), id ? ne(hrEmployees.id, id) : undefined));
        if (other) {
          const where = employerId ? ' nesta empresa' : '';
          throw new ConflictException(
            teamMemberId && teamMemberId !== current?.teamMemberId
              ? { code: 'TEAM_MEMBER_TAKEN', message: `Esta pessoa já é colaborador(a) cadastrado(a)${where}` }
              : { code: 'CPF_TAKEN', message: `Já existe um colaborador com este CPF${where}` },
          );
        }
      }

      const terminationDate = input.terminationDate ?? null;
      const ownContract = !employerId;
      const person: TeamMemberPatch = {
        ...splitName(name),
        cpf,
        ...(birthDate !== undefined ? { birthDate } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        // Início na empresa: a admissão, se a pessoa ainda não tinha (ou tinha uma data posterior).
        ...(ownContract && (!existing?.startedOn || existing.startedOn > input.admissionDate) ? { startedOn: input.admissionDate } : {}),
        // Encerramento: o desligamento; desfeito o desligamento, sai a data que veio dele.
        ...(!ownContract
          ? {}
          : terminationDate
            ? { endedOn: terminationDate }
            : current?.terminationDate && existing?.endedOn === current.terminationDate
              ? { endedOn: null }
              : {}),
      };
      const member = await this.team.saveInTx(tx, memberId, person);

      const values = {
        ...contract,
        teamMemberId: member.id,
        employerCustomerId: employerId,
        salary: centsToDecimal(toCents(input.salary)),
        experienceEnd: input.experienceEnd ?? null,
        terminationDate,
      };
      try {
        if (id) {
          await tx.update(hrEmployees).set(values).where(eq(hrEmployees.id, id));
          await this.audit.log(tx, { action: 'hr.employee.updated', entity: 'hr_employee', entityId: id, data: { fields: Object.keys(input) } });
          return { id, teamMemberId: member.id };
        }
        const [row] = await tx.insert(hrEmployees).values({ ...values, tenantId }).returning({ id: hrEmployees.id });
        await this.audit.log(tx, { action: 'hr.employee.created', entity: 'hr_employee', entityId: row!.id, data: { teamMemberId: member.id, employerCustomerId: employerId } });
        return { id: row!.id, teamMemberId: member.id };
      } catch (err) {
        if (pgCode(err) === '23505') throw new ConflictException({ code: 'TEAM_MEMBER_TAKEN', message: 'Esta pessoa já é colaborador(a) cadastrado(a)' });
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
      // Colaborador de empresa-cliente: quem paga é a empresa-cliente, nada vai para o financeiro.
      if (!emp.employerCustomerId) {
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
      }
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

  /** Lista de folhas com os totais (duas consultas, não uma por folha). */
  payrolls(opts: { employer?: EmployerFilter } = {}) {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ p: hrPayrolls, employerName: customers.name, employerDocument: customers.document })
        .from(hrPayrolls)
        .leftJoin(customers, eq(customers.id, hrPayrolls.employerCustomerId))
        .where(employerWhere(hrPayrolls.employerCustomerId, opts.employer))
        .orderBy(desc(hrPayrolls.competence), asc(hrPayrolls.type))
        .limit(opts.employer ? 60 : 120);
      const items = rows.length
        ? await tx
            .select({ payrollId: hrPayrollItems.payrollId, result: hrPayrollItems.result })
            .from(hrPayrollItems)
            .where(
              inArray(
                hrPayrollItems.payrollId,
                rows.map((r) => r.p.id),
              ),
            )
        : [];
      return rows.map(({ p, employerName, employerDocument }) => ({
        id: p.id,
        competence: p.competence,
        type: p.type,
        employer: p.employerCustomerId ? { id: p.employerCustomerId, name: employerName ?? '', document: employerDocument } : null,
        status: p.status,
        closedAt: p.closedAt?.toISOString() ?? null,
        totals: totalsOf(items.filter((i) => i.payrollId === p.id).map((i) => normalizePayslip(i.result))),
      }));
    });
  }

  getPayroll(id: string): Promise<Payroll> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  /**
   * Abre a folha mensal com todos que trabalharam no período (proporcional na admissão e no
   * desligamento). Quem tem rescisão no mês fica de fora: o saldo de salário vai no termo.
   * Uma folha por empregador: a da própria empresa ou a de uma empresa-cliente (consultoria de RH).
   */
  createPayroll(body: PayrollCreate): Promise<Payroll> {
    const { tenantId } = requestContext.require();
    const { competence, holidays } = body;
    const employerId = body.employerCustomerId ?? null;
    return this.tdb.run(async (tx) => {
      if (employerId) await this.assertEmployer(tx, employerId);
      const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      const start = `${competence}-01`;
      const end = lastDayOf(competence);
      const payroll = await this.insertPayroll(tx, { tenantId, competence, type: 'monthly', employerCustomerId: employerId, holidays, tables }, `A folha deste mês já existe${employerId ? ' para esta empresa' : ''}`);
      const terminated = new Set((await tx.select({ e: hrTerminations.employeeId }).from(hrTerminations).where(lte(hrTerminations.terminationDate, end))).map((r) => r.e));
      const employees = (await tx.select().from(hrEmployees).where(sameEmployer(hrEmployees.employerCustomerId, employerId))).filter(
        (e) => e.admissionDate <= end && (!e.terminationDate || e.terminationDate >= start) && !terminated.has(e.id),
      );
      if (!employees.length) throw badRequest('NO_EMPLOYEES', `Nenhum colaborador no mês${employerId ? ' nesta empresa' : ''}`);
      for (const e of employees) {
        const { daysWorked } = contractInMonth(e, competence);
        const result = await this.monthlyResult(tx, payroll, e, daysWorked, Number(e.salary), e.dependents, noManual);
        await tx.insert(hrPayrollItems).values({ tenantId, payrollId: payroll.id, employeeId: e.id, salary: e.salary, dependents: e.dependents, daysWorked, result });
      }
      await this.audit.log(tx, { action: 'hr.payroll.created', entity: 'hr_payroll', entityId: payroll.id, data: { competence, type: 'monthly', employerCustomerId: employerId } });
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
    const employerId = body.employerCustomerId ?? null;
    return this.tdb.run(async (tx) => {
      if (employerId) await this.assertEmployer(tx, employerId);
      const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);
      const competence = `${year}-${installment === 1 ? '11' : '12'}`;
      const type = installment === 1 ? 'thirteenth_1' : 'thirteenth_2';
      if (installment === 2) {
        const first = await findPayroll(tx, `${year}-11`, 'thirteenth_1', employerId);
        if (first?.status === 'draft') throw badRequest('FIRST_INSTALLMENT_OPEN', 'Feche a folha da 1ª parcela antes de calcular a 2ª');
      }
      const payroll = await this.insertPayroll(
        tx,
        { tenantId, competence, type, employerCustomerId: employerId, holidays: 0, tables },
        `A folha do 13º (${installment}ª parcela) de ${year} já existe${employerId ? ' para esta empresa' : ''}`,
      );
      const yearEnd = `${year}-12-31`;
      const admittedBy = installment === 1 ? `${year}-11-30` : yearEnd;
      const employees = (await tx.select().from(hrEmployees).where(sameEmployer(hrEmployees.employerCustomerId, employerId))).filter(
        (e) => e.admissionDate <= admittedBy && !(e.terminationDate && e.terminationDate <= yearEnd),
      );
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
      await this.audit.log(tx, { action: 'hr.payroll.created', entity: 'hr_payroll', entityId: payroll.id, data: { competence, type, employerCustomerId: employerId } });
      return this.detailInTx(tx, payroll.id);
    });
  }

  /** Refaz os cálculos da folha mensal aberta (afastamentos, férias e feriados novos), mantendo os lançamentos. */
  recalculate(id: string, body: { holidays?: number; useCurrentTables?: boolean }): Promise<Payroll> {
    return this.tdb.run(async (tx) => {
      let payroll = await payrollOrFail(tx, id);
      if (payroll.status === 'closed') throw badRequest('PAYROLL_CLOSED', 'Folha fechada não pode ser alterada');
      if (payroll.type !== 'monthly') throw badRequest('NOT_MONTHLY', 'Só a folha mensal é recalculada; no 13º, ajuste avos e médias por colaborador');
      if (body.holidays !== undefined && body.holidays !== payroll.holidays) {
        [payroll] = (await tx.update(hrPayrolls).set({ holidays: body.holidays }).where(eq(hrPayrolls.id, id)).returning()) as [PayrollRow];
      }
      if (body.useCurrentTables) {
        const { tables } = await this.settings.getInTx<HrSettings>(tx, MODULE);
        [payroll] = (await tx.update(hrPayrolls).set({ tables }).where(eq(hrPayrolls.id, id)).returning()) as [PayrollRow];
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
   *
   * Folha de empresa-cliente (consultoria de RH): quem paga salários e guias é a empresa-cliente, então
   * nada disso entra no financeiro da consultoria. Fechar trava a folha (holerites e o resumo para a
   * empresa) e avisa o ramo, que lança os honorários se houver.
   */
  closePayroll(id: string): Promise<Payroll> {
    const { userId, modules } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const payroll = await payrollOrFail(tx, id);
      if (payroll.status === 'closed') throw badRequest('PAYROLL_CLOSED', 'Folha já fechada');
      if (payroll.type === 'termination') throw badRequest('TERMINATION_PAYROLL', 'Rescisões são lançadas no financeiro ao confirmar cada uma');
      const detail = await this.detailInTx(tx, id);
      if (payroll.employerCustomerId) {
        await tx.update(hrPayrolls).set({ status: 'closed', closedAt: new Date(), closedById: userId ?? null }).where(eq(hrPayrolls.id, id));
        await this.audit.log(tx, { action: 'hr.payroll.closed', entity: 'hr_payroll', entityId: id, data: { type: payroll.type, employerCustomerId: payroll.employerCustomerId, ...detail.totals } });
        for (const ext of this.employers.active(modules)) {
          await ext.onPayrollClosed?.(tx, {
            payrollId: id,
            employerCustomerId: payroll.employerCustomerId,
            employerName: detail.employer?.name ?? '',
            competence: payroll.competence,
            type: payroll.type as 'monthly' | 'thirteenth_1' | 'thirteenth_2',
            totals: detail.totals,
          });
        }
        return this.detailInTx(tx, id);
      }
      const { payDay } = await this.settings.getInTx<HrSettings>(tx, MODULE);
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
  private async monthlyResult(tx: Tx, payroll: PayrollRow, e: ContractRow, daysWorked: number, salary: number, dependents: number, manual: ManualInputs): Promise<Payslip> {
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

  private async thirteenthResult(tx: Tx, installment: 1 | 2, year: number, e: ContractRow, salary: number, dependents: number, avos: number, average: number, tables: ReturnType<typeof tablesOf>): Promise<Payslip> {
    const advance = installment === 2 ? ((await closedItem(tx, e.id, `${year}-11`, 'thirteenth_1'))?.gross ?? 0) : 0;
    return computeThirteenth(installment, { salary, variableAverage: average, avos, dependents, advance, apprentice: e.category === 'apprentice' }, tables);
  }

  private async detailInTx(tx: Tx, id: string): Promise<Payroll> {
    const p = await payrollOrFail(tx, id);
    const items = await tx
      .select({ i: hrPayrollItems, e: hrEmployees, person: { name: teamMemberName, cpf: teamMembers.cpf } })
      .from(hrPayrollItems)
      .innerJoin(hrEmployees, eq(hrEmployees.id, hrPayrollItems.employeeId))
      .innerJoin(teamMembers, eq(teamMembers.id, hrEmployees.teamMemberId))
      .where(eq(hrPayrollItems.payrollId, id))
      .orderBy(asc(teamMemberName));
    const terminations =
      p.type === 'termination' && items.length
        ? await tx.select({ id: hrTerminations.id, employeeId: hrTerminations.employeeId }).from(hrTerminations).where(inArray(hrTerminations.employeeId, items.map(({ e }) => e.id)))
        : [];
    const list: PayrollItem[] = items.map(({ i, e, person }) => ({
      ...normalizePayslip(i.result),
      id: i.id,
      employee: { id: e.id, name: person.name, cpf: person.cpf ?? '', position: e.position, admissionDate: e.admissionDate, dependents: i.dependents, category: e.category },
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
    const cal = monthCalendar(p.competence, p.holidays);
    return {
      id: p.id,
      competence: p.competence,
      type: p.type,
      employer: await employerRef(tx, p.employerCustomerId),
      status: p.status,
      closedAt: p.closedAt?.toISOString() ?? null,
      tablesLabel: tablesOf(p.tables).label,
      holidays: p.holidays,
      calendar: { days: cal.days, sundays: cal.sundays, restDays: cal.restDays, workingDays: cal.workingDays },
      totals: totalsOf(list),
      items: list,
    };
  }
}

/** Totais da folha a partir dos holerites. */
function totalsOf(slips: Payslip[]): Payroll['totals'] {
  const sum = (k: 'gross' | 'inss' | 'irrf' | 'net' | 'fgts' | 'maternity') => round2(slips.reduce((s, x) => s + ((x[k] as number | undefined) ?? 0), 0));
  return { gross: sum('gross'), inss: sum('inss'), irrf: sum('irrf'), net: sum('net'), fgts: sum('fgts'), maternity: sum('maternity'), employees: slips.length };
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
    teamMemberId: r.teamMemberId,
    employerCustomerId: r.employerCustomerId,
    employer: r.employerCustomerId ? { id: r.employerCustomerId, name: r.employerName ?? '', document: r.employerDocument } : null,
    name: r.name,
    cpf: r.cpf ?? '',
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

  @Get('employers')
  @RequirePermission('hr.read')
  employers() {
    return this.hr.listEmployers();
  }

  @Get('employees')
  @RequirePermission('hr.read')
  employees(@Query(new ZodPipe(z.object({ status: z.string().max(20).optional(), employer: employerFilter }))) q: { status?: string; employer?: EmployerFilter }) {
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
  payrolls(@Query(new ZodPipe(z.object({ employer: employerFilter }))) q: { employer?: EmployerFilter }) {
    return this.hr.payrolls(q);
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

/** Exporta o registro de empregadores para os ramos que estendem o RH (ex.: Consultoria de RH). */
@Module({ controllers: [HrController], providers: [HrService, TerminationService, HrEmployersRegistry], exports: [HrEmployersRegistry] })
export class HrModule {}

