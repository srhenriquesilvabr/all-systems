import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { pets } from '@all/pets/schema';
import { sql } from 'drizzle-orm';
import { boolean, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Catálogo de vacinas da clínica. É por ele que "V10" e "V10 polivalente" contam como a mesma vacina;
 * o texto digitado continua na aplicação. Nome e apelidos são comparados por `vaccineKey` (contratos).
 */
export const vetVaccines = pgTable(
  'vet_vaccines',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** `vaccineKey(name)`: não deixa duas vacinas com o mesmo nome comparável. */
    nameKey: text('name_key').notNull(),
    aliases: text('aliases').array().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vet_vaccines_name_key').on(t.tenantId, t.nameKey), tenantIsolation()],
);

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
    /** Como foi digitada ou veio da planilha. */
    vaccine: text('vaccine').notNull(),
    /** Vacina do catálogo. Vazia só até a reconciliação do módulo ligar os registros antigos. */
    vaccineId: uuid('vaccine_id').references(() => vetVaccines.id),
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
  (t) => [
    index('vet_vaccinations_pet_idx').on(t.petId, t.appliedOn),
    index('vet_vaccinations_due_idx').on(t.tenantId, t.nextDueOn),
    // A mesma vacina no mesmo dia, uma vez: é o que impede duplicar ao importar a planilha de novo.
    uniqueIndex('vet_vaccinations_once').on(t.petId, t.vaccineId, t.appliedOn).where(sql`voided_at is null`),
    tenantIsolation(),
  ],
);
