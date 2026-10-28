import { customers, teamMembers } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { salesProducts } from '@all/sales/schema';
import { schAppointments, schResources, schServices } from '@all/scheduling/schema';
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Pacote de sessões de um procedimento vendido a um cliente. */
export const aesPackages = pgTable(
  'aes_packages',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => schServices.id),
    totalSessions: integer('total_sessions').notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    /** Dia da venda (pode ser anterior ao cadastro, ao registrar histórico). */
    soldOn: date('sold_on', { mode: 'string' }).notNull().defaultNow(),
    expiresOn: date('expires_on', { mode: 'string' }),
    status: text('status', { enum: ['active', 'finished', 'cancelled'] }).notNull().default('active'),
    notes: text('notes'),
    cancelReason: text('cancel_reason'),
    cancelledOn: date('cancelled_on', { mode: 'string' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('aes_packages_customer_idx').on(t.customerId, t.status), tenantIsolation()],
);

/**
 * Uso do pacote por atendimento: reservada ao marcar, usada ao concluir, liberada se o horário
 * for cancelado (ou se o cliente faltar, conforme a configuração).
 */
export const aesPackageSessions = pgTable(
  'aes_package_sessions',
  {
    id: id(),
    tenantId: tenantId(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => aesPackages.id),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => schAppointments.id),
    status: text('status', { enum: ['reserved', 'used', 'released'] }).notNull().default('reserved'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('aes_package_sessions_key').on(t.packageId, t.appointmentId), index('aes_package_sessions_appointment_idx').on(t.appointmentId), tenantIsolation()],
);

// ---- Especialidades (harmonização, clareamento, cirurgia plástica, micropigmentação, laser,
// tricologia). As fichas clínicas ficam no prontuário (mr_entries, só inclusão); aqui ficam os
// cadastros, o rastreio de lote e o andamento dos casos.

const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

/**
 * Registro no conselho de classe da pessoa da equipe (CRM, CRO…), conferido ao registrar fichas
 * que exigem habilitação (clareamento: CRO; cirurgia: CRM + RQE). Uma linha por pessoa.
 */
export const aesProfessionalCredentials = pgTable(
  'aes_professional_credentials',
  {
    id: id(),
    tenantId: tenantId(),
    teamMemberId: uuid('team_member_id')
      .notNull()
      .references(() => teamMembers.id, { onDelete: 'cascade' }),
    council: text('council', { enum: ['CRM', 'CRO', 'CRBM', 'CRF', 'COREN', 'CREFITO', 'CRBio', 'other'] }).notNull(),
    number: text('number').notNull(),
    uf: text('uf').notNull(),
    /** Registro de Qualificação de Especialista (médicos). */
    rqe: text('rqe'),
    specialty: text('specialty'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('aes_professional_credentials_member_key').on(t.tenantId, t.teamMemberId), tenantIsolation()],
);

/** Injetáveis, pigmentos, géis, implantes: o que tem lote e validade e precisa de rastreio. */
export const aesProducts = pgTable(
  'aes_products',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    brand: text('brand'),
    kind: text('kind', { enum: ['toxin', 'filler', 'biostimulator', 'thread', 'pigment', 'whitening_gel', 'implant', 'hair_drug', 'other'] }).notNull(),
    unit: text('unit', { enum: ['U', 'ml', 'fio', 'g', 'un'] }).notNull(),
    anvisaRegistration: text('anvisa_registration'),
    /** Quanto vem em cada embalagem (ex.: 100 U por frasco): uso ÷ isto = baixa no estoque. */
    unitsPerPackage: quantity('units_per_package'),
    /** Produto do estoque (shared.sales) que recebe a baixa. */
    salesProductId: uuid('sales_product_id').references(() => salesProducts.id, { onDelete: 'set null' }),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('aes_products_name_key').on(t.tenantId, sql`lower(${t.name})`), tenantIsolation()],
);

