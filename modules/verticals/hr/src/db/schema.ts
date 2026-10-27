import { users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** Colaborador (dados pessoais e salário: acesso só com permissão de RH). */
export const hrEmployees = pgTable(
  'hr_employees',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    cpf: text('cpf').notNull(),
    birthDate: date('birth_date', { mode: 'string' }),
    email: text('email'),
    phone: text('phone'),
    position: text('position').notNull(),
    department: text('department'),
    admissionDate: date('admission_date', { mode: 'string' }).notNull(),
    salary: money('salary').notNull(),
    weeklyHours: integer('weekly_hours').notNull().default(44),
    dependents: integer('dependents').notNull().default(0),
    status: text('status', { enum: ['active', 'on_leave', 'terminated'] }).notNull().default('active'),
    terminationDate: date('termination_date', { mode: 'string' }),
    pixKey: text('pix_key'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('hr_employees_cpf_key').on(t.tenantId, t.cpf), tenantIsolation()],
);

export const hrPayrolls = pgTable(
  'hr_payrolls',
  {
    id: id(),
    tenantId: tenantId(),
    /** "2026-10" */
    competence: text('competence').notNull(),
    status: text('status', { enum: ['draft', 'closed'] }).notNull().default('draft'),
    /** Tabelas usadas no cálculo (cópia: mudar a configuração depois não altera folha fechada). */
    tables: jsonb('tables').notNull(),
    closedAt: ts('closed_at'),
    closedById: uuid('closed_by_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('hr_payrolls_competence_key').on(t.tenantId, t.competence), tenantIsolation()],
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
    otherEarnings: money('other_earnings').notNull().default('0'),
    otherDeductions: money('other_deductions').notNull().default('0'),
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
    status: text('status', { enum: ['scheduled', 'cancelled'] }).notNull().default('scheduled'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('hr_vacations_employee_idx').on(t.employeeId, t.startOn), tenantIsolation()],
);
