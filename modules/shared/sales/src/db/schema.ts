import { customers, finAccounts, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

/** Caixa físico / terminal do PDV ("Caixa 1", "Balcão"). */
export const salesRegisters = pgTable(
  'sales_registers',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sales_registers_name_key').on(t.tenantId, t.name), tenantIsolation()],
);

/** Retrato do fechamento (cópia imutável, valores em reais): o relatório reimpresso sai igual. */
export interface RegisterClosingJson {
  totals: { method: 'cash' | 'pix' | 'debit_card' | 'credit_card' | 'on_account' | 'other'; expected: number; counted: number | null; difference: number | null }[];
  salesCount: number;
  salesTotal: number;
  withdrawals: number;
  deposits: number;
}

/**
 * Sessão de caixa: abertura (troco inicial) → vendas, sangrias e suprimentos → fechamento
 * conferido. Fechada, não muda mais (o serviço recusa; ver também o gatilho em docs).
 *
 * Abertura e fechamento podem ser de um horário passado (caixa registrado depois), mas as sessões
 * de um mesmo caixa nunca se cruzam no tempo: a sessão em vigor num momento é a última aberta até
 * ele, e vale até fechar ou até a abertura da seguinte. Por isso o mesmo caixa pode ter mais de uma
 * sessão aberta (a de um dia que já passou, sendo lançada, e a de agora).
 */
export const salesRegisterSessions = pgTable(
  'sales_register_sessions',
  {
    id: id(),
    tenantId: tenantId(),
    registerId: uuid('register_id')
      .notNull()
      .references(() => salesRegisters.id),
    number: integer('number').notNull(),
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
    openingFloat: money('opening_float').notNull(),
    openedBy: uuid('opened_by').references(() => users.id),
    openedAt: ts('opened_at').notNull().defaultNow(),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: ts('closed_at'),
    /** Preenchidos no fechamento. Diferença = contado − esperado (negativa = quebra). */
    expectedCash: money('expected_cash'),
    countedCash: money('counted_cash'),
    cashDifference: money('cash_difference'),
    closing: jsonb('closing').$type<RegisterClosingJson>(),
    notes: text('notes'),
    /** Registro no sistema (auditoria); opened_at é quando o caixa abriu de fato. */
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sales_register_sessions_number_key').on(t.tenantId, t.number),
    index('sales_register_sessions_opened_idx').on(t.tenantId, t.openedAt),
    // Sessão do caixa em vigor num momento (a última aberta até ele). A não sobreposição das
    // sessões fechadas é uma restrição de exclusão (btree_gist) no SQL manual da migração.
    index('sales_register_sessions_register_idx').on(t.registerId, t.openedAt),
    check('sales_register_sessions_closed_chk', sql`status = 'open' or (closed_at is not null and counted_cash is not null and closing is not null)`),
    check('sales_register_sessions_period_chk', sql`closed_at is null or closed_at >= opened_at`),
    tenantIsolation(),
  ],
);

/** Sangria (retirada) e suprimento (reforço) de dinheiro na gaveta durante a sessão. */
export const salesRegisterMoves = pgTable(
  'sales_register_moves',
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => salesRegisterSessions.id),
    kind: text('kind', { enum: ['withdrawal', 'deposit'] }).notNull(),
    amount: money('amount').notNull(),
    reason: text('reason').notNull(),
    /** Conta do outro lado (banco, cofre); sem conta, saiu/entrou como despesa/receita. */
    accountId: uuid('account_id').references(() => finAccounts.id),
    userId: uuid('user_id').references(() => users.id),
    /** Quando o dinheiro saiu/entrou (dentro do horário da sessão); created_at é o registro. */
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sales_register_moves_session_idx').on(t.sessionId), check('sales_register_moves_amount_chk', sql`amount > 0`), tenantIsolation()],
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
    /** Sessão de caixa da venda; os pagamentos dela entram no fechamento dessa sessão. */
    registerSessionId: uuid('register_session_id').references(() => salesRegisterSessions.id),
    /** Quando a venda aconteceu; relatórios usam esta data. created_at é o registro (auditoria). */
    soldAt: ts('sold_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sales_sales_number_key').on(t.tenantId, t.number),
    index('sales_sales_register_session_idx').on(t.registerSessionId),
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
    /** `consumption`: insumo usado num atendimento (ex.: frasco de toxina numa aplicação da estética). */
    kind: text('kind', { enum: ['purchase', 'production', 'loss', 'count', 'sale', 'return', 'consumption'] }).notNull(),
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
