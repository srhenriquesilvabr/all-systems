import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, type TestApp } from './helpers';

describe('financeiro', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const s = await ownerSession(t);
    const accounts = await s.as('get', '/finance/accounts').expect(200);
    const categories = await s.as('get', '/finance/categories').expect(200);
    const cash = accounts.body.find((a: { name: string }) => a.name === 'Caixa');
    const category = (key: string) => categories.body.find((c: { systemKey: string }) => c.systemKey === key).id as string;
    return { ...s, cashId: cash.id as string, category };
  }

  it('toda empresa nova já tem conta Caixa e categorias padrão', async () => {
    const s = await setup();
    expect(s.cashId).toBeTruthy();
    expect(s.category('services')).toBeTruthy();
    expect(s.category('rent')).toBeTruthy();
  });

  it('lança, dá baixa e reflete no saldo e no resumo', async () => {
    const s = await setup();
    await s
      .as('post', '/finance/entries')
      .send({ kind: 'income', description: 'Venda avulsa', amount: 150, status: 'paid', dueDate: '2026-03-10', paidAt: '2026-03-10', accountId: s.cashId, categoryId: s.category('other_income') })
      .expect(201);
    const { body: rent } = await s
      .as('post', '/finance/entries')
      .send({ kind: 'expense', description: 'Aluguel março', amount: 1200.5, status: 'pending', dueDate: '2026-03-05', categoryId: s.category('rent') })
      .expect(201);
    await s.as('post', '/finance/entries').send({ kind: 'income', description: 'A receber abril', amount: 80, status: 'pending', dueDate: '2026-04-15' }).expect(201);

    const before = await s.as('get', '/finance/summary?from=2026-03-01&to=2026-04-30').expect(200);
    expect(before.body.realized).toEqual({ income: 150, expense: 0 });
    expect(before.body.projected).toEqual({ income: 80, expense: 1200.5 });
    expect(before.body.months.map((m: { month: string }) => m.month)).toEqual(['2026-03', '2026-04']);

    await s.as('post', `/finance/entries/${rent.id}/pay`).send({ paidAt: '2026-03-06', accountId: s.cashId }).expect(201);
    const after = await s.as('get', '/finance/summary?from=2026-03-01&to=2026-04-30').expect(200);
    expect(after.body.realized).toEqual({ income: 150, expense: 1200.5 });
    expect(after.body.categories).toEqual(
      expect.arrayContaining([
        { name: 'Aluguel', kind: 'expense', total: 1200.5 },
        { name: 'Outras receitas', kind: 'income', total: 150 },
      ]),
    );

    const accounts = await s.as('get', '/finance/accounts').expect(200);
    expect(accounts.body.find((a: { id: string }) => a.id === s.cashId).balance).toBe(-1050.5);
  });

  it('lista vencidos e não paga duas vezes', async () => {
    const s = await setup();
    const { body: late } = await s
      .as('post', '/finance/entries')
      .send({ kind: 'expense', description: 'Conta de luz', amount: 300, status: 'pending', dueDate: '2020-01-10' })
      .expect(201);

    const overdue = await s.as('get', '/finance/entries?status=overdue').expect(200);
    expect(overdue.body.items.map((e: { id: string }) => e.id)).toEqual([late.id]);
    const summary = await s.as('get', '/finance/summary?from=2026-01-01&to=2026-01-31').expect(200);
    expect(summary.body.overdue.payable).toEqual({ total: 300, count: 1 });

    await s.as('post', `/finance/entries/${late.id}/pay`).send({ paidAt: '2020-01-12', accountId: s.cashId }).expect(201);
    const again = await s.as('post', `/finance/entries/${late.id}/pay`).send({ paidAt: '2020-01-12', accountId: s.cashId }).expect(400);
    expect(again.body.code).toBe('ENTRY_NOT_PENDING');
  });

  it('exige conta e data para lançamento já pago', async () => {
    const s = await setup();
    await s.as('post', '/finance/entries').send({ kind: 'income', description: 'Sem conta', amount: 10, status: 'paid', dueDate: '2026-01-01' }).expect(400);
  });

  it('cancelado sai dos totais', async () => {
    const s = await setup();
    const { body: e } = await s.as('post', '/finance/entries').send({ kind: 'income', description: 'Errado', amount: 99, status: 'pending', dueDate: '2026-05-01' }).expect(201);
    await s.as('post', `/finance/entries/${e.id}/cancel`).expect(204);
    const summary = await s.as('get', '/finance/summary?from=2026-05-01&to=2026-05-31').expect(200);
    expect(summary.body.projected.income).toBe(0);
  });

  it('exporta CSV no formato do Excel brasileiro', async () => {
    const s = await setup();
    await s.as('post', '/finance/entries').send({ kind: 'income', description: 'Serviço; com ponto e vírgula', amount: 1234.5, status: 'pending', dueDate: '2026-06-01' }).expect(201);
    const res = await s.as('get', '/finance/entries.csv').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('"Serviço; com ponto e vírgula";1234,50');
  });
});
