import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpf, createTestApp, ownerSession, type TestApp } from './helpers';

describe('Financeiro: cliente nos lançamentos', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('a lista traz o cliente, e a busca encontra pelo nome dele', async () => {
    const s = await ownerSession(t);
    const customer = async (name: string) => (await s.as('post', '/customers').send({ type: 'person', name, document: cpf() }).expect(201)).body;
    const ana = await customer('Ana Paciente');
    const bia = await customer('Bia Paciente');
    const entry = (customerId: string | null) => ({ kind: 'income', description: 'Mensalidade 3/24', amount: 300, dueDate: '2026-11-10', status: 'pending', customerId });
    await s.as('post', '/finance/entries').send(entry(ana.id)).expect(201);
    await s.as('post', '/finance/entries').send(entry(bia.id)).expect(201);
    await s.as('post', '/finance/entries').send(entry(null)).expect(201);

    const list = async (q?: string) => (await s.as('get', '/finance/entries').query({ q }).expect(200)).body;
    const all = await list();
    expect(all.items.map((e: { customerName: string | null }) => e.customerName).sort()).toEqual(['Ana Paciente', 'Bia Paciente', null].sort());

    const found = await list('ana pac');
    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({ customerId: ana.id, customerName: 'Ana Paciente' });
    expect(found.sums.income).toBe(300);
    // A descrição continua valendo na busca.
    expect((await list('mensalidade')).total).toBe(3);
  });

  it('a busca não enxerga cliente de outra empresa', async () => {
    const a = await ownerSession(t);
    const b = await ownerSession(t);
    const { body: other } = await b.as('post', '/customers').send({ type: 'person', name: 'Cliente Exclusivo Xyz', document: cpf() }).expect(201);
    await b.as('post', '/finance/entries').send({ kind: 'income', description: 'Serviço', amount: 10, dueDate: '2026-11-10', status: 'pending', customerId: other.id }).expect(201);
    expect((await a.as('get', '/finance/entries').query({ q: 'Exclusivo Xyz' }).expect(200)).body.total).toBe(0);
  });
});
