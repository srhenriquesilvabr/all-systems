import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpf, createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

describe('clientes', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('cadastra normalizando documento, e-mail e telefone', async () => {
    const s = await ownerSession(t);
    const doc = cpf();
    const res = await s
      .as('post', '/customers')
      .send({ name: 'Maria Silva', document: `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`, email: ' Maria@Email.COM ', phone: '(11) 98765-4321' })
      .expect(201);
    expect(res.body).toMatchObject({ type: 'person', document: doc, email: 'maria@email.com', phone: '+5511987654321' });

    const timeline = await s.as('get', `/customers/${res.body.id}/timeline`).expect(200);
    expect(timeline.body.map((e: { type: string }) => e.type)).toContain('customer.created');
  });

  it('recusa CPF, CNPJ e telefone inválidos', async () => {
    const s = await ownerSession(t);
    const badCpf = await s.as('post', '/customers').send({ name: 'Fulano', document: '111.111.111-11' }).expect(400);
    expect(badCpf.body.message).toContain('document: CPF inválido');
    await s.as('post', '/customers').send({ type: 'company', name: 'Empresa X', document: '11.222.333/0001-00' }).expect(400);
    await s.as('post', '/customers').send({ type: 'company', name: 'Empresa Y', document: '11.222.333/0001-81' }).expect(201);
    await s.as('post', '/customers').send({ name: 'Fulano', phone: '123' }).expect(400);
  });

  it('impede CPF duplicado e avisa sobre e-mail repetido', async () => {
    const s = await ownerSession(t);
    const doc = cpf();
    const email = uniqueEmail('cliente');
    await s.as('post', '/customers').send({ name: 'Primeiro', document: doc, email }).expect(201);

    const dupDoc = await s.as('post', '/customers').send({ name: 'Outro', document: doc }).expect(409);
    expect(dupDoc.body.code).toBe('DUPLICATE_DOCUMENT');

    const dupEmail = await s.as('post', '/customers').send({ name: 'Cônjuge', email }).expect(409);
    expect(dupEmail.body.code).toBe('POSSIBLE_DUPLICATE');
    expect(dupEmail.body.duplicates[0].matchedOn).toEqual(['email']);
    // Confirmado pelo usuário: e-mail compartilhado é permitido.
    await s.as('post', '/customers?allowDuplicates=true').send({ name: 'Cônjuge', email }).expect(201);

    const check = await s.as('get', `/customers/duplicates?document=${doc}`).expect(200);
    expect(check.body).toHaveLength(1);
  });

  it('o mesmo CPF pode existir em empresas diferentes', async () => {
    const doc = cpf();
    const a = await ownerSession(t);
    const b = await ownerSession(t);
    await a.as('post', '/customers').send({ name: 'Cliente', document: doc }).expect(201);
    await b.as('post', '/customers').send({ name: 'Cliente', document: doc }).expect(201);
    const listA = await a.as('get', '/customers').expect(200);
    expect(listA.body.total).toBe(1);
  });

  it('busca por nome, documento e telefone', async () => {
    const s = await ownerSession(t);
    const doc = cpf();
    await s.as('post', '/customers').send({ name: 'Joana Prado', document: doc, phone: '11912345678' }).expect(201);
    await s.as('post', '/customers').send({ name: 'Pedro Souza' }).expect(201);

    const byName = await s.as('get', '/customers?q=joana').expect(200);
    expect(byName.body.items.map((c: { name: string }) => c.name)).toEqual(['Joana Prado']);
    const byDoc = await s.as('get', `/customers?q=${doc.slice(0, 5)}`).expect(200);
    expect(byDoc.body.total).toBe(1);
    const byPhone = await s.as('get', '/customers?q=12345678').expect(200);
    expect(byPhone.body.total).toBe(1);
  });

  it('valida campos customizados', async () => {
    const s = await ownerSession(t);
    await s.as('post', '/custom-fields/customer').send({ label: 'Como conheceu', type: 'select', options: ['Indicação', 'Instagram'], required: true }).expect(201);
    await s.as('post', '/custom-fields/customer').send({ label: 'Limite de crédito', type: 'number' }).expect(201);

    const missing = await s.as('post', '/customers').send({ name: 'Sem campo' }).expect(400);
    expect(missing.body.message).toContain('Como conheceu: obrigatório');
    await s.as('post', '/customers').send({ name: 'Errado', customFields: { como_conheceu: 'TV' } }).expect(400);

    const ok = await s
      .as('post', '/customers')
      .send({ name: 'Certo', customFields: { como_conheceu: 'Instagram', limite_de_credito: '150.5', desconhecido: 'x' } })
      .expect(201);
    expect(ok.body.customFields).toEqual({ como_conheceu: 'Instagram', limite_de_credito: 150.5 });
  });

  it('registra consentimentos com histórico', async () => {
    const s = await ownerSession(t);
    const { body: c } = await s.as('post', '/customers').send({ name: 'Ana' }).expect(201);

    await s.as('post', `/customers/${c.id}/consents`).send({ purpose: 'marketing_email', granted: true, source: 'balcão' }).expect(201);
    const revoked = await s.as('post', `/customers/${c.id}/consents`).send({ purpose: 'marketing_email', granted: false, source: 'pedido por telefone' }).expect(201);
    expect(revoked.body.marketing_email.granted).toBe(false);

    const exported = await s.as('get', `/customers/${c.id}/export`).expect(200);
    expect(exported.body.consents).toHaveLength(2);
  });

  it('anonimiza dados pessoais a pedido do titular', async () => {
    const s = await ownerSession(t);
    const { body: c } = await s.as('post', '/customers').send({ name: 'Carlos', document: cpf(), email: uniqueEmail('c'), phone: '11999990000' }).expect(201);

    await s.as('post', `/customers/${c.id}/anonymize`).expect(204);
    const after = await s.as('get', `/customers/${c.id}`).expect(200);
    expect(after.body).toMatchObject({ name: 'Cliente anonimizado', document: null, email: null, phone: null });
    expect(after.body.anonymizedAt).toBeTruthy();
    await s.as('patch', `/customers/${c.id}`).send({ name: 'Volta' }).expect(400);
  });
});
