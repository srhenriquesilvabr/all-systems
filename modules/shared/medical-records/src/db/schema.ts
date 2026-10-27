import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { index, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Registros de prontuário. Só inclusão: o app_user não tem UPDATE nem DELETE nesta tabela
 * (migration 0007). Corrigir é incluir uma retificação apontando para o original.
 */
export const mrEntries = pgTable(
  'mr_entries',
  {
    id: id(),
    tenantId: tenantId(),
    /** Cliente responsável (o paciente, ou o tutor do pet): para a ficha e para LGPD. */
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    formKey: text('form_key').notNull(),
    title: text('title').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    notes: text('notes'),
    appointmentId: uuid('appointment_id'),
    amendsId: uuid('amends_id').references((): AnyPgColumn => mrEntries.id),
    amendReason: text('amend_reason'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    /** Nome do autor no momento do registro (o cadastro do usuário pode mudar). */
    authorName: text('author_name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('mr_entries_subject_idx').on(t.tenantId, t.subjectType, t.subjectId, t.createdAt),
    index('mr_entries_customer_idx').on(t.customerId),
    index('mr_entries_amends_idx').on(t.amendsId),
    tenantIsolation(),
  ],
);

/** Quem viu, incluiu ou baixou o quê (dado de saúde é sensível na LGPD). Também só inclusão. */
export const mrAccessLog = pgTable(
  'mr_access_log',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    action: text('action', { enum: ['view', 'create', 'amend', 'attach', 'download'] }).notNull(),
    entryId: uuid('entry_id'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('mr_access_log_subject_idx').on(t.tenantId, t.subjectType, t.subjectId, t.at), tenantIsolation()],
);
