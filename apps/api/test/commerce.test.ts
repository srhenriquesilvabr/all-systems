import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('vendas (PDV e estoque) e padaria', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function bakery(modules = ['bakery']) {
    const s = await ownerSession(t, modules);
    const { body: products } = await s.as('get', '/sales/products').expect(200);
    const product = (name: string) => products.find((p: { name: string }) => p.name === name);
    return { ...s, product };
  }

  async function inviteAndLogin(s: Awaited<ReturnType<typeof bakery>>, roleKeys: string[]) {
    const roles = await s.as('get', '/access/roles').expect(200);
    const roleIds = roleKeys.map((k) => roles.body.find((r: { key: string }) => r.key === k).id);
    const email = uniqueEmail('caixa');
    await s.as('post', '/users/invite').send({ email, name: 'Caixa', roleIds }).expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Caixa' }).expect(204);
    const session = await login(t, email);
    return (method: 'get' | 'post' | 'patch', path: string) => t.http()[method](`/api${path}`).set(auth(session.token));
  }

  it('venda no caixa: balança, desconto, troco, estoque e financeiro', async () => {
    const s = await bakery();
    const bread = s.product('Pão francês');
    const milk = s.product('Leite integral 1 L');
    expect(bread).toMatchObject({ unit: 'kg', price: 16.9, trackStock: false });

    const { body: sale } = await s
      .as('post', '/sales')
      .send({
        items: [
          { productId: bread.id, quantity: 0.5 },
          { productId: milk.id, quantity: 1 },
          { productId: milk.id, quantity: 1 },
        ],
        discount: 0.43,
        payments: [{ method: 'cash', amount: 20 }],
      })
      .expect(201);
    expect(sale).toMatchObject({ subtotal: 19.43, discount: 0.43, total: 19, change: 1, payments: [{ method: 'cash', amount: 19 }] });
    expect(sale.items).toEqual([
      expect.objectContaining({ name: 'Pão francês', quantity: 0.5, total: 8.45 }),
      expect.objectContaining({ name: 'Leite integral 1 L', quantity: 2, total: 10.98 }),
    ]);

    const { body: products } = await s.as('get', '/sales/products?q=Leite').expect(200);
    expect(products[0].stock).toBe(-2); // vende mesmo sem estoque lançado (padrão)

    const { body: entries } = await s.as('get', '/finance/entries?limit=50').expect(200);
    expect(entries.items.filter((e: { sourceId: string }) => e.sourceId === sale.id)).toEqual([expect.objectContaining({ status: 'paid', amount: 19, paymentMethod: 'cash' })]);

    const { body: summary } = await s.as('get', `/sales/summary?from=${localToday()}&to=${localToday()}`).expect(200);
    expect(summary).toMatchObject({ count: 1, total: 19, averageTicket: 19, byMethod: [{ method: 'cash', amount: 19 }] });
    expect(summary.topProducts[0]).toMatchObject({ name: 'Leite integral 1 L', quantity: 2 });
  });

  it('recusa pagamento errado e quantidade quebrada de produto por unidade', async () => {
    const s = await bakery();
    const milk = s.product('Leite integral 1 L');
    const sell = (body: Record<string, unknown>) => s.as('post', '/sales').send({ items: [{ productId: milk.id, quantity: 2 }], ...body });
    expect((await sell({ items: [{ productId: milk.id, quantity: 1.5 }], payments: [{ method: 'cash', amount: 10 }] }).expect(400)).body.code).toBe('INVALID_QUANTITY');
    expect((await sell({ payments: [{ method: 'pix', amount: 10 }] }).expect(400)).body.code).toBe('PAYMENT_SHORT');
    expect((await sell({ payments: [{ method: 'credit_card', amount: 20 }] }).expect(400)).body.code).toBe('PAYMENT_OVER');
    expect((await sell({ payments: [{ method: 'on_account', amount: 10.98 }] }).expect(400)).body.code).toBe('CUSTOMER_REQUIRED');

    const { body: customer } = await s.as('post', '/customers').send({ name: 'Seu Zé', phone: '(48) 99111-0000' }).expect(201);
    const { body: fiado } = await sell({ customerId: customer.id, payments: [{ method: 'pix', amount: 5 }, { method: 'on_account', amount: 5.98 }] }).expect(201);
    const { body: entries } = await s.as('get', `/finance/entries?limit=50&customerId=${customer.id}`).expect(200);
    const mine = entries.items.filter((e: { sourceId: string }) => e.sourceId === fiado.id);
    expect(mine.map((e: { status: string; amount: number }) => [e.status, e.amount]).sort()).toEqual([
      ['paid', 5],
      ['pending', 5.98],
    ]);
  });

  it('estoque: entrada atualiza custo, inventário acerta o saldo e o bloqueio de negativo vale', async () => {
    const s = await bakery();
    const soda = s.product('Refrigerante lata 350 ml');
    const move = (body: Record<string, unknown>) => s.as('post', '/sales/stock-moves').send({ productId: soda.id, ...body });
    expect((await move({ kind: 'purchase', quantity: 24, unitCost: 2.35, reason: 'NF 123' }).expect(201)).body).toMatchObject({ stock: 24, cost: 2.35 });
    expect((await move({ kind: 'loss', quantity: 1, reason: 'Amassada' }).expect(201)).body.stock).toBe(23);
    expect((await move({ kind: 'count', quantity: 20 }).expect(201)).body.stock).toBe(20);
    const { body: moves } = await s.as('get', `/sales/products/${soda.id}/moves`).expect(200);
    expect(moves.map((m: { kind: string; quantity: number; balance: number }) => [m.kind, m.quantity, m.balance])).toEqual([
      ['count', -3, 20],
      ['loss', -1, 23],
      ['purchase', 24, 24],
    ]);

    await s.as('put', '/modules/shared.sales/settings').send({ blockNegativeStock: true }).expect(204);
    const over = await s.as('post', '/sales').send({ items: [{ productId: soda.id, quantity: 21 }], payments: [{ method: 'pix', amount: 115.5 }] }).expect(409);
    expect(over.body.code).toBe('OUT_OF_STOCK');
    expect((await s.as('get', '/sales/products?q=Refrigerante').expect(200)).body[0].stock).toBe(20);
  });

  it('venda anterior: entra no dia informado no fechamento e no financeiro; venda futura é recusada', async () => {
    const s = await bakery();
    const milk = s.product('Leite integral 1 L');
    const today = localToday();
    const past = plusDays(today, -5);

    const future = await s
      .as('post', '/sales')
      .send({ items: [{ productId: milk.id, quantity: 1 }], payments: [{ method: 'pix', amount: 5.49 }], soldAt: plusDays(today, 1) })
      .expect(400);
    expect(JSON.stringify(future.body)).toContain('A data da venda não pode ser no futuro');

    const { body: sale } = await s
      .as('post', '/sales')
      .send({ items: [{ productId: milk.id, quantity: 2 }], payments: [{ method: 'pix', amount: 10.98 }], soldAt: past })
      .expect(201);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(sale.soldAt))).toBe(past);
    expect(Date.parse(sale.createdAt)).toBeGreaterThan(Date.parse(sale.soldAt));
    await s.as('post', '/sales').send({ items: [{ productId: milk.id, quantity: 1 }], payments: [{ method: 'cash', amount: 5.49 }] }).expect(201);

    const { body: onPast } = await s.as('get', `/sales/summary?from=${past}&to=${past}`).expect(200);
    expect(onPast).toMatchObject({ count: 1, total: 10.98, byDay: [{ date: past, count: 1, total: 10.98 }] });
    const { body: week } = await s.as('get', `/sales/summary?from=${past}&to=${today}`).expect(200);
    expect(week.byDay.map((d: { date: string }) => d.date)).toEqual([past, today]);
    const { body: onToday } = await s.as('get', `/sales/summary?from=${today}&to=${today}`).expect(200);
    expect(onToday).toMatchObject({ count: 1, total: 5.49 });
    const { body: listPast } = await s.as('get', `/sales?from=${past}&to=${past}`).expect(200);
    expect(listPast.map((x: { id: string }) => x.id)).toEqual([sale.id]);

    const { body: entries } = await s.as('get', '/finance/entries?limit=50').expect(200);
    expect(entries.items.filter((e: { sourceId: string }) => e.sourceId === sale.id)).toEqual([
      expect.objectContaining({ status: 'paid', amount: 10.98, dueDate: past, paidAt: past, competenceDate: past }),
    ]);
  });

  it('movimento de estoque com data passada entra no histórico pela data', async () => {
    const s = await bakery();
    const soda = s.product('Refrigerante lata 350 ml');
    const move = (body: Record<string, unknown>) => s.as('post', '/sales/stock-moves').send({ productId: soda.id, ...body });
    await move({ kind: 'loss', quantity: 2 }).expect(201);
    const past = plusDays(localToday(), -10);
    expect((await move({ kind: 'purchase', quantity: 12, occurredAt: past }).expect(201)).body.stock).toBe(10);
    await move({ kind: 'purchase', quantity: 1, occurredAt: plusDays(localToday(), 1) }).expect(400);

    const { body: moves } = await s.as('get', `/sales/products/${soda.id}/moves`).expect(200);
    expect(moves.map((m: { kind: string }) => m.kind)).toEqual(['loss', 'purchase']);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(moves[1].occurredAt))).toBe(past);
  });

  it('cancelar a venda devolve o estoque e estorna o financeiro', async () => {
    const s = await bakery();
    const soda = s.product('Refrigerante lata 350 ml');
    await s.as('post', '/sales/stock-moves').send({ productId: soda.id, kind: 'purchase', quantity: 10 }).expect(201);
    const { body: sale } = await s.as('post', '/sales').send({ items: [{ productId: soda.id, quantity: 4 }], payments: [{ method: 'debit_card', amount: 22 }] }).expect(201);
    await s.as('post', `/sales/${sale.id}/cancel`).send({ reason: 'Cliente desistiu' }).expect(201);
    await s.as('post', `/sales/${sale.id}/cancel`).send({ reason: 'De novo' }).expect(400);
    expect((await s.as('get', '/sales/products?q=Refrigerante').expect(200)).body[0].stock).toBe(10);
    const { body: entries } = await s.as('get', '/finance/entries?limit=50').expect(200);
    expect(entries.items.filter((e: { sourceId: string }) => e.sourceId === sale.id).map((e: { status: string }) => e.status)).toEqual(['cancelled']);
    const { body: summary } = await s.as('get', `/sales/summary?from=${localToday()}&to=${localToday()}`).expect(200);
    expect(summary.count).toBe(0);
  });

  it('código de barras não se repete e o caixa vende mas não mexe no cadastro', async () => {
    const s = await bakery();
    await s.as('post', '/sales/products').send({ name: 'Água 500 ml', barcode: '7891234567895', price: 3 }).expect(201);
    expect((await s.as('post', '/sales/products').send({ name: 'Outra água', barcode: '7891234567895', price: 3 }).expect(409)).body.code).toBe('BARCODE_TAKEN');

    const cashier = await inviteAndLogin(s, ['shared.sales.cashier']);
    const { body: found } = await cashier('get', '/sales/products?q=7891234567895').expect(200);
    expect(found.map((p: { name: string }) => p.name)).toEqual(['Água 500 ml']);
    await cashier('post', '/sales').send({ items: [{ productId: found[0].id, quantity: 1 }], payments: [{ method: 'cash', amount: 3 }] }).expect(201);
    await cashier('post', '/sales/products').send({ name: 'Proibido', price: 1 }).expect(403);
    await cashier('get', `/sales/summary?from=${localToday()}&to=${localToday()}`).expect(403);
  });

  it('encomenda: aviso ao registrar e ao ficar pronta, e plano de produção do dia', async () => {
    const s = await bakery(['bakery', 'integration.whatsapp']);
    const { body: me } = await s.as('get', '/me').expect(200);
    const paths = me.menu.map((m: { path: string }) => m.path);
    expect(paths).toContain('/padaria/encomendas');
    expect(paths).not.toContain('/ordens'); // "Encomendas" substitui "Ordens de serviço"
    expect(paths).toContain('/pdv');

    const { body: customer } = await s.as('post', '/customers').send({ name: 'Ana Festa', email: uniqueEmail('festa'), phone: '(48) 99222-3333' }).expect(201);
    const day = plusDays(localToday(), 2);
    const { body: order } = await s
      .as('post', '/bakery/orders')
      .send({
        customerId: customer.id,
        dueAt: new Date(`${day}T15:00:00-03:00`).toISOString(),
        items: [
          { productId: s.product('Coxinha').id, description: 'Coxinha', quantity: 100, unitPrice: 1.2 },
          { description: 'Bolo de aniversário 3 kg — brigadeiro', quantity: 1, unitPrice: 240 },
        ],
      })
      .expect(201);
    expect(order).toMatchObject({ workflow: 'bakery', status: 'received', total: 360 });
    await s
      .as('post', '/bakery/orders')
      .send({ customerId: customer.id, dueAt: new Date(`${day}T17:00:00-03:00`).toISOString(), items: [{ description: 'Coxinha', quantity: 50, unitPrice: 1.2 }] })
      .expect(201);

    const { body: plan } = await s.as('get', `/bakery/production?date=${day}`).expect(200);
    expect(plan.orders).toHaveLength(2);
    expect(plan.totals).toEqual([
      { description: 'Bolo de aniversário 3 kg — brigadeiro', quantity: 1 },
      { description: 'Coxinha', quantity: 150 },
    ]);

    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'in_production' }).expect(201);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'ready' }).expect(201);
    await t.relay.drain();
    const { body: msgs } = await s.as('get', `/notifications?relatedEntity=service_order&relatedId=${order.id}`).expect(200);
    const keys = msgs.filter((m: { channel: string }) => m.channel === 'whatsapp').map((m: { templateKey: string }) => m.templateKey).sort();
    expect(keys).toEqual(['bakery.order_ready', 'bakery.order_received']);

    await s.as('post', '/bakery/orders').send({ customerId: customer.id, dueAt: '2020-01-01T10:00:00Z', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] }).expect(400);

    // Encomenda antiga (registrar histórico): retirada no passado vale se o pedido também for antigo.
    const orderedOn = plusDays(localToday(), -10);
    const pastDue = new Date(`${plusDays(localToday(), -9)}T15:00:00-03:00`).toISOString();
    const old = { customerId: customer.id, items: [{ description: 'Bolo', quantity: 1, unitPrice: 80 }] };
    await s.as('post', '/bakery/orders').send({ ...old, receivedAt: orderedOn, dueAt: pastDue }).expect(201);
    expect((await s.as('post', '/bakery/orders').send({ ...old, dueAt: pastDue }).expect(400)).body.code).toBe('DUE_IN_PAST');
    const beforeOrder = new Date(`${plusDays(localToday(), -11)}T15:00:00-03:00`).toISOString();
    expect((await s.as('post', '/bakery/orders').send({ ...old, receivedAt: orderedOn, dueAt: beforeOrder }).expect(400)).body.code).toBe('DUE_BEFORE_RECEIVED');
  });
});
