import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

const spDay = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + n * 86_400_000));
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('lavanderia: edição, retrabalho, entrega e motoristas', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const s = await ownerSession(t, ['laundry']);
    const email = uniqueEmail('cliente');
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Rita', email, address: { street: 'Rua A', number: '1', city: 'São Paulo', state: 'SP', zip: '01001000' } }).expect(201);
    const { body: services } = await s.as('get', '/laundry/services').expect(200);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name);
    return { ...s, customer, customerEmail: email, service };
  }
  type S = Awaited<ReturnType<typeof setup>>;

  const open = async (s: S, quantity = 2) =>
    (await s.as('post', '/laundry/orders').send({ customerId: s.customer.id, lines: [{ serviceId: s.service('Lavar e passar').id, quantity }] }).expect(201)).body as {
      order: { id: string; number: number; total: number; status: string };
      pieces: { itemId: string; tagCode: string; status: string }[];
    };
  const allReady = (s: S, ids: string[]) => s.as('post', '/laundry/pieces/status').send({ itemIds: ids, status: 'ready' }).expect(200);
  const entries = async (s: S, sourceId: string) => (await s.as('get', '/finance/entries?limit=200').expect(200)).body.items.filter((e: { sourceId: string }) => e.sourceId === sourceId) as { status: string; amount: number; dueDate: string; sourceType: string }[];

  async function inviteAs(s: S, name: string, roleKey: string) {
    const roles = await s.as('get', '/access/roles').expect(200);
    const role = roles.body.find((r: { key: string }) => r.key === roleKey);
    const email = uniqueEmail('equipe');
    await s.as('post', '/users/invite').send({ email, name, roleIds: [role.id] }).expect(201);
    await t.http().post('/api/auth/set-password').send({ token: tokenFromMail(t.mails.findLast((m) => m.to === email)), password: PASSWORD }).expect(204);
    const { token } = await login(t, email);
    const team = await s.as('get', '/users/team').expect(200);
    const id = team.body.find((m: { name: string }) => m.name === name).id as string;
    return { id, as: (method: 'get' | 'post' | 'patch' | 'delete', path: string) => t.http()[method](`/api${path}`).set(auth(token)) };
  }

  it('edita previsão, desconto e observação interna; a previsão acompanha no financeiro e o total não fica abaixo do pago', async () => {
    const s = await setup();
    const { order } = await open(s);
    const due = new Date(`${spDay(5)}T15:00:00-03:00`).toISOString();
    const { body } = await s.as('patch', `/laundry/orders/${order.id}`).send({ dueAt: due, discount: 5, notesInternal: 'Cuidado com a gola' }).expect(200);
    const discounted = Math.round((order.total - 5) * 100) / 100;
    expect(body.order).toMatchObject({ dueAt: due, discount: 5, total: discounted, notesInternal: 'Cuidado com a gola' });
    expect(await entries(s, order.id)).toEqual([expect.objectContaining({ status: 'pending', dueDate: spDay(5), amount: discounted })]);

    const before = await s.as('patch', `/laundry/orders/${order.id}`).send({ dueAt: new Date(`${spDay(-3)}T10:00:00-03:00`).toISOString() }).expect(400);
    expect(before.body.code).toBe('DUE_BEFORE_RECEIVED');

    const { body: accounts } = await s.as('get', '/service-orders/payment-accounts').expect(200);
    await s.as('post', `/service-orders/${order.id}/payments`).send({ amount: 10, method: 'pix', accountId: accounts[0].id, paidAt: spDay(0) }).expect(201);
    const below = await s.as('patch', `/laundry/orders/${order.id}`).send({ discount: order.total }).expect(400);
    expect(below.body.code).toBe('TOTAL_BELOW_PAID');
  });

  it('a rota genérica não refaz as peças da lavanderia e, em rota, só as observações mudam', async () => {
    const s = await setup();
    const { order, pieces } = await open(s);
    const generic = await s.as('patch', `/service-orders/${order.id}`).send({ items: [{ description: 'x', quantity: 1, unitPrice: 1 }] }).expect(400);
    expect(generic.body.code).toBe('ITEMS_MANAGED');
    await allReady(s, pieces.map((p) => p.itemId));
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'out_for_delivery' }).expect(201);
    expect((await s.as('patch', `/laundry/orders/${order.id}`).send({ discount: 1 }).expect(400)).body.code).toBe('ORDER_OUT_FOR_DELIVERY');
    await s.as('patch', `/laundry/orders/${order.id}`).send({ notesInternal: 'Portão azul' }).expect(200);
  });

  it('inclui peça com etiqueta nova, tira a que não começou e recusa nos outros casos', async () => {
    const s = await setup();
    const { order, pieces } = await open(s, 3);
    const unit = order.total / 3;

    const { body: grown } = await s.as('post', `/laundry/orders/${order.id}/pieces`).send({ lines: [{ serviceId: s.service('Lavar e passar').id, quantity: 1 }] }).expect(201);
    expect(grown.pieces.map((p: { tagCode: string }) => p.tagCode)).toContain(`${order.number}-04`);
    expect(grown.order.total).toBeCloseTo(unit * 4);

    // Já começou: não sai. A que sai não devolve a etiqueta para a próxima.
    await s.as('post', '/laundry/pieces/status').send({ itemIds: [pieces[0]!.itemId], status: 'washing' }).expect(200);
    expect((await s.as('delete', `/laundry/orders/${order.id}/pieces/${pieces[0]!.itemId}`).expect(400)).body.code).toBe('PIECE_STARTED');
    const { body: shrunk } = await s.as('delete', `/laundry/orders/${order.id}/pieces/${pieces[1]!.itemId}`).expect(200);
    expect(shrunk.pieces).toHaveLength(3);
    expect(shrunk.order.total).toBeCloseTo(unit * 3);
    expect(await entries(s, order.id)).toEqual([expect.objectContaining({ status: 'pending' })]);
    const { body: again } = await s.as('post', `/laundry/orders/${order.id}/pieces`).send({ lines: [{ serviceId: s.service('Lavar e passar').id, quantity: 1 }] }).expect(201);
    expect(again.pieces.map((p: { tagCode: string }) => p.tagCode)).toContain(`${order.number}-05`);

    // Pronta: as peças não mudam mais.
    await allReady(s, again.pieces.map((p: { itemId: string }) => p.itemId));
    const late = await s.as('post', `/laundry/orders/${order.id}/pieces`).send({ lines: [{ serviceId: s.service('Lavar e passar').id, quantity: 1 }] }).expect(400);
    expect(late.body.code).toBe('ORDER_NOT_IN_PRODUCTION');
  });

  it('ordem pronta: aparece no quadro quando pedido, volta para retrabalho sem aviso e pode ser cancelada', async () => {
    const s = await setup();
    const { order, pieces } = await open(s);
    await allReady(s, pieces.map((p) => p.itemId));

    expect((await s.as('get', '/laundry/production').expect(200)).body).toEqual([]);
    const withReady = (await s.as('get', '/laundry/production?includeReady=true').expect(200)).body;
    expect(withReady.map((p: { orderId: string }) => p.orderId)).toEqual([order.id, order.id]);

    await s.as('post', `/laundry/pieces/${pieces[0]!.itemId}/status`).send({ status: 'washing' }).expect(200);
    const { body } = await s.as('get', `/laundry/orders/${order.id}`).expect(200);
    expect(body.order.status).toBe('in_process');
    expect(body.pieces.find((p: { itemId: string }) => p.itemId === pieces[0]!.itemId).reworkCount).toBe(1);

    await allReady(s, pieces.map((p) => p.itemId));
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'cancelled' }).expect(400); // sem motivo
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'cancelled', reason: 'Cliente desistiu' }).expect(201);
  });

  it('"Saiu para entrega" à mão volta sem novo aviso; com motorista em rota, a volta é recusada', async () => {
    const s = await setup();
    const { order, pieces } = await open(s);
    await allReady(s, pieces.map((p) => p.itemId));
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'out_for_delivery' }).expect(201);
    await t.relay.drain();
    const { body: before } = await s.as('get', `/notifications?relatedEntity=service_order&relatedId=${order.id}`).expect(200);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'ready', reason: 'Saída desfeita' }).expect(201);
    await t.relay.drain();
    const { body: after } = await s.as('get', `/notifications?relatedEntity=service_order&relatedId=${order.id}`).expect(200);
    expect(after.filter((m: { templateKey: string }) => m.templateKey === 'laundry.order.ready')).toHaveLength(before.filter((m: { templateKey: string }) => m.templateKey === 'laundry.order.ready').length);

    const { body: job } = await s.as('post', `/laundry/orders/${order.id}/delivery`).send({ date: spDay(0), period: 'afternoon', fee: 0 }).expect(201);
    await s.as('post', `/laundry/logistics/jobs/${job.id}/start`).send({}).expect(200);
    const refused = await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'ready' }).expect(400);
    expect(refused.body.code).toBe('JOB_EN_ROUTE');
    // A falha da tarefa continua devolvendo a ordem para "Pronta".
    await s.as('post', `/laundry/logistics/jobs/${job.id}/fail`).send({ reason: 'Cliente ausente' }).expect(200);
    expect((await s.as('get', `/laundry/orders/${order.id}`).expect(200)).body.order.status).toBe('ready');
  });

  it('cancelar a ordem cancela a entrega agendada e a taxa ainda não recebida', async () => {
    const s = await setup();
    const { order } = await open(s);
    const { body: job } = await s.as('post', `/laundry/orders/${order.id}/delivery`).send({ date: spDay(1), period: 'morning', fee: 12 }).expect(201);
    expect(await entries(s, job.id)).toEqual([expect.objectContaining({ status: 'pending', amount: 12 })]);

    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'cancelled', reason: 'Desistiu' }).expect(201);
    const { body: after } = await s.as('get', `/laundry/logistics/jobs/${job.id}`).expect(200);
    expect(after).toMatchObject({ status: 'cancelled', cancelReason: 'Ordem cancelada: Desistiu', feeStatus: null });
    expect((await entries(s, job.id)).map((e) => e.status)).toEqual(['cancelled']);
    // Não sobra entrega em aberto impedindo qualquer coisa, e cancelar de novo é recusado pela regra da ordem.
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'cancelled', reason: 'De novo' }).expect(400);
  });

  it('motorista recebe o saldo na entrega: um pagamento só, sem passar do saldo e respeitando a permissão', async () => {
    const s = await setup();
    const { order, pieces } = await open(s);
    await allReady(s, pieces.map((p) => p.itemId));
    const driver = await inviteAs(s, 'Mauro', 'laundry.driver');
    const { body: job } = await s.as('post', `/laundry/orders/${order.id}/delivery`).send({ date: spDay(0), period: 'afternoon', fee: 0, driverUserId: driver.id }).expect(201);

    // Valor maior que o saldo: nada acontece, nem a entrega conclui.
    const over = await driver.as('post', `/laundry/logistics/jobs/${job.id}/complete`).send({ receiverName: 'Porteiro', balancePayment: { amount: order.total + 1, method: 'cash' } }).expect(400);
    expect(over.body.code).toBe('PAYMENT_EXCEEDS_BALANCE');
    expect((await s.as('get', `/laundry/orders/${order.id}`).expect(200)).body.order).toMatchObject({ status: 'ready', paidAmount: 0 });

    const { body: done } = await driver.as('post', `/laundry/logistics/jobs/${job.id}/complete`).send({ receiverName: 'Porteiro', balancePayment: { amount: order.total, method: 'cash' } }).expect(200);
    expect(done.status).toBe('done');
    const { body } = await s.as('get', `/laundry/orders/${order.id}`).expect(200);
    expect(body.order).toMatchObject({ status: 'delivered', paidAmount: order.total, paymentStatus: 'paid' });
    expect(body.order.payments).toHaveLength(1);
    const money = await entries(s, order.id);
    expect(money.filter((e) => e.status === 'paid')).toHaveLength(1);
    expect(money.filter((e) => e.status === 'pending')).toEqual([]);

    // Concluir de novo não paga de novo.
    await driver.as('post', `/laundry/logistics/jobs/${job.id}/complete`).send({ receiverName: 'Porteiro', balancePayment: { amount: 1, method: 'cash' } }).expect(400);
    expect((await s.as('get', `/laundry/orders/${order.id}`).expect(200)).body.order.payments).toHaveLength(1);
  });

  it('sem a permissão de receber, o motorista conclui a entrega mas não registra o saldo', async () => {
    const s = await setup();
    const { order, pieces } = await open(s);
    await allReady(s, pieces.map((p) => p.itemId));
    const { body: role } = await s.as('post', '/access/roles').send({ label: 'Só dirige', permissions: ['laundry.logistics.drive'] }).expect(201);
    const email = uniqueEmail('dirige');
    await s.as('post', '/users/invite').send({ email, name: 'Dirce', roleIds: [role.id] }).expect(201);
    await t.http().post('/api/auth/set-password').send({ token: tokenFromMail(t.mails.findLast((m) => m.to === email)), password: PASSWORD }).expect(204);
    const { token } = await login(t, email);
    const team = await s.as('get', '/users/team').expect(200);
    const id = team.body.find((m: { name: string }) => m.name === 'Dirce').id as string;
    const { body: job } = await s.as('post', `/laundry/orders/${order.id}/delivery`).send({ date: spDay(0), period: 'afternoon', fee: 0, driverUserId: id }).expect(201);

    const denied = await t.http().post(`/api/laundry/logistics/jobs/${job.id}/complete`).set(auth(token)).send({ receiverName: 'Porteiro', balancePayment: { amount: 1, method: 'cash' } }).expect(403);
    expect(denied.body.code).toBe('MISSING_PERMISSION');
    await t.http().post(`/api/laundry/logistics/jobs/${job.id}/complete`).set(auth(token)).send({ receiverName: 'Porteiro' }).expect(200);
    expect((await s.as('get', `/laundry/orders/${order.id}`).expect(200)).body.order.payments).toEqual([]);
  });

  it('a lista de motoristas traz só quem pode dirigir, e quem não pode é recusado', async () => {
    const s = await setup();
    const driver = await inviteAs(s, 'Mauro', 'laundry.driver');
    const operator = await inviteAs(s, 'Olga', 'laundry.operator');
    const { body: drivers } = await s.as('get', '/laundry/logistics/drivers').expect(200);
    const names = drivers.map((d: { name: string }) => d.name);
    expect(names).toContain('Mauro');
    expect(names).toContain('Dono Teste');
    expect(names).not.toContain('Olga');

    const refused = await s.as('post', '/laundry/logistics/pickups').send({ customerId: s.customer.id, date: spDay(1), period: 'morning', driverUserId: operator.id }).expect(400);
    expect(refused.body.code).toBe('DRIVER_NOT_ALLOWED');
    await s.as('post', '/laundry/logistics/pickups').send({ customerId: s.customer.id, date: spDay(1), period: 'morning', driverUserId: driver.id }).expect(201);
    await operator.as('get', '/laundry/logistics/drivers').expect(403);
  });

  it('o relatório separa as unidades e chama o valor de contratado', async () => {
    const s = await setup();
    await s
      .as('post', '/laundry/orders')
      .send({
        customerId: s.customer.id,
        discount: 1,
        lines: [
          { serviceId: s.service('Lavar e passar').id, quantity: 2 },
          { serviceId: s.service('Lavagem por quilo').id, quantity: 8, weightKg: 5.5 },
        ],
      })
      .expect(201);
    const { body } = await s.as('get', `/laundry/reports?from=${spDay(0)}&to=${spDay(0)}`).expect(200);
    expect(body.byService).toEqual(
      expect.arrayContaining([
        { serviceName: 'Lavagem por quilo', unit: 'kg', quantity: 5.5, contracted: 109.45 },
        { serviceName: 'Lavar e passar', unit: 'piece', quantity: 2, contracted: 29.8 },
      ]),
    );
  });

  it('com a foto obrigatória, a peça sem foto não sai de Recebida; com foto, sai. O padrão continua sem exigir', async () => {
    const s = await setup();
    const { body: settings } = await s.as('get', '/modules/laundry/settings').expect(200);
    expect(settings).toMatchObject({ requirePiecePhotos: false });
    expect(settings).not.toHaveProperty('pricingMode');
    expect(settings).not.toHaveProperty('requirePhotosOnReceive');

    await s.as('put', '/modules/laundry/settings').send({ ...settings, requirePiecePhotos: true }).expect(204);
    const { pieces } = await open(s, 1);
    const refused = await s.as('post', `/laundry/pieces/${pieces[0]!.itemId}/status`).send({ status: 'washing' }).expect(400);
    expect(refused.body.code).toBe('PHOTO_REQUIRED');
    await s.as('post', `/laundry/pieces/${pieces[0]!.itemId}/photos`).attach('photo', PNG_1PX, { filename: 'p.png', contentType: 'image/png' }).expect(201);
    await s.as('post', `/laundry/pieces/${pieces[0]!.itemId}/status`).send({ status: 'washing' }).expect(200);
  });
});
