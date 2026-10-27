import { AuditService, centsToDecimal, centsToNumber, FinanceService, ModuleSettingsService, nextSequence, TenantDb, toCents } from '@all/core';
import { finAccounts, users } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  registerMoveLabel,
  salePaymentMethods,
  type CloseSessionInput,
  type OpenSessionInput,
  type RegisterInput,
  type RegisterMoveInput,
  type RegistersOverview,
  type RegisterSession,
  type RegisterSessionSummary,
  type RegisterSessionTotal,
  type RegisterUpdate,
  type SalePaymentMethod,
  type SalesSettings,
} from '../contracts';
import { salesPayments, salesRegisterMoves, salesRegisters, salesRegisterSessions, salesSales, type RegisterClosingJson } from '../db/schema';
import { dayEnd, dayStart, localDay } from './dates';

const MODULE = 'shared.sales';
/** Origem dos lançamentos no financeiro. As vendas continuam com a origem 'sale'. */
const SOURCE_MOVE = 'sales_register_move';
const SOURCE_SESSION = 'sales_register_session';

type SessionRow = typeof salesRegisterSessions.$inferSelect;
type Live = { byMethod: Map<SalePaymentMethod, number>; salesCount: number; salesCents: number; withdrawals: number; deposits: number };

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export interface SessionFilters {
  from?: string;
  to?: string;
  registerId?: string;
  status?: 'open' | 'closed';
  /** Só sessões fechadas com quebra ou sobra de dinheiro. */
  withDifference?: boolean;
  limit: number;
}

/**
 * Caixas do PDV e suas sessões: abertura com troco inicial, sangria e suprimento, fechamento
 * conferido (esperado × contado por forma de pagamento). Fechada, a sessão não muda mais.
 *
 * Financeiro: as vendas já lançam a receita (origem 'sale'); aqui só entram o dinheiro que sai
 * ou entra na gaveta sem ser venda (sangria/suprimento) e a quebra/sobra do fechamento.
 */
