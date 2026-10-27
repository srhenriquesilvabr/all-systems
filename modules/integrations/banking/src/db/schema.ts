import { customers, tenants } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Instituição parceira (banco, financeira, administradora) configurada pela empresa. */
export const bankConnections = pgTable(
  'bank_connections',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    mode: text('mode', { enum: ['simulated', 'api'] }).notNull(),
    products: text('products').array().notNull(),
    baseUrl: text('base_url'),
    clientId: text('client_id'),
    /** Cifrados com a chave de configurações (SecretBox). */
    clientSecretEnc: text('client_secret_enc'),
    webhookSecretEnc: text('webhook_secret_enc'),
    vehicleMonthlyRate: numeric('vehicle_monthly_rate', { precision: 6, scale: 4 }).notNull().default('1.99'),
    realEstateYearlyRate: numeric('real_estate_yearly_rate', { precision: 6, scale: 4 }).notNull().default('11.5'),
    tacFee: numeric('tac_fee', { precision: 10, scale: 2 }).notNull().default('0'),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [tenantIsolation()],
);

/**
 * Sem RLS: o webhook da instituição chega sem tenant; é por aqui que se descobre a empresa
 * dona da conexão. Só este módulo lê e grava.
 */
export const bankWebhookRoutes = pgTable('bank_webhook_routes', {
  connectionId: uuid('connection_id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
});

export const bankProposals = pgTable(
  'bank_proposals',
  {
    id: id(),
    tenantId: tenantId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => bankConnections.id),
    product: text('product', { enum: ['vehicle_financing', 'real_estate_financing', 'consortium'] }).notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    termMonths: integer('term_months').notNull(),
    offer: jsonb('offer'),
    /** Dados pessoais enviados à instituição (LGPD: exportados e anonimizados com o cliente). */
    applicant: jsonb('applicant').notNull(),
    details: jsonb('details').notNull().default({}),
    status: text('status', { enum: ['submitted', 'under_review', 'approved', 'rejected', 'cancelled', 'contracted'] }).notNull(),
    statusMessage: text('status_message'),
    externalId: text('external_id'),
    result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
    lastCheckedAt: ts('last_checked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('bank_proposals_source_idx').on(t.tenantId, t.sourceType, t.sourceId), index('bank_proposals_status_idx').on(t.tenantId, t.status), tenantIsolation()],
);

export const bankProposalEvents = pgTable(
  'bank_proposal_events',
  {
    id: id(),
    tenantId: tenantId(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => bankProposals.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    message: text('message'),
    /** De onde veio: envio, consulta periódica, webhook ou ação da equipe. */
    source: text('source', { enum: ['submit', 'poll', 'webhook', 'manual'] }).notNull(),
    payload: jsonb('payload'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('bank_proposal_events_proposal_idx').on(t.proposalId, t.at), tenantIsolation()],
);
