import { tenantId, tenantIsolation } from '@all/db';
import { soItems, soOrders } from '@all/service-orders/schema';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * O que é próprio da padaria em cada item da encomenda: a escrita do bolo e a baixa de estoque.
 * Nem todo item tem linha aqui: nasce com a escrita ou na retirada, quando baixa o estoque.
 */
export const bakeryItemDetails = pgTable(
  'bakery_item_details',
  {
    itemId: uuid('item_id')
      .primaryKey()
      .references(() => soItems.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => soOrders.id, { onDelete: 'cascade' }),
    /** Texto para escrever no bolo, exatamente como o cliente pediu. */
    inscription: text('inscription'),
    /** Quando o estoque foi baixado (na retirada): preenchido, nunca baixa de novo. */
    stockMovedAt: timestamp('stock_moved_at', { withTimezone: true }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('bakery_item_details_order_idx').on(t.orderId), tenantIsolation()],
);
