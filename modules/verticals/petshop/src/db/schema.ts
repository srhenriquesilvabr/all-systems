import { users } from '@all/core/schema';
import { tenantId, tenantIsolation } from '@all/db';
import { schAppointments } from '@all/scheduling/schema';
import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * O tutor buscou o pet: fica à parte porque "Concluído" da agenda só diz que o serviço terminou.
 * Uma linha por horário; desfazer apaga a linha e deixa o registro na auditoria.
 */
export const petshopPickups = pgTable(
  'petshop_pickups',
  {
    appointmentId: uuid('appointment_id')
      .primaryKey()
      .references(() => schAppointments.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }).notNull().defaultNow(),
    pickedUpBy: uuid('picked_up_by').references(() => users.id, { onDelete: 'set null' }),
  },
  () => [tenantIsolation()],
);
