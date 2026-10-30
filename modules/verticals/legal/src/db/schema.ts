import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** Processo (ou caso consultivo, sem número). */
export const legalCases = pgTable(
  'legal_cases',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Número CNJ formatado; nulo em casos consultivos. */
    number: text('number'),
    title: text('title').notNull(),
    area: text('area', { enum: ['civil', 'labor', 'family', 'criminal', 'social_security', 'tax', 'consumer', 'business', 'other'] }).notNull(),
    role: text('role', { enum: ['plaintiff', 'defendant', 'third_party', 'advisory'] }).notNull(),
    court: text('court'),
    opposingParty: text('opposing_party'),
    claimValue: money('claim_value'),
    responsibleUserId: uuid('responsible_user_id').references(() => users.id),
    status: text('status', { enum: ['active', 'suspended', 'settled', 'won', 'lost', 'archived'] }).notNull().default('active'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('legal_cases_number_key').on(t.tenantId, t.number), index('legal_cases_customer_idx').on(t.customerId), tenantIsolation()],
);

/** Andamentos do processo (registro do que aconteceu). */
export const legalUpdates = pgTable(
  'legal_updates',
  {
    id: id(),
    tenantId: tenantId(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => legalCases.id),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    authorId: uuid('author_id').references(() => users.id),
    /** Gerado pelo sistema (prazo cumprido, situação, êxito): não se edita nem se exclui à mão. */
    auto: boolean('auto').notNull().default(false),
    /** Prazo do andamento automático "Prazo cumprido": reabrir o prazo retira este andamento. */
    deadlineId: uuid('deadline_id').references((): AnyPgColumn => legalDeadlines.id),
    editedAt: ts('edited_at'),
    editedBy: uuid('edited_by').references(() => users.id),
    /** Excluído: some das telas e o registro fica (o texto anterior e o motivo também vão para a auditoria). */
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('legal_updates_case_idx').on(t.caseId, t.occurredOn), tenantIsolation()],
);

/** Prazos: a equipe é avisada por e-mail `alert_days` antes do vencimento. */
export const legalDeadlines = pgTable(
  'legal_deadlines',
  {
    id: id(),
    tenantId: tenantId(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => legalCases.id),
    title: text('title').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    alertDays: integer('alert_days').notNull().default(3),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    status: text('status', { enum: ['open', 'done'] }).notNull().default('open'),
    doneAt: ts('done_at'),
    alertedAt: ts('alerted_at'),
    notes: text('notes'),
    /** Excluído: some das telas e dos avisos, e o registro fica. */
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('legal_deadlines_due_idx').on(t.tenantId, t.status, t.dueOn), index('legal_deadlines_case_idx').on(t.caseId), tenantIsolation()],
);

/** Contrato de honorários: gera as parcelas no financeiro (o êxito, quando houver resultado). */
export const legalFees = pgTable(
  'legal_fees',
  {
    id: id(),
    tenantId: tenantId(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => legalCases.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    kind: text('kind', { enum: ['fixed', 'monthly', 'success'] }).notNull(),
    description: text('description'),
    amount: money('amount'),
    installments: integer('installments').notNull().default(1),
    successPercent: numeric('success_percent', { precision: 5, scale: 2 }),
    status: text('status', { enum: ['active', 'settled', 'cancelled'] }).notNull().default('active'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('legal_fees_case_idx').on(t.caseId), tenantIsolation()],
);
