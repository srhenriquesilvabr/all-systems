import { customers, tenants, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { AssemblyResultSnapshot, CorrectionEffects } from '../contracts';

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
    /** Assembleia que contemplou a cota: é por ela que o resultado é corrigido. */
    contemplatedAssemblyId: uuid('contemplated_assembly_id').references(() => consAssemblies.id, { onDelete: 'set null' }),
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
    /** Administradora do grupo. Vazio = ainda não se sabe (código sem cota nem grupo cadastrado). */
    connectionId: uuid('connection_id'),
    /** Como foi digitado; a comparação é por normalizeCode (contratos). */
    groupCode: text('group_code').notNull(),
    heldOn: date('held_on', { mode: 'string' }).notNull(),
    status: text('status', { enum: ['scheduled', 'held'] }).notNull().default('held'),
    drawn: text('drawn').array().notNull(),
    bids: jsonb('bids').$type<{ quotaNumber: string; percent: number }[]>().notNull(),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cons_assemblies_key').on(t.tenantId, t.connectionId, t.groupCode, t.heldOn).where(sql`connection_id is not null`),
    uniqueIndex('cons_assemblies_no_admin_key').on(t.tenantId, t.groupCode, t.heldOn).where(sql`connection_id is null`),
    index('cons_assemblies_date_idx').on(t.tenantId, t.heldOn),
    tenantIsolation(),
  ],
);

/**
 * Correção de um resultado já lançado: o que estava, o que ficou e o que aconteceu com cada cota.
 * Só de inclusão (sem UPDATE/DELETE para a aplicação), como o histórico que é.
 */
export const consAssemblyCorrections = pgTable(
  'cons_assembly_corrections',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    assemblyId: uuid('assembly_id')
      .notNull()
      .references(() => consAssemblies.id),
    /** `correction`: lista corrigida. `contemplation_reverted`: uma cota tirada do resultado. */
    kind: text('kind', { enum: ['correction', 'contemplation_reverted'] }).notNull(),
    reason: text('reason').notNull(),
    before: jsonb('before').$type<AssemblyResultSnapshot>().notNull(),
    after: jsonb('after').$type<AssemblyResultSnapshot>().notNull(),
    effects: jsonb('effects').$type<CorrectionEffects>().notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('cons_assembly_corrections_assembly_idx').on(t.assemblyId, t.createdAt), tenantIsolation()],
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

// ---- Captação de clientes (leads) -----------------------------------------------------------

/**
 * Quem indica (cliente da carteira ou vendedor) e o código do link de indicação
 * (/consorcio/<empresa>?ind=<código>). O lead que chega pelo link guarda quem indicou.
 */
export const consReferrers = pgTable(
  'cons_referrers',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    kind: text('kind', { enum: ['customer', 'seller'] }).notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Nome no momento do cadastro (o link continua valendo se o cadastro mudar). */
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cons_referrers_code_key').on(t.tenantId, t.code),
    uniqueIndex('cons_referrers_customer_key').on(t.tenantId, t.customerId).where(sql`customer_id is not null`),
    uniqueIndex('cons_referrers_user_key').on(t.tenantId, t.userId).where(sql`user_id is not null`),
    tenantIsolation(),
  ],
);

/**
 * Lead de consórcio: simulador público, anúncios (Meta Lead Ads, Google Ads), planilha, cadastro
 * manual ou indicação. Funil: novo → em contato → simulação enviada → proposta → venda / perdido.
 */
