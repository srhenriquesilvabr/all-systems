import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, index, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const laundryServices = pgTable(
  'laundry_services',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    pricingUnit: text('pricing_unit', { enum: ['piece', 'kg', 'sqm'] }).notNull(),
    /** Preço padrão por unidade de cobrança. A tabela por tipo de peça vem na Fase 3. */
    basePrice: numeric('base_price', { precision: 14, scale: 2 }).notNull(),
    turnaroundHours: integer('turnaround_hours').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('laundry_services_tenant_idx').on(t.tenantId), tenantIsolation()],
);
