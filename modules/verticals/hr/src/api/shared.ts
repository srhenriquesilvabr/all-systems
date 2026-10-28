import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Tx } from '@all/db';
import { customers, teamMemberName, teamMembers } from '@all/core/schema';
import { and, between, eq, getTableColumns, isNull, type AnyColumn, type SQL } from 'drizzle-orm';
import { isoAddDays, isoMonthEnd, round2, taxTables, type EmployerFilter, type EmployerRef, type Payslip, type TaxTables } from '../contracts';
import { hrEmployees, hrPayrollItems, hrPayrolls } from '../db/schema';

export const MODULE = 'hr';
export const PAYROLL_SOURCE = 'hr_payroll';
export const TERMINATION_SOURCE = 'hr_termination';

export const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
export const addDays = isoAddDays;
export const lastDayOf = (ym: string) => isoMonthEnd(`${ym}-01`);
/** Dia `day` do mês seguinte à competência "AAAA-MM". */
export const nextMonth = (ym: string, day: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
};
export const pgCode = (err: unknown) => (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;

/** Tabelas guardadas numa folha antiga ganham os campos novos com o valor padrão. */
export const tablesOf = (stored: unknown): TaxTables => {
  const parsed = taxTables.safeParse(stored);
  return parsed.success ? parsed.data : (stored as TaxTables);
};

/** Holerites antigos não têm os campos novos: completa com zero. */
export const normalizePayslip = (r: unknown): Payslip => {
  const p = r as Payslip;
  return {
    ...p,
    commissions: p.commissions ?? 0,
    dsr: p.dsr ?? 0,
    maternity: p.maternity ?? 0,
    vacation: p.vacation ?? 0,
    absenceDeduction: p.absenceDeduction ?? 0,
    variablePay: p.variablePay ?? p.overtime ?? 0,
    earnings: p.earnings ?? p.gross,
  };
};

/** Linha de hr_employees (contrato), sem os dados pessoais. */
export type ContractRow = typeof hrEmployees.$inferSelect;
export type PayrollRow = typeof hrPayrolls.$inferSelect;

/** Dados pessoais do colaborador, que vivem na pessoa da equipe (core). */
export const personColumns = {
  name: teamMemberName,
  cpf: teamMembers.cpf,
  birthDate: teamMembers.birthDate,
  email: teamMembers.email,
  phone: teamMembers.phone,
};

/** Colaborador = contrato (hr_employees) + dados pessoais (team_members) + nome do empregador, se for empresa-cliente. */
export const employeesQuery = (tx: Tx) =>
  tx
    .select({ ...getTableColumns(hrEmployees), ...personColumns, employerName: customers.name, employerDocument: customers.document })
    .from(hrEmployees)
    .innerJoin(teamMembers, eq(teamMembers.id, hrEmployees.teamMemberId))
    .leftJoin(customers, eq(customers.id, hrEmployees.employerCustomerId));
export type EmployeeRow = Awaited<ReturnType<typeof employeesQuery>>[number];

export async function employeeOrFail(tx: Tx, id: string): Promise<EmployeeRow> {
  const [e] = await employeesQuery(tx).where(eq(hrEmployees.id, id));
  if (!e) throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: 'Colaborador não encontrado' });
  return e;
}

export async function payrollOrFail(tx: Tx, id: string) {
  const [p] = await tx.select().from(hrPayrolls).where(eq(hrPayrolls.id, id));
  if (!p) throw new NotFoundException({ code: 'PAYROLL_NOT_FOUND', message: 'Folha não encontrada' });
  return p;
}

/** Folha da competência e tipo do empregador (null = a própria empresa). */
export async function findPayroll(tx: Tx, competence: string, type: PayrollRow['type'], employerCustomerId: string | null) {
  const [p] = await tx
    .select()
    .from(hrPayrolls)
    .where(and(eq(hrPayrolls.competence, competence), eq(hrPayrolls.type, type), sameEmployer(hrPayrolls.employerCustomerId, employerCustomerId)));
  return p ?? null;
}

/** Mesmo empregador (null = a própria empresa, que no banco é a coluna vazia). */
export const sameEmployer = (column: AnyColumn, employerCustomerId: string | null): SQL => (employerCustomerId ? eq(column, employerCustomerId) : isNull(column));

