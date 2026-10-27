import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const salesProducts = pgTable(
  'sales_products',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    sku: text('sku'),
    barcode: text('barcode'),
    category: text('category'),
    unit: text('unit', { enum: ['un', 'kg', 'g', 'l', 'ml', 'pct'] }).notNull().default('un'),
    price: money('price').notNull(),
    cost: money('cost'),
    trackStock: boolean('track_stock').notNull().default(true),
    /** Saldo atual. Cada mudança tem uma linha em sales_stock_moves. */
    stock: quantity('stock').notNull().default('0'),
    minStock: quantity('min_stock'),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('sales_products_barcode_key').on(t.tenantId, t.barcode), index('sales_products_name_idx').on(t.tenantId, t.name), tenantIsolation()],
);

export const salesSales = pgTable(
  'sales_sales',
  {
    id: id(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    status: text('status', { enum: ['completed', 'cancelled'] }).notNull().default('completed'),
    customerId: uuid('customer_id').references(() => customers.id),
    subtotal: money('subtotal').notNull(),
    discount: money('discount').notNull().default('0'),
    total: money('total').notNull(),
    change: money('change').notNull().default('0'),
    notes: text('notes'),
    sellerId: uuid('seller_id').references(() => users.id),
    cancelReason: text('cancel_reason'),
    cancelledAt: ts('cancelled_at'),
    /** Quando a venda aconteceu; relatórios usam esta data. created_at é o registro (auditoria). */
    soldAt: ts('sold_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sales_sales_number_key').on(t.tenantId, t.number),
    index('sales_sales_created_idx').on(t.tenantId, t.createdAt),
    index('sales_sales_sold_idx').on(t.tenantId, t.soldAt),
    tenantIsolation(),
  ],
);

export const salesItems = pgTable(
  'sales_items',
  {
    id: id(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => salesSales.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => salesProducts.id),
    /** Ordem em que o produto entrou no carrinho (o cupom sai nessa ordem). */
    position: integer('position').notNull().default(0),
    /** Nome e preço na hora da venda (o cadastro pode mudar depois). */
    name: text('name').notNull(),
    unit: text('unit', { enum: ['un', 'kg', 'g', 'l', 'ml', 'pct'] }).notNull(),
    quantity: quantity('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
    total: money('total').notNull(),
  },
  (t) => [index('sales_items_sale_idx').on(t.saleId), index('sales_items_product_idx').on(t.productId), tenantIsolation()],
);

export const salesPayments = pgTable(
  'sales_payments',
  {
    id: id(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => salesSales.id, { onDelete: 'cascade' }),
    method: text('method', { enum: ['cash', 'pix', 'debit_card', 'credit_card', 'on_account', 'other'] }).notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [index('sales_payments_sale_idx').on(t.saleId), tenantIsolation()],
);

export const salesStockMoves = pgTable(
  'sales_stock_moves',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => salesProducts.id),
    kind: text('kind', { enum: ['purchase', 'production', 'loss', 'count', 'sale', 'return'] }).notNull(),
    /** Variação do saldo (negativa nas saídas). */
    quantity: quantity('quantity').notNull(),
    /** Saldo depois do movimento. */
    balance: quantity('balance').notNull(),
    unitCost: money('unit_cost'),
    reason: text('reason'),
    saleId: uuid('sale_id').references(() => salesSales.id),
    userId: uuid('user_id').references(() => users.id),
    /** Quando o movimento aconteceu (compra lançada depois, venda anterior…). */
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sales_stock_moves_product_idx').on(t.productId, t.occurredAt), tenantIsolation()],
);