export const consLeads = pgTable(
  'cons_leads',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    /** E.164 (+5511999998888). */
    phone: text('phone'),
    /** Minúsculas. */
    email: text('email'),
    city: text('city'),
    state: text('state'),
    /** O que a pessoa simulou (ou pediu no anúncio). */
    assetType: text('asset_type', { enum: ['vehicle', 'real_estate', 'heavy', 'services'] }),
    creditValue: money('credit_value'),
    termMonths: integer('term_months'),
    estimatedInstallment: money('estimated_installment'),
    source: text('source', { enum: ['simulator', 'meta', 'google', 'import', 'manual', 'referral'] }).notNull(),
    /** Atribuição: utm_source/medium/campaign/term/content, gclid, fbclid. */
    utm: jsonb('utm').$type<Record<string, string>>().notNull().default({}),
    /** Campanha (utm_campaign, ou a campanha/formulário do anúncio), para o relatório por origem. */
    campaign: text('campaign'),
    formId: text('form_id'),
    adId: text('ad_id'),
    /** Id do lead na plataforma (Meta leadgen_id, Google lead_id): evita duplicar no reenvio. */
    externalId: text('external_id'),
    channelId: uuid('channel_id'),
    referrerId: uuid('referrer_id').references(() => consReferrers.id, { onDelete: 'set null' }),
    /**
     * Recompensa da indicação: aguardando a venda → a pagar → paga (ou cancelada). Estornada = já
     * tinha sido paga e a cota caiu dentro do prazo de estorno. No financeiro: despesa com origem
     * 'consortium_lead' (source_id = id do lead).
     */
    rewardStatus: text('reward_status', { enum: ['none', 'waiting', 'due', 'paid', 'cancelled', 'reversed'] }).notNull().default('none'),
    rewardAmount: money('reward_amount'),
    rewardPaidAt: ts('reward_paid_at'),
    status: text('status', { enum: ['new', 'contacting', 'simulation_sent', 'proposal', 'won', 'lost'] }).notNull().default('new'),
    lostReason: text('lost_reason'),
    statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
    sellerId: uuid('seller_id').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: ts('assigned_at'),
    customerId: uuid('customer_id').references(() => customers.id),
    quotaId: uuid('quota_id').references(() => consQuotas.id, { onDelete: 'set null' }),
    /**
     * Base para o contato (LGPD): aceite no formulário (site/anúncio), pedido de contato fora do
     * sistema (balcão, telefone, evento) ou cliente da carteira.
     */
    contactBasis: text('contact_basis', { enum: ['form_consent', 'requested_contact', 'existing_customer'] }).notNull(),
    /** Prova do aceite no simulador público: texto exato, versão e quando. */
    consent: jsonb('consent').$type<{ version: string; text: string; acceptedAt: string }>(),
    ipHash: text('ip_hash'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    anonymizedAt: ts('anonymized_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('cons_leads_number_key').on(t.tenantId, t.number),
    uniqueIndex('cons_leads_external_key').on(t.tenantId, t.source, t.externalId).where(sql`external_id is not null`),
    index('cons_leads_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('cons_leads_seller_idx').on(t.tenantId, t.sellerId, t.status),
    index('cons_leads_phone_idx').on(t.tenantId, t.phone),
    index('cons_leads_source_idx').on(t.tenantId, t.source, t.createdAt),
    index('cons_leads_quota_idx').on(t.quotaId),
    tenantIsolation(),
  ],
);

/** Histórico do lead: criação, mudanças no funil, atribuição, anotações, WhatsApp, venda. */
export const consLeadEvents = pgTable(
  'cons_lead_events',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => consLeads.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    text: text('text'),
    data: jsonb('data'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('cons_lead_events_lead_idx').on(t.leadId, t.createdAt), tenantIsolation()],
);

/** Tarefa de retorno (ligar de novo, mandar a simulação…) com data e responsável. */
export const consLeadTasks = pgTable(
  'cons_lead_tasks',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => consLeads.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueAt: ts('due_at').notNull(),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    doneAt: ts('done_at'),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('cons_lead_tasks_open_idx').on(t.tenantId, t.assignedTo, t.dueAt).where(sql`done_at is null`), index('cons_lead_tasks_lead_idx').on(t.leadId), tenantIsolation()],
);

/**
 * Entrada de leads de anúncio: Meta Lead Ads (página + formulários + token da página, cifrado) ou
 * formulário de lead do Google Ads (webhook com chave, cifrada). `simulated` gera leads de teste.
 */
export const consLeadChannels = pgTable(
  'cons_lead_channels',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['meta', 'google'] }).notNull(),
    name: text('name').notNull(),
    mode: text('mode', { enum: ['simulated', 'api'] }).notNull().default('simulated'),
    /** Meta: id da página do Facebook. */
    pageId: text('page_id'),
    /** Meta: formulários aceitos (vazio = todos os da página). */
    formIds: text('form_ids').array().notNull().default(sql`'{}'::text[]`),
    /** Meta: token de acesso da página (leitura dos leads pela Graph API). Cifrado. */
    accessTokenEnc: text('access_token_enc'),
    /** Google: chave (google_key) configurada no formulário do anúncio. Cifrada. */
    webhookKeyEnc: text('webhook_key_enc'),
    /** Tipo de bem padrão dos leads deste canal (o formulário do anúncio costuma ser de um produto só). */
    assetType: text('asset_type', { enum: ['vehicle', 'real_estate', 'heavy', 'services'] }),
    active: boolean('active').notNull().default(true),
    lastLeadAt: ts('last_lead_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [tenantIsolation()],
);

/**
 * Sem RLS: os webhooks do Meta e do Google chegam sem tenant; é por aqui que se descobre a empresa
 * (pelo canal ou pela página do Facebook). Só este módulo lê e grava.
 */
export const consLeadRoutes = pgTable(
  'cons_lead_routes',
  {
    channelId: uuid('channel_id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Meta: a mesma página só pode estar ligada a uma empresa. */
    pageId: text('page_id'),
  },
  (t) => [uniqueIndex('cons_lead_routes_page_key').on(t.pageId).where(sql`page_id is not null`)],
);
