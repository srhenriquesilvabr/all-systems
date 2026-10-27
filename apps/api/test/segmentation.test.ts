import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${localToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe('segmentação de clientes (RFM)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('classifica pela recência, frequência e valor de 12 meses, e exporta a lista', async () => {
    const s = await ownerSession(t, ['laundry']);
    const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
    const customer = async (name: string) => (await s.as('post', '/customers').send({ name }).expect(201)).body as { id: string };
    const paid = (customerId: string, amount: number, ago: number) =>
      s
        .as('post', '/finance/entries')
        .send({ kind: 'income', description: 'Serviço', amount, status: 'paid', dueDate: daysAgo(ago), paidAt: daysAgo(ago), accountId: accounts[0].id, customerId })
        .expect(201);

    const ana = await customer('Ana Fiel');
    for (const ago of [1, 20, 40, 70, 100, 150]) await paid(ana.id, 200, ago);
    const bruno = await customer('Bruno Novo');
    await paid(bruno.id, 50, 3);
    const carla = await customer('Carla Sumida');
    for (const ago of [200, 230, 260, 290]) await paid(carla.id, 100, ago);
    const davi = await customer('Davi Antigo');
    await paid(davi.id, 300, 400);
    const eva = await customer('Eva Só Orçamento');
    await s.as('post', '/finance/entries').send({ kind: 'income', description: 'Orçamento', amount: 90, status: 'pending', dueDate: daysAgo(-5), customerId: eva.id }).expect(201);

    const { body: summary } = await s.as('post', '/segmentation/recompute').expect(201);
    expect(summary).toMatchObject({ customers: 5, withoutPurchases: 1 });
    const bySegment = Object.fromEntries(summary.segments.map((x: { segment: string; customers: number }) => [x.segment, x.customers]));
    expect(bySegment).toEqual({ champions: 1, new: 1, at_risk: 1, lost: 1 });

    const { body: rows } = await s.as('get', '/segmentation/customers').expect(200);
    const of = (id: string) => rows.find((r: { customer: { id: string } }) => r.customer.id === id);
    expect(of(ana.id)).toMatchObject({ segment: 'champions', frequency: 6, monetary: 1200, recencyDays: 1 });
    expect(of(bruno.id)).toMatchObject({ segment: 'new', frequency: 1 });
    expect(of(carla.id)).toMatchObject({ segment: 'at_risk', frequency: 4, recencyDays: 200 });
    expect(of(davi.id)).toMatchObject({ segment: 'lost', frequency: 0, monetary: 0 });
    expect((await s.as('get', `/segmentation/customers/${eva.id}`).expect(200)).body).toEqual({});

    const csv = await s.as('get', '/segmentation/customers.csv?segment=at_risk').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Carla Sumida;;;Em risco;');
    expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('o job recalcula para todas as empresas e cada uma só vê os seus', async () => {
    const a = await ownerSession(t, ['laundry']);
    const b = await ownerSession(t, ['laundry']);
    const { body: accounts } = await a.as('get', '/finance/accounts').expect(200);
    const { body: c } = await a.as('post', '/customers').send({ name: 'Cliente A' }).expect(201);
    await a
      .as('post', '/finance/entries')
      .send({ kind: 'income', description: 'Serviço', amount: 80, status: 'paid', dueDate: localToday(), paidAt: localToday(), accountId: accounts[0].id, customerId: c.id })
      .expect(201);
    await t.jobs.runOnce('core.segmentation');
    expect((await a.as('get', '/segmentation/summary').expect(200)).body.segments).toEqual([expect.objectContaining({ segment: 'promising', customers: 1 })]);
    expect((await b.as('get', '/segmentation/summary').expect(200)).body.segments).toEqual([]);
  });
});
