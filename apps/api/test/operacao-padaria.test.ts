import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dueOn = (day: string, time = '15:00') => new Date(`${day}T${time}:00-03:00`).toISOString();

describe('padaria: escrita, produção, estoque, retirada e sinal no caixa', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const s = await ownerSession(t, ['bakery']);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Ana', email: uniqueEmail('ana') }).expect(201);
    const { body: products } = await s.as('get', '/sales/products').expect(200);
    const product = (name: string) => products.find((p: { name: string }) => p.name === name);
    return { ...s, customer, product };
  }
  type S = Awaited<ReturnType<typeof setup>>;

  const order = async (s: S, items: unknown[], day = plusDays(localToday(), 2)) =>
    (await s.as('post', '/bakery/orders').send({ customerId: s.customer.id, dueAt: dueOn(day), items }).expect(201)).body as { id: string; number: number; total: number; items: { id: string }[] };
  const go = (s: S, id: string, to: string) => s.as('post', `/service-orders/${id}/transition`).send({ to }).expect(201);
  const stockOf = async (s: S, name: string) => ((await s.as('get', '/sales/products').expect(200)).body as { name: string; stock: number }[]).find((p) => p.name === name)!.stock;

  it('a escrita do bolo vai para a Produção do dia, em campo próprio, e é editável', async () => {
    const s = await setup();
    const day = plusDays(localToday(), 3);
    const o = await order(s, [{ description: 'Bolo 2 kg', quantity: 1, unitPrice: 150, inscription: 'Parabéns, Ana!' }], day);
    const { body: plan } = await s.as('get', `/bakery/production?date=${day}`).expect(200);
    expect(plan.orders[0].items).toEqual([{ description: 'Bolo 2 kg', quantity: 1, inscription: 'Parabéns, Ana!' }]);

    const { body: edited } = await s.as('patch', `/bakery/orders/${o.id}`).send({ inscriptions: [{ itemId: o.items[0]!.id, inscription: 'Feliz aniversário' }] }).expect(200);
    expect(edited.items[0].inscription).toBe('Feliz aniversário');
    const other = await order(s, [{ description: 'Torta', quantity: 1, unitPrice: 50 }]);
    const wrong = await s.as('patch', `/bakery/orders/${o.id}`).send({ inscriptions: [{ itemId: other.items[0]!.id, inscription: 'x' }] }).expect(400);
    expect(wrong.body.code).toBe('ITEM_NOT_FOUND');
  });

  it('o total soma pelo produto, ignora acento e maiúscula no sob medida e deixa as prontas de fora', async () => {
    const s = await setup();
    const day = plusDays(localToday(), 4);
    const coxinha = s.product('Coxinha');
    await order(s, [{ productId: coxinha.id, description: 'Coxinha de festa', quantity: 100, unitPrice: 1 }], day);
    await order(s, [{ description: 'coxinha', quantity: 50, unitPrice: 1 }, { description: 'Bolo de Maçã', quantity: 1, unitPrice: 80 }], day);
    await order(s, [{ description: 'BOLO DE MACA', quantity: 2, unitPrice: 80 }], day);
    const pronta = await order(s, [{ productId: coxinha.id, description: 'Coxinha', quantity: 30, unitPrice: 1 }], day);
    await go(s, pronta.id, 'ready');

    const { body: plan } = await s.as('get', `/bakery/production?date=${day}`).expect(200);
    expect(plan.orders).toHaveLength(4); // a pronta continua na lista, para a conferência
    expect(plan.totals).toEqual([
      { description: 'Bolo de Maçã', quantity: 3 },
      { description: 'Coxinha', quantity: 150 },
    ]);
  });

  it('a retirada baixa o estoque uma vez só; cancelada ou sem produto não baixa', async () => {
    const s = await setup();
    const leite = s.product('Leite integral 1 L');
    await s.as('post', '/sales/stock-moves').send({ productId: leite.id, kind: 'purchase', quantity: 10 }).expect(201);

    const o = await order(s, [{ productId: leite.id, description: 'Leite', quantity: 3, unitPrice: 5 }, { description: 'Bolo', quantity: 1, unitPrice: 80 }]);
    expect(await stockOf(s, 'Leite integral 1 L')).toBe(10); // ao encomendar, ainda não
    await go(s, o.id, 'ready');
    expect(await stockOf(s, 'Leite integral 1 L')).toBe(10); // pronta, ainda não
    await go(s, o.id, 'delivered');
    expect(await stockOf(s, 'Leite integral 1 L')).toBe(7);

    const { body: moves } = await s.as('get', `/sales/products/${leite.id}/moves`).expect(200);
    expect(moves.filter((m: { kind: string }) => m.kind === 'order')).toEqual([expect.objectContaining({ quantity: -3, reason: `Encomenda nº ${o.number}` })]);
    const { body: detail } = await s.as('get', `/bakery/orders/${o.id}`).expect(200);
    expect(detail.items.find((i: { productId: string | null }) => i.productId)).toMatchObject({ stockMovedAt: expect.any(String) });

    // Retirada é final: tentar de novo é recusado e não baixa outra vez.
    await s.as('post', `/service-orders/${o.id}/transition`).send({ to: 'delivered' }).expect(400);
    expect(await stockOf(s, 'Leite integral 1 L')).toBe(7);

    const cancelled = await order(s, [{ productId: leite.id, description: 'Leite', quantity: 2, unitPrice: 5 }]);
    await s.as('post', `/service-orders/${cancelled.id}/transition`).send({ to: 'cancelled', reason: 'Desistiu' }).expect(201);
    expect(await stockOf(s, 'Leite integral 1 L')).toBe(7);
  });

  it('a retirada sai com produto sem saldo, mesmo com o bloqueio de venda ligado', async () => {
    const s = await setup();
    const { body: settings } = await s.as('get', '/modules/shared.sales/settings').expect(200);
    await s.as('put', '/modules/shared.sales/settings').send({ ...settings, blockNegativeStock: true }).expect(204);
    const leite = s.product('Leite integral 1 L');
    const o = await order(s, [{ productId: leite.id, description: 'Leite', quantity: 2, unitPrice: 5 }]);
    await go(s, o.id, 'ready');
    await go(s, o.id, 'delivered');
    expect(await stockOf(s, 'Leite integral 1 L')).toBe(-2);
  });

  it('a data de retirada muda a produção e o vencimento; passado e encomenda encerrada são recusados', async () => {
    const s = await setup();
    const day = plusDays(localToday(), 2);
    const next = plusDays(localToday(), 5);
    const o = await order(s, [{ description: 'Bolo', quantity: 1, unitPrice: 80 }], day);

    await s.as('patch', `/bakery/orders/${o.id}`).send({ dueAt: dueOn(next, '10:00') }).expect(200);
    expect((await s.as('get', `/bakery/production?date=${day}`).expect(200)).body.orders).toEqual([]);
    expect((await s.as('get', `/bakery/production?date=${next}`).expect(200)).body.orders).toHaveLength(1);
    const { body: entries } = await s.as('get', '/finance/entries?limit=50').expect(200);
    expect(entries.items.find((e: { sourceId: string; status: string }) => e.sourceId === o.id && e.status === 'pending').dueDate).toBe(next);

    const past = await s.as('patch', `/bakery/orders/${o.id}`).send({ dueAt: dueOn(plusDays(localToday(), -3)) }).expect(400);
    expect(past.body.code).toBe('DUE_IN_PAST');

    await s.as('post', `/service-orders/${o.id}/transition`).send({ to: 'cancelled', reason: 'Desistiu' }).expect(201);
    expect((await s.as('patch', `/bakery/orders/${o.id}`).send({ dueAt: dueOn(next) }).expect(400)).body.code).toBe('ORDER_CLOSED');
  });

  it('os itens da encomenda não são refeitos pela rota genérica (a escrita e a baixa ficariam perdidas)', async () => {
    const s = await setup();
    const o = await order(s, [{ description: 'Bolo', quantity: 1, unitPrice: 80 }]);
    const res = await s.as('patch', `/service-orders/${o.id}`).send({ items: [{ description: 'Outro', quantity: 1, unitPrice: 1 }] }).expect(400);
    expect(res.body.code).toBe('ITEMS_MANAGED');
  });

  describe('sinal no caixa', () => {
    async function withRegister(s: S) {
      const { body: register } = await s.as('post', '/sales/registers').send({ name: 'Caixa 1' }).expect(201);
      const { body: session } = await s.as('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 50 }).expect(201);
      return { register, session };
    }
    const financeOf = async (s: S, orderId: string) =>
      ((await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as { sourceId: string; status: string; amount: number; accountName?: string }[]).filter((e) => e.sourceId === orderId);

    it('o sinal em dinheiro entra na conferência da gaveta e fica um lançamento só no financeiro', async () => {
      const s = await setup();
      const { register, session } = await withRegister(s);
      const o = await order(s, [{ description: 'Bolo', quantity: 1, unitPrice: 200 }]);

      const { body: paid } = await s.as('post', `/bakery/orders/${o.id}/payments`).send({ amount: 80, method: 'cash', paidAt: localToday(), registerId: register.id }).expect(201);
      expect(paid.order).toMatchObject({ paidAmount: 80, paymentStatus: 'partial' });

      const { body: live } = await s.as('get', `/sales/registers/sessions/${session.id}`).expect(200);
      expect(live.expectedCash).toBe(130); // 50 de troco + 80 do sinal
      expect(live.moves).toEqual([expect.objectContaining({ kind: 'service_receipt', amount: 80, reason: `Encomenda nº ${o.number}` })]);

      const money = await financeOf(s, o.id);
      expect(money.filter((e) => e.status === 'paid').map((e) => e.amount)).toEqual([80]);
      expect(money.filter((e) => e.status === 'pending').map((e) => e.amount)).toEqual([120]);
      // O caixa não lança nada à parte: a origem da sessão fica vazia no financeiro.
      const all = (await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as { sourceType: string }[];
      expect(all.filter((e) => e.sourceType === 'sales_register_move')).toEqual([]);

      // Fechamento: o dinheiro do sinal é esperado na gaveta; sem quebra, não há lançamento novo.
      const { body: closed } = await s.as('post', `/sales/registers/sessions/${session.id}/close`).send({ counted: { cash: 130 } }).expect(201);
      expect(closed).toMatchObject({ cashDifference: 0, status: 'closed' });
      expect((await financeOf(s, o.id)).filter((e) => e.status === 'paid')).toHaveLength(1);
    });

    it('sem caixa informado vai só para o financeiro; caixa fechado é recusado sem lançar nada', async () => {
      const s = await setup();
      const { body: register } = await s.as('post', '/sales/registers').send({ name: 'Caixa 2' }).expect(201);
      const { body: accounts } = await s.as('get', '/service-orders/payment-accounts').expect(200);
      const o = await order(s, [{ description: 'Bolo', quantity: 1, unitPrice: 200 }]);

      const closed = await s.as('post', `/bakery/orders/${o.id}/payments`).send({ amount: 10, method: 'cash', paidAt: localToday(), registerId: register.id }).expect(409);
      expect(closed.body.code).toBe('REGISTER_CLOSED');
      expect((await financeOf(s, o.id)).filter((e) => e.status === 'paid')).toEqual([]);

      await s.as('post', `/bakery/orders/${o.id}/payments`).send({ amount: 10, method: 'pix', accountId: accounts[0].id, paidAt: localToday() }).expect(201);
      expect((await s.as('get', `/bakery/orders/${o.id}`).expect(200)).body.order.paidAmount).toBe(10);

      const over = await s.as('post', `/bakery/orders/${o.id}/payments`).send({ amount: 1000, method: 'pix', accountId: accounts[0].id, paidAt: localToday() }).expect(400);
      expect(over.body.code).toBe('PAYMENT_EXCEEDS_BALANCE');
      const future = await s.as('post', `/bakery/orders/${o.id}/payments`).send({ amount: 1, method: 'pix', accountId: accounts[0].id, paidAt: plusDays(localToday(), 1) }).expect(400);
      expect(future.body.code).toBe('INVALID_DATE');
    });
  });

  it('a lista de encomendas pagina', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await order(s, [{ description: `Bolo ${i}`, quantity: 1, unitPrice: 10 }]);
    const { body } = await s.as('get', '/service-orders?workflow=bakery&limit=2&offset=2').expect(200);
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(1);
  });
});

