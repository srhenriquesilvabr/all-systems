import { customers, files, tenants, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { salesProducts, salesSales } from '@all/sales/schema';
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ConsentRecord, DeliveryAddress } from '../contracts';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

/**
 * Anúncio de um produto do PDV na lojinha: um por produto. Preço base, estoque e nome vêm do
 * cadastro de vendas (shared.sales); aqui ficam só o que a vitrine mostra a mais.
 */
export const storeListings = pgTable(
  'store_listings',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => salesProducts.id, { onDelete: 'cascade' }),
    visible: boolean('visible').notNull().default(false),
    /** Título na loja; nulo = nome do produto. */
    title: text('title'),
    description: text('description').notNull().default(''),
    /** Categoria da loja; nula = categoria do produto no PDV. */
    category: text('category'),
    featured: boolean('featured').notNull().default(false),
    promoPrice: money('promo_price'),
    /** Último dia do preço promocional (inclusive, fuso de SP). Nulo = sem prazo. */
    promoUntil: date('promo_until', { mode: 'string' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('store_listings_product_key').on(t.tenantId, t.productId),
    index('store_listings_visible_idx').on(t.tenantId, t.visible),
    check('store_listings_promo_chk', sql`promo_price is null or promo_price > 0`),
    tenantIsolation(),
  ],
);

/** Fotos do anúncio (arquivos no storage, dono `store_photo`), na ordem da galeria. */
export const storeListingPhotos = pgTable(
  'store_listing_photos',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => storeListings.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('store_listing_photos_file_key').on(t.fileId), index('store_listing_photos_listing_idx').on(t.listingId, t.position), tenantIsolation()],
);

/**
 * Pedido da loja. Número sequencial por empresa (`tenant_sequences`, chave `store_order`).
 * Confirmado e ainda em aberto, segura o estoque dos itens (a reserva é calculada a partir dos
 * pedidos nesses estados); concluído vira uma venda do PDV (`sale_id`).
 */
export const storeOrders = pgTable(
  'store_orders',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    status: text('status', { enum: ['new', 'confirmed', 'preparing', 'ready', 'dispatched', 'completed', 'cancelled'] })
      .notNull()
      .default('new'),
    /** public: vitrine; admin: lançado pela equipe. */
    source: text('source', { enum: ['public', 'admin'] }).notNull().default('public'),
    /** Dados informados no pedido (o cadastro do cliente é ligado na confirmação). Nulos depois da anonimização. */
    customerName: text('customer_name').notNull(),
    /** E.164. */
    customerPhone: text('customer_phone'),
    customerEmail: text('customer_email'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    fulfillment: text('fulfillment', { enum: ['pickup', 'delivery'] }).notNull(),
    address: jsonb('address').$type<DeliveryAddress>(),
    paymentMode: text('payment_mode', { enum: ['whatsapp', 'on_delivery', 'online'] }).notNull(),
    /** paid: pago online (provedor) ou na conclusão; on_account fica pending. */
    paymentStatus: text('payment_status', { enum: ['pending', 'paid'] }).notNull().default('pending'),
    /** Identificador da cobrança no provedor de pagamento online. */
    paymentReference: text('payment_reference'),
    /** Forma de pagamento registrada na venda, na conclusão. */
    paymentMethod: text('payment_method', { enum: ['cash', 'pix', 'debit_card', 'credit_card', 'on_account', 'other'] }),
    subtotal: money('subtotal').notNull(),
    deliveryFee: money('delivery_fee').notNull().default('0'),
    total: money('total').notNull(),
    notes: text('notes'),
    /** Consentimento LGPD aceito na vitrine (texto e versão). */
    consent: jsonb('consent').$type<ConsentRecord>(),
    /** Hash do IP (com o tenant) para o limite de pedidos; o IP não é guardado. */
    ipHash: text('ip_hash'),
    saleId: uuid('sale_id').references(() => salesSales.id),
    cancelReason: text('cancel_reason'),
    confirmedAt: ts('confirmed_at'),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('store_orders_number_key').on(t.tenantId, t.number),
    index('store_orders_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('store_orders_phone_idx').on(t.tenantId, t.customerPhone, t.createdAt),
    index('store_orders_ip_idx').on(t.tenantId, t.ipHash, t.createdAt),
    index('store_orders_customer_idx').on(t.customerId),
    check('store_orders_total_chk', sql`total = subtotal + delivery_fee and subtotal >= 0 and delivery_fee >= 0`),
    check('store_orders_completed_chk', sql`status <> 'completed' or sale_id is not null`),
    check('store_orders_cancelled_chk', sql`status <> 'cancelled' or cancel_reason is not null`),
    check('store_orders_address_chk', sql`fulfillment <> 'delivery' or address is not null or customer_phone is null`),
    tenantIsolation(),
  ],
);

export const storeOrderItems = pgTable(
  'store_order_items',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => storeOrders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => salesProducts.id),
    position: integer('position').notNull().default(0),
    /** Nome e preços na hora do pedido (o cadastro pode mudar depois). */
    name: text('name').notNull(),
    unit: text('unit', { enum: ['un', 'kg', 'g', 'l', 'ml', 'pct'] }).notNull(),
    quantity: quantity('quantity').notNull(),
    /** Preço cobrado (promocional, se havia). */
    unitPrice: money('unit_price').notNull(),
    /** Preço cheio do produto na hora. */
    regularPrice: money('regular_price').notNull(),
    total: money('total').notNull(),
  },
  (t) => [
    index('store_order_items_order_idx').on(t.orderId),
    index('store_order_items_product_idx').on(t.productId),
    check('store_order_items_quantity_chk', sql`quantity > 0`),
    tenantIsolation(),
  ],
);

/** Histórico do pedido (mudanças de estado e observações), mostrado na tela do pedido. */
export const storeOrderEvents = pgTable(
  'store_order_events',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => storeOrders.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['new', 'confirmed', 'preparing', 'ready', 'dispatched', 'completed', 'cancelled'] }),
    text: text('text').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('store_order_events_order_idx').on(t.orderId, t.createdAt), tenantIsolation()],
);
