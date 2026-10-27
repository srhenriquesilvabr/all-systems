import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTenant, createTestApp, login, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

const service = { name: 'Lavar e passar', pricingUnit: 'piece', basePrice: 12.9, turnaroundHours: 48 };

describe('controle de acesso', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** Convida um usuário com os papéis indicados (pelas keys) e devolve o token de acesso dele. */
  async function inviteAndLogin(ownerToken: string, roleKeys: string[]) {
    const roles = await t.http().get('/api/access/roles').set(auth(ownerToken)).expect(200);
    const roleIds = roleKeys.map((k) => roles.body.find((r: { key: string }) => r.key === k).id);
    const email = uniqueEmail('func');

    const invited = await t.http()
      .post('/api/users/invite')
      .set(auth(ownerToken))
      .send({ email, name: 'Funcionário', roleIds })
      .expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));

    const info = await t.http().get('/api/auth/token-info').query({ token }).expect(200);
    expect(info.body.purpose).toBe('invite');
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Funcionário Novo' }).expect(204);
    return { ...(await login(t, email)), membershipId: invited.body.membershipId as string };
  }

  describe('módulos por tenant', () => {
    it('bloqueia rotas de módulo não contratado e libera ao ativar', async () => {
      const { tenantId, email } = await createTenant(t, { modules: [] });
      const { token } = await login(t, email);

      const blocked = await t.http().get('/api/laundry/services').set(auth(token)).expect(403);
      expect(blocked.body.code).toBe('MODULE_NOT_ENABLED');
      const me = await t.http().get('/api/me').set(auth(token)).expect(200);
      expect(me.body.permissions).not.toContain('laundry.catalog.manage');

      await t.tenancy.enableModules(tenantId, ['laundry']);
      await t.http().get('/api/laundry/services').set(auth(token)).expect(200);

      await t.tenancy.disableModule(tenantId, 'laundry');
      await t.http().get('/api/laundry/services').set(auth(token)).expect(403);
    });

    it('ativar o módulo cria os papéis padrão do manifesto', async () => {
      const { email } = await createTenant(t);
      const { token } = await login(t, email);
      const roles = await t.http().get('/api/access/roles').set(auth(token)).expect(200);
      const keys = roles.body.map((r: { key: string }) => r.key);
      expect(keys).toEqual(expect.arrayContaining(['core.owner', 'laundry.attendant', 'laundry.operator', 'laundry.driver']));
    });

    it('não desativa módulos do core', async () => {
      const { tenantId } = await createTenant(t);
      await expect(t.tenancy.disableModule(tenantId, 'core.users')).rejects.toThrow(/core/);
    });
  });

  describe('permissões', () => {
    it('operador consulta o catálogo mas não altera', async () => {
      const { email } = await createTenant(t);
      const owner = await login(t, email);
      const created = await t.http().post('/api/laundry/services').set(auth(owner.token)).send(service).expect(201);

      const operator = await inviteAndLogin(owner.token, ['laundry.operator']);
      const list = await t.http().get('/api/laundry/services').set(auth(operator.token)).expect(200);
      expect(list.body.map((s: { id: string }) => s.id)).toContain(created.body.id);

      const denied = await t.http().post('/api/laundry/services').set(auth(operator.token)).send(service).expect(403);
      expect(denied.body.code).toBe('MISSING_PERMISSION');

      const me = await t.http().get('/api/me').set(auth(operator.token)).expect(200);
      expect(me.body.isOwner).toBe(false);
      expect(me.body.menu.map((m: { path: string }) => m.path)).not.toContain('/lavanderia/servicos');
      await t.http().get('/api/users').set(auth(operator.token)).expect(403);
    });

    it('papel personalizado só aceita permissões de módulos ativos', async () => {
      const { email } = await createTenant(t, { modules: [] });
      const { token } = await login(t, email);

      const invalid = await t.http()
        .post('/api/access/roles')
        .set(auth(token))
        .send({ label: 'Gerente', permissions: ['laundry.catalog.manage'] })
        .expect(400);
      expect(invalid.body.code).toBe('INVALID_PERMISSION');

      await t.http()
        .post('/api/access/roles')
        .set(auth(token))
        .send({ label: 'Gerente', permissions: ['core.users.read'] })
        .expect(201);
    });

    it('papéis padrão não podem ser editados', async () => {
      const { email } = await createTenant(t);
      const { token } = await login(t, email);
      const roles = await t.http().get('/api/access/roles').set(auth(token)).expect(200);
      const operator = roles.body.find((r: { key: string }) => r.key === 'laundry.operator');
      const res = await t.http().patch(`/api/access/roles/${operator.id}`).set(auth(token)).send({ label: 'Outro nome' }).expect(400);
      expect(res.body.code).toBe('SYSTEM_ROLE');
    });
  });

  describe('usuários', () => {
    it('desativar o acesso derruba a sessão do usuário imediatamente', async () => {
      const { email } = await createTenant(t);
      const owner = await login(t, email);
      const employee = await inviteAndLogin(owner.token, ['laundry.attendant']);

      await t.http().get('/api/laundry/services').set(auth(employee.token)).expect(200);
      await t.http()
        .patch(`/api/users/${employee.membershipId}`)
        .set(auth(owner.token))
        .send({ status: 'disabled' })
        .expect(204);

      const res = await t.http().get('/api/laundry/services').set(auth(employee.token)).expect(403);
      expect(res.body.code).toBe('NO_MEMBERSHIP');
      await t.http().post('/api/auth/refresh').set('Cookie', employee.cookie).expect(401);
    });

    it('a empresa nunca fica sem dono ativo', async () => {
      const { email } = await createTenant(t);
      const owner = await login(t, email);
      const users = await t.http().get('/api/users').set(auth(owner.token)).expect(200);
      const self = users.body[0];

      const disableSelf = await t.http().patch(`/api/users/${self.membershipId}`).set(auth(owner.token)).send({ status: 'disabled' }).expect(400);
      expect(disableSelf.body.code).toBe('CANNOT_DISABLE_SELF');

      const demote = await t.http().patch(`/api/users/${self.membershipId}`).set(auth(owner.token)).send({ roleIds: [] }).expect(400);
      expect(demote.body.code).toBe('LAST_OWNER');
    });

    it('não convida o mesmo e-mail duas vezes', async () => {
      const { email } = await createTenant(t);
      const owner = await login(t, email);
      const guest = uniqueEmail('dup');
      await t.http().post('/api/users/invite').set(auth(owner.token)).send({ email: guest, name: 'Fulano' }).expect(201);
      const dup = await t.http().post('/api/users/invite').set(auth(owner.token)).send({ email: guest, name: 'Fulano' }).expect(409);
      expect(dup.body.code).toBe('ALREADY_MEMBER');
    });

    it('lista só os usuários da própria empresa', async () => {
      // O dono participa de duas empresas: a política de memberships deixa ele ver as próprias
      // memberships em ambas, então a listagem precisa filtrar pelo tenant atual.
      const email = uniqueEmail('dono-duplo');
      const a = await createTenant(t, { ownerEmail: email });
      const b = await createTenant(t, { ownerEmail: email });
      const res = await t.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
      const select = (tenantId: string) =>
        t.http().post('/api/auth/select-tenant').send({ selectionToken: res.body.selectionToken, tenantId }).expect(200);

      const tokenA = (await select(a.tenantId)).body.accessToken;
      await t.http().post('/api/users/invite').set(auth(tokenA)).send({ email: uniqueEmail('so-a'), name: 'Só do A' }).expect(201);

      const tokenB = (await select(b.tenantId)).body.accessToken;
      const users = await t.http().get('/api/users').set(auth(tokenB)).expect(200);
      expect(users.body.map((u: { user: { email: string } }) => u.user.email)).toEqual([email]);
    });
  });

  it('registra as alterações na auditoria', async () => {
    const { email } = await createTenant(t);
    const { token } = await login(t, email);
    await t.http().post('/api/laundry/services').set(auth(token)).send(service).expect(201);

    const log = await t.http().get('/api/audit').set(auth(token)).expect(200);
    const actions = log.body.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['tenant.created', 'laundry.service.created']));
    expect(log.body.find((e: { action: string }) => e.action === 'laundry.service.created').user.email).toBe(email);
  });
});