describe('configurações do caixa', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('o bloqueio recusa a venda sem saldo; a conta de Pix recebe a venda; o rodapé chega a quem vende', async () => {
    const s = await ownerSession(t, ['bakery']);
    const { body: products } = await s.as('get', '/sales/products').expect(200);
    const leite = products.find((p: { name: string }) => p.name === 'Leite integral 1 L');
    const { body: account } = await s.as('post', '/finance/accounts').send({ name: 'Banco', type: 'bank' }).expect(201);
    const { body: settings } = await s.as('get', '/modules/shared.sales/settings').expect(200);
    await s.as('put', '/modules/shared.sales/settings').send({ ...settings, blockNegativeStock: true, bankAccountId: account.id, receiptFooter: 'Volte sempre!' }).expect(204);

    const sale = (method: string) => s.as('post', '/sales').send({ items: [{ productId: leite.id, quantity: 1 }], payments: [{ method, amount: leite.price }] });
    expect((await sale('pix').expect(409)).body.code).toBe('OUT_OF_STOCK');

    await s.as('post', '/sales/stock-moves').send({ productId: leite.id, kind: 'purchase', quantity: 5 }).expect(201);
    const { body: sold } = await sale('pix').expect(201);
    const { body: entries } = await s.as('get', '/finance/entries?limit=50').expect(200);
    expect(entries.items.find((e: { sourceId: string }) => e.sourceId === sold.id)).toMatchObject({ accountId: account.id });

    const { body: overview } = await s.as('get', '/sales/registers').expect(200);
    expect(overview.receiptFooter).toBe('Volte sempre!');
  });
});
