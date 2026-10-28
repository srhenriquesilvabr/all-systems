import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

// Consulta de crédito (birôs): autorização do cliente obrigatória, resultado simulado
// determinístico, custo e teto mensal, decisão e auditoria, adaptadores reais ainda pendentes
// ("a confirmar") e a exigência de consulta aprovada na venda da cota. Nenhum birô é chamado.

const consent = (over: Record<string, unknown> = {}) => ({ givenAt: '2026-01-15', method: 'signed_term', evidence: 'Termo assinado na pasta do cliente', confirmed: true, ...over });

describe('consulta de crédito (birôs)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('só consulta com a autorização registrada; resultado, custo, decisão, histórico e auditoria', async () => {
    const s = await ownerSession(t, ['consortium', 'integration.credit_bureau']);
    const { body: status } = await s.as('get', '/credit-bureau/status').expect(200);
    expect(status).toMatchObject({ provider: 'simulated', simulated: true, month: { count: 0, cost: 0 } });
    await s.as('put', '/modules/integration.credit_bureau/settings').send({ costPerQueryPf: 3.5, costPerQueryPj: 7.9, suggestedMinScore: 600 }).expect(204);

    const base = { document: '123.456.789-09', subjectName: 'Carla Proponente', purpose: 'consortium_sale' };
    await s.as('post', '/credit-bureau/queries').send({ ...base, consent: consent({ confirmed: false }) }).expect(400);
    await s.as('post', '/credit-bureau/queries').send({ ...base, consent: consent({ givenAt: '2999-01-01' }) }).expect(400);
    await s.as('post', '/credit-bureau/queries').send({ ...base, document: '111.111.111-11', consent: consent() }).expect(400);

    const { body: q } = await s.as('post', '/credit-bureau/queries').send({ ...base, sourceType: 'consortium_lead', sourceId: '00000000-0000-4000-8000-000000000001', consent: consent() }).expect(201);
    expect(q).toMatchObject({ status: 'done', simulated: true, provider: 'simulated', document: '12345678909', documentType: 'cpf', cost: 3.5, decision: 'pending', suggestedMinScore: 600, queriedBy: 'Dono Teste' });
    expect(q.score).toBeGreaterThanOrEqual(150);
    expect(q.score).toBeLessThanOrEqual(950);
    expect(q.summary).toEqual(expect.objectContaining({ negativeRecords: expect.any(Object), protests: expect.any(Object) }));
    expect(q.consent).toMatchObject({ purpose: 'consortium_sale', method: 'signed_term', givenAt: '2026-01-15', evidence: 'Termo assinado na pasta do cliente', recordedBy: 'Dono Teste', version: 'v1' });
    expect(q.consent.text).toContain('análise da proposta de consórcio');

    // Mesmo documento: mesmo resultado (simulação determinística). CNPJ custa o valor de PJ.
    const { body: again } = await s.as('post', '/credit-bureau/queries').send({ ...base, consent: consent({ method: 'recorded_call' }) }).expect(201);
    expect(again.score).toBe(q.score);
    const { body: pj } = await s.as('post', '/credit-bureau/queries').send({ document: '11.222.333/0001-81', subjectName: 'Empresa Proponente', purpose: 'credit_analysis', consent: consent() }).expect(201);
    expect(pj).toMatchObject({ documentType: 'cnpj', cost: 7.9 });

    const { body: decided } = await s.as('post', `/credit-bureau/queries/${q.id}/decision`).send({ decision: 'rejected', note: 'Pendências recentes' }).expect(200);
    expect(decided).toMatchObject({ decision: 'rejected', decisionNote: 'Pendências recentes', decidedBy: 'Dono Teste' });
    expect((await s.as('get', '/credit-bureau/queries?sourceType=consortium_lead&sourceId=00000000-0000-4000-8000-000000000001').expect(200)).body).toHaveLength(1);
    expect((await s.as('get', '/credit-bureau/queries?document=12345678909').expect(200)).body).toHaveLength(2);
    await s.as('get', `/credit-bureau/queries/${q.id}`).expect(200);

    const { body: month } = await s.as('get', '/credit-bureau/status').expect(200);
    expect(month.month).toEqual({ count: 3, cost: 14.9 });
    const { body: audit } = await s.as('get', '/audit?limit=50').expect(200);
    const actions = (audit.items ?? audit).map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['credit_bureau.query', 'credit_bureau.decision', 'credit_bureau.query.viewed']));
    // O documento não vai inteiro para a auditoria.
    expect(JSON.stringify(audit)).not.toContain('12345678909');
  });

  it('teto mensal e birôs reais com adaptador pendente (a confirmar)', async () => {
    const s = await ownerSession(t, ['integration.credit_bureau']);
    await s.as('put', '/modules/integration.credit_bureau/settings').send({ monthlyLimit: 1 }).expect(204);
    const body = { document: '529.982.247-25', subjectName: 'Pedro Teto', purpose: 'credit_analysis', consent: consent() };
    await s.as('post', '/credit-bureau/queries').send(body).expect(201);
    expect((await s.as('post', '/credit-bureau/queries').send(body).expect(429)).body.code).toBe('MONTHLY_LIMIT');

    await s.as('put', '/modules/integration.credit_bureau/settings').send({ provider: 'serasa_experian' }).expect(204);
    const { body: noCreds } = await s.as('post', '/credit-bureau/queries').send(body).expect(201);
    expect(noCreds).toMatchObject({ status: 'error', cost: 0, simulated: false, provider: 'serasa_experian' });
    expect(noCreds.error).toContain('credenciais');
    await s.as('put', '/modules/integration.credit_bureau/settings').send({ provider: 'quod', baseUrl: 'não é url', clientId: 'cliente', clientSecret: 'segredo' }).expect(400);
    await s.as('put', '/modules/integration.credit_bureau/settings').send({ provider: 'quod', baseUrl: 'https://api.bureau.exemplo', clientId: 'cliente', clientSecret: 'segredo' }).expect(204);
    const { body: pending } = await s.as('post', '/credit-bureau/queries').send(body).expect(201);
    expect(pending.error).toContain('a confirmar');
    // Sem resultado não há decisão.
    await s.as('post', `/credit-bureau/queries/${pending.id}/decision`).send({ decision: 'approved' }).expect(400);
    const { body: settings } = await s.as('get', '/modules/integration.credit_bureau/settings').expect(200);
    expect(settings.clientSecret).not.toBe('segredo');
  });

  it('sem o módulo contratado a rota não existe; com a exigência ligada, a venda da cota precisa da consulta aprovada', async () => {
    const without = await ownerSession(t, ['consortium']);
    await without.as('get', '/credit-bureau/status').expect(403);

    const s = await ownerSession(t, ['consortium', 'integration.credit_bureau']);
    await s.as('put', '/modules/consortium/settings').send({ requireCreditApproval: true }).expect(204);
    await s.as('post', '/consortium/plans/sync').expect(200);
    const { body: [plan] } = await s.as('get', '/consortium/plans?assetType=vehicle&maxCredit=70000').expect(200);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Bruno Proponente', phone: '(48) 99222-3333', email: uniqueEmail('bruno') }).expect(201);
    const applicant = { name: 'Bruno Proponente', document: '529.982.247-25', monthlyIncome: 9000 };
    const sell = () => s.as('post', '/consortium/quotas').send({ customerId: customer.id, planId: plan.id, applicant });

    expect((await sell().expect(400)).body.code).toBe('CREDIT_CHECK_REQUIRED');
    const { body: q } = await s
      .as('post', '/credit-bureau/queries')
      .send({ document: applicant.document, subjectName: applicant.name, customerId: customer.id, purpose: 'consortium_sale', consent: consent() })
      .expect(201);
    expect((await sell().expect(400)).body.code).toBe('CREDIT_DECISION_PENDING');
    await s.as('post', `/credit-bureau/queries/${q.id}/decision`).send({ decision: 'rejected' }).expect(200);
    expect((await sell().expect(400)).body.code).toBe('CREDIT_REJECTED');
    await s.as('post', `/credit-bureau/queries/${q.id}/decision`).send({ decision: 'approved', note: 'Score ok' }).expect(200);
    await sell().expect(201);

    // LGPD: o cliente anonimizado leva junto o documento e o resultado das consultas dele.
    await s.as('post', `/customers/${customer.id}/anonymize`).expect(204);
    const { body: after } = await s.as('get', `/credit-bureau/queries/${q.id}`).expect(200);
    expect(after).toMatchObject({ document: '', subjectName: 'Anonimizado', summary: null });
  });
});
