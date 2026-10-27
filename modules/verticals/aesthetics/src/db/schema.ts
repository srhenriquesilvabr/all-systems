import { customers } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { schAppointments, schServices } from '@all/scheduling/schema';
import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Pacote de sessões de um procedimento vendido a um cliente. */
export const aesPackages = pgTable(
  'aes_packages',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => schServices.id),
    totalSessions: integer('total_sessions').notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    expiresOn: date('expires_on', { mode: 'string' }),
    status: text('status', { enum: ['active', 'finished', 'cancelled'] }).notNull().default('active'),
    notes: text('notes'),
    cancelReason: text('cancel_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('aes_packages_customer_idx').on(t.customerId, t.status), tenantIsolation()],
);

/**
 * Uso do pacote por atendimento: reservada ao marcar, usada ao concluir, liberada se o horário
 * for cancelado (ou se o cliente faltar, conforme a configuração).
 */
export const aesPackageSessions = pgTable(
  'aes_package_sessions',
  {
    id: id(),
    tenantId: tenantId(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => aesPackages.id),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => schAppointments.id),
    status: text('status', { enum: ['reserved', 'used', 'released'] }).notNull().default('reserved'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('aes_package_sessions_key').on(t.packageId, t.appointmentId), index('aes_package_sessions_appointment_idx').on(t.appointmentId), tenantIsolation()],
);
