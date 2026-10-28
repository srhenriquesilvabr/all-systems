import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

// Integração bancária: catálogo de administradoras, modo manual (sem API: a equipe registra a
// resposta e o consórcio acompanha igual) e adaptador próprio ainda em esqueleto ("a confirmar").

describe('integração bancária: catálogo e modo manual', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const applicant = { name: 'Carla Manual', document: '12345678909', monthlyIncome: 8000 };

  it('catálogo com o que cada administradora oferece e o que é preciso para ligar', async () => {
    const s = await ownerSession(t, ['consortium']);
    const { body } = await s.as('get', '/banking/catalog').expect(200);
    const keys = body.administrators.map((a: { key: string }) => a.key);
    expect(keys).toEqual(expect.arrayContaining(['itau', 'bradesco', 'caixa', 'santander', 'embracon', 'porto', 'rodobens', 'ademicon']));
    const embracon = body.administrators.find((a: { key: string }) => a.key === 'embracon');
    expect(embracon).toMatchObject({ kind: 'independent', confirmed: false, vendorAdapter: 'pending' });
    expect(embracon.requirements.length).toBeGreaterThan(0);
    expect(body.vendorPendingItems.length).toBeGreaterThan(0);

    await s.as('post', '/banking/connections').send({ name: 'Fora', catalogKey: 'nao-existe', mode: 'manual', products: ['consortium'] }).expect(400);
    // Adaptador próprio exige a administradora do catálogo.
    await s.as('post', '/banking/connections').send({ name: 'Sem catálogo', mode: 'api', adapter: 'vendor', products: ['consortium'] }).expect(400);
  });

  it('modo manual: planos cadastrados, adesão registrada, resposta da equipe ativa a cota com grupo e cota', async () => {
    const s = await ownerSession(t, ['consortium']);
    // Só a administradora manual, para os planos virem dela.
    for (const c of (await s.as('get', '/banking/connections').expect(200)).body) await s.as('patch', `/banking/connections/${c.id}`).send({ ...c, active: false }).expect(200);
    const { body: conn } = await s
      .as('post', '/banking/connections')
      .send({
        name: 'Embracon',
        catalogKey: 'embracon',
        mode: 'manual',
        products: ['consortium'],
        manualPlans: [{ name: 'Imóvel 300 mil', assetType: 'real_estate', creditValue: 300000, termMonths: 200, adminFeePercent: 17, reserveFundPercent: 2, insurancePercent: 0.03 }],
      })
      .expect(201);
    expect(conn).toMatchObject({ mode: 'manual', catalogKey: 'embracon', manualPlans: [expect.objectContaining({ name: 'Imóvel 300 mil' })] });

    const { body: plans } = await s.as('post', '/consortium/plans/sync').expect(200);
    expect(plans).toEqual([expect.objectContaining({ name: 'Imóvel 300 mil', institution: 'Embracon', creditValue: 300000, termMonths: 200 })]);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Carla Manual', phone: '(48) 99333-4444', email: uniqueEmail('manual') }).expect(201);
    const { body: quota } = await s.as('post', '/consortium/quotas').send({ customerId: customer.id, planId: plans[0].id, applicant }).expect(201);
    expect(quota.status).toBe('proposal');

    const { body: [proposal] } = await s.as('get', `/banking/proposals?sourceType=consortium_quota&sourceId=${quota.id}`).expect(200);
    expect(proposal).toMatchObject({ status: 'submitted', connection: { mode: 'manual' } });
    expect(proposal.externalId).toMatch(/^MAN-/);
    // Sem API: "consultar" não muda nada.
    expect((await s.as('post', `/banking/proposals/${proposal.id}/refresh`).expect(200)).body.status).toBe('submitted');

    // Aprovação de consórcio exige grupo e cota.
    expect((await s.as('post', `/banking/proposals/${proposal.id}/manual`).send({ status: 'approved' }).expect(400)).body.code).toBe('GROUP_REQUIRED');
    await s.as('post', `/banking/proposals/${proposal.id}/manual`).send({ status: 'contracted' }).expect(400);
    const { body: approved } = await s
      .as('post', `/banking/proposals/${proposal.id}/manual`)
      .send({ status: 'approved', groupCode: 'E1234', quotaNumber: '077', externalId: 'EMB-998877', message: 'Aprovada no portal do parceiro' })
      .expect(200);
    expect(approved).toMatchObject({ status: 'approved', externalId: 'EMB-998877', result: { groupCode: 'E1234', quotaNumber: '077' } });
    expect(approved.events.at(-1)).toMatchObject({ status: 'approved', source: 'manual' });

    await t.relay.drain();
    const { body: active } = await s.as('get', `/consortium/quotas/${quota.id}`).expect(200);
    expect(active).toMatchObject({ status: 'active', groupCode: 'E1234', quotaNumber: '077' });
    const { body: inst } = await s.as('get', `/consortium/quotas/${quota.id}/installments`).expect(200);
    expect(inst.total).toBe(200);
  });

  it('API com adaptador da administradora: esqueleto responde "a confirmar" sem chamar ninguém', async () => {
    const s = await ownerSession(t, ['consortium']);
    for (const c of (await s.as('get', '/banking/connections').expect(200)).body) await s.as('patch', `/banking/connections/${c.id}`).send({ ...c, active: false }).expect(200);
    await s.as('post', '/banking/connections').send({ name: 'Porto', catalogKey: 'porto', mode: 'api', adapter: 'vendor', products: ['consortium'] }).expect(201);
    const calls = t.bankApi.calls.length;
    const res = await s.as('post', '/consortium/plans/sync').expect(502);
    expect(res.body.message ?? res.text).toMatch(/a confirmar/);
    expect(t.bankApi.calls.length).toBe(calls);
  });
});
