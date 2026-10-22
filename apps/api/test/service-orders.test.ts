import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, auth, type TestApp } from './helpers';

describe('ordens de serviço', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function setup(opts: { withEmail?: boolean } = {}) {
    const s = await ownerSession(t);
    const email = opts.withEmail === false ? undefined : uniqueEmail('cliente');
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Maria Cliente', email }).expect(201);
    const { body: accounts } = await s.as('get', '/service-orders/payment-accounts').expect(200);
    const newOrder = (body: Record<string, unknown> = {}) =>
      s
        .as('post', '/service-orders')
        .send({
          customerId: customer.id,
          items: [
            { description: 'Camisa social', quantity: 3, unitPrice: 12.9 },
            { description: 'Edredom casal', quantity: 1, unitPrice: 45 },
          ],
          ...body,
        })
        .expect(201)
        .then((r) => r.body);
    return { ...s, customer, customerEmail: email, accountId: accounts[0].id as string, newOrder };
  }

  const receivablesOf = async (s: Awaited<ReturnType<typeof setup>>, orderId: string) => {
    const res = await s.as('get', '/finance/entries?limit=200').expect(200);
    return res.body.items.filter((e: { sourceId: string }) => e.sourceId === orderId);
  };

  it('calcula totais, numera por empresa e gera o "a receber"', async () => {
    const s = await setup();
    const first = await s.newOrder({ discount: 3.7 });
    expect(first).toMatchObject({ number: 1, status: 'open', subtotal: 83.7, discount: 3.7, total: 80, paymentStatus: 'pending' });
    expect((await s.newOrder()).number).toBe(2);

    // Outra empresa começa do 1.
    const other = await setup();
    expect((await other.newOrder()).number).toBe(1);

    const entries = await receivablesOf(s, first.id);
    expect(entries).toEqual([expect.objectContaining({ kind: 'income', status: 'pending', amount: 80, sourceType: 'service_order' })]);
  });

  it('pagamento parcial e total atualizam a ordem e o financeiro', async () => {
    const s = await setup();
    const order = await s.newOrder();

    const partial = await s.as('post', `/service-orders/${order.id}/payments`).send({ amount: 50, method: 'pix', accountId: s.accountId, paidAt: '2026-10-20' }).expect(201);
    expect(partial.body).toMatchObject({ paidAmount: 50, paymentStatus: 'partial' });
    let entries = await receivablesOf(s, order.id);
    expect(entries.find((e: { status: string }) => e.status === 'pending').amount).toBeCloseTo(33.7);
    expect(entries.find((e: { status: string }) => e.status === 'paid').amount).toBe(50);

    const tooMuch = await s.as('post', `/service-orders/${order.id}/payments`).send({ amount: 40, method: 'cash', accountId: s.accountId, paidAt: '2026-10-20' }).expect(400);
    expect(tooMuch.body.code).toBe('PAYMENT_EXCEEDS_BALANCE');

    const full = await s.as('post', `/service-orders/${order.id}/payments`).send({ amount: 33.7, method: 'cash', accountId: s.accountId, paidAt: '2026-10-21' }).expect(201);
    expect(full.body).toMatchObject({ paidAmount: 83.7, paymentStatus: 'paid' });
    expect(full.body.payments).toHaveLength(2);
    entries = await receivablesOf(s, order.id);
    expect(entries.filter((e: { status: string }) => e.status === 'pending')).toEqual([]);
  });

  it('segue o fluxo de status e recusa transições inválidas', async () => {
    const s = await setup();
    const order = await s.newOrder();

    const skip = await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'delivered' }).expect(400);
    expect(skip.body.code).toBe('INVALID_TRANSITION');

    for (const to of ['in_progress', 'ready', 'delivered']) {
      await s.as('post', `/service-orders/${order.id}/transition`).send({ to }).expect(201);
    }
    const done = await s.as('get', `/service-orders/${order.id}`).expect(200);
    expect(done.body.history.map((h: { to: string }) => h.to)).toEqual(['open', 'in_progress', 'ready', 'delivered']);
    expect(done.body.closedAt).toBeTruthy();

    const edit = await s.as('patch', `/service-orders/${order.id}`).send({ discount: 1 }).expect(400);
    expect(edit.body.code).toBe('ORDER_CLOSED');
  });

  it('cancelar exige motivo e zera o "a receber"', async () => {
    const s = await setup();
    const order = await s.newOrder();
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'cancelled' }).expect(400);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'cancelled', reason: 'Cliente desistiu' }).expect(201);
    const entries = await receivablesOf(s, order.id);
    expect(entries.every((e: { status: string }) => e.status === 'cancelled')).toBe(true);
    await s.as('post', `/service-orders/${order.id}/payments`).send({ amount: 1, method: 'pix', accountId: s.accountId, paidAt: '2026-10-20' }).expect(400);
  });

  it('não reduz o total abaixo do que já foi pago', async () => {
    const s = await setup();
    const order = await s.newOrder();
    await s.as('post', `/service-orders/${order.id}/payments`).send({ amount: 80, method: 'pix', accountId: s.accountId, paidAt: '2026-10-20' }).expect(201);
    const res = await s.as('patch', `/service-orders/${order.id}`).send({ items: [{ description: 'Só uma camisa', quantity: 1, unitPrice: 12.9 }] }).expect(400);
    expect(res.body.code).toBe('TOTAL_BELOW_PAID');
  });

  it('avisa o cliente por e-mail pelo outbox, com o texto personalizado pela empresa', async () => {
    const s = await setup();
    await s
      .as('put', '/notifications/templates/shared.service-orders.ready')
      .send({ subject: 'Pode buscar! Ordem {{os.numero}}', body: 'Oi {{cliente.nome}}, falta pagar {{os.saldo}}. — {{empresa.nome}}' })
      .expect(204);

    const order = await s.newOrder();
    await t.relay.drain();
    expect(t.mails.findLast((m) => m.to === s.customerEmail)?.subject).toBe(`Recebemos sua ordem nº ${order.number}`);

    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'in_progress' }).expect(201);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'ready' }).expect(201);
    await t.relay.drain();
    const ready = t.mails.findLast((m) => m.to === s.customerEmail)!;
    expect(ready.subject).toBe(`Pode buscar! Ordem ${order.number}`);
    expect(ready.text).toMatch(/^Oi Maria Cliente, falta pagar R\$\s83,70\. — Empresa /);

    const log = await s.as('get', '/notifications').expect(200);
    expect(log.body.map((n: { status: string }) => n.status)).toEqual(['sent', 'sent']);
  });

  it('registra o motivo quando não dá para avisar o cliente', async () => {
    const s = await setup({ withEmail: false });
    await s.newOrder();
    const log = await s.as('get', '/notifications').expect(200);
    expect(log.body[0]).toMatchObject({ status: 'skipped', detail: 'Cliente sem e-mail cadastrado' });
  });

  it('respeita o cliente que pediu para não receber avisos', async () => {
    const s = await setup();
    await s.as('post', `/customers/${s.customer.id}/consents`).send({ purpose: 'service_notifications', granted: false, source: 'pedido do cliente' }).expect(201);
    await s.newOrder();
    const log = await s.as('get', '/notifications').expect(200);
    expect(log.body[0]).toMatchObject({ status: 'skipped', detail: 'Cliente pediu para não receber avisos' });
  });

  it('aparece na linha do tempo e na exportação LGPD do cliente', async () => {
    const s = await setup();
    const order = await s.newOrder();
    const timeline = await s.as('get', `/customers/${s.customer.id}/timeline`).expect(200);
    expect(timeline.body.map((e: { type: string }) => e.type)).toContain('service_order.created');

    const exported = await s.as('get', `/customers/${s.customer.id}/export`).expect(200);
    expect(exported.body.modules['shared.service-orders'][0].number).toBe(order.number);
    expect(exported.body.modules['core.finance'][0].sourceId).toBe(order.id);
  });

  it('atendente da lavanderia abre ordens e recebe, mas não vê o financeiro', async () => {
    const s = await setup();
    const roles = await s.as('get', '/access/roles').expect(200);
    const attendant = roles.body.find((r: { key: string }) => r.key === 'laundry.attendant');
    const email = uniqueEmail('atendente');
    await s.as('post', '/users/invite').send({ email, name: 'Atendente', roleIds: [attendant.id] }).expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD }).expect(204);
    const { token: access } = await login(t, email);

    const created = await t.http()
      .post('/api/service-orders')
      .set(auth(access))
      .send({ customerId: s.customer.id, items: [{ description: 'Calça', quantity: 1, unitPrice: 15 }] })
      .expect(201);
    await t.http().get('/api/service-orders/payment-accounts').set(auth(access)).expect(200);
    await t.http()
      .post(`/api/service-orders/${created.body.id}/payments`)
      .set(auth(access))
      .send({ amount: 15, method: 'cash', accountId: s.accountId, paidAt: '2026-10-21' })
      .expect(201);
    await t.http().get('/api/finance/summary?from=2026-10-01&to=2026-10-31').set(auth(access)).expect(403);
  });

  it('sem o módulo contratado, não há ordens de serviço', async () => {
    const s = await ownerSession(t, []);
    const res = await s.as('get', '/service-orders').expect(403);
    expect(res.body.code).toBe('MODULE_NOT_ENABLED');
  });
});
