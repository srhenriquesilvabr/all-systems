import { customers } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { date, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Tratamento ortodôntico: o contrato que gera as mensalidades no financeiro. */
export const orthoTreatments = pgTable(
  'ortho_treatments',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    appliance: text('appliance', { enum: ['fixed_metal', 'fixed_aesthetic', 'self_ligating', 'aligners', 'removable', 'other'] }).notNull(),
    startedOn: date('started_on', { mode: 'string' }).notNull(),
    expectedMonths: integer('expected_months').notNull(),
    entryFee: numeric('entry_fee', { precision: 12, scale: 2 }).notNull().default('0'),
    monthlyFee: numeric('monthly_fee', { precision: 12, scale: 2 }).notNull(),
    dueDay: integer('due_day').notNull(),
    status: text('status', { enum: ['active', 'finished', 'cancelled'] }).notNull().default('active'),
    finishedOn: date('finished_on', { mode: 'string' }),
    cancelReason: text('cancel_reason'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('ortho_treatments_customer_idx').on(t.customerId, t.status), tenantIsolation()],
);
