import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

/** Data (YYYY-MM-DD) em São Paulo, `n` dias a partir de hoje. */
const spDay = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + n * 86_400_000));

const PNG_1PX =Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('lavanderia — balcão e produção', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const s = await ownerSession(t, ['laundry', 'integration.payments']);
    const email = uniqueEmail('cliente');
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Rita Cliente', email }).expect(201);
    const { body: services } = await s.as('get', '/laundry/services').expect(200);
    const { body: garments } = await s.as('get', '/laundry/garment-types').expect(200);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name);
    const garment = (name: string) => garments.find((x: { name: string }) => x.name === name);
    return { ...s, customer, customerEmail: email, service, garment };
  }

  async function openOrder(s: Awaited<ReturnType<typeof setup>>, lines?: unknown[]) {
    const res = await s
      .as('post', '/laundry/orders')
      .send({
        customerId: s.customer.id,
        lines: lines ?? [
          { serviceId: s.service('Lavar e passar').id, garmentTypeId: s.garment('Camisa').id, quantity: 2, color: 'azul' },
          { serviceId: s.service('Lavagem por quilo').id, quantity: 8, weightKg: 5.5 },
        ],
      })
      .expect(201);
    return res.body as { order: { id: string; number: number; total: number; status: string; dueAt: string }; pieces: { itemId: string; tagCode: string; status: string }[] };
  }

  const move = (s: Awaited<ReturnType<typeof setup>>, itemIds: string[], status: string) =>
    s.as('post', '/laundry/pieces/status').send({ itemIds, status });

  it('nova lavanderia já vem com serviços e tipos de peça', async () => {
    const s = await setup();
    expect(s.service('Lavar e passar')).toMatchObject({ pricingUnit: 'piece' });
    expect(s.service('Lavagem por quilo')).toMatchObject({ pricingUnit: 'kg' });
    expect(s.garment('Edredom')).toBeTruthy();
  });

  it('abre a ordem com uma etiqueta por peça, preço por tipo de peça e prazo padrão', async () => {
    const s = await setup();
    await s
      .as('put', `/laundry/services/${s.service('Lavar e passar').id}/prices`)
      .send({ prices: [{ garmentTypeId: s.garment('Camisa').id, price: 12 }] })
      .expect(204);

    const { order, pieces } = await openOrder(s);
    // 2 camisas × 12,00 + 5,5 kg × 19,90
    expect(order.total).toBeCloseTo(24 + 109.45);
    expect(order.status).toBe('received');
    expect(pieces.map((p) => p.tagCode)).toEqual([`${order.number}-01`, `${order.number}-02`, `${order.number}-03`]);
    const hours = (new Date(order.dueAt).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(47);
    expect(hours).toBeLessThan(49);

    await t.relay.drain();
    expect(t.mails.findLast((m) => m.to === s.customerEmail)?.subject).toBe(`Recebemos suas peças — ordem nº ${order.number}`);
  });

  it('exige o peso em serviço cobrado por quilo', async () => {
    const s = await setup();
    const res = await s
      .as('post', '/laundry/orders')
      .send({ customerId: s.customer.id, lines: [{ serviceId: s.service('Lavagem por quilo').id, quantity: 3 }] })
      .expect(400);
    expect(res.body.code).toBe('MEASURE_REQUIRED');
  });

  it('a ordem acompanha as peças: produção, pronta, retrabalho', async () => {
    const s = await setup();
    const { order, pieces } = await openOrder(s);
    const ids = pieces.map((p) => p.itemId);
    const status = async () => (await s.as('get', `/laundry/orders/${order.id}`).expect(200)).body.order.status;

    await move(s, [ids[0]!], 'washing').expect(200);
    expect(await status()).toBe('in_process');

    await move(s, ids, 'ready').expect(200);
    expect(await status()).toBe('ready');
    await t.relay.drain();
    expect(t.mails.findLast((m) => m.to === s.customerEmail)?.subject).toBe(`Suas peças estão prontas — ordem nº ${order.number}`);

    // Uma peça volta para a lavagem: retrabalho, e a ordem volta para a produção.
    const [reworked] = (await move(s, [ids[1]!], 'washing').expect(200)).body;
    expect(reworked.reworkCount).toBe(1);
    expect(await status()).toBe('in_process');
    await move(s, [ids[1]!], 'ready').expect(200);
    expect(await status()).toBe('ready');
  });

  it('não deixa marcar a ordem como pronta com peças em produção', async () => {
    const s = await setup();
    const { order } = await openOrder(s);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'in_process' }).expect(201);
    const res = await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'ready' }).expect(400);
    expect(res.body.code).toBe('PIECES_NOT_READY');
  });

  it('depois de entregue, as peças saem da produção', async () => {
    const s = await setup();
    const { order, pieces } = await openOrder(s);
    const ids = pieces.map((p) => p.itemId);
    await move(s, ids, 'ready').expect(200);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'delivered' }).expect(201);

    const board = await s.as('get', '/laundry/production').expect(200);
    expect(board.body.filter((p: { orderId: string }) => p.orderId === order.id)).toEqual([]);
    const res = await move(s, [ids[0]!], 'washing').expect(400);
    expect(res.body.code).toBe('ORDER_CLOSED');
  });

  it('quadro de produção prioriza o prazo e acha a peça pela etiqueta', async () => {
    const s = await setup();
    const late = await openOrder(s, [{ serviceId: s.service('Só passar').id, quantity: 1 }]);
    await s.as('patch', `/service-orders/${late.order.id}`).send({ dueAt: new Date(Date.now() - 3600_000).toISOString() }).expect(200);
    await openOrder(s);

    const board = await s.as('get', '/laundry/production').expect(200);
    expect(board.body[0].orderNumber).toBe(late.order.number);
    const found = await s.as('get', `/laundry/pieces/by-tag/${late.pieces[0]!.tagCode}`).expect(200);
    expect(found.body).toMatchObject({ itemId: late.pieces[0]!.itemId, customerName: 'Rita Cliente' });
  });

  it('ordens da lavanderia só abrem pelo balcão', async () => {
    const s = await setup();
    const res = await s
      .as('post', '/service-orders')
      .send({ customerId: s.customer.id, workflow: 'laundry', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] })
      .expect(400);
    expect(res.body.code).toBe('USE_VERTICAL_ENDPOINT');

    const other = await ownerSession(t, ['shared.service-orders']);
    const workflows = await other.as('get', '/service-orders/workflows').expect(200);
    expect(workflows.body.map((w: { key: string }) => w.key)).toEqual(['default']);
  });

  it('fotos: guarda, serve só para a própria empresa e recusa o que não é imagem', async () => {
    const s = await setup();
    const { order, pieces } = await openOrder(s);
    const itemId = pieces[0]!.itemId;

    const upload = await s.as('post', `/laundry/pieces/${itemId}/photos`).attach('photo', PNG_1PX, { filename: 'mancha.png', contentType: 'image/png' }).expect(201);
    const file = await s.as('get', `/files/${upload.body.id}`).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body, PNG_1PX)).toBe(0);

    const detail = await s.as('get', `/laundry/orders/${order.id}`).expect(200);
    expect(detail.body.pieces[0].photos).toEqual([{ id: upload.body.id, filename: 'mancha.png' }]);

    const outsider = await ownerSession(t);
    await outsider.as('get', `/files/${upload.body.id}`).expect(404);

    const bad = await s.as('post', `/laundry/pieces/${itemId}/photos`).attach('photo', Buffer.from('oi'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);
    expect(bad.body.code).toBe('INVALID_FILE_TYPE');

    await s.as('delete', `/laundry/pieces/${itemId}/photos/${upload.body.id}`).expect(204);
    await s.as('get', `/files/${upload.body.id}`).expect(404);
  });

  it('ocorrência com peça avisa o cliente e entra na linha do tempo', async () => {
    const s = await setup();
    const { order, pieces } = await openOrder(s);
    const res = await s.as('post', `/laundry/pieces/${pieces[0]!.itemId}/incident`).send({ notes: 'Mancha de caneta não saiu após dois ciclos' }).expect(200);
    expect(res.body.incidentNotes).toBe('Mancha de caneta não saiu após dois ciclos');

    await t.relay.drain();
    const mail = t.mails.findLast((m) => m.to === s.customerEmail)!;
    expect(mail.subject).toBe(`Precisamos falar sobre uma peça da ordem nº ${order.number}`);
    expect(mail.text).toContain(`etiqueta ${pieces[0]!.tagCode}`);
    const timeline = await s.as('get', `/customers/${s.customer.id}/timeline`).expect(200);
    expect(timeline.body.map((e: { type: string }) => e.type)).toContain('laundry.incident');
  });

  it('relatório: entregas no prazo, produção, retrabalho e receita por serviço', async () => {
    const s = await setup();
    const { order, pieces } = await openOrder(s);
    const ids = pieces.map((p) => p.itemId);
    await move(s, ids, 'ready').expect(200);
    await move(s, [ids[0]!], 'ironing').expect(200);
    await move(s, [ids[0]!], 'ready').expect(200);
    await s.as('post', `/laundry/pieces/${ids[1]}/incident`).send({ notes: 'Botão solto, recolocado' }).expect(200);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'delivered' }).expect(201);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const { body: r } = await s.as('get', `/laundry/reports?from=${today}&to=${today}`).expect(200);
    expect(r.delivered).toMatchObject({ total: 1, onTime: 1, withDueDate: 1 });
    expect(r.piecesReady).toBe(4);
    expect(r.reworks).toBe(1);
    expect(r.incidents).toBe(1);
    expect(r.byService).toEqual(
      expect.arrayContaining([
        { serviceName: 'Lavagem por quilo', quantity: 5.5, revenue: 109.45 },
        { serviceName: 'Lavar e passar', quantity: 2, revenue: 29.8 },
      ]),
    );
    expect(r.byOperator[0].moves).toBe(5);
  });

  it('registra ordem antiga: prazo, aviso e relatório seguem a data de entrada', async () => {
    const s = await setup();
    const day = spDay(-20);
    const { body } = await s
      .as('post', '/laundry/orders')
      .send({ customerId: s.customer.id, receivedAt: day, lines: [{ serviceId: s.service('Lavagem por quilo').id, quantity: 8, weightKg: 5.5 }] })
      .expect(201);
    const { order, pieces } = body as { order: { id: string; receivedAt: string; dueAt: string }; pieces: { itemId: string; statusChangedAt: string }[] };
    expect(order.receivedAt).toBe(new Date(`${day}T12:00:00-03:00`).toISOString());
    // Prazo padrão (48 h) contado da entrada, não de agora.
    expect(new Date(order.dueAt).getTime() - new Date(order.receivedAt).getTime()).toBe(48 * 3600_000);
    expect(pieces[0]!.statusChangedAt).toBe(order.receivedAt);

    // Ordem antiga não manda "recebemos suas peças".
    await t.relay.drain();
    expect(t.mails.filter((m) => m.to === s.customerEmail)).toEqual([]);

    // Receita por serviço entra no dia da entrada.
    const { body: then } = await s.as('get', `/laundry/reports?from=${day}&to=${day}`).expect(200);
    expect(then.byService).toEqual([{ serviceName: 'Lavagem por quilo', quantity: 5.5, revenue: 109.45 }]);
    const today = spDay(0);
    const { body: before } = await s.as('get', `/laundry/reports?from=${today}&to=${today}`).expect(200);
    expect(before.byService).toEqual([]);

    // Entregue hoje: o tempo de atendimento conta da entrada (uns 20 dias) e saiu fora do prazo.
    await move(s, pieces.map((p) => p.itemId), 'ready').expect(200);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'delivered' }).expect(201);
    const { body: now } = await s.as('get', `/laundry/reports?from=${today}&to=${today}`).expect(200);
    expect(now.delivered).toMatchObject({ total: 1, onTime: 0, withDueDate: 1 });
    expect(now.delivered.avgHours).toBeGreaterThan(19 * 24);
  });

  it('não aceita ordem com data de entrada no futuro', async () => {
    const s = await setup();
    const res = await s
      .as('post', '/laundry/orders')
      .send({ customerId: s.customer.id, receivedAt: spDay(2), lines: [{ serviceId: s.service('Só passar').id, quantity: 1 }] })
      .expect(400);
    expect(String(res.body.message)).toMatch(/não pode ser no futuro/);
  });

  it('operador move peças, mas não abre ordens', async () => {
    const s = await setup();
    const { pieces } = await openOrder(s);
    const roles = await s.as('get', '/access/roles').expect(200);
    const operator = roles.body.find((r: { key: string }) => r.key === 'laundry.operator');
    const email = uniqueEmail('operador');
    await s.as('post', '/users/invite').send({ email, name: 'Operador', roleIds: [operator.id] }).expect(201);
    await t.http().post('/api/auth/set-password').send({ token: tokenFromMail(t.mails.findLast((m) => m.to === email)), password: PASSWORD }).expect(204);
    const { token } = await login(t, email);

    await t.http().post('/api/laundry/pieces/status').set(auth(token)).send({ itemIds: [pieces[0]!.itemId], status: 'washing' }).expect(200);
    await t.http().post('/api/laundry/orders').set(auth(token)).send({ customerId: s.customer.id, lines: [] }).expect(403);
  });

  describe('Pix', () => {
    it('gera o copia e cola com a chave configurada pela empresa', async () => {
      const s = await setup();
      const notConfigured = await s.as('post', '/payments/pix').send({ amount: 10, reference: 'OS1' }).expect(400);
      expect(notConfigured.body.code).toBe('PIX_NOT_CONFIGURED');

      await s.as('put', '/modules/integration.payments/settings').send({ pixKey: '123', merchantName: 'X', merchantCity: 'Y' }).expect(400);
      await s
        .as('put', '/modules/integration.payments/settings')
        .send({ pixKey: 'pix@bolha.com.br', merchantName: 'Lavanderia Bolha', merchantCity: 'São Paulo' })
        .expect(204);
      const settings = await s.as('get', '/modules/integration.payments/settings').expect(200);
      expect(settings.body.pixKey).toBe('pix@bolha.com.br');

      const { body } = await s.as('post', '/payments/pix').send({ amount: 133.45, reference: 'OS-42' }).expect(200);
      expect(body.payload).toContain('0014br.gov.bcb.pix0116pix@bolha.com.br');
      expect(body.payload).toContain('5406133.45');
      expect(body.payload).toContain('62080504OS42');
    });

    it('sem o módulo contratado, não há Pix', async () => {
      const s = await ownerSession(t, ['laundry']);
      const res = await s.as('post', '/payments/pix').send({ amount: 10, reference: 'OS1' }).expect(403);
      expect(res.body.code).toBe('MODULE_NOT_ENABLED');
    });
  });
});
