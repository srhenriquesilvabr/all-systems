import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const pct = (name: string) => numeric(name, { precision: 6, scale: 3 });

/** Planos das administradoras, sincronizados pela integração bancária. */
export const consPlans = pgTable(
  'cons_plans',
  {
    id: id(),
    tenantId: tenantId(),
    connectionId: uuid('connection_id').notNull(),
    institution: text('institution').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    assetType: text('asset_type', { enum: ['vehicle', 'real_estate', 'heavy', 'services'] }).notNull(),
    creditValue: money('credit_value').notNull(),
    termMonths: integer('term_months').notNull(),
    adminFeePercent: pct('admin_fee_percent').notNull(),
    reserveFundPercent: pct('reserve_fund_percent').notNull(),
    insurancePercent: pct('insurance_percent').notNull().default('0'),
    active: boolean('active').notNull().default(true),
    syncedAt: ts('synced_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_plans_external_key').on(t.tenantId, t.connectionId, t.externalId), tenantIsolation()],
);

/** Cota vendida a um cliente. Grupo e número vêm da administradora quando a adesão é aceita. */
export const consQuotas = pgTable(
  'cons_quotas',
  {
    id: id(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => consPlans.id),
    proposalId: uuid('proposal_id'),
    status: text('status', { enum: ['proposal', 'active', 'contemplated', 'rejected', 'cancelled'] }).notNull().default('proposal'),
    statusMessage: text('status_message'),
    groupCode: text('group_code'),
    quotaNumber: text('quota_number'),
    dueDay: integer('due_day').notNull(),
    contemplatedOn: date('contemplated_on', { mode: 'string' }),
    contemplationType: text('contemplation_type', { enum: ['draw', 'bid'] }),
    bidPercent: numeric('bid_percent', { precision: 5, scale: 2 }),
    sellerId: uuid('seller_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_quotas_number_key').on(t.tenantId, t.number), index('cons_quotas_group_idx').on(t.tenantId, t.groupCode, t.quotaNumber), index('cons_quotas_customer_idx').on(t.customerId), tenantIsolation()],
);

export const consAssemblies = pgTable(
  'cons_assemblies',
  {
    id: id(),
    tenantId: tenantId(),
    groupCode: text('group_code').notNull(),
    heldOn: date('held_on', { mode: 'string' }).notNull(),
    drawn: text('drawn').array().notNull(),
    bids: jsonb('bids').$type<{ quotaNumber: string; percent: number }[]>().notNull(),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_assemblies_key').on(t.tenantId, t.groupCode, t.heldOn), tenantIsolation()],
);
