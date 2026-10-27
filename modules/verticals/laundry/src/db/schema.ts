import { id, tenantId, tenantIsolation } from '@all/db';
import { soItems, soOrders } from '@all/service-orders/schema';
import { boolean, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const laundryServices = pgTable(
  'laundry_services',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    pricingUnit: text('pricing_unit', { enum: ['piece', 'kg', 'sqm'] }).notNull(),
    /** Preço padrão por unidade de cobrança. Por tipo de peça: laundry_service_prices. */
    basePrice: numeric('base_price', { precision: 14, scale: 2 }).notNull(),
    turnaroundHours: integer('turnaround_hours').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('laundry_services_tenant_idx').on(t.tenantId), tenantIsolation()],
);

export const laundryGarmentTypes = pgTable(
  'laundry_garment_types',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('laundry_garment_types_name').on(t.tenantId, t.name), tenantIsolation()],
);

/** Preço do serviço para um tipo de peça (ex.: "Lavar e passar" de um terno custa mais que de uma camisa). */
export const laundryServicePrices = pgTable(
  'laundry_service_prices',
  {
    tenantId: tenantId(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => laundryServices.id, { onDelete: 'cascade' }),
    garmentTypeId: uuid('garment_type_id')
      .notNull()
      .references(() => laundryGarmentTypes.id, { onDelete: 'cascade' }),
    price: numeric('price', { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.garmentTypeId] }), tenantIsolation()],
);

/**
 * Extensão 1:1 do item da ordem de serviço com o que é próprio da lavanderia:
 * etiqueta, peça, avarias e a etapa de produção.
 */
export const laundryItemDetails = pgTable(
  'laundry_item_details',
  {
    itemId: uuid('item_id')
      .primaryKey()
      .references(() => soItems.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => soOrders.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => laundryServices.id),
    garmentTypeId: uuid('garment_type_id').references(() => laundryGarmentTypes.id),
    /** Etiqueta impressa e presa à peça: "<nº da ordem>-<sequência>". */
    tagCode: text('tag_code').notNull(),
    color: text('color'),
    brand: text('brand'),
    intakeNotes: text('intake_notes'),
    incidentNotes: text('incident_notes'),
    incidentAt: ts('incident_at'),
    weightKg: numeric('weight_kg', { precision: 8, scale: 3 }),
    piecesCount: integer('pieces_count').notNull().default(1),
    status: text('status', { enum: ['received', 'washing', 'drying', 'ironing', 'ready'] }).notNull().default('received'),
    reworkCount: integer('rework_count').notNull().default(0),
    statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('laundry_item_details_tag').on(t.tenantId, t.tagCode),
    index('laundry_item_details_order_idx').on(t.orderId),
    index('laundry_item_details_status_idx').on(t.tenantId, t.status),
    tenantIsolation(),
  ],
);

/** Cada movimento de peça: base dos relatórios de produtividade, retrabalho e ocorrências. */
export const laundryPieceEvents = pgTable(
  'laundry_piece_events',
  {
    id: id(),
    tenantId: tenantId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => soItems.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['status', 'rework', 'incident'] }).notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    notes: text('notes'),
    userId: uuid('user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('laundry_piece_events_created_idx').on(t.tenantId, t.createdAt), index('laundry_piece_events_item_idx').on(t.itemId), tenantIsolation()],
);
