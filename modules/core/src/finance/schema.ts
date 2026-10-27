import { id, tenantId, tenantIsolation } from '@all/db';
import { boolean, date, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customers } from '../customers/schema';
import { tenants, users } from '../db/schema';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const finAccounts = pgTable(
  'fin_accounts',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', { enum: ['cash', 'bank', 'gateway'] }).notNull(),
    initialBalance: money('initial_balance').notNull().default('0'),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [tenantIsolation()],
);

export const finCategories = pgTable(
  'fin_categories',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    /** Chave estável das categorias criadas pelo sistema (ex.: 'services'), usada pelos módulos. */
    systemKey: text('system_key'),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [tenantIsolation()],
);

/**
 * Livro único de lançamentos. Um lançamento é previsto (pending), realizado (paid) ou cancelado.
 * `source_type/source_id` dizem de onde veio (manual, ordem de serviço, pedido Shopify…).
 */
export const finEntries = pgTable(
  'fin_entries',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    status: text('status', { enum: ['pending', 'paid', 'cancelled'] }).notNull(),
    description: text('description').notNull(),
    amount: money('amount').notNull(),
    /** Mês a que o valor pertence (DRE). */
    competenceDate: date('competence_date', { mode: 'string' }).notNull(),
    /** Vencimento (contas a pagar/receber). */
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    /** Data em que o dinheiro entrou/saiu (fluxo de caixa). */
    paidAt: date('paid_at', { mode: 'string' }),
    accountId: uuid('account_id').references(() => finAccounts.id),
    categoryId: uuid('category_id').references(() => finCategories.id),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    paymentMethod: text('payment_method'),
    sourceType: text('source_type').notNull().default('manual'),
    sourceId: text('source_id'),
    /**
     * Lançamento de módulo que recebe baixa aqui no financeiro (parcelas, honorários, folha):
     * o módulo de origem não tem fluxo de pagamento próprio. Ordens de serviço, agenda e PDV
     * registram o pagamento por lá e deixam false.
     */
    settleInFinance: boolean('settle_in_finance').notNull().default(false),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledAt: ts('cancelled_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('fin_entries_due_idx').on(t.tenantId, t.dueDate),
    index('fin_entries_paid_idx').on(t.tenantId, t.paidAt),
    index('fin_entries_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
    index('fin_entries_customer_idx').on(t.customerId),
    tenantIsolation(),
  ],
);
