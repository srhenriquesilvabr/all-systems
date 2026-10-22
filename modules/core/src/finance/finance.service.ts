import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { centsToDecimal, centsToNumber, toCents } from '../common/money';
import { CustomerDataRegistry } from '../customers/customer-data.registry';
import { TenantDb } from '../db/tenant-db';
import { ModuleHooks } from '../tenancy/module-hooks';
import { finAccounts, finCategories, finEntries } from './schema';

export type EntryKind = 'income' | 'expense';

export interface EntryInput {
  kind: EntryKind;
  description: string;
  /** Em reais. */
  amount: number;
  status: 'pending' | 'paid';
  dueDate: string;
  competenceDate?: string;
  paidAt?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  customerId?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
}

/** Lançamento gerado por outro módulo. A categoria pode vir pela chave do sistema (ex.: 'services'). */
export interface SourcedEntryInput extends EntryInput {
  sourceType: string;
  sourceId: string;
  categoryKey?: string;
}

export interface EntryFilters {
  from?: string;
  to?: string;
  /** Qual data o período filtra: vencimento (padrão), pagamento ou competência. */
  dateField: 'due' | 'paid' | 'competence';
  status?: 'pending' | 'paid' | 'cancelled' | 'overdue';
  kind?: EntryKind;
  accountId?: string;
  categoryId?: string;
  customerId?: string;
  q?: string;
  limit: number;
  offset: number;
}

const DEFAULT_CATEGORIES: { key: string; name: string; kind: EntryKind }[] = [
  { key: 'services', name: 'Serviços', kind: 'income' },
  { key: 'products', name: 'Venda de produtos', kind: 'income' },
  { key: 'other_income', name: 'Outras receitas', kind: 'income' },
  { key: 'rent', name: 'Aluguel', kind: 'expense' },
  { key: 'payroll', name: 'Salários e encargos', kind: 'expense' },
  { key: 'supplies', name: 'Insumos e materiais', kind: 'expense' },
  { key: 'fees', name: 'Taxas e tarifas', kind: 'expense' },
  { key: 'taxes', name: 'Impostos', kind: 'expense' },
  { key: 'other_expense', name: 'Outras despesas', kind: 'expense' },
];

/** "Hoje" no fuso do negócio. Fuso por tenant fica para quando houver clientes fora de SP. */
const TODAY = sql`(now() at time zone 'America/Sao_Paulo')::date`;

