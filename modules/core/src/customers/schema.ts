import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants, users } from '../db/schema';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export interface Address {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
}

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['person', 'company'] }).notNull(),
    name: text('name').notNull(),
    /** CPF ou CNPJ, só dígitos. */
    document: text('document'),
    /** Minúsculas. */
    email: text('email'),
    /** E.164 (+5511999998888). */
    phone: text('phone'),
    birthDate: date('birth_date', { mode: 'string' }),
    address: jsonb('address').$type<Address>(),
    notes: text('notes'),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    /** Preenchido quando os dados pessoais foram apagados a pedido do titular (LGPD). */
    anonymizedAt: ts('anonymized_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('customers_tenant_document_key').on(t.tenantId, t.document).where(sql`document is not null`),
    index('customers_tenant_email_idx').on(t.tenantId, t.email),
    index('customers_tenant_phone_idx').on(t.tenantId, t.phone),
    index('customers_tenant_name_idx').on(t.tenantId, t.name),
    tenantIsolation(),
  ],
);

export const consentPurposes = ['service_notifications', 'marketing_email', 'marketing_whatsapp'] as const;
export type ConsentPurpose = (typeof consentPurposes)[number];

/** Histórico de consentimentos: cada concessão/revogação é uma linha (prova para a LGPD). */
export const customerConsents = pgTable(
  'customer_consents',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: consentPurposes }).notNull(),
    granted: boolean('granted').notNull(),
    legalBasis: text('legal_basis', { enum: ['consent', 'contract', 'legitimate_interest'] }).notNull(),
    source: text('source').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('customer_consents_customer_idx').on(t.customerId, t.purpose, t.createdAt), tenantIsolation()],
);

export const customFieldTypes = ['text', 'number', 'date', 'boolean', 'select'] as const;

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type', { enum: customFieldTypes }).notNull(),
    options: jsonb('options').$type<string[]>(),
    required: boolean('required').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('custom_field_definitions_key').on(t.tenantId, t.entity, t.key), tenantIsolation()],
);

/** Linha do tempo do cliente, alimentada por todos os módulos. */
export const customerTimeline = pgTable(
  'customer_timeline',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('customer_timeline_customer_idx').on(t.customerId, t.createdAt), tenantIsolation()],
);
