import { customers, files, teamMembers, tenants, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ApplicationAnswer, ConsentRecord, JobQuestion, JobStage } from '../contracts';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** Vaga: da própria empresa ou de uma empresa-cliente (consultoria de RH). */
export const recJobs = pgTable(
  'rec_jobs',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** Empresa contratante (cliente do tipo empresa). Nulo = a própria empresa. */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'no action' }),
    /** Esconde o nome da contratante na página pública e nos anúncios. */
    confidential: boolean('confidential').notNull().default(false),
    title: text('title').notNull(),
    area: text('area'),
    description: text('description').notNull().default(''),
    /** Requisitos obrigatórios e desejáveis, um por item. */
    requirements: jsonb('requirements').$type<string[]>().notNull().default([]),
    niceToHave: jsonb('nice_to_have').$type<string[]>().notNull().default([]),
    salaryMin: money('salary_min'),
    salaryMax: money('salary_max'),
    showSalary: boolean('show_salary').notNull().default(false),
    benefits: jsonb('benefits').$type<string[]>().notNull().default([]),
    workModel: text('work_model', { enum: ['onsite', 'hybrid', 'remote'] }).notNull().default('onsite'),
    city: text('city'),
    state: text('state'),
    contractType: text('contract_type', { enum: ['clt', 'pj', 'internship', 'temporary'] }).notNull().default('clt'),
    positions: integer('positions').notNull().default(1),
    status: text('status', { enum: ['draft', 'open', 'paused', 'closed'] }).notNull().default('draft'),
    /** Etapas do processo, em ordem; a última é a de contratação. */
    stages: jsonb('stages').$type<JobStage[]>().notNull(),
    /** Perguntas feitas na candidatura. */
    questions: jsonb('questions').$type<JobQuestion[]>().notNull().default([]),
    /** Publicar também na Gupy (integração nas configurações do módulo). */
    publishGupy: boolean('publish_gupy').notNull().default(false),
    gupyJobId: text('gupy_job_id'),
    gupySyncStatus: text('gupy_sync_status', { enum: ['none', 'pending', 'synced', 'error'] }).notNull().default('none'),
    /** Último erro da sincronização, mostrado na vaga. */
    gupyError: text('gupy_error'),
    gupySyncedAt: ts('gupy_synced_at'),
    openedAt: ts('opened_at'),
    closedAt: ts('closed_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('rec_jobs_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('rec_jobs_tenant_customer_idx').on(t.tenantId, t.customerId),
    check('rec_jobs_positions_chk', sql`positions > 0`),
    check('rec_jobs_salary_chk', sql`salary_min is null or salary_max is null or salary_max >= salary_min`),
    tenantIsolation(),
  ],
);

/** Candidato do banco de talentos: um por e-mail na empresa (dado pessoal). */
export const recCandidates = pgTable(
  'rec_candidates',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Minúsculas. Nulo depois da anonimização. */
    email: text('email'),
    /** E.164 (+5511999998888) quando reconhecido; senão, como digitado. */
    phone: text('phone'),
    linkedinUrl: text('linkedin_url'),
    city: text('city'),
    state: text('state'),
    notes: text('notes'),
    /** Currículo mais recente (o de cada candidatura fica nela). */
    resumeFileId: uuid('resume_file_id').references(() => files.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['public', 'manual'] }).notNull().default('manual'),
    /** Até quando os dados podem ficar (prazo do consentimento); depois o job anonimiza. */
    retainUntil: date('retain_until', { mode: 'string' }),
    /** Preenchido quando os dados pessoais foram apagados (pedido do titular ou fim do prazo). */
    anonymizedAt: ts('anonymized_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('rec_candidates_tenant_email_key').on(t.tenantId, t.email).where(sql`email is not null`),
    index('rec_candidates_tenant_name_idx').on(t.tenantId, t.name),
    index('rec_candidates_tenant_retain_idx').on(t.tenantId, t.retainUntil),
    tenantIsolation(),
  ],
);

