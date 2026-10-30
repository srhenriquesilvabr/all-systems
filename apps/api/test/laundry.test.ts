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
        { serviceName: 'Lavagem por quilo', unit: 'kg', quantity: 5.5, contracted: 109.45 },
        { serviceName: 'Lavar e passar', unit: 'piece', quantity: 2, contracted: 29.8 },
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
    expect(then.byService).toEqual([{ serviceName: 'Lavagem por quilo', unit: 'kg', quantity: 5.5, contracted: 109.45 }]);
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

describe('lavanderia — coleta e entrega', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const address = { street: 'Rua das Flores', number: '10', district: 'Centro', city: 'São Paulo', state: 'SP', zip: '01000-000' };
  type Job = {
    id: string;
    kind: string;
    status: string;
    date: string;
    period: string | null;
    windowStart: string;
    windowEnd: string;
    fee: number;
    feeStatus: string | null;
    address: Record<string, string>;
    mapsUrl: string | null;
    driver: { id: string; name: string } | null;
    order: { id: string; number: number; status: string } | null;
    itemsCount: number | null;
    receiverName: string | null;
    completedAt: string | null;
    failReason: string | null;
    attempts: number;
    photos: { id: string }[];
  };

  async function setup() {
    const s = await ownerSession(t, ['laundry']);
    const email = uniqueEmail('cliente');
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Rita Cliente', email, phone: '+5511987654321', address }).expect(201);
    const { body: services } = await s.as('get', '/laundry/services').expect(200);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name);
    return { ...s, customer, customerEmail: email, service };
  }
  type S = Awaited<ReturnType<typeof setup>>;

  async function readyOrder(s: S) {
    const { body } = await s
      .as('post', '/laundry/orders')
      .send({ customerId: s.customer.id, lines: [{ serviceId: s.service('Lavar e passar').id, quantity: 2 }] })
      .expect(201);
    await s.as('post', '/laundry/pieces/status').send({ itemIds: body.pieces.map((p: { itemId: string }) => p.itemId), status: 'ready' }).expect(200);
    return body.order as { id: string; number: number; total: number };
  }

  /** Convida alguém com o papel Motorista e devolve o id (para atribuir) e um atalho autenticado. */
  async function inviteDriver(s: S, name: string) {
    const roles = await s.as('get', '/access/roles').expect(200);
    const role = roles.body.find((r: { key: string }) => r.key === 'laundry.driver');
    const email = uniqueEmail('motorista');
    await s.as('post', '/users/invite').send({ email, name, roleIds: [role.id] }).expect(201);
    await t.http().post('/api/auth/set-password').send({ token: tokenFromMail(t.mails.findLast((m) => m.to === email)), password: PASSWORD }).expect(204);
    const { token } = await login(t, email);
    const team = await s.as('get', '/users/team').expect(200);
    const id = team.body.find((m: { name: string }) => m.name === name).id as string;
    const as = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => t.http()[method](`/api${path}`).set(auth(token));
    return { id, as };
  }

  const feeEntries = async (s: S, jobId: string) => {
    const res = await s.as('get', '/finance/entries?limit=200').expect(200);
    return res.body.items.filter((e: { sourceId: string }) => e.sourceId === jobId) as { status: string; amount: number; sourceType: string; paymentMethod: string | null }[];
  };
  const lastMail = (s: S) => t.mails.findLast((m) => m.to === s.customerEmail);

  it('agenda a coleta com o endereço do cadastro e a taxa padrão, conclui com as peças e abre a ordem ligada a ela', async () => {
    const s = await setup();
    await s.as('put', '/modules/laundry/settings').send({ pickupFee: 8, deliveryFee: 12 }).expect(204);

    const { body: job } = (await s
      .as('post', '/laundry/logistics/pickups')
      .send({ customerId: s.customer.id, date: spDay(1), period: 'morning', notes: 'Interfone 12' })
      .expect(201)) as { body: Job };
    expect(job).toMatchObject({ kind: 'pickup', status: 'scheduled', date: spDay(1), period: 'morning', windowStart: '08:00', windowEnd: '12:00', fee: 8, feeStatus: 'pending', order: null });
    expect(job.address).toMatchObject({ street: 'Rua das Flores', number: '10', city: 'São Paulo' });
    expect(job.mapsUrl).toContain('https://www.google.com/maps/search/?api=1&query=Rua%20das%20Flores');
    expect(await feeEntries(s, job.id)).toEqual([expect.objectContaining({ status: 'pending', amount: 8, sourceType: 'laundry_logistics' })]);
    await t.relay.drain();
    expect(lastMail(s)?.subject).toMatch(/^Coleta agendada para /);
    expect(lastMail(s)?.text).toContain('Rua das Flores, 10');

    await s.as('post', `/laundry/logistics/jobs/${job.id}/start`).expect(200);
    await t.relay.drain();
    expect(lastMail(s)?.subject).toBe('Estamos a caminho para buscar suas peças');

    const noItems = await s.as('post', `/laundry/logistics/jobs/${job.id}/complete`).send({}).expect(400);
    expect(noItems.body.code).toBe('ITEMS_REQUIRED');
    const { body: done } = await s.as('post', `/laundry/logistics/jobs/${job.id}/complete`).send({ itemsCount: 6 }).expect(200);
    expect(done).toMatchObject({ status: 'done', itemsCount: 6 });
    expect(done.completedAt).toBeTruthy();

    // No balcão, a ordem aberta a partir da coleta fica ligada a ela (uma vez só).
    const lines = [{ serviceId: s.service('Lavar e passar').id, quantity: 6 }];
    const { body: opened } = await s.as('post', '/laundry/orders').send({ customerId: s.customer.id, lines, pickupJobId: job.id }).expect(201);
    const { body: linked } = await s.as('get', `/laundry/logistics/jobs/${job.id}`).expect(200);
    expect(linked.order).toMatchObject({ id: opened.order.id, number: opened.order.number });
    const again = await s.as('post', '/laundry/orders').send({ customerId: s.customer.id, lines, pickupJobId: job.id }).expect(409);
    expect(again.body.code).toBe('PICKUP_ALREADY_LINKED');
  });

  it('entrega de ordem pronta com taxa: a taxa é um "a receber" à parte; motorista sai, entrega com comprovante e a ordem fica entregue', async () => {
    const s = await setup();
    const driver = await inviteDriver(s, 'Zé Entregador');
    const order = await readyOrder(s);

    const { body: job } = (await s
      .as('post', `/laundry/orders/${order.id}/delivery`)
      .send({ date: spDay(0), windowStart: '14:00', windowEnd: '16:00', fee: 10, driverUserId: driver.id })
      .expect(201)) as { body: Job };
    expect(job).toMatchObject({ kind: 'delivery', status: 'scheduled', period: null, windowStart: '14:00', windowEnd: '16:00', fee: 10, feeStatus: 'pending' });
    expect(job.order).toMatchObject({ id: order.id, number: order.number, status: 'ready' });
    expect(job.driver).toEqual({ id: driver.id, name: 'Zé Entregador' });
    await t.relay.drain();
    expect(lastMail(s)?.subject).toBe(`Entrega agendada — ordem nº ${order.number}`);

    // A taxa não mexe no total da ordem: vira um lançamento próprio.
    const { body: detail } = await s.as('get', `/laundry/orders/${order.id}`).expect(200);
    expect(detail.order.total).toBe(order.total);
    expect(await feeEntries(s, job.id)).toEqual([expect.objectContaining({ status: 'pending', amount: 10, sourceType: 'laundry_logistics' })]);

    const twice = await s.as('post', `/laundry/orders/${order.id}/delivery`).send({ date: spDay(0), period: 'evening' }).expect(409);
    expect(twice.body.code).toBe('DELIVERY_EXISTS');

    // O motorista sai: a ordem vai para "Saiu para entrega" e o cliente é avisado.
    const { body: started } = await driver.as('post', `/laundry/logistics/jobs/${job.id}/start`).expect(200);
    expect(started.status).toBe('en_route');
    expect(started.order.status).toBe('out_for_delivery');
    await t.relay.drain();
    expect(lastMail(s)?.subject).toBe(`Ordem nº ${order.number} saiu para entrega`);

    const noReceiver = await driver.as('post', `/laundry/logistics/jobs/${job.id}/complete`).send({}).expect(400);
    expect(noReceiver.body.code).toBe('RECEIVER_REQUIRED');

    const photo = await driver
      .as('post', `/laundry/logistics/jobs/${job.id}/photos`)
      .attach('photo', PNG_1PX, { filename: 'comprovante.png', contentType: 'image/png' })
      .expect(201);
    const { body: done } = await driver
      .as('post', `/laundry/logistics/jobs/${job.id}/complete`)
      .send({ receiverName: 'Porteiro João', feeMethod: 'cash' })
      .expect(200);
    expect(done).toMatchObject({ status: 'done', receiverName: 'Porteiro João', feeStatus: 'paid' });
    expect(done.completedAt).toBeTruthy();
    expect(done.photos).toEqual([{ id: photo.body.id, filename: 'comprovante.png' }]);
    expect(done.order.status).toBe('delivered');

    const { body: delivered } = await s.as('get', `/laundry/orders/${order.id}`).expect(200);
    expect(delivered.order.status).toBe('delivered');
    expect(delivered.order.history.slice(-2).map((h: { to: string }) => h.to)).toEqual(['out_for_delivery', 'delivered']);
    await t.relay.drain();
    expect(lastMail(s)?.subject).toBe(`Ordem nº ${order.number} entregue`);

    const fees = await feeEntries(s, job.id);
    expect(fees.filter((e) => e.status === 'pending')).toEqual([]);
    expect(fees).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'paid', amount: 10, paymentMethod: 'cash' })]));
  });

  it('motorista só vê e movimenta as tarefas atribuídas a ele', async () => {
    const s = await setup();
    const ana = await inviteDriver(s, 'Ana Motorista');
    const beto = await inviteDriver(s, 'Beto Motorista');
    const schedule = async (driverUserId: string | null, period: string) =>
      (await s.as('post', '/laundry/logistics/pickups').send({ customerId: s.customer.id, date: spDay(0), period, driverUserId }).expect(201)).body as Job;
    const forAna = await schedule(ana.id, 'afternoon');
    const forAnaEarly = await schedule(ana.id, 'morning');
    const forBeto = await schedule(beto.id, 'morning');
    await schedule(null, 'evening');

    // Rota da Ana: só as dela, na ordem das janelas.
    const { body: route } = await ana.as('get', '/laundry/logistics/my-route').expect(200);
    expect(route.map((j: Job) => j.id)).toEqual([forAnaEarly.id, forAna.id]);

    await ana.as('get', '/laundry/logistics/jobs').expect(403);
    await ana.as('post', '/laundry/logistics/pickups').send({ customerId: s.customer.id, date: spDay(0), period: 'morning' }).expect(403);
    await ana.as('patch', `/laundry/logistics/jobs/${forAna.id}`).send({ driverUserId: beto.id }).expect(403);
    await ana.as('get', `/laundry/logistics/jobs/${forBeto.id}`).expect(404);
    await ana.as('post', `/laundry/logistics/jobs/${forBeto.id}/start`).expect(404);
    await ana.as('get', '/laundry/production').expect(403);
    await ana.as('get', `/laundry/logistics/jobs/${forAna.id}`).expect(200);

    // O escritório vê tudo e filtra por motorista ou pelas sem motorista.
    const { body: all } = await s.as('get', `/laundry/logistics/jobs?date=${spDay(0)}`).expect(200);
    expect(all).toHaveLength(4);
    const { body: onlyBeto } = await s.as('get', `/laundry/logistics/jobs?date=${spDay(0)}&driverId=${beto.id}`).expect(200);
    expect(onlyBeto.map((j: Job) => j.id)).toEqual([forBeto.id]);
    const { body: unassigned } = await s.as('get', `/laundry/logistics/jobs?date=${spDay(0)}&driverId=none`).expect(200);
    expect(unassigned).toHaveLength(1);

    // Reatribuída para o Beto, some da rota da Ana.
    await s.as('patch', `/laundry/logistics/jobs/${forAna.id}`).send({ driverUserId: beto.id }).expect(200);
    const { body: after } = await ana.as('get', '/laundry/logistics/my-route').expect(200);
    expect(after.map((j: Job) => j.id)).toEqual([forAnaEarly.id]);
  });

  it('entrega não realizada: registra o motivo, a ordem volta para "Pronta" e a entrega pode ser reagendada', async () => {
    const s = await setup();
    const driver = await inviteDriver(s, 'Caio Motorista');
    const order = await readyOrder(s);
    const { body: job } = (await s
      .as('post', `/laundry/orders/${order.id}/delivery`)
      .send({ date: spDay(0), period: 'morning', driverUserId: driver.id })
      .expect(201)) as { body: Job };
    expect(job.fee).toBe(0); // sem taxa padrão configurada
    expect(job.feeStatus).toBeNull();

    await driver.as('post', `/laundry/logistics/jobs/${job.id}/start`).expect(200);
    await driver.as('post', `/laundry/logistics/jobs/${job.id}/fail`).send({ reason: '' }).expect(400);
    const { body: failed } = await driver.as('post', `/laundry/logistics/jobs/${job.id}/fail`).send({ reason: 'Cliente ausente' }).expect(200);
    expect(failed).toMatchObject({ status: 'failed', failReason: 'Cliente ausente', attempts: 1 });
    expect(failed.order.status).toBe('ready');

    const { body: detail } = await s.as('get', `/laundry/orders/${order.id}`).expect(200);
    expect(detail.order.status).toBe('ready');
    expect(detail.order.history.at(-1)).toMatchObject({ from: 'out_for_delivery', to: 'ready', reason: 'Entrega não realizada: Cliente ausente' });

    const again = await driver.as('post', `/laundry/logistics/jobs/${job.id}/start`).expect(400);
    expect(again.body.code).toBe('INVALID_JOB_STATUS');
    const { body: pending } = await s.as('get', '/laundry/logistics/jobs?status=failed').expect(200);
    expect(pending.map((j: Job) => j.id)).toContain(job.id);

    // Reagendada para amanhã à tarde: volta para "Agendada", com o histórico da tentativa.
    const { body: rescheduled } = await s.as('patch', `/laundry/logistics/jobs/${job.id}`).send({ date: spDay(1), period: 'afternoon' }).expect(200);
    expect(rescheduled).toMatchObject({ status: 'scheduled', date: spDay(1), windowStart: '12:00', attempts: 1 });
    await s.as('post', `/laundry/orders/${order.id}/delivery`).send({ date: spDay(1), period: 'evening' }).expect(409);
  });

  it('valida endereço, data e janela ao agendar', async () => {
    const s = await setup();
    const { body: noAddress } = await s.as('post', '/customers').send({ name: 'Sem Endereço', email: uniqueEmail('sem') }).expect(201);
    const missing = await s.as('post', '/laundry/logistics/pickups').send({ customerId: noAddress.id, date: spDay(0), period: 'morning' }).expect(400);
    expect(missing.body.code).toBe('ADDRESS_REQUIRED');
    // Endereço informado na hora vale só para esta coleta.
    const { body: job } = await s
      .as('post', '/laundry/logistics/pickups')
      .send({ customerId: noAddress.id, date: spDay(0), period: 'morning', address: { street: 'Av. Brasil', number: '500', city: 'Santos' } })
      .expect(201);
    expect(job.addressText).toBe('Av. Brasil, 500 — Santos');

    await s.as('post', '/laundry/logistics/pickups').send({ customerId: s.customer.id, date: spDay(0) }).expect(400);
    await s.as('post', '/laundry/logistics/pickups').send({ customerId: s.customer.id, date: spDay(0), windowStart: '15:00', windowEnd: '14:00' }).expect(400);

    // Entrega só para ordem ainda não entregue/cancelada.
    const order = await readyOrder(s);
    await s.as('post', `/service-orders/${order.id}/transition`).send({ to: 'delivered' }).expect(201);
    const closed = await s.as('post', `/laundry/orders/${order.id}/delivery`).send({ date: spDay(0), period: 'morning' }).expect(400);
    expect(closed.body.code).toBe('ORDER_NOT_OPEN');
  });

  it('registra depois coleta e entrega que já aconteceram: dia passado, horário de cada passo, taxa na data e sem aviso ao cliente', async () => {
    const s = await setup();
    await s.as('put', '/modules/laundry/settings').send({ pickupFee: 8, deliveryFee: 12 }).expect(204);
    const day = spDay(-2);
    const at = (hhmm: string, d = day) => new Date(`${d}T${hhmm}:00-03:00`).toISOString();
    const job = (id: string, action: string, body: Record<string, unknown> = {}) => s.as('post', `/laundry/logistics/jobs/${id}/${action}`).send(body);

    // Ordem que entrou quatro dias atrás e já está pronta (os avisos dela saem antes da contagem).
    const lines = [{ serviceId: s.service('Lavar e passar').id, quantity: 2 }];
    const { body: created } = await s.as('post', '/laundry/orders').send({ customerId: s.customer.id, lines, receivedAt: spDay(-4) }).expect(201);
    await s.as('post', '/laundry/pieces/status').send({ itemIds: created.pieces.map((p: { itemId: string }) => p.itemId), status: 'ready' }).expect(200);
    await t.relay.drain();
    const mailsBefore = t.mails.filter((m) => m.to === s.customerEmail).length;

    // Coleta de dois dias atrás: agendada no passado, saiu e foi concluída nos horários informados.
    const { body: pickup } = (await s.as('post', '/laundry/logistics/pickups').send({ customerId: s.customer.id, date: day, period: 'morning' }).expect(201)) as { body: Job };
    expect(pickup).toMatchObject({ status: 'scheduled', date: day, feeStatus: 'pending' });
    expect((await job(pickup.id, 'start', { occurredAt: at('10:00', spDay(-3)) }).expect(400)).body.code).toBe('BEFORE_JOB_DATE');
    expect((await job(pickup.id, 'start', { occurredAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400)).body.code).toBe('VALIDATION');
    const { body: started } = await job(pickup.id, 'start', { occurredAt: at('08:10') }).expect(200);
    expect(started).toMatchObject({ status: 'en_route', startedAt: at('08:10') });
    expect((await job(pickup.id, 'complete', { itemsCount: 5, occurredAt: at('08:05') }).expect(400)).body.code).toBe('BEFORE_START');
    const { body: picked } = await job(pickup.id, 'complete', { itemsCount: 5, feeMethod: 'pix', occurredAt: at('08:40') }).expect(200);
    expect(picked).toMatchObject({ status: 'done', startedAt: at('08:10'), completedAt: at('08:40'), feeStatus: 'paid' });
    const fees = await s.as('get', '/finance/entries?limit=200').expect(200);
    const paidFee = fees.body.items.find((e: { sourceId: string; status: string }) => e.sourceId === pickup.id && e.status === 'paid');
    expect(paidFee).toMatchObject({ amount: 8, paymentMethod: 'pix', dueDate: day, paidAt: day });

    // Entrega no mesmo dia: a primeira tentativa não deu certo; a nova tentativa (à tarde) deu.
    const { body: delivery } = (await s.as('post', `/laundry/orders/${created.order.id}/delivery`).send({ date: day, period: 'morning' }).expect(201)) as { body: Job };
    const { body: failed } = await job(delivery.id, 'fail', { reason: 'Cliente ausente', occurredAt: at('09:30') }).expect(200);
    expect(failed).toMatchObject({ status: 'failed', failedAt: at('09:30'), attempts: 1 });
    // Remarcar para o passado só a partir do dia da tentativa que falhou.
    const before = await s.as('patch', `/laundry/logistics/jobs/${delivery.id}`).send({ date: spDay(-3), period: 'afternoon' }).expect(400);
    expect(before.body.code).toBe('DATE_BEFORE_FAILURE');
    const { body: retry } = await s.as('patch', `/laundry/logistics/jobs/${delivery.id}`).send({ date: day, period: 'afternoon' }).expect(200);
    expect(retry).toMatchObject({ status: 'scheduled', date: day, attempts: 1, failedAt: at('09:30') });
    expect((await job(delivery.id, 'start', { occurredAt: at('09:00') }).expect(400)).body.code).toBe('BEFORE_FAILURE');
    await job(delivery.id, 'start', { occurredAt: at('14:00') }).expect(200);
    const { body: delivered } = await job(delivery.id, 'complete', { receiverName: 'Porteiro Zé', feeMethod: 'cash', occurredAt: at('14:30') }).expect(200);
    expect(delivered).toMatchObject({ status: 'done', completedAt: at('14:30'), order: { status: 'delivered' } });

    // A ordem foi entregue naquele horário (histórico e relatório de prazo usam essa data).
    const { body: detail } = await s.as('get', `/laundry/orders/${created.order.id}`).expect(200);
    const when = (to: string) => detail.order.history.find((h: { to: string }) => h.to === to)?.createdAt;
    expect([when('out_for_delivery'), when('delivered')]).toEqual([at('14:00'), at('14:30')]);
    expect(detail.order.status).toBe('delivered');

    // Nada disso avisa o cliente: é registro do que já passou.
    await t.relay.drain();
    expect(t.mails.filter((m) => m.to === s.customerEmail)).toHaveLength(mailsBefore);

    // A agendada que ainda não aconteceu não volta para o passado.
    const { body: future } = await s.as('post', '/laundry/logistics/pickups').send({ customerId: s.customer.id, date: spDay(1), period: 'morning' }).expect(201);
    const back = await s.as('patch', `/laundry/logistics/jobs/${future.id}`).send({ date: spDay(-1) }).expect(400);
    expect(back.body.code).toBe('DATE_IN_PAST');
    // A entrega não pode ser antes da entrada da ordem.
    const { body: newer } = await s.as('post', '/laundry/orders').send({ customerId: s.customer.id, lines }).expect(201);
    await s.as('post', '/laundry/pieces/status').send({ itemIds: newer.pieces.map((p: { itemId: string }) => p.itemId), status: 'ready' }).expect(200);
    const { body: early } = await s.as('post', `/laundry/orders/${newer.order.id}/delivery`).send({ date: day, period: 'morning' }).expect(201);
    expect((await job(early.id, 'start', { occurredAt: at('09:00') }).expect(400)).body.code).toBe('BEFORE_ORDER');
  });
});
