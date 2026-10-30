import { id, tenantId, tenantIsolation } from '@all/db';
import { schAppointments, schAppointmentServices, schResources, schServices } from '@all/scheduling/schema';
import { date, index, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Comissão do profissional: uma linha com `service_id` nulo é o percentual padrão dele;
 * as demais são exceções por serviço.
 */
export const beautyCommissionRules = pgTable(
  'beauty_commission_rules',
  {
    id: id(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schResources.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => schServices.id, { onDelete: 'cascade' }),
    /** Percentual (0–100). */
    rate: numeric('rate', { precision: 5, scale: 2 }).notNull(),
  },
  (t) => [unique('beauty_commission_rules_key').on(t.tenantId, t.resourceId, t.serviceId).nullsNotDistinct(), tenantIsolation()],
);

/**
 * Comissão lançada no financeiro: uma despesa a pagar por profissional e período. As linhas que
 * entraram apontam para cá, e por isso a mesma linha nunca é lançada duas vezes.
 */
export const beautyCommissionPayouts = pgTable(
  'beauty_commission_payouts',
  {
    id: id(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schResources.id),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    finEntryId: uuid('fin_entry_id'),
    status: text('status', { enum: ['open', 'cancelled'] }).notNull().default('open'),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('beauty_commission_payouts_period_idx').on(t.tenantId, t.periodFrom), tenantIsolation()],
);

/**
 * Comissão de cada serviço de um atendimento concluído: percentual e valor gravados na conclusão.
 * Mudar a regra depois não recalcula o passado.
 */
export const beautyCommissionLines = pgTable(
  'beauty_commission_lines',
  {
    id: id(),
    tenantId: tenantId(),
    appointmentServiceId: uuid('appointment_service_id')
      .notNull()
      .references(() => schAppointmentServices.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => schAppointments.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schResources.id),
    serviceId: uuid('service_id'),
    rate: numeric('rate', { precision: 5, scale: 2 }).notNull(),
    commission: numeric('commission', { precision: 14, scale: 2 }).notNull(),
    /** Lançamento no financeiro em que esta linha entrou; nulo = ainda a lançar. */
    payoutId: uuid('payout_id').references(() => beautyCommissionPayouts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('beauty_commission_lines_service_key').on(t.appointmentServiceId),
    index('beauty_commission_lines_appointment_idx').on(t.appointmentId),
    index('beauty_commission_lines_payout_idx').on(t.payoutId),
    tenantIsolation(),
  ],
);
