import { id, tenantId, tenantIsolation } from '@all/db';
import { schResources, schServices } from '@all/scheduling/schema';
import { numeric, pgTable, unique, uuid } from 'drizzle-orm/pg-core';

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
