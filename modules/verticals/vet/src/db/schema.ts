import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { pets } from '@all/pets/schema';
import { date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Carteira de vacinação. Lançamento errado é anulado (com motivo), nunca apagado. */
export const vetVaccinations = pgTable(
  'vet_vaccinations',
  {
    id: id(),
    tenantId: tenantId(),
    petId: uuid('pet_id')
      .notNull()
      .references(() => pets.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    vaccine: text('vaccine').notNull(),
    dose: text('dose'),
    batch: text('batch'),
    manufacturer: text('manufacturer'),
    appliedOn: date('applied_on', { mode: 'string' }).notNull(),
    nextDueOn: date('next_due_on', { mode: 'string' }),
    appliedById: uuid('applied_by_id').references(() => users.id),
    appliedByName: text('applied_by_name').notNull(),
    notes: text('notes'),
    reminderSentAt: ts('reminder_sent_at'),
    voidedAt: ts('voided_at'),
    voidReason: text('void_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('vet_vaccinations_pet_idx').on(t.petId, t.appliedOn), index('vet_vaccinations_due_idx').on(t.tenantId, t.nextDueOn), tenantIsolation()],
);
