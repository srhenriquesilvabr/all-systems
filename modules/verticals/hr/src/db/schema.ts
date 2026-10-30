import { customers, teamMembers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * Colaborador: contrato de trabalho (cargo, salário…; acesso só com permissão de RH). Nome, CPF,
 * nascimento, e-mail e telefone ficam na pessoa da equipe (core), a mesma do profissional da agenda.
 * Empregador: a própria empresa (vazio) ou, na consultoria de RH, uma empresa-cliente (cliente do
 * tipo empresa). A mesma pessoa pode ter um contrato por empregador.
 */
export const hrEmployees = pgTable(
  'hr_employees',
  {
    id: id(),
    tenantId: tenantId(),
    teamMemberId: uuid('team_member_id')
      .notNull()
      .references(() => teamMembers.id),
    /** Empresa-cliente empregadora (consultoria de RH). Vazio = a própria empresa. */
    employerCustomerId: uuid('employer_customer_id').references(() => customers.id),
    position: text('position').notNull(),
    department: text('department'),
    admissionDate: date('admission_date', { mode: 'string' }).notNull(),
    salary: money('salary').notNull(),
    weeklyHours: integer('weekly_hours').notNull().default(44),
    dependents: integer('dependents').notNull().default(0),
    /** Aprendiz recolhe FGTS de 2%. */
    category: text('category', { enum: ['employee', 'apprentice'] }).notNull().default('employee'),
    /** Fim do contrato de experiência, se houver. */
    experienceEnd: date('experience_end', { mode: 'string' }),
    status: text('status', { enum: ['active', 'on_leave', 'terminated'] }).notNull().default('active'),
    terminationDate: date('termination_date', { mode: 'string' }),
    pixKey: text('pix_key'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Um contrato por pessoa e empregador (o vazio, a própria empresa, é tratado como um empregador).
    uniqueIndex('hr_employees_own_member_key').on(t.tenantId, t.teamMemberId).where(sql`employer_customer_id is null`),
    uniqueIndex('hr_employees_employer_member_key').on(t.tenantId, t.employerCustomerId, t.teamMemberId).where(sql`employer_customer_id is not null`),
    tenantIsolation(),
  ],
);

/**
 * Uma folha por competência, tipo e empregador: mensal, 13º (1ª e 2ª parcelas) e rescisões do mês.
 * Na consultoria de RH, cada empresa-cliente tem as suas; a da própria empresa tem o empregador vazio.
 */
export const hrPayrolls = pgTable(
  'hr_payrolls',
  {
    id: id(),
    tenantId: tenantId(),
    /** "2026-10" (13º: 1ª parcela em novembro, 2ª em dezembro). */
    competence: text('competence').notNull(),
    type: text('type', { enum: ['monthly', 'thirteenth_1', 'thirteenth_2', 'termination'] }).notNull().default('monthly'),
    /** Empresa-cliente da folha (consultoria de RH). Vazio = a própria empresa. */
    employerCustomerId: uuid('employer_customer_id').references(() => customers.id),
    status: text('status', { enum: ['draft', 'closed'] }).notNull().default('draft'),
    /** Feriados em dias úteis no mês (DSR). */
    holidays: integer('holidays').notNull().default(0),
    /** Tabelas usadas no cálculo (cópia: mudar a configuração depois não altera folha fechada). */
    tables: jsonb('tables').notNull(),
    closedAt: ts('closed_at'),
    closedById: uuid('closed_by_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hr_payrolls_own_competence_type_key').on(t.tenantId, t.competence, t.type).where(sql`employer_customer_id is null`),
    uniqueIndex('hr_payrolls_employer_competence_type_key').on(t.tenantId, t.employerCustomerId, t.competence, t.type).where(sql`employer_customer_id is not null`),
    tenantIsolation(),
  ],
);

export const hrPayrollItems = pgTable(
  'hr_payroll_items',
  {
    id: id(),
    tenantId: tenantId(),
    payrollId: uuid('payroll_id')
      .notNull()
      .references(() => hrPayrolls.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => hrEmployees.id),
    salary: money('salary').notNull(),
    dependents: integer('dependents').notNull(),
    daysWorked: integer('days_worked').notNull(),
    overtime50Hours: numeric('overtime50_hours', { precision: 6, scale: 2 }).notNull().default('0'),
    overtime100Hours: numeric('overtime100_hours', { precision: 6, scale: 2 }).notNull().default('0'),
    /** Comissões e variáveis (geram DSR). */
    commissions: money('commissions').notNull().default('0'),
    otherEarnings: money('other_earnings').notNull().default('0'),
    otherDeductions: money('other_deductions').notNull().default('0'),
    /** Faltas injustificadas e repousos perdidos. */
    absences: integer('absences').notNull().default(0),
    dsrLostDays: integer('dsr_lost_days').notNull().default(0),
    /** 13º: avos e média das variáveis (editáveis). */
    avos: integer('avos'),
    variableAverage: money('variable_average').notNull().default('0'),
    /** Resultado do cálculo (holerite). */
    result: jsonb('result').notNull(),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('hr_payroll_items_key').on(t.payrollId, t.employeeId), tenantIsolation()],
);

export const hrVacations = pgTable(
  'hr_vacations',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => hrEmployees.id),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    startOn: date('start_on', { mode: 'string' }).notNull(),
    days: integer('days').notNull(),
    soldDays: integer('sold_days').notNull().default(0),
    /** "Gozadas" não é gravado: é derivado (marcadas cujo fim já passou). */
    status: text('status', { enum: ['scheduled', 'cancelled'] }).notNull().default('scheduled'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('hr_vacations_employee_idx').on(t.employeeId, t.startOn), tenantIsolation()],
);

/** Afastamentos: doença (INSS a partir do 16º dia) e licença-maternidade. */
export const hrLeaves = pgTable(
  'hr_leaves',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => hrEmployees.id),
    type: text('type', { enum: ['sick', 'maternity'] }).notNull(),
    startOn: date('start_on', { mode: 'string' }).notNull(),
    endOn: date('end_on', { mode: 'string' }).notNull(),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('hr_leaves_employee_idx').on(t.employeeId, t.startOn), tenantIsolation()],
);

/** Rescisão confirmada: entradas e termo calculado (TRCT resumido). Uma por colaborador. */
export const hrTerminations = pgTable(
  'hr_terminations',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => hrEmployees.id),
    /** Folha de rescisões da competência da saída. */
    payrollId: uuid('payroll_id')
      .notNull()
      .references(() => hrPayrolls.id),
    type: text('type', { enum: ['without_cause', 'resignation', 'just_cause', 'experience_end', 'agreement'] }).notNull(),
    notice: text('notice', { enum: ['indemnified', 'worked', 'waived', 'deducted', 'none'] }).notNull(),
    terminationDate: date('termination_date', { mode: 'string' }).notNull(),
    projectedEnd: date('projected_end', { mode: 'string' }).notNull(),
    input: jsonb('input').notNull(),
    result: jsonb('result').notNull(),
    notes: text('notes'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** Rescisão desfeita: o termo fica guardado, com quem desfez e o motivo, e deixa de valer. */
    cancelledAt: ts('cancelled_at'),
    cancelledById: uuid('cancelled_by_id').references(() => users.id),
    cancelReason: text('cancel_reason'),
  },
  (t) => [uniqueIndex('hr_terminations_employee_key').on(t.tenantId, t.employeeId).where(sql`cancelled_at is null`), tenantIsolation()],
);
