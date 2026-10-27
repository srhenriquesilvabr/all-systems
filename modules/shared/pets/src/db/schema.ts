import { customers } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, date, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Pet, sempre ligado a um tutor (o cliente). */
export const pets = pgTable(
  'pets',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    name: text('name').notNull(),
    species: text('species', { enum: ['dog', 'cat', 'bird', 'rodent', 'reptile', 'other'] }).notNull(),
    breed: text('breed'),
    sex: text('sex', { enum: ['male', 'female', 'unknown'] }).notNull().default('unknown'),
    birthDate: date('birth_date', { mode: 'string' }),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
    coat: text('coat'),
    size: text('size', { enum: ['small', 'medium', 'large', 'giant'] }),
    neutered: boolean('neutered').notNull().default(false),
    microchip: text('microchip'),
    notes: text('notes'),
    deceasedAt: ts('deceased_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('pets_customer_idx').on(t.customerId), index('pets_tenant_name_idx').on(t.tenantId, t.name), tenantIsolation()],
);