@Injectable()
export class FinanceService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
    private readonly hooks: ModuleHooks,
    private readonly customerData: CustomerDataRegistry,
  ) {}

  onModuleInit() {
    this.hooks.register('core.finance', { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    // Valores financeiros são mantidos na anonimização (obrigação fiscal); só o vínculo pessoal some do cadastro.
    this.customerData.register({
      moduleKey: 'core.finance',
      export: async (tx, customerId) =>
        (await tx.select().from(finEntries).where(eq(finEntries.customerId, customerId)).orderBy(asc(finEntries.dueDate))).map(toEntryDto),
    });
  }

  // ---- Contas -------------------------------------------------------------------------------

  listAccounts() {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({
          id: finAccounts.id,
          name: finAccounts.name,
          type: finAccounts.type,
          active: finAccounts.active,
          initialBalance: finAccounts.initialBalance,
          movement: sql<string>`coalesce(sum(case when ${finEntries.kind} = 'income' then ${finEntries.amount} else -${finEntries.amount} end)
                                 filter (where ${finEntries.status} = 'paid'), 0)`,
        })
        .from(finAccounts)
        .leftJoin(finEntries, eq(finEntries.accountId, finAccounts.id))
        .groupBy(finAccounts.id)
        .orderBy(asc(finAccounts.name));
      return rows.map(({ movement, initialBalance, ...a }) => ({
        ...a,
        initialBalance: Number(initialBalance),
        balance: centsToNumber(toCents(initialBalance) + toCents(movement)),
      }));
    });
  }

  createAccount(input: { name: string; type: 'cash' | 'bank' | 'gateway'; initialBalance: number }) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [account] = await tx
        .insert(finAccounts)
        .values({ ...input, tenantId, initialBalance: centsToDecimal(toCents(input.initialBalance)) })
        .returning();
      await this.audit.log(tx, { action: 'finance.account.created', entity: 'fin_account', entityId: account!.id, data: input });
      return account!;
    });
  }

  updateAccount(id: string, input: { name?: string; active?: boolean }) {
    return this.tdb.run(async (tx) => {
      const [account] = await tx.update(finAccounts).set(input).where(eq(finAccounts.id, id)).returning();
      if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Conta não encontrada' });
      await this.audit.log(tx, { action: 'finance.account.updated', entity: 'fin_account', entityId: id, data: input });
      return account;
    });
  }

  // ---- Categorias ---------------------------------------------------------------------------

  listCategories() {
    return this.tdb.run((tx) => tx.select().from(finCategories).orderBy(asc(finCategories.kind), asc(finCategories.name)));
  }

  createCategory(input: { name: string; kind: EntryKind }) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [category] = await tx.insert(finCategories).values({ ...input, tenantId }).returning();
      await this.audit.log(tx, { action: 'finance.category.created', entity: 'fin_category', entityId: category!.id, data: input });
      return category!;
    });
  }

  updateCategory(id: string, input: { name?: string; active?: boolean }) {
    return this.tdb.run(async (tx) => {
      const [category] = await tx.update(finCategories).set(input).where(eq(finCategories.id, id)).returning();
      if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Categoria não encontrada' });
      await this.audit.log(tx, { action: 'finance.category.updated', entity: 'fin_category', entityId: id, data: input });
      return category;
    });
  }

  // ---- Lançamentos --------------------------------------------------------------------------

  listEntries(filters: EntryFilters) {
    return this.tdb.run(async (tx) => {
      const where = entryFilter(filters);
      const category = aliasedTable(finCategories, 'category');
      const account = aliasedTable(finAccounts, 'account');
      const [rows, [totals]] = await Promise.all([
        tx
          .select({ entry: finEntries, categoryName: category.name, accountName: account.name })
          .from(finEntries)
          .leftJoin(category, eq(category.id, finEntries.categoryId))
          .leftJoin(account, eq(account.id, finEntries.accountId))
          .where(where)
          .orderBy(desc(finEntries.dueDate), desc(finEntries.createdAt))
          .limit(filters.limit)
          .offset(filters.offset),
        tx
          .select({
            total: count(),
            income: sql<string>`coalesce(sum(${finEntries.amount}) filter (where ${finEntries.kind} = 'income'), 0)`,
            expense: sql<string>`coalesce(sum(${finEntries.amount}) filter (where ${finEntries.kind} = 'expense'), 0)`,
          })
          .from(finEntries)
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({ ...toEntryDto(r.entry), categoryName: r.categoryName, accountName: r.accountName })),
        total: totals!.total,
        sums: { income: Number(totals!.income), expense: Number(totals!.expense) },
      };
    });
  }

  createEntry(input: EntryInput) {
    return this.tdb.run(async (tx) => {
      const entry = await this.insertEntry(tx, { ...input, sourceType: 'manual' });
      await this.audit.log(tx, { action: 'finance.entry.created', entity: 'fin_entry', entityId: entry.id, data: input });
      return toEntryDto(entry);
    });
  }

  /** Lançamentos vindos de outros módulos só aceitam mudar categoria, conta e observação aqui. */
  updateEntry(id: string, input: Partial<EntryInput>) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.status === 'cancelled') throw conflict('ENTRY_CANCELLED', 'Lançamento cancelado não pode ser editado');
      const allowed: Partial<EntryInput> =
        current.sourceType === 'manual' ? input : { categoryId: input.categoryId, accountId: input.accountId, notes: input.notes };

      const { amount, ...rest } = allowed;
      const [entry] = await tx
        .update(finEntries)
        .set({ ...stripUndefined(rest), ...(amount !== undefined ? { amount: centsToDecimal(toCents(amount)) } : {}) })
        .where(eq(finEntries.id, id))
        .returning();
      await this.audit.log(tx, { action: 'finance.entry.updated', entity: 'fin_entry', entityId: id, data: allowed });
      return toEntryDto(entry!);
    });
  }

  /** Baixa: o dinheiro entrou/saiu. */
  pay(id: string, input: { paidAt: string; accountId: string; paymentMethod?: string | null }) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.status !== 'pending') throw conflict('ENTRY_NOT_PENDING', 'Só lançamentos em aberto podem receber baixa');
      if (current.sourceType !== 'manual') {
        throw conflict('ENTRY_FROM_MODULE', 'Este valor é controlado por outro módulo: registre o pagamento por lá');
      }
      const [entry] = await tx
        .update(finEntries)
        .set({ status: 'paid', paidAt: input.paidAt, accountId: input.accountId, paymentMethod: input.paymentMethod ?? null })
        .where(eq(finEntries.id, id))
        .returning();
      await this.audit.log(tx, { action: 'finance.entry.paid', entity: 'fin_entry', entityId: id, data: input });
      return toEntryDto(entry!);
    });
  }

  cancel(id: string) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.sourceType !== 'manual') {
        throw conflict('ENTRY_FROM_MODULE', 'Este valor é controlado por outro módulo: cancele por lá');
      }
      if (current.status === 'cancelled') return;
      await tx.update(finEntries).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(finEntries.id, id));
      await this.audit.log(tx, { action: 'finance.entry.cancelled', entity: 'fin_entry', entityId: id });
    });
  }

  /** Visão geral do período: realizado, previsto, vencidos, por mês, por categoria e saldo das contas. */
  summary(from: string, to: string) {
    return this.tdb.run(async (tx) => {
      const paidInRange = and(eq(finEntries.status, 'paid'), gte(finEntries.paidAt, from), lte(finEntries.paidAt, to));
      const pendingInRange = and(eq(finEntries.status, 'pending'), gte(finEntries.dueDate, from), lte(finEntries.dueDate, to));
      const byKind = (where: SQL | undefined) =>
        tx
          .select({ kind: finEntries.kind, total: sql<string>`sum(${finEntries.amount})`, count: count() })
          .from(finEntries)
          .where(where)
          .groupBy(finEntries.kind);

      const [realized, projected, overdue, monthlyPaid, monthlyPending, categories] = await Promise.all([
        byKind(paidInRange),
        byKind(pendingInRange),
        byKind(and(eq(finEntries.status, 'pending'), sql`${finEntries.dueDate} < ${TODAY}`)),
        tx
          .select({ month: sql<string>`to_char(${finEntries.paidAt}, 'YYYY-MM')`, kind: finEntries.kind, total: sql<string>`sum(${finEntries.amount})` })
          .from(finEntries)
          .where(paidInRange)
          .groupBy(sql`1`, finEntries.kind),
        tx
          .select({ month: sql<string>`to_char(${finEntries.dueDate}, 'YYYY-MM')`, kind: finEntries.kind, total: sql<string>`sum(${finEntries.amount})` })
          .from(finEntries)
          .where(pendingInRange)
          .groupBy(sql`1`, finEntries.kind),
        tx
          .select({ name: sql<string>`coalesce(${finCategories.name}, 'Sem categoria')`, kind: finEntries.kind, total: sql<string>`sum(${finEntries.amount})` })
          .from(finEntries)
          .leftJoin(finCategories, eq(finCategories.id, finEntries.categoryId))
          .where(paidInRange)
          .groupBy(sql`1`, finEntries.kind)
          .orderBy(sql`3 desc`),
      ]);

      const pick = (rows: { kind: EntryKind; total: string; count?: number }[], kind: EntryKind) => {
        const row = rows.find((r) => r.kind === kind);
        return { total: Number(row?.total ?? 0), count: row?.count ?? 0 };
      };
      const months = monthsBetween(from, to).map((month) => {
        const sum = (rows: typeof monthlyPaid, kind: EntryKind) => Number(rows.find((r) => r.month === month && r.kind === kind)?.total ?? 0);
        return {
          month,
          realizedIncome: sum(monthlyPaid, 'income'),
          realizedExpense: sum(monthlyPaid, 'expense'),
          projectedIncome: sum(monthlyPending, 'income'),
          projectedExpense: sum(monthlyPending, 'expense'),
        };
      });

      return {
        period: { from, to },
        realized: { income: pick(realized, 'income').total, expense: pick(realized, 'expense').total },
        projected: { income: pick(projected, 'income').total, expense: pick(projected, 'expense').total },
        overdue: { receivable: pick(overdue, 'income'), payable: pick(overdue, 'expense') },
        months,
        categories: categories.map((c) => ({ name: c.name, kind: c.kind, total: Number(c.total) })),
      };
    });
  }

  async exportCsv(filters: EntryFilters) {
    const { items } = await this.listEntries({ ...filters, limit: 10_000, offset: 0 });
    const statusLabel = { pending: 'Em aberto', paid: 'Pago', cancelled: 'Cancelado' } as const;
    const header = ['Tipo', 'Situação', 'Descrição', 'Valor', 'Vencimento', 'Pagamento', 'Competência', 'Categoria', 'Conta', 'Origem'];
    const lines = items.map((e) =>
      [
        e.kind === 'income' ? 'Receita' : 'Despesa',
        statusLabel[e.status],
        e.description,
        e.amount.toFixed(2).replace('.', ','),
        e.dueDate,
        e.paidAt ?? '',
        e.competenceDate,
        e.categoryName ?? '',
        e.accountName ?? '',
        e.sourceType,
      ]
        .map(csvCell)
        .join(';'),
    );
    // BOM para o Excel abrir com acentos; ";" porque o Excel em pt-BR usa vírgula decimal.
    return '﻿' + [header.join(';'), ...lines].join('\r\n');
  }

  // ---- API para outros módulos (rodam dentro da transação de quem chama) --------------------

  /** Registra um lançamento vindo de outro módulo (ex.: pagamento de uma OS). */
  async recordInTx(tx: Tx, input: SourcedEntryInput) {
    return toEntryDto(await this.insertEntry(tx, input));
  }

  /**
   * Mantém um único "a receber" em aberto por origem com o valor ainda devido.
   * Valor zero ou negativo cancela o pendente (tudo pago ou origem cancelada).
   */
  async syncReceivableInTx(
    tx: Tx,
    input: { sourceType: string; sourceId: string; amountCents: number; description: string; dueDate: string; customerId?: string | null; categoryKey?: string },
  ) {
    const [pending] = await tx
      .select()
      .from(finEntries)
      .where(and(eq(finEntries.sourceType, input.sourceType), eq(finEntries.sourceId, input.sourceId), eq(finEntries.status, 'pending')));

    if (input.amountCents <= 0) {
      if (pending) await tx.update(finEntries).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(finEntries.id, pending.id));
      return;
    }
    if (pending) {
      await tx
        .update(finEntries)
        .set({ amount: centsToDecimal(input.amountCents), description: input.description, dueDate: input.dueDate, customerId: input.customerId })
        .where(eq(finEntries.id, pending.id));
      return;
    }
    await this.insertEntry(tx, {
      kind: 'income',
      status: 'pending',
      amount: centsToNumber(input.amountCents),
      description: input.description,
      dueDate: input.dueDate,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      categoryKey: input.categoryKey ?? 'services',
    });
  }

  /** Contas ativas sem saldo: para quem registra pagamentos e não tem acesso ao financeiro. */
  listAccountsBasic() {
    return this.tdb.run((tx) =>
      tx
        .select({ id: finAccounts.id, name: finAccounts.name, type: finAccounts.type })
        .from(finAccounts)
        .where(eq(finAccounts.active, true))
        .orderBy(sql`${finAccounts.type} = 'cash' desc`, asc(finAccounts.name)),
    );
  }

  async defaultAccountId(tx: Tx): Promise<string | undefined> {
    const [account] = await tx
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .where(eq(finAccounts.active, true))
      .orderBy(sql`${finAccounts.type} = 'cash' desc`, asc(finAccounts.createdAt))
      .limit(1);
    return account?.id;
  }

  // ---- internos -----------------------------------------------------------------------------

  private async insertEntry(tx: Tx, input: EntryInput & { sourceType: string; sourceId?: string; categoryKey?: string }) {
    const { tenantId, userId } = requestContext.requireTenant();
    if (input.status === 'paid' && (!input.paidAt || !input.accountId)) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'Lançamento pago precisa da data de pagamento e da conta' });
    }
    const categoryId = input.categoryId ?? (input.categoryKey ? await this.categoryIdByKey(tx, input.categoryKey) : null);
    const [entry] = await tx
      .insert(finEntries)
      .values({
        tenantId,
        kind: input.kind,
        status: input.status,
        description: input.description,
        amount: centsToDecimal(toCents(input.amount)),
        dueDate: input.dueDate,
        competenceDate: input.competenceDate ?? input.dueDate,
        paidAt: input.status === 'paid' ? input.paidAt : null,
        accountId: input.accountId ?? null,
        categoryId,
        customerId: input.customerId ?? null,
        paymentMethod: input.paymentMethod ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        notes: input.notes ?? null,
        createdBy: userId ?? null,
      })
      .returning();
    return entry!;
  }

  private async categoryIdByKey(tx: Tx, key: string) {
    const [category] = await tx.select({ id: finCategories.id }).from(finCategories).where(eq(finCategories.systemKey, key));
    return category?.id ?? null;
  }

  private async findOrFail(tx: Tx, id: string) {
    const [entry] = await tx.select().from(finEntries).where(eq(finEntries.id, id));
    if (!entry) throw new NotFoundException({ code: 'ENTRY_NOT_FOUND', message: 'Lançamento não encontrado' });
    return entry;
  }

  /** Categorias e conta "Caixa" iniciais. Idempotente: não duplica se já existirem. */
  private async seed(tx: Tx, tenantId: string) {
    const existing = new Set(
      (await tx.select({ key: finCategories.systemKey }).from(finCategories).where(eq(finCategories.tenantId, tenantId))).map((c) => c.key),
    );
    const missing = DEFAULT_CATEGORIES.filter((c) => !existing.has(c.key));
    if (missing.length) {
      await tx.insert(finCategories).values(missing.map((c) => ({ tenantId, name: c.name, kind: c.kind, systemKey: c.key })));
    }
    const [account] = await tx.select({ id: finAccounts.id }).from(finAccounts).where(eq(finAccounts.tenantId, tenantId)).limit(1);
    if (!account) await tx.insert(finAccounts).values({ tenantId, name: 'Caixa', type: 'cash' });
  }
}

