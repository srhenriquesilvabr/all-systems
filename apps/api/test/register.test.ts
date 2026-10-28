import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface Entry {
  sourceType: string;
  sourceId: string;
  kind: 'income' | 'expense';
  status: string;
  amount: number;
  accountId: string | null;
  categoryId: string | null;
  dueDate: string;
  paidAt: string | null;
}

describe('caixa do PDV: abertura, sangria/suprimento e fechamento', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function bakery() {
    const s = await ownerSession(t, ['bakery']);
    const { body: products } = await s.as('get', '/sales/products').expect(200);
    const product = (name: string) => products.find((p: { name: string }) => p.name === name);
    const entries = async () => (await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as Entry[];
    const categoryKey = async (id: string | null) => {
      const { body } = await s.as('get', '/finance/categories').expect(200);
      return body.find((c: { id: string }) => c.id === id)?.systemKey ?? null;
    };
    return { ...s, product, entries, categoryKey };
  }

  async function inviteAndLogin(s: Awaited<ReturnType<typeof bakery>>, roleKeys: string[]) {
    const roles = await s.as('get', '/access/roles').expect(200);
    const roleIds = roleKeys.map((k) => roles.body.find((r: { key: string }) => r.key === k).id);
    const email = uniqueEmail('caixa');
    await s.as('post', '/users/invite').send({ email, name: 'Operador', roleIds }).expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Operador' }).expect(204);
    const session = await login(t, email);
    return (method: 'get' | 'post' | 'patch' | 'put', path: string) => t.http()[method](`/api${path}`).set(auth(session.token));
  }

  it('abre, vende na sessão, faz sangria e suprimento, fecha com quebra e lança no financeiro', async () => {
    const s = await bakery();
    const milk = s.product('Leite integral 1 L');

    const { body: empty } = await s.as('get', '/sales/registers').expect(200);
    expect(empty).toMatchObject({ requireSession: false, registers: [] });
    const cashAccountId = empty.cashAccountId as string;
    expect(cashAccountId).toBeTruthy();

    const { body: register } = await s.as('post', '/sales/registers').send({ name: 'Caixa 1' }).expect(201);
    expect((await s.as('post', '/sales/registers').send({ name: 'Caixa 1' }).expect(409)).body.code).toBe('REGISTER_NAME_TAKEN');

    // Abertura com troco inicial; o mesmo caixa não abre duas vezes.
    const { body: opened } = await s.as('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 100 }).expect(201);
    expect(opened).toMatchObject({ status: 'open', openingFloat: 100, expectedCash: 100, register: { id: register.id, name: 'Caixa 1' } });
    expect(opened.totals).toEqual([{ method: 'cash', expected: 100, counted: null, difference: null }]);
    expect((await s.as('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 50 }).expect(409)).body.code).toBe('REGISTER_ALREADY_OPEN');
    const { body: overview } = await s.as('get', '/sales/registers').expect(200);
    expect(overview.registers).toEqual([expect.objectContaining({ id: register.id, openSession: expect.objectContaining({ id: opened.id, openingFloat: 100 }) })]);

    // Vendas no caixa: dinheiro com troco (entra só o líquido) e Pix. Uma cancelada não conta.
    const sell = (body: Record<string, unknown>) => s.as('post', '/sales').send({ items: [{ productId: milk.id, quantity: 2 }], ...body });
    const { body: cashSale } = await sell({ registerId: register.id, payments: [{ method: 'cash', amount: 20 }] }).expect(201);
    expect(cashSale).toMatchObject({ registerSessionId: opened.id, total: 10.98, change: 9.02 });
    const { body: pixSale } = await sell({ registerId: register.id, items: [{ productId: milk.id, quantity: 1 }], payments: [{ method: 'pix', amount: 5.49 }] }).expect(201);
    expect(pixSale.registerSessionId).toBe(opened.id);
    const { body: cancelled } = await sell({ registerId: register.id, payments: [{ method: 'cash', amount: 10.98 }] }).expect(201);
    await s.as('post', `/sales/${cancelled.id}/cancel`).send({ reason: 'Cliente desistiu' }).expect(201);
    // Sem caixa (não exigido): vende fora da sessão.
    const { body: loose } = await sell({ payments: [{ method: 'cash', amount: 10.98 }] }).expect(201);
    expect(loose.registerSessionId).toBeNull();

    // Sangria sem conta = despesa; suprimento vindo do banco = transferência (duas pontas).
    const { body: bank } = await s.as('post', '/finance/accounts').send({ name: 'Banco', type: 'bank', initialBalance: 0 }).expect(201);
    const { body: afterWithdrawal } = await s
      .as('post', `/sales/registers/sessions/${opened.id}/moves`)
      .send({ kind: 'withdrawal', amount: 50, reason: 'Pagamento do entregador' })
      .expect(201);
    const { body: afterDeposit } = await s
      .as('post', `/sales/registers/sessions/${opened.id}/moves`)
      .send({ kind: 'deposit', amount: 30, reason: 'Reforço de troco', accountId: bank.id })
      .expect(201);
    expect(afterDeposit.moves.map((m: { kind: string; amount: number; accountName: string | null }) => [m.kind, m.amount, m.accountName])).toEqual([
      ['withdrawal', 50, null],
      ['deposit', 30, 'Banco'],
    ]);
    const tooMuch = await s.as('post', `/sales/registers/sessions/${opened.id}/moves`).send({ kind: 'withdrawal', amount: 1000, reason: 'Excesso' }).expect(400);
    expect(tooMuch.body.code).toBe('WITHDRAWAL_OVER');
    expect((await s.as('post', `/sales/registers/sessions/${opened.id}/moves`).send({ kind: 'deposit', amount: 5, reason: 'Mesma conta', accountId: cashAccountId }).expect(400)).body.code).toBe(
      'SAME_ACCOUNT',
    );

    const all = await s.entries();
    const withdrawalId = afterWithdrawal.moves[0].id;
    const depositId = afterDeposit.moves[1].id;
    const withdrawalEntries = all.filter((e) => e.sourceId === withdrawalId);
    expect(withdrawalEntries).toEqual([expect.objectContaining({ sourceType: 'sales_register_move', kind: 'expense', status: 'paid', amount: 50, accountId: cashAccountId })]);
    expect(await s.categoryKey(withdrawalEntries[0]!.categoryId)).toBe('other_expense');
    const depositEntries = all.filter((e) => e.sourceId === depositId);
    expect(depositEntries.map((e) => [e.kind, e.amount, e.accountId, e.categoryId]).sort()).toEqual(
      [
        ['expense', 30, bank.id, null],
        ['income', 30, cashAccountId, null],
      ].sort(),
    );
    // A receita das vendas continua só com a origem 'sale' (nada duplicado pelo caixa).
    expect(all.filter((e) => e.sourceId === cashSale.id)).toEqual([expect.objectContaining({ sourceType: 'sale', amount: 10.98 })]);

    // Esperado: 100 + 10,98 (dinheiro líquido) + 30 − 50 = 90,98; Pix 5,49.
    const { body: live } = await s.as('get', `/sales/registers/sessions/${opened.id}`).expect(200);
    expect(live).toMatchObject({ salesCount: 2, salesTotal: 16.47, withdrawals: 50, deposits: 30, expectedCash: 90.98 });
    expect(live.totals).toEqual([
      { method: 'cash', expected: 90.98, counted: null, difference: null },
      { method: 'pix', expected: 5.49, counted: null, difference: null },
    ]);
    expect(live.sales.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([
      [cashSale.id, 'completed'],
      [pixSale.id, 'completed'],
      [cancelled.id, 'cancelled'],
    ]);

    // Fechamento: faltaram R$ 2,00 no dinheiro (quebra); Pix conferido sem diferença.
    const { body: closed } = await s
      .as('post', `/sales/registers/sessions/${opened.id}/close`)
      .send({ counted: { cash: 88.98, pix: 5.49 }, notes: 'Conferido com o gerente' })
      .expect(201);
    expect(closed).toMatchObject({ status: 'closed', expectedCash: 90.98, countedCash: 88.98, cashDifference: -2, notes: 'Conferido com o gerente' });
    expect(closed.closedAt).toBeTruthy();
    expect(closed.totals).toEqual([
      { method: 'cash', expected: 90.98, counted: 88.98, difference: -2 },
      { method: 'pix', expected: 5.49, counted: 5.49, difference: 0 },
    ]);
    const shortage = (await s.entries()).filter((e) => e.sourceId === opened.id);
    expect(shortage).toEqual([expect.objectContaining({ sourceType: 'sales_register_session', kind: 'expense', status: 'paid', amount: 2, accountId: cashAccountId })]);
    expect(await s.categoryKey(shortage[0]!.categoryId)).toBe('other_expense');

    // Fechada é imutável e não recebe venda; o caixa pode abrir de novo.
    expect((await s.as('post', `/sales/registers/sessions/${opened.id}/moves`).send({ kind: 'deposit', amount: 1, reason: 'Depois' }).expect(409)).body.code).toBe('SESSION_CLOSED');
    expect((await s.as('post', `/sales/registers/sessions/${opened.id}/close`).send({ counted: { cash: 1 } }).expect(409)).body.code).toBe('SESSION_CLOSED');
    expect((await sell({ registerId: register.id, payments: [{ method: 'cash', amount: 10.98 }] }).expect(409)).body.code).toBe('REGISTER_CLOSED');
    const { body: reopened } = await s.as('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 88.98 }).expect(201);
    expect(reopened.number).toBe(opened.number + 1);

    // Uma venda cancelada depois do fechamento não muda o relatório fechado.
    await s.as('post', `/sales/${pixSale.id}/cancel`).send({ reason: 'Estorno' }).expect(201);
    const { body: frozen } = await s.as('get', `/sales/registers/sessions/${opened.id}`).expect(200);
    expect(frozen).toMatchObject({ salesTotal: 16.47, cashDifference: -2 });
    expect(frozen.totals).toEqual(closed.totals);

    // Histórico com filtros.
    const { body: history } = await s.as('get', `/sales/registers/sessions?from=${localToday()}&to=${localToday()}`).expect(200);
    expect(history.map((h: { id: string }) => h.id)).toEqual([reopened.id, opened.id]);
    const { body: withDiff } = await s.as('get', '/sales/registers/sessions?withDifference=true').expect(200);
    expect(withDiff.map((h: { id: string }) => h.id)).toEqual([opened.id]);
    const { body: openOnes } = await s.as('get', `/sales/registers/sessions?status=open&registerId=${register.id}`).expect(200);
    expect(openOnes.map((h: { id: string }) => h.id)).toEqual([reopened.id]);
  });

  it('sobra de caixa vira receita', async () => {
    const s = await bakery();
    const { body: register } = await s.as('post', '/sales/registers').send({ name: 'Balcão' }).expect(201);
    const { body: opened } = await s.as('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 50 }).expect(201);
    const { body: closed } = await s.as('post', `/sales/registers/sessions/${opened.id}/close`).send({ counted: { cash: 51.5 } }).expect(201);
    expect(closed).toMatchObject({ cashDifference: 1.5, countedCash: 51.5, expectedCash: 50 });
    const entries = (await s.entries()).filter((e) => e.sourceId === opened.id);
    expect(entries).toEqual([expect.objectContaining({ kind: 'income', amount: 1.5, status: 'paid' })]);
    expect(await s.categoryKey(entries[0]!.categoryId)).toBe('other_income');

    // Sem diferença, nada no financeiro.
    const { body: again } = await s.as('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 51.5 }).expect(201);
    await s.as('post', `/sales/registers/sessions/${again.id}/close`).send({ counted: { cash: 51.5 } }).expect(201);
    expect((await s.entries()).filter((e) => e.sourceId === again.id)).toEqual([]);
  });

  it('com a exigência ligada, só vende com caixa aberto (venda de outro dia passa sem sessão)', async () => {
    const s = await bakery();
    const milk = s.product('Leite integral 1 L');
    const sell = (body: Record<string, unknown>) => s.as('post', '/sales').send({ items: [{ productId: milk.id, quantity: 1 }], payments: [{ method: 'pix', amount: 5.49 }], ...body });

    await s.as('put', '/modules/shared.sales/settings').send({ requireRegisterSession: true }).expect(204);
    expect((await s.as('get', '/sales/registers').expect(200)).body.requireSession).toBe(true);
    expect((await sell({}).expect(409)).body.code).toBe('REGISTER_SESSION_REQUIRED');

    const { body: register } = await s.as('post', '/sales/registers').send({ name: 'Caixa 1' }).expect(201);
    expect((await sell({ registerId: register.id }).expect(409)).body.code).toBe('REGISTER_CLOSED');

    const { body: past } = await sell({ soldAt: plusDays(localToday(), -3) }).expect(201);
    expect(past.registerSessionId).toBeNull();

    const { body: opened } = await s.as('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 0 }).expect(201);
    const { body: sale } = await sell({ registerId: register.id }).expect(201);
    expect(sale.registerSessionId).toBe(opened.id);
  });

  it('caixa de outro dia: abre, vende, movimenta e fecha no passado, sem cruzar com a sessão de agora', async () => {
    const s = await bakery();
    const milk = s.product('Leite integral 1 L');
    const { body: bank } = await s.as('post', '/finance/accounts').send({ name: 'Banco', type: 'bank', initialBalance: 0 }).expect(201);
    const { body: register } = await s.as('post', '/sales/registers').send({ name: 'Caixa 1' }).expect(201);
    const day = plusDays(localToday(), -3);
    const at = (hhmm: string) => new Date(`${day}T${hhmm}:00-03:00`).toISOString();
    const open = (body: Record<string, unknown>) => s.as('post', '/sales/registers/sessions').send({ registerId: register.id, ...body });
    const sell = (body: Record<string, unknown>) =>
      s.as('post', '/sales').send({ registerId: register.id, items: [{ productId: milk.id, quantity: 2 }], payments: [{ method: 'cash', amount: 20 }], ...body });
    const move = (id: string, body: Record<string, unknown>) => s.as('post', `/sales/registers/sessions/${id}/moves`).send(body);
    const close = (id: string, body: Record<string, unknown>) => s.as('post', `/sales/registers/sessions/${id}/close`).send(body);

    // O caixa está aberto agora; o de três dias atrás é lançado mesmo assim (os horários não se cruzam).
    const { body: current } = await open({ openingFloat: 50 }).expect(201);
    const { body: past } = await open({ openingFloat: 100, openedAt: at('08:00') }).expect(201);
    expect(past).toMatchObject({ status: 'open', openedAt: at('08:00'), openUntil: current.openedAt });
    expect(Date.parse(past.createdAt)).toBeGreaterThan(Date.parse(past.openedAt));
    expect(current.openUntil).toBeNull();
    // No PDV, o caixa aberto continua sendo o de agora.
    const { body: overview } = await s.as('get', '/sales/registers').expect(200);
    expect(overview.registers[0].openSession.id).toBe(current.id);

    // Abertura no futuro, dentro da sessão de agora ou da que está sendo lançada: recusada.
    expect((await open({ openingFloat: 0, openedAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400)).body.code).toBe('VALIDATION');
    expect((await open({ openingFloat: 0, openedAt: new Date(Date.now() - 60_000).toISOString() }).expect(409)).body.code).toBe('REGISTER_ALREADY_OPEN');
    expect((await open({ openingFloat: 0, openedAt: at('10:00') }).expect(409)).body.code).toBe('REGISTER_ALREADY_OPEN');

    // Vendas: com o caixa e o horário daquele dia, entram na sessão lançada; antes da abertura, em
    // sessão nenhuma (venda de outro dia, como antes); agora, na sessão de agora.
    const { body: pastSale } = await sell({ soldAt: at('09:00') }).expect(201);
    expect(pastSale).toMatchObject({ registerSessionId: past.id, soldAt: at('09:00'), change: 9.02 });
    const { body: early } = await sell({ soldAt: at('07:00') }).expect(201);
    expect(early.registerSessionId).toBeNull();
    const { body: nowSale } = await sell({}).expect(201);
    expect(nowSale.registerSessionId).toBe(current.id);

    // Movimentos só dentro do horário da sessão (da abertura até a abertura da seguinte).
    expect((await move(past.id, { kind: 'withdrawal', amount: 10, reason: 'Cedo demais', occurredAt: at('07:30') }).expect(400)).body.code).toBe('OUTSIDE_SESSION');
    expect((await move(past.id, { kind: 'withdrawal', amount: 10, reason: 'Sem horário (agora)' }).expect(400)).body.code).toBe('OUTSIDE_SESSION');
    const { body: afterMove } = await move(past.id, { kind: 'withdrawal', amount: 50, reason: 'Depósito no banco', accountId: bank.id, occurredAt: at('12:00') }).expect(201);
    expect(afterMove.moves).toEqual([expect.objectContaining({ kind: 'withdrawal', amount: 50, occurredAt: at('12:00') })]);
    const moveEntries = (await s.entries()).filter((e) => e.sourceId === afterMove.moves[0].id);
    expect(moveEntries).toHaveLength(2);
    expect(moveEntries.every((e) => e.dueDate === day && e.paidAt === day)).toBe(true);

    // Fechamento: sem horário (agora) passaria da abertura da sessão de agora; antes do último
    // movimento também não. No horário daquele dia, a quebra entra no financeiro naquele dia.
    expect((await close(past.id, { counted: { cash: 58.98 } }).expect(400)).body.code).toBe('SESSION_OVERLAP');
    expect((await close(past.id, { counted: { cash: 58.98 }, closedAt: at('11:00') }).expect(400)).body.code).toBe('CLOSE_BEFORE_LAST_EVENT');
    expect((await close(past.id, { counted: { cash: 58.98 }, closedAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400)).body.code).toBe('VALIDATION');
    const { body: closed } = await close(past.id, { counted: { cash: 58.98 }, closedAt: at('18:00') }).expect(201);
    // Esperado: 100 + 10,98 − 50 = 60,98; contado 58,98 → quebra de 2,00.
    expect(closed).toMatchObject({ status: 'closed', closedAt: at('18:00'), expectedCash: 60.98, cashDifference: -2, salesCount: 1, openUntil: null });
    const shortage = (await s.entries()).filter((e) => e.sourceId === past.id);
    expect(shortage).toEqual([expect.objectContaining({ kind: 'expense', amount: 2, dueDate: day, paidAt: day })]);

    // Fechada, o horário dela continua ocupado; venda daquele dia depois do fechamento fica fora de sessão.
    expect((await open({ openingFloat: 0, openedAt: at('17:00') }).expect(409)).body.code).toBe('SESSION_OVERLAP');
    const { body: late } = await sell({ soldAt: at('19:00') }).expect(201);
    expect(late.registerSessionId).toBeNull();
    // Outra sessão naquele dia, depois do fechamento, pode.
    const { body: evening } = await open({ openingFloat: 0, openedAt: at('18:30') }).expect(201);
    await close(evening.id, { counted: { cash: 0 }, closedAt: at('20:00') }).expect(201);

    // No histórico, cada sessão no dia dela.
    const { body: thatDay } = await s.as('get', `/sales/registers/sessions?from=${day}&to=${day}`).expect(200);
    expect(thatDay.map((h: { id: string }) => h.id)).toEqual([evening.id, past.id]);
    const { body: today } = await s.as('get', `/sales/registers/sessions?from=${localToday()}&to=${localToday()}`).expect(200);
    expect(today.map((h: { id: string }) => h.id)).toEqual([current.id]);
  });

  it('o papel Caixa abre, movimenta e fecha, mas não vê o histórico', async () => {
    const s = await bakery();
    const milk = s.product('Leite integral 1 L');
    const cashier = await inviteAndLogin(s, ['shared.sales.cashier']);

    const { body: register } = await cashier('post', '/sales/registers').send({ name: 'Caixa 2' }).expect(201);
    const { body: opened } = await cashier('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 20 }).expect(201);
    await cashier('post', '/sales').send({ registerId: register.id, items: [{ productId: milk.id, quantity: 1 }], payments: [{ method: 'cash', amount: 5.49 }] }).expect(201);
    await cashier('post', `/sales/registers/sessions/${opened.id}/moves`).send({ kind: 'withdrawal', amount: 10, reason: 'Cofre' }).expect(201);
    const { body: panel } = await cashier('get', `/sales/registers/sessions/${opened.id}`).expect(200);
    expect(panel.expectedCash).toBe(15.49);
    await cashier('post', `/sales/registers/sessions/${opened.id}/close`).send({ counted: { cash: 15.49 } }).expect(201);

    await cashier('get', '/sales/registers/sessions').expect(403);
    await cashier('patch', `/sales/registers/${register.id}`).send({ name: 'Outro nome' }).expect(403);
    await s.as('patch', `/sales/registers/${register.id}`).send({ name: 'Caixa 2 (fundos)' }).expect(200);
  });
});