/** Filtro das listas: sem filtro, todos; "own", a própria empresa; um id, a empresa-cliente. */
export const employerWhere = (column: AnyColumn, filter: EmployerFilter): SQL | undefined => (filter === undefined ? undefined : sameEmployer(column, filter === 'own' ? null : filter));

/**
 * Empresa-cliente que pode ser empregadora: cliente do tipo empresa, não anonimizado.
 * (A permissão para ter empregadores é conferida antes, pelo HrEmployersRegistry.)
 */
export async function employerOrFail(tx: Tx, customerId: string): Promise<EmployerRef> {
  const [c] = await tx.select({ id: customers.id, name: customers.name, document: customers.document, type: customers.type, anonymizedAt: customers.anonymizedAt }).from(customers).where(eq(customers.id, customerId));
  if (!c || c.anonymizedAt) throw badRequest('EMPLOYER_NOT_FOUND', 'Empresa empregadora não encontrada no cadastro de clientes');
  if (c.type !== 'company') throw badRequest('EMPLOYER_NOT_COMPANY', 'O empregador precisa ser um cliente do tipo empresa');
  return { id: c.id, name: c.name, document: c.document };
}

/** Nome e CNPJ do empregador (para as telas); null = a própria empresa. */
export async function employerRef(tx: Tx, customerId: string | null): Promise<EmployerRef | null> {
  if (!customerId) return null;
  const [c] = await tx.select({ id: customers.id, name: customers.name, document: customers.document }).from(customers).where(eq(customers.id, customerId));
  return c ?? { id: customerId, name: '', document: null };
}

/** Competência "AAAA-MM" somada de n meses. */
export const addCompetence = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/**
 * Média mensal das variáveis (horas extras + comissões + DSR) nas folhas mensais fechadas entre
 * duas competências. Divide pelos meses em que o colaborador esteve na folha.
 * Simplificação: média dos valores em reais registrados; a Súmula 347 TST manda calcular a média
 * de horas e valorizar pelo salário atual — iguais quando o salário não mudou no período.
 */
export async function variableAverage(tx: Tx, employeeId: string, from: string, to: string): Promise<number> {
  const rows = await tx
    .select({ result: hrPayrollItems.result })
    .from(hrPayrollItems)
    .innerJoin(hrPayrolls, eq(hrPayrolls.id, hrPayrollItems.payrollId))
    .where(and(eq(hrPayrollItems.employeeId, employeeId), eq(hrPayrolls.type, 'monthly'), eq(hrPayrolls.status, 'closed'), between(hrPayrolls.competence, from, to)));
  if (!rows.length) return 0;
  return round2(rows.reduce((s, r) => s + (normalizePayslip(r.result).variablePay ?? 0), 0) / rows.length);
}

/** Holerite de um colaborador numa folha fechada (ex.: 1ª parcela do 13º já paga). */
export async function closedItem(tx: Tx, employeeId: string, competence: string, type: PayrollRow['type']): Promise<Payslip | null> {
  const [row] = await tx
    .select({ result: hrPayrollItems.result })
    .from(hrPayrollItems)
    .innerJoin(hrPayrolls, eq(hrPayrolls.id, hrPayrollItems.payrollId))
    .where(and(eq(hrPayrollItems.employeeId, employeeId), eq(hrPayrolls.competence, competence), eq(hrPayrolls.type, type), eq(hrPayrolls.status, 'closed')));
  return row ? normalizePayslip(row.result) : null;
}

/** FGTS depositado estimado: soma do FGTS das folhas fechadas (sem JAM nem depósitos anteriores ao sistema). */
export async function fgtsEstimate(tx: Tx, employeeId: string): Promise<number> {
  const rows = await tx
    .select({ result: hrPayrollItems.result })
    .from(hrPayrollItems)
    .innerJoin(hrPayrolls, eq(hrPayrolls.id, hrPayrollItems.payrollId))
    .where(and(eq(hrPayrollItems.employeeId, employeeId), eq(hrPayrolls.status, 'closed')));
  return round2(rows.reduce((s, r) => s + ((r.result as Payslip).fgts ?? 0), 0));
}
