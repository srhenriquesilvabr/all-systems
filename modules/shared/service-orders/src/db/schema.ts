import { customers } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid, date } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const soOrders = pgTable(
  'so_orders',
  {
    id: id(),
    tenantId: tenantId(),
    /** Número legível, sequencial por tenant. */
    number: integer('number').notNull(),
    /** Fluxo de status (registrado pela vertical). */
    workflow: text('workflow').notNull(),
    status: text('status').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    channel: text('channel').notNull().default('counter'),
    subtotal: money('subtotal').notNull(),
    discount: money('discount').notNull().default('0'),
    total: money('total').notNull(),
    paidAmount: money('paid_amount').notNull().default('0'),
    paymentStatus: text('payment_status', { enum: ['pending', 'partial', 'paid'] }).notNull().default('pending'),
    dueAt: ts('due_at'),
    closedAt: ts('closed_at'),
    cancelReason: text('cancel_reason'),
    notesCustomer: text('notes_customer'),
    notesInternal: text('notes_internal'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('so_orders_tenant_number').on(t.tenantId, t.number),
    index('so_orders_tenant_status_idx').on(t.tenantId, t.status),
    index('so_orders_customer_idx').on(t.customerId),
    tenantIsolation(),
  ],
);

export const soItems = pgTable(
  'so_items',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => soOrders.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    unitPrice: money('unit_price').notNull(),
    total: money('total').notNull(),
    /** Referência opcional da vertical (ex.: serviço de lavanderia). */
    refType: text('ref_type'),
    refId: text('ref_id'),
  },
  (t) => [index('so_items_order_idx').on(t.orderId), tenantIsolation()],
);

export const soStatusHistory = pgTable(
  'so_status_history',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => soOrders.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    userId: uuid('user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('so_status_history_order_idx').on(t.orderId), tenantIsolation()],
);

export const soPayments = pgTable(
  'so_payments',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => soOrders.id, { onDelete: 'cascade' }),
    amount: money('amount').notNull(),
    method: text('method').notNull(),
    paidAt: date('paid_at', { mode: 'string' }).notNull(),
    /** Lançamento correspondente no financeiro. */
    finEntryId: uuid('fin_entry_id'),
    userId: uuid('user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('so_payments_order_idx').on(t.orderId), tenantIsolation()],
);
