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
    /** Comissão da corretora neste plano; vazio = a da administradora ou a padrão do módulo. A sincronização não mexe. */
    commissionPercent: pct('commission_percent'),
    active:boolean('active').notNull().default(true),
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
    sellerId: uuid('seller_id').references(() => users.id, { onDelete: 'set null' }),
    /** Quando a administradora aceitou a adesão (base do prazo de estorno da comissão). */
    activatedAt: ts('activated_at'),
    cancelledAt: ts('cancelled_at'),
    /** Comissão gravada na ativação (percentual vigente naquele momento). */
    commissionPercent: pct('commission_percent'),
    commissionAmount: money('commission_amount'),
    commissionReversedAt: ts('commission_reversed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cons_quotas_number_key').on(t.tenantId, t.number),
    index('cons_quotas_group_idx').on(t.tenantId, t.groupCode, t.quotaNumber),
    index('cons_quotas_customer_idx').on(t.customerId),
    index('cons_quotas_seller_idx').on(t.tenantId, t.sellerId),
    tenantIsolation(),
  ],
);

/**
 * Assembleia de um grupo. Pode ser agendada antes (status `scheduled`, sem resultado) para receber
 * lances; o resultado preenche a mesma linha (status `held`). Grupo + data continua único.
 */
export const consAssemblies = pgTable(
  'cons_assemblies',
  {
    id: id(),
    tenantId: tenantId(),
    groupCode: text('group_code').notNull(),
    heldOn: date('held_on', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['scheduled', 'held'] }).notNull().default('held'),
    drawn: text('drawn').array().notNull(),
    bids: jsonb('bids').$type<{ quotaNumber: string; percent: number }[]>().notNull(),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_assemblies_key').on(t.tenantId, t.groupCode, t.heldOn), index('cons_assemblies_date_idx').on(t.tenantId, t.heldOn), tenantIsolation()],
);

/** Administradora (conexão da integração bancária) com a comissão combinada com a corretora. */
export const consAdministrators = pgTable(
  'cons_administrators',
  {
    id: id(),
    tenantId: tenantId(),
    connectionId: uuid('connection_id').notNull(),
    institution: text('institution').notNull(),
    /** Vazio = a comissão padrão do módulo. */
    commissionPercent: pct('commission_percent'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_administrators_key').on(t.tenantId, t.connectionId), tenantIsolation()],
);

/** Grupo de consórcio de uma administradora (e plano). Lance médio e assembleias vêm dos resultados lançados. */
export const consGroups = pgTable(
  'cons_groups',
  {
    id: id(),
    tenantId: tenantId(),
    connectionId: uuid('connection_id').notNull(),
    planId: uuid('plan_id').references(() => consPlans.id, { onDelete: 'set null' }),
    groupCode: text('group_code').notNull(),
    members: integer('members'),
    /** Meses que faltavam para o encerramento na data `months_remaining_on` (a tela desconta o tempo passado). */
    monthsRemaining: integer('months_remaining'),
    monthsRemainingOn: date('months_remaining_on', { mode: 'string' }),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_groups_key').on(t.tenantId, t.connectionId, t.groupCode), index('cons_groups_code_idx').on(t.tenantId, t.groupCode), tenantIsolation()],
);

/**
 * Parcelas da cota, só para acompanhamento: quem cobra é a administradora. O pagamento é informado
 * pelo cliente ou pela administradora e NÃO gera lançamento no financeiro da corretora.
 */
export const consInstallments = pgTable(
  'cons_installments',
  {
    id: id(),
    tenantId: tenantId(),
    quotaId: uuid('quota_id')
      .notNull()
      .references(() => consQuotas.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
    paidOn: date('paid_on', { mode: 'string' }),
    paidAmount: money('paid_amount'),
    notes: text('notes'),
    paidBy: uuid('paid_by').references(() => users.id, { onDelete: 'set null' }),
    /** Aviso de atraso já enviado ao cliente (uma vez por parcela). */
    lateNoticeSentAt: ts('late_notice_sent_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_installments_seq_key').on(t.quotaId, t.seq), index('cons_installments_due_idx').on(t.tenantId, t.dueOn), tenantIsolation()],
);

/** Lance da cota para uma assembleia agendada. O resultado da assembleia marca vencedor ou perdedor. */
export const consBids = pgTable(
  'cons_bids',
  {
    id: id(),
    tenantId: tenantId(),
    quotaId: uuid('quota_id')
      .notNull()
      .references(() => consQuotas.id, { onDelete: 'cascade' }),
    assemblyId: uuid('assembly_id')
      .notNull()
      .references(() => consAssemblies.id),
    type: text('type', { enum: ['free', 'embedded', 'fixed'] }).notNull(),
    percent: numeric('percent', { precision: 5, scale: 2 }).notNull(),
    amount: money('amount').notNull(),
    status: text('status', { enum: ['registered', 'sent', 'won', 'lost', 'void'] }).notNull().default('registered'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_bids_key').on(t.quotaId, t.assemblyId), index('cons_bids_assembly_idx').on(t.assemblyId), tenantIsolation()],
);

/** Uso do crédito depois da contemplação (uma linha por cota). */
export const consCredits = pgTable(
  'cons_credits',
  {
    id: id(),
    tenantId: tenantId(),
    quotaId: uuid('quota_id')
      .notNull()
      .references(() => consQuotas.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['awaiting_docs', 'released', 'acquired'] }).notNull().default('awaiting_docs'),
    /** Crédito a liberar: o da carta menos o lance embutido, se houver. */
    amount: money('amount').notNull(),
    releasedOn: date('released_on', { mode: 'string' }),
    assetDescription: text('asset_description'),
    acquiredOn: date('acquired_on', { mode: 'string' }),
    notes: text('notes'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cons_credits_quota_key').on(t.quotaId), tenantIsolation()],
);
