import { customers, tenants, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { BureauSummary } from '../contracts';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Autorização do cliente para a consulta (LGPD): finalidade, quando e como foi dada, o texto
 * mostrado e quem registrou. Uma por consulta; fica como prova mesmo se o cadastro for anonimizado.
 */
export const cbConsents = pgTable(
  'cb_consents',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** CPF (dígitos) ou CNPJ (maiúsculas, sem pontuação). */
    document: text('document').notNull(),
    documentType: text('document_type', { enum: ['cpf', 'cnpj'] }).notNull(),
    subjectName: text('subject_name').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    purpose: text('purpose', { enum: ['consortium_sale', 'credit_analysis', 'other_credit'] }).notNull(),
    method: text('method', { enum: ['signed_term', 'digital_acceptance', 'recorded_call', 'written_message'] }).notNull(),
    givenAt: date('given_at', { mode: 'string' }).notNull(),
    evidence: text('evidence'),
    /** Texto exato mostrado ao cliente e a versão. */
    text: text('text').notNull(),
    version: text('version').notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('cb_consents_document_idx').on(t.tenantId, t.document), tenantIsolation()],
);

/** Consulta feita (ou tentada) num birô, com o resumo do resultado, o custo e a decisão da equipe. */
export const cbQueries = pgTable(
  'cb_queries',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    consentId: uuid('consent_id')
      .notNull()
      .references(() => cbConsents.id),
    document: text('document').notNull(),
    documentType: text('document_type', { enum: ['cpf', 'cnpj'] }).notNull(),
    subjectName: text('subject_name').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** Quem pediu (ex.: `consortium_lead`, `consortium_quota`). */
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    provider: text('provider', { enum: ['simulated', 'serasa_experian', 'boa_vista', 'quod'] }).notNull(),
    simulated: boolean('simulated').notNull(),
    status: text('status', { enum: ['done', 'error'] }).notNull(),
    error: text('error'),
    /** Protocolo da consulta no birô. */
    externalId: text('external_id'),
    score: integer('score'),
    riskBand: text('risk_band', { enum: ['low', 'medium', 'high', 'very_high'] }),
    /** Só o resumo (minimização): a resposta bruta do birô não é guardada. */
    summary: jsonb('summary').$type<BureauSummary>(),
    cost: numeric('cost', { precision: 10, scale: 2 }).notNull().default('0'),
    decision: text('decision', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
    decisionNote: text('decision_note'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts('decided_at'),
    queriedBy: uuid('queried_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('cb_queries_created_idx').on(t.tenantId, t.createdAt),
    index('cb_queries_document_idx').on(t.tenantId, t.document, t.createdAt),
    index('cb_queries_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
    tenantIsolation(),
  ],
);