@Injectable()
export class RegistersService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly finance: FinanceService,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
  ) {}

  // ---- Caixas ---------------------------------------------------------------------------------

  overview(): Promise<RegistersOverview> {
    return this.tdb.run(async (tx) => {
      const settings = await this.settings.getInTx<SalesSettings>(tx, MODULE);
      const opener = aliasedTable(users, 'opener');
      const [registers, accounts, cashAccountId] = await Promise.all([
        tx
          .select({ r: salesRegisters, s: salesRegisterSessions, openedByName: opener.name })
          .from(salesRegisters)
          .leftJoin(salesRegisterSessions, and(eq(salesRegisterSessions.registerId, salesRegisters.id), eq(salesRegisterSessions.status, 'open')))
          .leftJoin(opener, eq(opener.id, salesRegisterSessions.openedBy))
          .orderBy(asc(salesRegisters.name)),
        tx
          .select({ id: finAccounts.id, name: finAccounts.name, type: finAccounts.type })
          .from(finAccounts)
          .where(eq(finAccounts.active, true))
          .orderBy(sql`${finAccounts.type} = 'cash' desc`, asc(finAccounts.name)),
        this.finance.defaultAccountId(tx),
      ]);
      return {
        requireSession: settings.requireRegisterSession,
        registers: registers.map(({ r, s, openedByName }) => ({
          id: r.id,
          name: r.name,
          active: r.active,
          openSession: s ? { id: s.id, number: s.number, openedAt: s.openedAt.toISOString(), openedByName, openingFloat: Number(s.openingFloat) } : null,
        })),
        accounts,
        cashAccountId: cashAccountId ?? null,
      };
    });
  }

  createRegister(input: RegisterInput) {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const [row] = await guardName(() => tx.insert(salesRegisters).values({ tenantId, name: input.name }).returning());
      await this.audit.log(tx, { action: 'sales.register.created', entity: 'sales_register', entityId: row!.id, data: input });
      return { id: row!.id, name: row!.name, active: row!.active, openSession: null };
    });
  }

  updateRegister(id: string, input: RegisterUpdate) {
    return this.tdb.run(async (tx) => {
      const [current] = await tx.select().from(salesRegisters).where(eq(salesRegisters.id, id)).for('update');
      if (!current) throw new NotFoundException({ code: 'REGISTER_NOT_FOUND', message: 'Caixa não encontrado' });
      if (input.active === false && (await this.openSessionOf(tx, id))) {
        throw conflict('REGISTER_OPEN', 'Feche o caixa antes de desativá-lo');
      }
      const [row] = await guardName(() =>
        tx
          .update(salesRegisters)
          .set({ name: input.name ?? current.name, active: input.active ?? current.active })
          .where(eq(salesRegisters.id, id))
          .returning(),
      );
      await this.audit.log(tx, { action: 'sales.register.updated', entity: 'sales_register', entityId: id, data: input });
      return { id: row!.id, name: row!.name, active: row!.active };
    });
  }

  // ---- Sessões --------------------------------------------------------------------------------

  open(input: OpenSessionInput): Promise<RegisterSession> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      // Trava o caixa: duas aberturas simultâneas do mesmo caixa esperam uma pela outra.
      const [register] = await tx.select().from(salesRegisters).where(eq(salesRegisters.id, input.registerId)).for('update');
      if (!register) throw new NotFoundException({ code: 'REGISTER_NOT_FOUND', message: 'Caixa não encontrado' });
      if (!register.active) throw badRequest('REGISTER_INACTIVE', 'Este caixa está desativado');
      if (await this.openSessionOf(tx, register.id)) throw conflict('REGISTER_ALREADY_OPEN', `${register.name} já está aberto`);

      const number = await nextSequence(tx, tenantId, 'register_session');
      const [session] = await tx
        .insert(salesRegisterSessions)
        .values({ tenantId, registerId: register.id, number, openingFloat: centsToDecimal(toCents(input.openingFloat)), openedBy: userId ?? null })
        .returning();
      await this.audit.log(tx, { action: 'sales.register_session.opened', entity: 'sales_register_session', entityId: session!.id, data: { register: register.name, openingFloat: input.openingFloat } });
      return this.detailInTx(tx, session!.id);
    });
  }

  addMove(sessionId: string, input: RegisterMoveInput): Promise<RegisterSession> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const session = await this.lockOpen(tx, sessionId);
      const [register] = await tx.select().from(salesRegisters).where(eq(salesRegisters.id, session.registerId));
      const cents = toCents(input.amount);

      if (input.kind === 'withdrawal') {
        const live = (await this.liveInTx(tx, [session.id])).get(session.id);
        const available = toCents(session.openingFloat) + (live?.byMethod.get('cash') ?? 0) + (live?.deposits ?? 0) - (live?.withdrawals ?? 0);
        if (cents > available) throw badRequest('WITHDRAWAL_OVER', `A sangria passa do dinheiro esperado na gaveta (${brl(available)})`);
      }

      const cashAccount = await this.cashAccountOrFail(tx);
      const other = input.accountId ? await this.accountOrFail(tx, input.accountId) : null;
      if (other && other.id === cashAccount) throw badRequest('SAME_ACCOUNT', 'Escolha outra conta: o dinheiro do caixa já está nesta conta');

      const [move] = await tx
        .insert(salesRegisterMoves)
        .values({ tenantId, sessionId: session.id, kind: input.kind, amount: centsToDecimal(cents), reason: input.reason, accountId: other?.id ?? null, userId: userId ?? null })
        .returning();

      // Com conta do outro lado é transferência (sai de uma conta, entra na outra, sem categoria:
      // não é receita nem despesa). Sem conta, o dinheiro saiu/entrou do negócio.
      const day = localDay(new Date());
      const label = `${registerMoveLabel[input.kind]} ${register!.name} (sessão #${session.number})`;
      const base = { status: 'paid' as const, amount: cents / 100, dueDate: day, paidAt: day, paymentMethod: 'cash', sourceType: SOURCE_MOVE, sourceId: move!.id, notes: input.reason };
      if (input.kind === 'withdrawal') {
        if (other) {
          await this.finance.recordInTx(tx, { ...base, kind: 'expense', description: `${label} → ${other.name}`, accountId: cashAccount });
          await this.finance.recordInTx(tx, { ...base, kind: 'income', description: `${label} ← ${register!.name}`, accountId: other.id });
        } else {
          await this.finance.recordInTx(tx, { ...base, kind: 'expense', description: `${label}: ${input.reason}`, accountId: cashAccount, categoryKey: 'other_expense' });
        }
      } else if (other) {
        await this.finance.recordInTx(tx, { ...base, kind: 'expense', description: `${label} → ${register!.name}`, accountId: other.id });
        await this.finance.recordInTx(tx, { ...base, kind: 'income', description: `${label} ← ${other.name}`, accountId: cashAccount });
      } else {
        await this.finance.recordInTx(tx, { ...base, kind: 'income', description: `${label}: ${input.reason}`, accountId: cashAccount, categoryKey: 'other_income' });
      }

      await this.audit.log(tx, { action: `sales.register_session.${input.kind}`, entity: 'sales_register_session', entityId: session.id, data: { moveId: move!.id, amount: input.amount, reason: input.reason, accountId: other?.id ?? null } });
      return this.detailInTx(tx, session.id);
    });
  }

  close(sessionId: string, input: CloseSessionInput): Promise<RegisterSession> {
    const { userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      // FOR UPDATE espera as vendas em andamento nesta sessão (elas seguram FOR SHARE) e
      // bloqueia as novas até o fechamento confirmar; depois disso elas não acham sessão aberta.
      const session = await this.lockOpen(tx, sessionId);
      const [register] = await tx.select().from(salesRegisters).where(eq(salesRegisters.id, session.registerId));
      const live = (await this.liveInTx(tx, [session.id])).get(session.id)!;
      const counted: Partial<Record<SalePaymentMethod, number | null | undefined>> = input.counted;
      // Dinheiro sempre; as demais formas quando houve venda ou o operador contou alguma coisa.
      const totals = expectedTotals(session, live)
        .filter((t) => t.method === 'cash' || t.expected !== 0 || counted[t.method] != null)
        .map((t) => {
        const value = counted[t.method];
        const countedCents = value == null ? null : toCents(value);
        return { method: t.method, expected: t.expected, counted: countedCents, difference: countedCents === null ? null : countedCents - t.expected };
      });
      const cash = totals.find((t) => t.method === 'cash')!;
      const closing: RegisterClosingJson = {
        totals: totals.map((t) => ({
          method: t.method,
          expected: centsToNumber(t.expected),
          counted: t.counted === null ? null : centsToNumber(t.counted),
          difference: t.difference === null ? null : centsToNumber(t.difference),
        })),
        salesCount: live.salesCount,
        salesTotal: centsToNumber(live.salesCents),
        withdrawals: centsToNumber(live.withdrawals),
        deposits: centsToNumber(live.deposits),
      };

      await tx
        .update(salesRegisterSessions)
        .set({
          status: 'closed',
          closedAt: new Date(),
          closedBy: userId ?? null,
          expectedCash: centsToDecimal(cash.expected),
          countedCash: centsToDecimal(cash.counted!),
          cashDifference: centsToDecimal(cash.difference!),
          closing,
          notes: input.notes || null,
        })
        .where(eq(salesRegisterSessions.id, session.id));

      // Quebra (faltou dinheiro) é despesa; sobra é receita. Diferença em cartão/Pix fica só no
      // relatório: o valor das vendas já foi lançado na conta certa e costuma ser forma trocada.
      if (cash.difference) {
        const day = localDay(new Date());
        const over = cash.difference > 0;
        await this.finance.recordInTx(tx, {
          kind: over ? 'income' : 'expense',
          status: 'paid',
          description: `${over ? 'Sobra' : 'Quebra'} de caixa: ${register!.name} (sessão #${session.number})`,
          amount: Math.abs(cash.difference) / 100,
          dueDate: day,
          paidAt: day,
          accountId: await this.cashAccountOrFail(tx),
          paymentMethod: 'cash',
          sourceType: SOURCE_SESSION,
          sourceId: session.id,
          categoryKey: over ? 'other_income' : 'other_expense',
          notes: input.notes || null,
        });
      }

      await this.audit.log(tx, {
        action: 'sales.register_session.closed',
        entity: 'sales_register_session',
        entityId: session.id,
        data: { expectedCash: centsToNumber(cash.expected), countedCash: centsToNumber(cash.counted!), cashDifference: centsToNumber(cash.difference!) },
      });
      return this.detailInTx(tx, session.id);
    });
  }

  get(id: string): Promise<RegisterSession> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  list(f: SessionFilters): Promise<RegisterSessionSummary[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.sessionRows(tx, f);
      const live = await this.liveInTx(
        tx,
        rows.filter((r) => r.s.status === 'open').map((r) => r.s.id),
      );
      return rows.map((r) => toSummary(r, live.get(r.s.id)));
    });
  }

  /**
   * Sessão em que a venda entra. Com caixa informado, ele precisa estar aberto (a sessão fica
   * travada em FOR SHARE até o fim da transação). Sem caixa, só passa se a empresa não exige caixa.
   * Venda lançada depois (de outro dia) não entra em sessão nenhuma: o dinheiro dela não está na gaveta.
   */
  async sessionForSaleInTx(tx: Tx, opts: { registerId: string | null; required: boolean; soldAt: Date }): Promise<string | null> {
    if (localDay(opts.soldAt) < localDay(new Date())) return null;
    if (opts.registerId) {
      const [session] = await tx
        .select({ id: salesRegisterSessions.id })
        .from(salesRegisterSessions)
        .where(and(eq(salesRegisterSessions.registerId, opts.registerId), eq(salesRegisterSessions.status, 'open')))
        .for('share');
      if (!session) throw conflict('REGISTER_CLOSED', 'Este caixa está fechado. Abra o caixa para vender.');
      return session.id;
    }
    if (opts.required) throw conflict('REGISTER_SESSION_REQUIRED', 'Abra o caixa para vender.');
    return null;
  }

  // ---- internos -------------------------------------------------------------------------------

  private async openSessionOf(tx: Tx, registerId: string) {
    const [row] = await tx
      .select({ id: salesRegisterSessions.id })
      .from(salesRegisterSessions)
      .where(and(eq(salesRegisterSessions.registerId, registerId), eq(salesRegisterSessions.status, 'open')));
    return row;
  }

  private async lockOpen(tx: Tx, id: string): Promise<SessionRow> {
    const [session] = await tx.select().from(salesRegisterSessions).where(eq(salesRegisterSessions.id, id)).for('update');
    if (!session) throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Sessão de caixa não encontrada' });
    if (session.status !== 'open') throw conflict('SESSION_CLOSED', 'Este caixa já foi fechado e não pode mais ser alterado');
    return session;
  }

  private async cashAccountOrFail(tx: Tx): Promise<string> {
    const id = await this.finance.defaultAccountId(tx);
    if (!id) throw badRequest('NO_CASH_ACCOUNT', 'Cadastre uma conta "Caixa" no financeiro');
    return id;
  }

  private async accountOrFail(tx: Tx, id: string) {
    const [account] = await tx.select({ id: finAccounts.id, name: finAccounts.name }).from(finAccounts).where(and(eq(finAccounts.id, id), eq(finAccounts.active, true)));
    if (!account) throw badRequest('ACCOUNT_NOT_FOUND', 'Conta do financeiro não encontrada');
    return account;
  }

  /** Vendas concluídas por forma de pagamento, sangrias e suprimentos das sessões (em centavos). */
  private async liveInTx(tx: Tx, ids: string[]): Promise<Map<string, Live>> {
    const out = new Map<string, Live>();
    if (!ids.length) return out;
    for (const id of ids) out.set(id, { byMethod: new Map(), salesCount: 0, salesCents: 0, withdrawals: 0, deposits: 0 });
    const completed = and(inArray(salesSales.registerSessionId, ids), eq(salesSales.status, 'completed'));
    const [payments, sales, moves] = await Promise.all([
      tx
        .select({ sessionId: salesSales.registerSessionId, method: salesPayments.method, amount: sql<string>`sum(${salesPayments.amount})` })
        .from(salesPayments)
        .innerJoin(salesSales, eq(salesSales.id, salesPayments.saleId))
        .where(completed)
        .groupBy(salesSales.registerSessionId, salesPayments.method),
      tx
        .select({ sessionId: salesSales.registerSessionId, count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${salesSales.total}), 0)` })
        .from(salesSales)
        .where(completed)
        .groupBy(salesSales.registerSessionId),
      tx
        .select({ sessionId: salesRegisterMoves.sessionId, kind: salesRegisterMoves.kind, amount: sql<string>`sum(${salesRegisterMoves.amount})` })
        .from(salesRegisterMoves)
        .where(inArray(salesRegisterMoves.sessionId, ids))
        .groupBy(salesRegisterMoves.sessionId, salesRegisterMoves.kind),
    ]);
    for (const p of payments) out.get(p.sessionId!)?.byMethod.set(p.method, toCents(p.amount));
    for (const s of sales) {
      const live = out.get(s.sessionId!);
      if (live) Object.assign(live, { salesCount: s.count, salesCents: toCents(s.total) });
    }
    for (const m of moves) {
      const live = out.get(m.sessionId);
      if (live) live[m.kind === 'withdrawal' ? 'withdrawals' : 'deposits'] = toCents(m.amount);
    }
    return out;
  }

  private sessionRows(tx: Tx, f: Partial<SessionFilters> & { ids?: string[] }) {
    const opener = aliasedTable(users, 'opener');
    const closer = aliasedTable(users, 'closer');
    return tx
      .select({ s: salesRegisterSessions, register: { id: salesRegisters.id, name: salesRegisters.name }, openedByName: opener.name, closedByName: closer.name })
      .from(salesRegisterSessions)
      .innerJoin(salesRegisters, eq(salesRegisters.id, salesRegisterSessions.registerId))
      .leftJoin(opener, eq(opener.id, salesRegisterSessions.openedBy))
      .leftJoin(closer, eq(closer.id, salesRegisterSessions.closedBy))
      .where(
        and(
          f.ids ? inArray(salesRegisterSessions.id, f.ids) : undefined,
          f.from ? gte(salesRegisterSessions.openedAt, dayStart(f.from)) : undefined,
          f.to ? lt(salesRegisterSessions.openedAt, dayEnd(f.to)) : undefined,
          f.registerId ? eq(salesRegisterSessions.registerId, f.registerId) : undefined,
          f.status ? eq(salesRegisterSessions.status, f.status) : undefined,
          f.withDifference ? and(eq(salesRegisterSessions.status, 'closed'), ne(salesRegisterSessions.cashDifference, '0')) : undefined,
        ),
      )
      .orderBy(desc(salesRegisterSessions.openedAt), desc(salesRegisterSessions.number))
      .limit(f.limit ?? f.ids?.length ?? 1);
  }

  private async detailInTx(tx: Tx, id: string): Promise<RegisterSession> {
    const [row] = await this.sessionRows(tx, { ids: [id] });
    if (!row) throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Sessão de caixa não encontrada' });
    const live = row.s.status === 'open' ? (await this.liveInTx(tx, [id])).get(id) : undefined;
    const mover = aliasedTable(users, 'mover');
    const [moves, sales] = await Promise.all([
      tx
        .select({ m: salesRegisterMoves, accountName: finAccounts.name, userName: mover.name })
        .from(salesRegisterMoves)
        .leftJoin(finAccounts, eq(finAccounts.id, salesRegisterMoves.accountId))
        .leftJoin(mover, eq(mover.id, salesRegisterMoves.userId))
        .where(eq(salesRegisterMoves.sessionId, id))
        .orderBy(asc(salesRegisterMoves.createdAt), asc(salesRegisterMoves.id)),
      tx
        .select({ id: salesSales.id, number: salesSales.number, soldAt: salesSales.soldAt, status: salesSales.status, total: salesSales.total })
        .from(salesSales)
        .where(eq(salesSales.registerSessionId, id))
        .orderBy(asc(salesSales.number)),
    ]);
    const payments = sales.length
      ? await tx
          .select({ saleId: salesPayments.saleId, method: salesPayments.method, amount: salesPayments.amount })
          .from(salesPayments)
          .where(inArray(salesPayments.saleId, sales.map((s) => s.id)))
          .orderBy(asc(salesPayments.id))
      : [];

    const totals: RegisterSessionTotal[] = row.s.closing
      ? row.s.closing.totals
      : expectedTotals(row.s, live!)
          .filter((t) => t.method === 'cash' || t.expected !== 0)
          .map((t) => ({ method: t.method, expected: centsToNumber(t.expected), counted: null, difference: null }));
    return {
      ...toSummary(row, live),
      totals,
      moves: moves.map(({ m, accountName, userName }) => ({
        id: m.id,
        kind: m.kind,
        amount: Number(m.amount),
        reason: m.reason,
        accountName,
        userName,
        createdAt: m.createdAt.toISOString(),
      })),
      sales: sales.map((s) => ({
        id: s.id,
        number: s.number,
        soldAt: s.soldAt.toISOString(),
        status: s.status,
        total: Number(s.total),
        payments: payments.filter((p) => p.saleId === s.id).map((p) => ({ method: p.method, amount: Number(p.amount) })),
      })),
    };
  }
}

/**
 * Esperado por forma (centavos), na ordem do PDV. Dinheiro: troco inicial + vendas em dinheiro
 * (já sem o troco devolvido) + suprimentos − sangrias. Demais: soma das vendas concluídas.
 */
function expectedTotals(session: SessionRow, live: Live) {
  return salePaymentMethods.map((method) => ({
    method,
    expected:
      method === 'cash'
        ? toCents(session.openingFloat) + (live.byMethod.get('cash') ?? 0) + live.deposits - live.withdrawals
        : (live.byMethod.get(method) ?? 0),
  }));
}

type SummaryRow = { s: SessionRow; register: { id: string; name: string }; openedByName: string | null; closedByName: string | null };

function toSummary({ s, register, openedByName, closedByName }: SummaryRow, live: Live | undefined): RegisterSessionSummary {
  // Fechada: números do retrato do fechamento (uma venda cancelada depois não muda o relatório).
  const c = s.closing;
  const openingCents = toCents(s.openingFloat);
  const expectedCash = c
    ? Number(s.expectedCash)
    : centsToNumber(openingCents + (live?.byMethod.get('cash') ?? 0) + (live?.deposits ?? 0) - (live?.withdrawals ?? 0));
  return {
    id: s.id,
    number: s.number,
    register,
    status: s.status,
    openingFloat: centsToNumber(openingCents),
    openedAt: s.openedAt.toISOString(),
    openedByName,
    closedAt: s.closedAt?.toISOString() ?? null,
    closedByName,
    salesCount: c ? c.salesCount : (live?.salesCount ?? 0),
    salesTotal: c ? c.salesTotal : centsToNumber(live?.salesCents ?? 0),
    withdrawals: c ? c.withdrawals : centsToNumber(live?.withdrawals ?? 0),
    deposits: c ? c.deposits : centsToNumber(live?.deposits ?? 0),
    expectedCash,
    countedCash: s.countedCash === null ? null : Number(s.countedCash),
    cashDifference: s.cashDifference === null ? null : Number(s.cashDifference),
    notes: s.notes,
  };
}

async function guardName<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
    if (code === '23505') throw new ConflictException({ code: 'REGISTER_NAME_TAKEN', message: 'Já existe um caixa com este nome' });
    throw err;
  }
}
