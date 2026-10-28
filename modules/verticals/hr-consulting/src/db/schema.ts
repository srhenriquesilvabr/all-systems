import { customers } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * Honorários da consultoria por empresa atendida (o cadastro da empresa é o cliente do core, tipo
 * empresa; colaboradores e folhas dela ficam no RH, com o empregador). Sem linha = sem honorário.
 */
export const hrcClients = pgTable(
  'hrc_clients',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** none = não lança; per_employee = valor × colaboradores na folha; fixed = valor por folha. */
    feeMode: text('fee_mode', { enum: ['none', 'per_employee', 'fixed'] }).notNull().default('none'),
    feeAmount: money('fee_amount').notNull().default('0'),
    /** Dia do vencimento do honorário, no mês seguinte à competência. */
    feeDueDay: integer('fee_due_day').notNull().default(10),
    /** Cobra o honorário também no fechamento da 2ª parcela do 13º (a "13ª mensalidade"). */
    thirteenthFee: boolean('thirteenth_fee').notNull().default(false),
    /** Valor por rescisão confirmada (0 = não cobra). */
    terminationFee: money('termination_fee').notNull().default('0'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('hrc_clients_customer_key').on(t.tenantId, t.customerId), tenantIsolation()],
);
