import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const regimes = ['mei', 'simples', 'presumido', 'real'] as const;

/** Empresa atendida pelo escritório (o cadastro em si é o cliente do core). */
export const accClients = pgTable(
  'acc_clients',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    taxRegime: text('tax_regime', { enum: regimes }).notNull(),
    cnae: text('cnae'),
    hasEmployees: boolean('has_employees').notNull().default(false),
    monthlyFee: numeric('monthly_fee', { precision: 12, scale: 2 }).notNull().default('0'),
    feeDueDay: integer('fee_due_day').notNull().default(10),
    responsibleUserId: uuid('responsible_user_id').references(() => users.id),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('acc_clients_customer_key').on(t.tenantId, t.customerId), tenantIsolation()],
);

/** Catálogo de obrigações do escritório (vem com o padrão e é editável). */
export const accObligationTypes = pgTable(
  'acc_obligation_types',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    regimes: text('regimes').array().notNull(),
    requiresEmployees: boolean('requires_employees').notNull().default(false),
    frequency: text('frequency', { enum: ['monthly', 'quarterly', 'annual'] }).notNull(),
    dueDay: integer('due_day').notNull(),
    dueMonth: integer('due_month'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('acc_obligation_types_code_key').on(t.tenantId, t.code), tenantIsolation()],
);

export const accObligations = pgTable(
  'acc_obligations',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => accClients.id),
    typeId: uuid('type_id')
      .notNull()
      .references(() => accObligationTypes.id),
    competence: text('competence').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['pending', 'done', 'waived'] }).notNull().default('pending'),
    doneAt: ts('done_at'),
    doneById: uuid('done_by_id').references(() => users.id),
    alertedAt: ts('alerted_at'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('acc_obligations_key').on(t.clientId, t.typeId, t.competence), index('acc_obligations_due_idx').on(t.tenantId, t.status, t.dueOn), tenantIsolation()],
);

/** Honorário já lançado no financeiro por competência (evita lançar duas vezes). */
export const accFeeInvoices = pgTable(
  'acc_fee_invoices',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => accClients.id),
    competence: text('competence').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('acc_fee_invoices_key').on(t.clientId, t.competence), tenantIsolation()],
);
