import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { DocumentItem, DocumentPayment, Recipient, Taxes } from '../contracts';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const percent = (name: string) => numeric(name, { precision: 5, scale: 2 });

const docType = (name: string) => text(name, { enum: ['nfse', 'nfce', 'nfe'] });
const environment = (name: string) => text(name, { enum: ['homologation', 'production'] });

/**
 * Certificado digital A1 (.pfx). O arquivo fica no storage (`files`, dono `fiscal_certificate`,
 * fora do download genérico) e a senha, cifrada com a chave de configurações. Só um ativo por empresa.
 */
export const fiscalCertificates = pgTable(
  'fiscal_certificates',
  {
    id: id(),
    tenantId: tenantId(),
    fileId: uuid('file_id').notNull(),
    passwordEnc: text('password_enc').notNull(),
    subjectName: text('subject_name').notNull(),
    /** CNPJ/CPF do titular lido do certificado (ICP-Brasil). */
    subjectDocument: text('subject_document'),
    issuerName: text('issuer_name').notNull(),
    serialNumber: text('serial_number').notNull(),
    validFrom: ts('valid_from').notNull(),
    validTo: ts('valid_to').notNull(),
    active: boolean('active').notNull().default(true),
    /** Último aviso de vencimento enviado (dias que faltavam), para não repetir. */
    lastAlertDays: integer('last_alert_days'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fiscal_certificates_active_key').on(t.tenantId).where(sql`active`), tenantIsolation()],
);

/** Série em uso e próximo número, um por tipo e ambiente (quando o sistema numera). */
export const fiscalSeries = pgTable(
  'fiscal_series',
  {
    id: id(),
    tenantId: tenantId(),
    type: docType('type').notNull(),
    environment: environment('environment').notNull(),
    series: text('series').notNull(),
    nextNumber: integer('next_number').notNull().default(1),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('fiscal_series_key').on(t.tenantId, t.type, t.environment),
    check('fiscal_series_next_chk', sql`next_number > 0`),
    tenantIsolation(),
  ],
);

/**
 * Cadastro fiscal do produto (vendas/PDV). Sem FK para `sales_products`: a integração não depende
 * do módulo de vendas; o nome fica guardado para a tela e para o caso de o produto sumir.
 */
export const fiscalProductCodes = pgTable(
  'fiscal_product_codes',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id').notNull(),
    productName: text('product_name').notNull(),
    ncm: text('ncm').notNull(),
    cfop: text('cfop').notNull(),
    cest: text('cest'),
    origin: smallint('origin').notNull().default(0),
    icmsSituation: text('icms_situation').notNull(),
    icmsRate: percent('icms_rate'),
    pisCofinsCst: text('pis_cofins_cst'),
    pisRate: percent('pis_rate'),
    cofinsRate: percent('cofins_rate'),
    taxUnit: text('tax_unit').notNull(),
    ibsCbsCst: text('ibs_cbs_cst'),
    classTrib: text('class_trib'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('fiscal_product_codes_product_key').on(t.tenantId, t.productId),
    check('fiscal_product_codes_ncm_chk', sql`ncm ~ '^[0-9]{8}$'`),
    check('fiscal_product_codes_cfop_chk', sql`cfop ~ '^[5-7][0-9]{3}$'`),
    check('fiscal_product_codes_origin_chk', sql`origin between 0 and 8`),
    tenantIsolation(),
  ],
);

/**
 * Cadastro fiscal do serviço. `ref_type` diz de onde ele vem: `sch_service` (serviço da agenda) ou o
 * `ref_type` dos itens de ordem de serviço de uma vertical. Sem FK pelo mesmo motivo dos produtos.
 */
export const fiscalServiceCodes = pgTable(
  'fiscal_service_codes',
  {
    id: id(),
    tenantId: tenantId(),
    refType: text('ref_type').notNull(),
    refId: text('ref_id').notNull(),
    serviceName: text('service_name').notNull(),
    lc116: text('lc116').notNull(),
    nationalCode: text('national_code'),
    nbs: text('nbs'),
    municipalCode: text('municipal_code'),
    issRate: percent('iss_rate').notNull(),
    issWithheld: boolean('iss_withheld').notNull().default(false),
    cnae: text('cnae'),
    ibsCbsCst: text('ibs_cbs_cst'),
    classTrib: text('class_trib'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('fiscal_service_codes_ref_key').on(t.tenantId, t.refType, t.refId),
    check('fiscal_service_codes_lc116_chk', sql`lc116 ~ '^[0-9]{2}\\.[0-9]{2}$'`),
    check('fiscal_service_codes_iss_chk', sql`iss_rate between 0 and 5`),
    tenantIsolation(),
  ],
);

/**
 * Origem de nota vinda dos eventos dos outros módulos (venda, atendimento pago, ordem concluída):
 * uma cópia do que a nota precisa, porque a integração não lê as tabelas deles.
 */
export const fiscalSources = pgTable(
  'fiscal_sources',
  {
    id: id(),
    tenantId: tenantId(),
    sourceType: text('source_type', { enum: ['sale', 'appointment', 'service_order'] }).notNull(),
    sourceId: text('source_id').notNull(),
    label: text('label').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    occurredAt: ts('occurred_at').notNull(),
    total: money('total').notNull(),
    status: text('status', { enum: ['pending', 'ready', 'cancelled'] }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** Última nota gerada desta origem. */
    documentId: uuid('document_id'),
    /** Emissão automática que não deu certo (ex.: produto sem cadastro fiscal). */
    autoError: text('auto_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('fiscal_sources_key').on(t.tenantId, t.sourceType, t.sourceId),
    index('fiscal_sources_status_idx').on(t.tenantId, t.status, t.occurredAt),
    tenantIsolation(),
  ],
);

/**
 * A nota. Itens, destinatário e impostos são cópias do momento da emissão (o cadastro pode mudar).
 * Notas autorizadas não são apagadas: a guarda de XML e DANFE é de 5 anos (CTN, art. 173).
 */
export const fiscalDocuments = pgTable(
  'fiscal_documents',
  {
    id: id(),
    tenantId: tenantId(),
    type: docType('type').notNull(),
    environment: environment('environment').notNull(),
    provider: text('provider', { enum: ['simulated', 'focus', 'plugnotas', 'nfeio'] }).notNull(),
    status: text('status', { enum: ['draft', 'sending', 'authorized', 'rejected', 'denied', 'cancelled', 'discarded'] })
      .notNull()
      .default('draft'),
    /** Referência enviada ao provedor (única por empresa): reenvio após rejeição usa a mesma. */
    reference: text('reference').notNull(),
    series: text('series'),
    number: integer('number'),
    accessKey: text('access_key'),
    verificationCode: text('verification_code'),
    protocol: text('protocol'),
    sourceType: text('source_type', { enum: ['sale', 'appointment', 'service_order', 'manual'] }).notNull(),
    sourceId: text('source_id'),
    sourceLabel: text('source_label'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    recipient: jsonb('recipient').$type<Recipient>(),
    items: jsonb('items').$type<DocumentItem[]>().notNull(),
    payments: jsonb('payments').$type<DocumentPayment[]>().notNull().default([]),
    total: money('total').notNull(),
    discount: money('discount').notNull().default('0'),
    taxes: jsonb('taxes').$type<Taxes>().notNull(),
    nature: text('nature').notNull(),
    additionalInfo: text('additional_info'),
    serviceDate: text('service_date'),
    /** Quando foi enviada (data de emissão da nota). */
    issuedAt: ts('issued_at'),
    authorizedAt: ts('authorized_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    statusCode: text('status_code'),
    /** Motivo do provedor/SEFAZ/prefeitura (rejeição, denegação, falha de comunicação). */
    statusMessage: text('status_message'),
    errors: jsonb('errors').$type<{ code?: string; message: string; field?: string }[]>().notNull().default([]),
    contingency: boolean('contingency').notNull().default(false),
    /** Já chegou ao provedor ao menos uma vez (consulta de status faz sentido). */
    transmittedAt: ts('transmitted_at'),
    attempts: integer('attempts').notNull().default(0),
    lastCheckedAt: ts('last_checked_at'),
    xmlFileId: uuid('xml_file_id'),
    pdfFileId: uuid('pdf_file_id'),
    cancelXmlFileId: uuid('cancel_xml_file_id'),
    /** Endereços do provedor para baixar o XML/DANFE (quando não vieram no corpo). */
    remoteFiles: jsonb('remote_files').$type<{ xml?: string; pdf?: string; cancelXml?: string }>().notNull().default({}),
    consultUrl: text('consult_url'),
    qrCodeUrl: text('qr_code_url'),
    delivery: jsonb('delivery').$type<{ channel: string; status: string; to: string; actionUrl?: string | null; at: string; requestId?: string }[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('fiscal_documents_reference_key').on(t.tenantId, t.reference),
    // Número nunca se repete na série (nem de nota descartada: esse vira lacuna a inutilizar).
    uniqueIndex('fiscal_documents_number_key').on(t.tenantId, t.type, t.environment, t.series, t.number).where(sql`number is not null`),
    index('fiscal_documents_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
    index('fiscal_documents_status_idx').on(t.tenantId, t.status),
    index('fiscal_documents_issued_idx').on(t.tenantId, t.issuedAt),
    check('fiscal_documents_total_chk', sql`total >= 0`),
    tenantIsolation(),
  ],
);

/** Histórico da nota: envio, respostas do provedor, webhook, cancelamento, carta de correção, downloads. */
export const fiscalDocumentEvents = pgTable(
  'fiscal_document_events',
  {
    id: id(),
    tenantId: tenantId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fiscalDocuments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status'),
    message: text('message'),
    source: text('source', { enum: ['user', 'auto', 'provider', 'poll', 'webhook', 'public'] }).notNull(),
    payload: jsonb('payload'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('fiscal_document_events_doc_idx').on(t.documentId, t.at), tenantIsolation()],
);

/** Carta de correção (NF-e): até 20 por nota, vale a última. */
export const fiscalCorrections = pgTable(
  'fiscal_corrections',
  {
    id: id(),
    tenantId: tenantId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fiscalDocuments.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    text: text('text').notNull(),
    protocol: text('protocol'),
    xmlFileId: uuid('xml_file_id'),
    pdfFileId: uuid('pdf_file_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fiscal_corrections_seq_key').on(t.documentId, t.sequence), tenantIsolation()],
);

/** Inutilização de faixa de numeração (NFC-e/NF-e). */
export const fiscalVoids = pgTable(
  'fiscal_voids',
  {
    id: id(),
    tenantId: tenantId(),
    type: text('type', { enum: ['nfce', 'nfe'] }).notNull(),
    environment: environment('environment').notNull(),
    series: text('series').notNull(),
    numberFrom: integer('number_from').notNull(),
    numberTo: integer('number_to').notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['authorized', 'rejected'] }).notNull(),
    message: text('message'),
    protocol: text('protocol'),
    xmlFileId: uuid('xml_file_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('fiscal_voids_series_idx').on(t.tenantId, t.type, t.environment, t.series),
    check('fiscal_voids_range_chk', sql`number_to >= number_from`),
    tenantIsolation(),
  ],
);
