import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, gt, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { financeSourceLabel } from './source-labels';
import { AuditService } from '../audit/audit.service';
import { centsToDecimal, centsToNumber, toCents } from '../common/money';
import { CustomerDataRegistry } from '../customers/customer-data.registry';
import { customers } from '../customers/schema';
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

export type EntryUpdate = Partial<Pick<EntryInput, 'description' | 'amount' | 'dueDate' | 'competenceDate' | 'accountId' | 'categoryId' | 'customerId' | 'notes'>>;

/** Lançamento gerado por outro módulo. A categoria pode vir pela chave do sistema (ex.: 'services'). */
export interface SourcedEntryInput extends EntryInput {
  sourceType: string;
  sourceId: string;
  categoryKey?: string;
  /** O módulo não registra o pagamento: a baixa (e só ela) fica com o financeiro. */
  settleInFinance?: boolean;
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
      const before = await this.accountOrFail(tx, id);
      const [account] = await tx.update(finAccounts).set(input).where(eq(finAccounts.id, id)).returning();
      await this.audit.log(tx, { action: 'finance.account.updated', entity: 'fin_account', entityId: id, data: { ...input, previousName: before.name } });
      return account!;
    });
  }

  /**
   * Corrige o saldo inicial informado errado. Não vira lançamento: receita ou despesa de ajuste
   * sujaria o resultado com dinheiro que não entrou nem saiu. O valor anterior, o novo e o motivo
   * ficam na auditoria e no histórico da conta.
   */
  correctInitialBalance(id: string, input: { initialBalance: number; reason: string }) {
    return this.tdb.run(async (tx) => {
      const before = await this.accountOrFail(tx, id);
      const next = centsToDecimal(toCents(input.initialBalance));
      if (toCents(before.initialBalance) === toCents(next)) throw conflict('SAME_BALANCE', 'O saldo inicial já é esse valor');
      const [account] = await tx.update(finAccounts).set({ initialBalance: next }).where(eq(finAccounts.id, id)).returning();
      await this.audit.log(tx, {
        action: 'finance.account.initial_balance_corrected',
        entity: 'fin_account',
        entityId: id,
        data: { from: Number(before.initialBalance), to: input.initialBalance, reason: input.reason },
      });
      return account!;
    });
  }

  accountHistory(id: string) {
    return this.audit.forEntity('fin_account', id);
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
      // O rodapé só soma cancelados quando a pessoa pediu para ver os cancelados.
      const counted = filters.status === 'cancelled' ? sql`true` : sql`${finEntries.status} <> 'cancelled'`;
      const [rows, [totals]] = await Promise.all([
        tx
          .select({ entry: finEntries, categoryName: category.name, accountName: account.name, customerName: customers.name })
          .from(finEntries)
          .leftJoin(category, eq(category.id, finEntries.categoryId))
          .leftJoin(account, eq(account.id, finEntries.accountId))
          .leftJoin(customers, eq(customers.id, finEntries.customerId))
          .where(where)
          .orderBy(desc(finEntries.dueDate), desc(finEntries.createdAt))
          .limit(filters.limit)
          .offset(filters.offset),
        tx
          .select({
            total: count(),
            income: sql<string>`coalesce(sum(${finEntries.amount}) filter (where ${finEntries.kind} = 'income' and ${counted}), 0)`,
            expense: sql<string>`coalesce(sum(${finEntries.amount}) filter (where ${finEntries.kind} = 'expense' and ${counted}), 0)`,
          })
          .from(finEntries)
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({ ...toEntryDto(r.entry), categoryName: r.categoryName, accountName: r.accountName, customerName: r.customerName })),
        total: totals!.total,
        sums: { income: Number(totals!.income), expense: Number(totals!.expense) },
      };
    });
  }

  createEntry(input: EntryInput) {
    return this.tdb.run(async (tx) => {
      await this.assertRefs(tx, input.kind, input);
      const entry = await this.insertEntry(tx, { ...input, sourceType: 'manual' });
      await this.audit.log(tx, { action: 'finance.entry.created', entity: 'fin_entry', entityId: entry.id, data: input });
      return toEntryDto(entry);
    });
  }

  /**
   * Edição, com o que é seguro em cada caso (ADR-039):
   * - manual em aberto: tudo;
   * - manual pago: não muda valor nem conta, que mexem no saldo; é preciso estornar a baixa antes;
   * - de módulo: categoria e observações, e a conta enquanto em aberto. O resto pertence à origem
   *   (ADR-010), e o módulo recalcularia ou deixaria de reconhecer o valor.
   * Pedir uma mudança proibida é recusado, em vez de ser ignorado em silêncio. A auditoria guarda o
   * valor anterior e o novo de cada campo.
   */
  updateEntry(id: string, input: EntryUpdate) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.status === 'cancelled') throw conflict('ENTRY_CANCELLED', 'Lançamento cancelado não pode ser editado');

      const fromModule = current.sourceType !== 'manual';
      const changes = changedFields(current, input);
      const blocked = (field: keyof EntryUpdate) => field in changes;
      if (fromModule && (['description', 'amount', 'dueDate', 'competenceDate', 'customerId'] as const).some(blocked)) {
        throw conflict('ENTRY_FROM_MODULE', 'Valor, descrição, datas e cliente deste lançamento são controlados por outro módulo: corrija por lá');
      }
      if (current.status === 'paid' && (['amount', 'accountId'] as const).some(blocked)) {
        throw conflict('ENTRY_PAID_LOCKED', 'Lançamento pago: estorne a baixa antes de mudar o valor ou a conta');
      }
      await this.assertRefs(tx, current.kind, input);

      const { amount, ...rest } = input;
      const [entry] = await tx
        .update(finEntries)
        .set({ ...stripUndefined(rest), ...(amount !== undefined ? { amount: centsToDecimal(toCents(amount)) } : {}) })
        .where(eq(finEntries.id, id))
        .returning();
      await this.audit.log(tx, { action: 'finance.entry.updated', entity: 'fin_entry', entityId: id, data: { changes } });
      return toEntryDto(entry!);
    });
  }

  /** Baixa: o dinheiro entrou/saiu. */
  pay(id: string, input: { paidAt: string; accountId: string; paymentMethod?: string | null }) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.status !== 'pending') throw conflict('ENTRY_NOT_PENDING', 'Só lançamentos em aberto podem receber baixa');
      if (current.sourceType !== 'manual' && !current.settleInFinance) {
        throw conflict('ENTRY_FROM_MODULE', 'Este valor é controlado por outro módulo: registre o pagamento por lá');
      }
      await this.assertRefs(tx, current.kind, { accountId: input.accountId });
      const [entry] = await tx
        .update(finEntries)
        .set({ status: 'paid', paidAt: input.paidAt, accountId: input.accountId, paymentMethod: input.paymentMethod ?? null })
        .where(eq(finEntries.id, id))
        .returning();
      await this.audit.log(tx, { action: 'finance.entry.paid', entity: 'fin_entry', entityId: id, data: input });
      return toEntryDto(entry!);
    });
  }

  /**
   * Estorno da baixa: o lançamento volta a ficar em aberto e o dinheiro sai do saldo da conta. Só o
   * que recebe baixa aqui: em ordem, agenda e PDV, o pagamento é do módulo de origem. A data, a conta
   * e a forma do pagamento desfeito ficam na auditoria, com o motivo.
   */
  reversePayment(id: string, input: { reason: string }) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.status !== 'paid') throw conflict('ENTRY_NOT_PAID', 'Só lançamentos pagos podem ter a baixa estornada');
      if (current.sourceType !== 'manual' && !current.settleInFinance) {
        throw conflict('ENTRY_FROM_MODULE', 'Este pagamento é controlado por outro módulo: desfaça por lá');
      }
      const [entry] = await tx.update(finEntries).set({ status: 'pending', paidAt: null, accountId: null, paymentMethod: null }).where(eq(finEntries.id, id)).returning();
      await this.audit.log(tx, {
        action: 'finance.entry.payment_reversed',
        entity: 'fin_entry',
        entityId: id,
        data: { reason: input.reason, amount: Number(current.amount), paidAt: current.paidAt, accountId: current.accountId, paymentMethod: current.paymentMethod },
      });
      return toEntryDto(entry!);
    });
  }

  /** Só o que está em aberto: pago passa antes pelo estorno, para o saldo não mudar sem rastro. */
  cancel(id: string, input: { reason?: string | null } = {}) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.sourceType !== 'manual') {
        throw conflict('ENTRY_FROM_MODULE', 'Este valor é controlado por outro módulo: cancele por lá');
      }
      if (current.status === 'cancelled') return;
      if (current.status === 'paid') throw conflict('ENTRY_PAID', 'Estorne a baixa antes de cancelar este lançamento');
      await tx.update(finEntries).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(finEntries.id, id));
      await this.audit.log(tx, { action: 'finance.entry.cancelled', entity: 'fin_entry', entityId: id, data: input.reason ? { reason: input.reason } : undefined });
    });
  }

  /** Histórico do lançamento: criação, edições, baixas e estornos. */
  async entryHistory(id: string) {
    await this.tdb.run((tx) => this.findOrFail(tx, id));
    return this.audit.forEntity('fin_entry', id);
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
        e.sourceLabel,
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
   * Cancela o que ainda está em aberto de uma origem (ex.: parcelas de um contrato encerrado).
   * Com `dueAfter`, só as que vencem depois dessa data.
   */
  async cancelPendingBySourceInTx(tx: Tx, sourceType: string, sourceId: string, opts: { dueAfter?: string } = {}): Promise<number> {
    const rows = await tx
      .update(finEntries)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(
        and(
          eq(finEntries.sourceType, sourceType),
          eq(finEntries.sourceId, sourceId),
          eq(finEntries.status, 'pending'),
          opts.dueAfter ? gt(finEntries.dueDate, opts.dueAfter) : undefined,
        ),
      )
      .returning({ id: finEntries.id });
    return rows.length;
  }

  /** Estorno de uma origem (ex.: venda cancelada): cancela tudo, inclusive o que já estava pago. */
  async cancelAllBySourceInTx(tx: Tx, sourceType: string, sourceId: string): Promise<number> {
    const rows = await tx
      .update(finEntries)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(and(eq(finEntries.sourceType, sourceType), eq(finEntries.sourceId, sourceId), inArray(finEntries.status, ['pending', 'paid'])))
      .returning({ id: finEntries.id });
    return rows.length;
  }

  /** Lançamentos de uma ou mais origens (ex.: parcelas de tratamentos), por vencimento. */
  async listBySourceInTx(tx: Tx, sourceType: string, sourceIds: string | string[]) {
    const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
    if (!ids.length) return [];
    const rows = await tx
      .select()
      .from(finEntries)
      .where(and(eq(finEntries.sourceType, sourceType), inArray(finEntries.sourceId, ids)))
      .orderBy(asc(finEntries.dueDate), asc(finEntries.id));
    return rows.map(toEntryDto);
  }

  /** Lançamentos de uma origem ligados a um cliente, do vencimento mais novo para o mais antigo (ex.: honorários de uma empresa). */
  async listBySourceForCustomerInTx(tx: Tx, sourceType: string, customerId: string) {
    const rows = await tx
      .select()
      .from(finEntries)
      .where(and(eq(finEntries.sourceType, sourceType), eq(finEntries.customerId, customerId)))
      .orderBy(desc(finEntries.dueDate), desc(finEntries.createdAt))
      .limit(200);
    return rows.map(toEntryDto);
  }

  /**
   * Correção, pelo módulo de origem, de um lançamento dele ainda em aberto. Pago é recusado: o estorno
   * vem antes. Devolve o antes e o depois; a auditoria, com o motivo, é de quem chama.
   */
  async correctPendingBySourceInTx(tx: Tx, sourceType: string, entryId: string, patch: { amount?: number; dueDate?: string; description?: string }) {
    const before = await this.pendingOfSource(tx, sourceType, entryId);
    const { amount, ...rest } = stripUndefined(patch);
    const [after] = await tx
      .update(finEntries)
      .set({ ...rest, ...(amount !== undefined ? { amount: centsToDecimal(toCents(amount)) } : {}) })
      .where(eq(finEntries.id, entryId))
      .returning();
    return { before: toEntryDto(before), after: toEntryDto(after!) };
  }

  /** Cancela, pelo módulo de origem, um lançamento dele ainda em aberto (a auditoria é de quem chama). */
  async cancelPendingOneBySourceInTx(tx: Tx, sourceType: string, entryId: string) {
    const before = await this.pendingOfSource(tx, sourceType, entryId);
    await tx.update(finEntries).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(finEntries.id, entryId));
    return toEntryDto(before);
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

  private async insertEntry(tx: Tx, input: EntryInput & { sourceType: string; sourceId?: string; categoryKey?: string; settleInFinance?: boolean }) {
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
        settleInFinance: input.sourceType !== 'manual' && (input.settleInFinance ?? false),
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

  private async pendingOfSource(tx: Tx, sourceType: string, entryId: string) {
    const entry = await this.findOrFail(tx, entryId);
    if (entry.sourceType !== sourceType) throw new NotFoundException({ code: 'ENTRY_NOT_FOUND', message: 'Lançamento não encontrado' });
    if (entry.status === 'paid') throw conflict('ENTRY_PAID', 'Este lançamento já foi pago: estorne a baixa no financeiro antes');
    if (entry.status !== 'pending') throw conflict('ENTRY_CANCELLED', 'Este lançamento já foi cancelado');
    return entry;
  }

  private async accountOrFail(tx: Tx, id: string) {
    const [account] = await tx.select().from(finAccounts).where(eq(finAccounts.id, id));
    if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Conta não encontrada' });
    return account;
  }

  /**
   * Conta, categoria e cliente precisam ser desta empresa (a FK não passa pelo RLS) e a categoria
   * precisa ser do mesmo tipo do lançamento.
   */
  private async assertRefs(tx: Tx, kind: EntryKind, refs: { accountId?: string | null; categoryId?: string | null; customerId?: string | null }) {
    if (refs.accountId) await this.accountOrFail(tx, refs.accountId);
    if (refs.categoryId) {
      const [category] = await tx.select({ kind: finCategories.kind }).from(finCategories).where(eq(finCategories.id, refs.categoryId));
      if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Categoria não encontrada' });
      if (category.kind !== kind) throw conflict('CATEGORY_KIND', kind === 'income' ? 'Escolha uma categoria de receita' : 'Escolha uma categoria de despesa');
    }
    if (refs.customerId) {
      const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, refs.customerId));
      if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado' });
    }
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
    /** Nome da origem em português (tela e planilha). */
    sourceLabel: financeSourceLabel(e.sourceType),
    sourceId: e.sourceId,
    settleInFinance: e.settleInFinance,
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
    // A busca acha pela descrição ou pelo nome do cliente: parcelas iguais de clientes diferentes se distinguem.
    like ? or(ilike(finEntries.description, like), sql`exists (select 1 from ${customers} c where c.id = ${finEntries.customerId} and c.name ilike ${like})`) : undefined,
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

/** Só o que muda de fato: mandar o valor atual de um campo travado não é tentar alterá-lo. */
function changedFields(current: EntryRow, input: EntryUpdate): Partial<Record<keyof EntryUpdate, { from: unknown; to: unknown }>> {
  const out: Partial<Record<keyof EntryUpdate, { from: unknown; to: unknown }>> = {};
  for (const key of Object.keys(input) as (keyof EntryUpdate)[]) {
    const to = input[key];
    if (to === undefined) continue;
    const from = current[key] ?? null;
    const same = key === 'amount' ? toCents(String(from)) === toCents(to as number) : from === (to ?? null);
    if (!same) out[key] = { from: key === 'amount' ? Number(from) : from, to: to ?? null };
  }
  return out;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function conflict(code: string, message: string) {
  return new BadRequestException({ code, message });
}
