import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '../db/schema';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Transactional outbox: o evento é gravado na mesma transação da mudança e entregue
 * depois pelo worker. Sem RLS de propósito: o relay lê eventos de todos os tenants;
 * a gravação passa só pelo OutboxService, que usa o tenant do contexto.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
    /** Desistiu após o máximo de tentativas: precisa de intervenção. */
    failedAt: ts('failed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('outbox_events_pending_idx').on(t.nextAttemptAt).where(sql`processed_at is null and failed_at is null`)],
);

/** Quais handlers já processaram cada evento: numa nova tentativa, só os que falharam rodam de novo. */
export const outboxDeliveries = pgTable(
  'outbox_deliveries',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => outboxEvents.id, { onDelete: 'cascade' }),
    handler: text('handler').notNull(),
    deliveredAt: ts('delivered_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.handler] })],
);

/** Numeração legível por tenant (nº da OS, nº do pedido…). */
export const tenantSequences = pgTable(
  'tenant_sequences',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: bigint('value', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] }), tenantIsolation()],
);
