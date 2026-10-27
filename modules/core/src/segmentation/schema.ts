import { tenantId, tenantIsolation } from '@all/db';
import { date, index, integer, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customers } from '../customers/schema';

/**
 * Indicadores RFM por cliente, recalculados por job (e sob demanda). Fonte: recebimentos do
 * financeiro com cliente, então vale para qualquer vertical que lança no financeiro.
 */
export const customerFeatures = pgTable(
  'customer_features',
  {
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    firstPurchaseOn: date('first_purchase_on', { mode: 'string' }).notNull(),
    lastPurchaseOn: date('last_purchase_on', { mode: 'string' }).notNull(),
    recencyDays: integer('recency_days').notNull(),
    /** Compras (origens distintas) nos últimos 12 meses. */
    frequency: integer('frequency').notNull(),
    /** Valor recebido nos últimos 12 meses. */
    monetary: numeric('monetary', { precision: 14, scale: 2 }).notNull(),
    r: integer('r').notNull(),
    f: integer('f').notNull(),
    m: integer('m').notNull(),
    segment: text('segment', { enum: ['champions', 'loyal', 'promising', 'new', 'at_risk', 'hibernating', 'lost'] }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.customerId] }), index('customer_features_segment_idx').on(t.tenantId, t.segment), tenantIsolation()],
);
