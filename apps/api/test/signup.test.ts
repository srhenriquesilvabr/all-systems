import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, login, ownerSession, PASSWORD, uniqueEmail, type TestApp } from './helpers';

/** Cálculo do que o formulário envia: aberto há 10 s, como uma pessoa preenchendo. */
const signupBody = (over: Record<string, unknown> = {}) => ({
  branch: 'laundry',
  companyName: 'Lavanderia Nova',
  ownerName: 'Dona Nova',
  email: uniqueEmail('cadastro'),
  password: PASSWORD,
  consent: true,
  openedAt: Date.now() - 10_000,
  ...over,
});

describe('Contratação: cadastro público e ramos e módulos adicionais', () => {
  let t: TestApp;
  const admin = new Client({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/allsystems_test' });
  const signup = (body: object) => t.http().post('/api/public/signup').send(body);

  beforeAll(async () => {
    t = await createTestApp();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await t.close();
  });
  // O limite por IP olha o banco, que os outros testes deste arquivo também usam.
  beforeEach(() => admin.query('delete from tenant_signups'));

  it('lista só os ramos para escolher, nunca módulos', async () => {
    const { body } = await t.http().get('/api/public/signup/branches').expect(200);
    const keys = body.map((b: { key: string }) => b.key);
    expect(keys).toEqual(expect.arrayContaining(['laundry', 'legal', 'hr_consulting']));
    expect(keys).not.toContain('store');
    expect(keys).not.toContain('core.finance');
  });

  it('a empresa entra em teste só com o ramo escolhido e o que ele exige', async () => {
    const body = signupBody({ branch: 'legal', document: '11.222.333/0001-81' });
    await signup(body).expect(201);
    const { token } = await login(t, body.email);
    const { body: me } = await t.http().get('/api/me').set(auth(token)).expect(200);

    expect(me.tenant.status).toBe('trial');
    expect(me.isOwner).toBe(true);
    const verticals = me.modules.filter((m: { layer: string }) => m.layer === 'vertical').map((m: { key: string }) => m.key);
    expect(verticals).toEqual(['legal']);
    expect(me.menu.map((m: { module: string }) => m.module)).not.toContain('laundry');
    await t.http().get('/api/laundry/services').set(auth(token)).expect(403);
  });

  it('e-mail já cadastrado não ganha empresa nova nem troca de senha', async () => {
    const { email } = await ownerSession(t);
    const res = await signup(signupBody({ email, password: 'outra-senha-forte' })).expect(409);
    expect(res.body.code).toBe('EMAIL_IN_USE');
    const again = await t.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    expect(again.body.selectTenant).toBeUndefined();
  });

  it('recusa o que não é ramo, documento inválido, robô e falta de consentimento', async () => {
    expect((await signup(signupBody({ branch: 'store' })).expect(400)).body.code).toBe('INVALID_BRANCH');
    expect((await signup(signupBody({ branch: 'core.finance' })).expect(400)).body.code).toBe('INVALID_BRANCH');
    expect((await signup(signupBody({ document: '11.111.111/1111-11' })).expect(400)).body.code).toBe('INVALID_DOCUMENT');
    expect((await signup(signupBody({ website: 'http://spam.test' })).expect(400)).body.code).toBe('SIGNUP_REJECTED');
    expect((await signup(signupBody({ openedAt: Date.now() })).expect(400)).body.code).toBe('SIGNUP_REJECTED');
    await signup(signupBody({ consent: false })).expect(400);
  });

  it('limita os cadastros por IP', async () => {
    for (let i = 0; i < 5; i++) await signup(signupBody()).expect(201);
    expect((await signup(signupBody()).expect(429)).body.code).toBe('TOO_MANY_SIGNUPS');
  });

  it('o dono contrata um ramo adicional e um módulo, que valem na hora', async () => {
    const s = await ownerSession(t, ['laundry']);
    await s.as('get', '/legal/cases').expect(403);

    const { body: catalog } = await s.as('get', '/modules/catalog').expect(200);
    expect(catalog.find((m: { key: string }) => m.key === 'legal')).toMatchObject({ layer: 'vertical' });

    const { body } = await s.as('post', '/modules/legal/activate').expect(200);
    expect(body.enabled).toContain('legal');
    await s.as('get', '/legal/cases').expect(200);

    await s.as('post', '/modules/store/activate').expect(200);
    await s.as('get', '/store/status').expect(200);
    // Contratar de novo não muda nada.
    await s.as('post', '/modules/store/activate').expect(200);

    const { body: me } = await s.as('get', '/me').expect(200);
    const verticals = me.modules.filter((m: { layer: string }) => m.layer === 'vertical').map((m: { key: string }) => m.key);
    expect(verticals.sort()).toEqual(['laundry', 'legal']);
  });

  it('só o dono contrata, e só ramos e módulos', async () => {
    const s = await ownerSession(t, ['laundry']);
    expect((await s.as('post', '/modules/core.finance/activate').expect(400)).body.code).toBe('NOT_HIREABLE');
    expect((await s.as('post', '/modules/nao-existe/activate').expect(400)).body.code).toBe('NOT_HIREABLE');

    const email = uniqueEmail('equipe');
    await s.as('post', '/users/invite').send({ email, name: 'Da Equipe', roleIds: [] }).expect(201);
    const { tokenFromMail } = await import('./helpers');
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Da Equipe' }).expect(204);
    const { token: staff } = await login(t, email);
    const res = await t.http().post('/api/modules/legal/activate').set(auth(staff)).expect(403);
    expect(res.body.code).toBe('OWNER_ONLY');
  });
});
