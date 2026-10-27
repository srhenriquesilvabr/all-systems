import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const reProperties = pgTable(
  're_properties',
  {
    id: id(),
    tenantId: tenantId(),
    /** Código curto do imóvel (anúncios, placa na frente). */
    code: integer('code').notNull(),
    purpose: text('purpose', { enum: ['sale', 'rent', 'both'] }).notNull(),
    type: text('type', { enum: ['apartment', 'house', 'condo_house', 'land', 'commercial', 'office', 'rural'] }).notNull(),
    title: text('title').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => customers.id),
    street: text('street').notNull(),
    number: text('number'),
    complement: text('complement'),
    district: text('district').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    zip: text('zip'),
    areaM2: numeric('area_m2', { precision: 12, scale: 2 }),
    landM2: numeric('land_m2', { precision: 14, scale: 2 }),
    bedrooms: integer('bedrooms').notNull().default(0),
    suites: integer('suites').notNull().default(0),
    bathrooms: integer('bathrooms').notNull().default(0),
    parking: integer('parking').notNull().default(0),
    salePrice: money('sale_price'),
    rentPrice: money('rent_price'),
    condoFee: money('condo_fee'),
    iptuYearly: money('iptu_yearly'),
    financeable: boolean('financeable').notNull().default(true),
    status: text('status', { enum: ['available', 'reserved', 'sold', 'rented', 'inactive'] }).notNull().default('available'),
    description: text('description'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('re_properties_code_key').on(t.tenantId, t.code), index('re_properties_city_idx').on(t.tenantId, t.city, t.district), tenantIsolation()],
);

export const reDeals = pgTable(
  're_deals',
  {
    id: id(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => reProperties.id),
    price: money('price').notNull(),
    paymentType: text('payment_type', { enum: ['cash', 'financing'] }).notNull(),
    downPayment: money('down_payment').notNull().default('0'),
    fgtsAmount: money('fgts_amount').notNull().default('0'),
    commissionPercent: numeric('commission_percent', { precision: 5, scale: 2 }).notNull(),
    status: text('status', { enum: ['negotiating', 'credit_analysis', 'credit_approved', 'credit_rejected', 'closed', 'lost'] }).notNull().default('negotiating'),
    lostReason: text('lost_reason'),
    brokerId: uuid('broker_id').references(() => users.id),
    notes: text('notes'),
    closedAt: ts('closed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('re_deals_number_key').on(t.tenantId, t.number), index('re_deals_property_idx').on(t.propertyId), index('re_deals_customer_idx').on(t.customerId), tenantIsolation()],
);
