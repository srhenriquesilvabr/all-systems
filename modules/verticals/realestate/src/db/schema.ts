import { customers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const day = (name: string) => date(name, { mode: 'string' });

export const reProperties = pgTable(
  're_properties',
  {
    id: id(),
    tenantId: tenantId(),
    /** Código curto do imóvel (anúncios, placa na frente). */
    code: integer('code').notNull(),
    purpose: text('purpose', { enum: ['sale', 'rent', 'both'] }).notNull(),
    type: text('type', { enum: ['apartment', 'house', 'condo_house', 'land', 'commercial', 'office', 'rural'] }).notNull(),
    title: text('title').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => customers.id),
    street: text('street').notNull(),
    number: text('number'),
    complement: text('complement'),
    district: text('district').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    zip: text('zip'),
    areaM2: numeric('area_m2', { precision: 12, scale: 2 }),
    landM2: numeric('land_m2', { precision: 14, scale: 2 }),
    bedrooms: integer('bedrooms').notNull().default(0),
    suites: integer('suites').notNull().default(0),
    bathrooms: integer('bathrooms').notNull().default(0),
    parking: integer('parking').notNull().default(0),
    salePrice: money('sale_price'),
    rentPrice: money('rent_price'),
    condoFee: money('condo_fee'),
    iptuYearly: money('iptu_yearly'),
    financeable: boolean('financeable').notNull().default(true),
    status: text('status', { enum: ['available', 'reserved', 'sold', 'rented', 'inactive'] }).notNull().default('available'),
    description: text('description'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('re_properties_code_key').on(t.tenantId, t.code), index('re_properties_city_idx').on(t.tenantId, t.city, t.district), tenantIsolation()],
);

export const reDeals = pgTable(
  're_deals',
  {
    id: id(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => reProperties.id),
    price: money('price').notNull(),
    paymentType: text('payment_type', { enum: ['cash', 'financing'] }).notNull(),
    downPayment: money('down_payment').notNull().default('0'),
    fgtsAmount: money('fgts_amount').notNull().default('0'),
    commissionPercent: numeric('commission_percent', { precision: 5, scale: 2 }).notNull(),
    status: text('status', { enum: ['negotiating', 'credit_analysis', 'credit_approved', 'credit_rejected', 'closed', 'lost'] }).notNull().default('negotiating'),
    /** Detalhe do motivo (antes era o único campo, texto livre). */
    lostReason: text('lost_reason'),
    /** Motivo padronizado (lostReasonKeys dos contratos); nulo nas perdidas antigas. */
    lostReasonKey: text('lost_reason_key'),
    lostAt: ts('lost_at'),
    /** Corretor responsável (o "vendedor" da imobiliária). */
    brokerId: uuid('broker_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    closedAt: ts('closed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('re_deals_number_key').on(t.tenantId, t.number),
    index('re_deals_property_idx').on(t.propertyId),
    index('re_deals_customer_idx').on(t.customerId),
    index('re_deals_broker_idx').on(t.tenantId, t.brokerId),
    tenantIsolation(),
  ],
);

/**
 * Contrato de locação. O proprietário é copiado do imóvel na assinatura; `rent` é o aluguel
 * vigente (muda a cada reajuste aplicado) e `initial_rent` o valor original.
 */
export const reLeases = pgTable(
  're_leases',
  {
    id: id(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => reProperties.id),
    /** Inquilino (locatário). */
    renterId: uuid('renter_id')
      .notNull()
      .references(() => customers.id),
    /** Proprietário (locador) no momento da assinatura. */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => customers.id),
    startDate: day('start_date').notNull(),
    termMonths: integer('term_months').notNull(),
    /** Último dia do prazo (início + prazo − 1 dia). Muda na prorrogação. */
    endDate: day('end_date').notNull(),
    initialRent: money('initial_rent').notNull(),
    rent: money('rent').notNull(),
    dueDay: integer('due_day').notNull(),
    /** Condomínio e IPTU mensais: cobrados do inquilino e repassados ao proprietário, sem taxa. */
    condoFee: money('condo_fee').notNull().default('0'),
    iptuMonthly: money('iptu_monthly').notNull().default('0'),
    adjustmentIndex: text('adjustment_index', { enum: ['igpm', 'ipca', 'fixed', 'none'] }).notNull(),
    /** Percentual anual quando o índice é fixo. */
    adjustmentPercent: numeric('adjustment_percent', { precision: 6, scale: 2 }),
    /** Mês do aniversário (1–12). */
    adjustmentMonth: integer('adjustment_month').notNull(),
    guaranteeType: text('guarantee_type', { enum: ['deposit', 'guarantor', 'insurance', 'capitalization', 'none'] }).notNull(),
    /** Valor da caução ou do título de capitalização. */
    guaranteeAmount: money('guarantee_amount'),
    guarantorName: text('guarantor_name'),
    guarantorDocument: text('guarantor_document'),
    /** Seguradora (seguro-fiança) ou emissora (título de capitalização). */
    guaranteeProvider: text('guarantee_provider'),
    /** Número da apólice ou do título. */
    guaranteeNumber: text('guarantee_number'),
    /** Taxa de administração cobrada do proprietário, sobre o aluguel. */
    adminFeePercent: numeric('admin_fee_percent', { precision: 5, scale: 2 }).notNull(),
    notes: text('notes'),
    status: text('status', { enum: ['active', 'ended', 'terminated'] }).notNull().default('active'),
    terminatedOn: day('terminated_on'),
    terminationReason: text('termination_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('re_leases_number_key').on(t.tenantId, t.number),
    // Um imóvel só tem um contrato ativo por vez.
    uniqueIndex('re_leases_property_active_key').on(t.propertyId).where(sql`status = 'active'`),
    index('re_leases_renter_idx').on(t.renterId),
    index('re_leases_owner_idx').on(t.tenantId, t.ownerId),
    tenantIsolation(),
  ],
);

/**
 * Mensalidade do contrato (uma por mês de uso, `seq` 1..prazo). Os valores ficam no financeiro:
 * o "a receber" do inquilino e o "a pagar" do repasse têm source_type 'real_estate_lease' e
 * source_id = id desta linha. Reajuste e rescisão recalculam só as que ainda estão em aberto.
 */
export const reLeaseCharges = pgTable(
  're_lease_charges',
  {
    id: id(),
    tenantId: tenantId(),
    leaseId: uuid('lease_id')
      .notNull()
      .references(() => reLeases.id),
    seq: integer('seq').notNull(),
    /** Primeiro dia do mês de uso a que o aluguel se refere. */
    periodStart: day('period_start').notNull(),
    dueDate: day('due_date').notNull(),
    payoutDate: day('payout_date').notNull(),
    rent: money('rent').notNull(),
    condoFee: money('condo_fee').notNull().default('0'),
    iptu: money('iptu').notNull().default('0'),
    adminFee: money('admin_fee').notNull(),
    payout: money('payout').notNull(),
    status: text('status', { enum: ['active', 'cancelled'] }).notNull().default('active'),
    reminderSentAt: ts('reminder_sent_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('re_lease_charges_seq_key').on(t.leaseId, t.seq), index('re_lease_charges_due_idx').on(t.tenantId, t.dueDate), tenantIsolation()],
);

/** Cobranças avulsas do contrato (multa, reparo, condomínio extra…). Financeiro: source_type 'real_estate_lease_extra'. */
export const reLeaseExtras = pgTable(
  're_lease_extras',
  {
    id: id(),
    tenantId: tenantId(),
    leaseId: uuid('lease_id')
      .notNull()
      .references(() => reLeases.id),
    kind: text('kind', { enum: ['condo', 'iptu', 'fine', 'repair', 'other'] }).notNull(),
    description: text('description').notNull(),
    amount: money('amount').notNull(),
    dueDate: day('due_date').notNull(),
    /** O valor é repassado integralmente ao proprietário. */
    passToOwner: boolean('pass_to_owner').notNull().default(false),
    status: text('status', { enum: ['active', 'cancelled'] }).notNull().default('active'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('re_lease_extras_lease_idx').on(t.leaseId), index('re_lease_extras_due_idx').on(t.tenantId, t.dueDate), tenantIsolation()],
);

/** Reajuste anual: aparece pendente perto do aniversário; aplicado, recalcula as mensalidades em aberto a partir de `due_on`. */
export const reLeaseAdjustments = pgTable(
  're_lease_adjustments',
  {
    id: id(),
    tenantId: tenantId(),
    leaseId: uuid('lease_id')
      .notNull()
      .references(() => reLeases.id),
    /** Aniversário: vale para os meses de uso que começam nesta data ou depois. */
    dueOn: day('due_on').notNull(),
    index: text('index', { enum: ['igpm', 'ipca', 'fixed', 'none'] }).notNull(),
    percent: numeric('percent', { precision: 6, scale: 2 }),
    previousRent: money('previous_rent').notNull(),
    newRent: money('new_rent'),
    status: text('status', { enum: ['pending', 'applied', 'skipped'] }).notNull().default('pending'),
    notes: text('notes'),
    appliedAt: ts('applied_at'),
    appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('re_lease_adjustments_due_key').on(t.leaseId, t.dueOn), index('re_lease_adjustments_status_idx').on(t.tenantId, t.status), tenantIsolation()],
);
