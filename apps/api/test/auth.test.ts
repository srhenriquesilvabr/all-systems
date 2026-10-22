import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTenant, createTestApp, login, PASSWORD, refreshCookie, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

describe('autenticação', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('login devolve access token, cookie de refresh e a sessão em /me', async () => {
    const { email } = await createTenant(t);
    const { token } = await login(t, email);

    const me = await t.http().get('/api/me').set(auth(token)).expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.isOwner).toBe(true);
    expect(me.body.modules.map((m: { key: string }) => m.key)).toContain('laundry');
    expect(me.body.permissions).toContain('laundry.catalog.manage');
    expect(me.body.menu.map((m: { path: string }) => m.path)).toContain('/lavanderia/servicos');
  });

  it('senha errada e e-mail inexistente recebem a mesma resposta', async () => {
    const { email } = await createTenant(t);
    const wrong = await t.http().post('/api/auth/login').send({ email, password: 'errada-errada' }).expect(401);
    const missing = await t.http().post('/api/auth/login').send({ email: uniqueEmail('ninguem'), password: 'qualquer-coisa' }).expect(401);
    expect(wrong.body).toEqual(missing.body);
  });

  it('bloqueia temporariamente após 5 senhas erradas', async () => {
    const { email } = await createTenant(t);
    for (let i = 0; i < 5; i++) await t.http().post('/api/auth/login').send({ email, password: 'errada-errada' }).expect(401);
    await t.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
  });

  it('requisição sem token é recusada', async () => {
    await t.http().get('/api/me').expect(401);
    await t.http().get('/api/me').set(auth('token-invalido')).expect(401);
  });

  it('refresh rotaciona o token e detecta reuso', async () => {
    const { email } = await createTenant(t);
    const first = await login(t, email);

    const rotated = await t.http().post('/api/auth/refresh').set('Cookie', first.cookie).expect(200);
    expect(rotated.body.accessToken).toBeTruthy();
    const second = refreshCookie(rotated);

    // Reusar o cookie antigo = possível roubo: a família inteira é revogada.
    const reuse = await t.http().post('/api/auth/refresh').set('Cookie', first.cookie).expect(401);
    expect(reuse.body.code).toBe('REFRESH_REUSED');
    await t.http().post('/api/auth/refresh').set('Cookie', second).expect(401);
  });

  it('logout invalida o refresh token', async () => {
    const { email } = await createTenant(t);
    const { cookie } = await login(t, email);
    await t.http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await t.http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  describe('recuperação de senha', () => {
    it('envia link, troca a senha e encerra as sessões abertas', async () => {
      const { email } = await createTenant(t);
      const session = await login(t, email);

      await t.http().post('/api/auth/forgot-password').send({ email }).expect(204);
      const resetMail = t.mails.findLast((m) => m.to === email && m.subject === 'Redefinição de senha');
      const token = tokenFromMail(resetMail);

      const info = await t.http().get('/api/auth/token-info').query({ token }).expect(200);
      expect(info.body).toMatchObject({ purpose: 'password_reset', email });

      await t.http().post('/api/auth/set-password').send({ token, password: 'nova-senha-segura' }).expect(204);
      await t.http().post('/api/auth/refresh').set('Cookie', session.cookie).expect(401);
      await t.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
      await login(t, email, 'nova-senha-segura');
      expect(t.mails.some((m) => m.to === email && m.subject === 'Sua senha foi alterada')).toBe(true);

      // O link só vale uma vez.
      await t.http().post('/api/auth/set-password').send({ token, password: 'outra-senha-segura' }).expect(400);
    });

    it('e-mail desconhecido recebe a mesma resposta e nenhum e-mail é enviado', async () => {
      const before = t.mails.length;
      await t.http().post('/api/auth/forgot-password').send({ email: uniqueEmail('ninguem') }).expect(204);
      expect(t.mails.length).toBe(before);
    });

    it('rejeita senha curta', async () => {
      const { email } = await createTenant(t);
      await t.http().post('/api/auth/forgot-password').send({ email }).expect(204);
      const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
      const res = await t.http().post('/api/auth/set-password').send({ token, password: 'curta' }).expect(400);
      expect(res.body.code).toBe('VALIDATION');
    });
  });

  describe('usuário em várias empresas', () => {
    it('escolhe a empresa no login e pode trocar depois', async () => {
      const email = uniqueEmail('multi');
      const a = await createTenant(t, { ownerEmail: email, name: 'Alfa' });
      const b = await createTenant(t, { ownerEmail: email, name: 'Beta' });

      const res = await t.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
      expect(res.body.selectTenant).toBe(true);
      expect(res.body.tenants.map((x: { name: string }) => x.name)).toEqual(['Alfa', 'Beta']);

      const selected = await t.http()
        .post('/api/auth/select-tenant')
        .send({ selectionToken: res.body.selectionToken, tenantId: a.tenantId })
        .expect(200);
      const meA = await t.http().get('/api/me').set(auth(selected.body.accessToken)).expect(200);
      expect(meA.body.tenant.id).toBe(a.tenantId);
      expect(meA.body.tenants).toHaveLength(2);

      const switched = await t.http()
        .post('/api/auth/switch-tenant')
        .set(auth(selected.body.accessToken))
        .send({ tenantId: b.tenantId })
        .expect(200);
      const meB = await t.http().get('/api/me').set(auth(switched.body.accessToken)).expect(200);
      expect(meB.body.tenant.id).toBe(b.tenantId);
    });

    it('não entra em empresa da qual não é membro', async () => {
      const email = uniqueEmail('multi');
      await createTenant(t, { ownerEmail: email });
      await createTenant(t, { ownerEmail: email });
      const outsider = await createTenant(t);

      const res = await t.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
      await t.http()
        .post('/api/auth/select-tenant')
        .send({ selectionToken: res.body.selectionToken, tenantId: outsider.tenantId })
        .expect(403);
    });
  });
});
