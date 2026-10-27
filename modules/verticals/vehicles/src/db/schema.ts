import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const vehVehicles = pgTable(
  'veh_vehicles',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: ['car', 'motorcycle', 'truck', 'utility'] }).notNull(),
    brand: text('brand').notNull(),
    model: text('model').notNull(),
    version: text('version'),
    yearManufacture: integer('year_manufacture').notNull(),
    yearModel: integer('year_model').notNull(),
    plate: text('plate'),
    color: text('color'),
    km: integer('km').notNull().default(0),
    fuel: text('fuel', { enum: ['flex', 'gasoline', 'ethanol', 'diesel', 'electric', 'hybrid'] }).notNull(),
    transmission: text('transmission', { enum: ['manual', 'automatic', 'cvt', 'automated'] }).notNull(),
    fipeCode: text('fipe_code'),
    fipePrice: money('fipe_price'),
    cost: money('cost'),
    price: money('price').notNull(),
    status: text('status', { enum: ['available', 'reserved', 'sold', 'inactive'] }).notNull().default('available'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('veh_vehicles_plate_key').on(t.tenantId, t.plate), index('veh_vehicles_status_idx').on(t.tenantId, t.status), tenantIsolation()],
);

export const vehDeals = pgTable(
  'veh_deals',
  {
    id: id(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehVehicles.id),
    price: money('price').notNull(),
    discount: money('discount').notNull().default('0'),
    paymentType: text('payment_type', { enum: ['cash', 'financing'] }).notNull(),
    downPayment: money('down_payment').notNull().default('0'),
    tradeIn: jsonb('trade_in'),
    status: text('status', { enum: ['negotiating', 'credit_analysis', 'credit_approved', 'credit_rejected', 'closed', 'lost'] }).notNull().default('negotiating'),
    lostReason: text('lost_reason'),
    sellerId: uuid('seller_id').references(() => users.id),
    notes: text('notes'),
    closedAt: ts('closed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('veh_deals_number_key').on(t.tenantId, t.number), index('veh_deals_vehicle_idx').on(t.vehicleId), index('veh_deals_customer_idx').on(t.customerId), tenantIsolation()],
);