type EntryRow = typeof finEntries.$inferSelect;

export function toEntryDto(e: EntryRow) {
  return {
    id: e.id,
    kind: e.kind,
    status: e.status,
    description: e.description,
    amount: Number(e.amount),
    dueDate: e.dueDate,
    competenceDate: e.competenceDate,
    paidAt: e.paidAt,
    accountId: e.accountId,
    categoryId: e.categoryId,
    customerId: e.customerId,
    paymentMethod: e.paymentMethod,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    notes: e.notes,
    createdAt: e.createdAt,
  };
}

function entryFilter(f: EntryFilters): SQL | undefined {
  const dateColumn = { due: finEntries.dueDate, paid: finEntries.paidAt, competence: finEntries.competenceDate }[f.dateField];
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
  return and(
    f.from ? gte(dateColumn, f.from) : undefined,
    f.to ? lte(dateColumn, f.to) : undefined,
    f.status === 'overdue'
      ? and(eq(finEntries.status, 'pending'), sql`${finEntries.dueDate} < ${TODAY}`)
      : f.status
        ? eq(finEntries.status, f.status)
        : undefined,
    f.kind ? eq(finEntries.kind, f.kind) : undefined,
    f.accountId ? eq(finEntries.accountId, f.accountId) : undefined,
    f.categoryId ? eq(finEntries.categoryId, f.categoryId) : undefined,
    f.customerId ? eq(finEntries.customerId, f.customerId) : undefined,
    like ? ilike(finEntries.description, like) : undefined,
  );
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const [ey, em] = to.slice(0, 7).split('-').map(Number) as [number, number];
  while ((y < ey || (y === ey && m <= em)) && out.length < 36) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function csvCell(value: string) {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function conflict(code: string, message: string) {
  return new BadRequestException({ code, message });
}