export const aesProductLots = pgTable(
  'aes_product_lots',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => aesProducts.id),
    lot: text('lot').notNull(),
    expiresOn: date('expires_on', { mode: 'string' }).notNull(),
    receivedOn: date('received_on', { mode: 'string' }),
    /** Quantidade recebida, na unidade do produto (informativa). */
    quantity: quantity('quantity'),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('aes_product_lots_key').on(t.tenantId, t.productId, t.lot), index('aes_product_lots_expiry_idx').on(t.tenantId, t.expiresOn), tenantIsolation()],
);

/**
 * Uso de cada lote em cada paciente (rastreabilidade exigida pela Anvisa: num recall, quem
 * recebeu o lote). Só inclusão, como o prontuário: o app_user não tem UPDATE/DELETE (migration).
 */
export const aesLotUsages = pgTable(
  'aes_lot_usages',
  {
    id: id(),
    tenantId: tenantId(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => aesProductLots.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => aesProducts.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Registro do prontuário (mr_entries) em que o uso foi anotado. */
    entryId: uuid('entry_id').notNull(),
    specialty: text('specialty').notNull(),
    amount: quantity('amount').notNull(),
    unit: text('unit').notNull(),
    usedOn: date('used_on', { mode: 'string' }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('aes_lot_usages_lot_idx').on(t.lotId), index('aes_lot_usages_customer_idx').on(t.customerId), tenantIsolation()],
);

/** Modelos de termo de consentimento, editáveis pela clínica. O aceite guarda o texto da versão. */
export const aesConsentTemplates = pgTable(
  'aes_consent_templates',
  {
    id: id(),
    tenantId: tenantId(),
    /** Modelo que veio com a especialidade (ex.: "harmonization.toxin"); nulo nos criados pela clínica. */
    key: text('key'),
    specialty: text('specialty'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    version: integer('version').notNull().default(1),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('aes_consent_templates_key').on(t.tenantId, t.key).where(sql`key is not null`), tenantIsolation()],
);

export interface AesBudgetItem {
  kind: 'surgeon' | 'anesthetist' | 'hospital' | 'implant' | 'materials' | 'other';
  description: string;
  amount: number;
  billedBy: 'clinic' | 'third_party';
}

export interface AesBudget {
  items: AesBudgetItem[];
  status: 'draft' | 'approved';
  validUntil: string | null;
  approvedOn: string | null;
  installments: number | null;
}

export interface AesSurgery {
  appointmentId: string;
  startsAt: string;
  location: string;
  team: { role: string; name: string; teamMemberId?: string | null }[];
}

/**
 * Caso / tratamento de uma especialidade (clareamento em andamento, protocolo capilar, cirurgia).
 * Guarda o andamento e o que não é clínico (orçamento, agenda da cirurgia); as fichas ficam no
 * prontuário com o id do caso.
 */
export const aesCases = pgTable(
  'aes_cases',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    specialty: text('specialty').notNull(),
    title: text('title').notNull(),
    status: text('status', { enum: ['active', 'finished', 'cancelled'] }).notNull().default('active'),
    /** Etapa da cirurgia plástica (nulo nas outras especialidades). */
    stage: text('stage', { enum: ['evaluation', 'preop', 'scheduled', 'operated', 'postop', 'discharged'] }),
    professionalId: uuid('professional_id').references(() => schResources.id, { onDelete: 'set null' }),
    plannedSessions: integer('planned_sessions'),
    startedOn: date('started_on', { mode: 'string' }).notNull(),
    finishedOn: date('finished_on', { mode: 'string' }),
    closeReason: text('close_reason'),
    notes: text('notes'),
    /** Orçamento em partes (cirurgia). Aprovado, a parte da clínica vira "a receber" (origem aes_case). */
    budget: jsonb('budget').$type<AesBudget>(),
    /** Cirurgia marcada: horário na agenda, local e equipe. */
    surgery: jsonb('surgery').$type<AesSurgery>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('aes_cases_customer_idx').on(t.customerId, t.specialty), index('aes_cases_open_idx').on(t.tenantId, t.specialty, t.status), tenantIsolation()],
);