/** Candidatura: um candidato numa vaga, com a etapa atual, respostas, consentimento e nota. */
export const recApplications = pgTable(
  'rec_applications',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => recJobs.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => recCandidates.id, { onDelete: 'cascade' }),
    /** Id da etapa (rec_jobs.stages). Na reprovação, fica a etapa em que estava. */
    stageId: text('stage_id').notNull(),
    status: text('status', { enum: ['active', 'rejected', 'hired', 'withdrawn'] }).notNull().default('active'),
    rejectionReason: text('rejection_reason'),
    rejectedAt: ts('rejected_at'),
    hiredAt: ts('hired_at'),
    /** Pessoa da equipe criada na contratação. */
    teamMemberId: uuid('team_member_id').references(() => teamMembers.id, { onDelete: 'set null' }),
    salaryExpectation: money('salary_expectation'),
    answers: jsonb('answers').$type<ApplicationAnswer[]>().notNull().default([]),
    resumeFileId: uuid('resume_file_id').references(() => files.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['public', 'manual'] }).notNull().default('manual'),
    consent: jsonb('consent').$type<ConsentRecord>(),
    /** Hash do IP de origem (limite de candidaturas por IP), nunca o IP em claro. */
    ipHash: text('ip_hash'),
    /** Nota de aderência atual (0–100) e como foi calculada; copiadas da última análise. */
    score: smallint('score'),
    scoreMethod: text('score_method', { enum: ['ai', 'heuristic'] }),
    analysisStatus: text('analysis_status', { enum: ['pending', 'running', 'done', 'failed'] }).notNull().default('pending'),
    stageChangedAt: ts('stage_changed_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('rec_applications_job_candidate_key').on(t.tenantId, t.jobId, t.candidateId),
    index('rec_applications_job_idx').on(t.tenantId, t.jobId, t.status, t.score),
    index('rec_applications_candidate_idx').on(t.tenantId, t.candidateId),
    index('rec_applications_ip_idx').on(t.tenantId, t.ipHash, t.createdAt),
    check('rec_applications_score_chk', sql`score is null or score between 0 and 100`),
    tenantIsolation(),
  ],
);

/**
 * Análises de aderência (histórico: uma linha por pedido). A pendente é processada pelo job
 * `recruiting.analyses` (IA) ou pelo handler do outbox (estimativa sem IA).
 */
export const recAnalyses = pgTable(
  'rec_analyses',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => recApplications.id, { onDelete: 'cascade' }),
    /** O que foi pedido: auto (IA se houver chave) ou só a estimativa. */
    requested: text('requested', { enum: ['auto', 'heuristic'] }).notNull().default('auto'),
    /** Como foi feita (preenchido ao concluir). */
    method: text('method', { enum: ['ai', 'heuristic'] }),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] }).notNull().default('pending'),
    score: smallint('score'),
    strengths: jsonb('strengths').$type<string[]>().notNull().default([]),
    gaps: jsonb('gaps').$type<string[]>().notNull().default([]),
    summary: text('summary'),
    /** Modelo que respondeu (pode ser o de reserva, se o principal recusou). */
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** Custo aproximado em dólares, pela tabela de preços conhecida no código. */
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('rec_analyses_status_idx').on(t.tenantId, t.status, t.createdAt), index('rec_analyses_application_idx').on(t.tenantId, t.applicationId, t.createdAt), tenantIsolation()],
);

/** Histórico do candidato: candidaturas, mudanças de etapa, reprovações, contratação e anotações. */
export const recEvents = pgTable(
  'rec_events',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => recCandidates.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => recApplications.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['applied', 'note', 'stage', 'rejected', 'reopened', 'hired', 'analysis', 'edited'] }).notNull(),
    text: text('text'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('rec_events_candidate_idx').on(t.tenantId, t.candidateId, t.createdAt), tenantIsolation()],
);
