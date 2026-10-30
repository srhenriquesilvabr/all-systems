import { CoreConfig } from '@all/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTenant, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

/** Melhorias do núcleo: financeiro, convites, auditoria, módulos e segmentos. Inclui os casos de recusa. */
describe('melhorias do núcleo', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  type Session = Awaited<ReturnType<typeof ownerSession>>;
  const cashOf = async (s: Session) => ((await s.as('get', '/finance/accounts').expect(200)).body as { id: string; name: string }[]).find((a) => a.name === 'Caixa')!.id;
  const newEntry = async (s: Session, body: Record<string, unknown> = {}) =>
    (await s.as('post', '/finance/entries').send({ kind: 'expense', description: 'Conta de luz', amount: 100, status: 'pending', dueDate: '2026-03-10', ...body }).expect(201)).body as { id: string };

  describe('financeiro', () => {
    it('estorno da baixa: volta para em aberto, sai do saldo e guarda motivo e pagamento na auditoria', async () => {
      const s = await ownerSession(t);
      const cash = await cashOf(s);
      const e = await newEntry(s);
      await s.as('post', `/finance/entries/${e.id}/pay`).send({ paidAt: '2026-03-11', accountId: cash, paymentMethod: 'pix' }).expect(201);
      const balance = async () => ((await s.as('get', '/finance/accounts').expect(200)).body as { id: string; balance: number }[]).find((a) => a.id === cash)!.balance;
      expect(await balance()).toBe(-100);

      // Sem motivo: recusado.
      await s.as('post', `/finance/entries/${e.id}/reverse`).send({}).expect(400);
      await s.as('post', `/finance/entries/${e.id}/reverse`).send({ reason: 'x' }).expect(400);

      const { body: reversed } = await s.as('post', `/finance/entries/${e.id}/reverse`).send({ reason: 'Pagamento lançado na conta errada' }).expect(200);
      expect(reversed).toMatchObject({ status: 'pending', paidAt: null, accountId: null, paymentMethod: null });
      expect(await balance()).toBe(0);

      const { body: history } = await s.as('get', `/finance/entries/${e.id}/history`).expect(200);
      expect(history.map((h: { action: string }) => h.action)).toEqual(['finance.entry.payment_reversed', 'finance.entry.paid', 'finance.entry.created']);
      expect(history[0].data).toMatchObject({ reason: 'Pagamento lançado na conta errada', paidAt: '2026-03-11', accountId: cash, paymentMethod: 'pix', amount: 100 });

      // Em aberto não estorna de novo; volta a receber baixa normalmente.
      expect((await s.as('post', `/finance/entries/${e.id}/reverse`).send({ reason: 'De novo' }).expect(400)).body.code).toBe('ENTRY_NOT_PAID');
      await s.as('post', `/finance/entries/${e.id}/pay`).send({ paidAt: '2026-03-12', accountId: cash }).expect(201);
    });

    it('edição: pago não muda valor nem conta nem cancela; em aberto muda tudo; cancelado não muda nada', async () => {
      const s = await ownerSession(t, ['laundry']);
      const cash = await cashOf(s);
      const e = await newEntry(s);
      await s.as('post', `/finance/entries/${e.id}/pay`).send({ paidAt: '2026-03-11', accountId: cash }).expect(201);

      // Pago: valor e conta travados; descrição e observações, livres.
      expect((await s.as('patch', `/finance/entries/${e.id}`).send({ amount: 200 }).expect(400)).body.code).toBe('ENTRY_PAID_LOCKED');
      await s.as('patch', `/finance/entries/${e.id}`).send({ amount: 100, description: 'Conta de luz de março', notes: 'Boleto 123' }).expect(200);
      // Cancelar pago exige estornar antes.
      expect((await s.as('post', `/finance/entries/${e.id}/cancel`).expect(400)).body.code).toBe('ENTRY_PAID');

      const { body: before } = await s.as('get', `/finance/entries/${e.id}/history`).expect(200);
      expect(before[0]).toMatchObject({ action: 'finance.entry.updated', data: { changes: { description: { from: 'Conta de luz', to: 'Conta de luz de março' } } } });

      // Em aberto: tudo muda.
      const open = await newEntry(s);
      const { body: edited } = await s.as('patch', `/finance/entries/${open.id}`).send({ amount: 150.5, dueDate: '2026-04-01' }).expect(200);
      expect(edited).toMatchObject({ amount: 150.5, dueDate: '2026-04-01' });

      // Cancelado não edita.
      await s.as('post', `/finance/entries/${open.id}/cancel`).send({ reason: 'Lançado em duplicidade' }).expect(204);
      expect((await s.as('patch', `/finance/entries/${open.id}`).send({ notes: 'x' }).expect(400)).body.code).toBe('ENTRY_CANCELLED');
    });

    it('recusa conta e categoria de outra empresa, e categoria do tipo errado', async () => {
      const a = await ownerSession(t);
      const b = await ownerSession(t);
      const foreign = await cashOf(b);
      const e = await newEntry(a);
      await a.as('patch', `/finance/entries/${e.id}`).send({ accountId: foreign }).expect(404);
      await a.as('post', `/finance/entries/${e.id}/pay`).send({ paidAt: '2026-03-11', accountId: foreign }).expect(404);
      const { body: categories } = await a.as('get', '/finance/categories').expect(200);
      const income = categories.find((c: { kind: string }) => c.kind === 'income');
      expect((await a.as('patch', `/finance/entries/${e.id}`).send({ categoryId: income.id }).expect(400)).body.code).toBe('CATEGORY_KIND');
    });

    it('o rodapé não soma cancelados, salvo no filtro de cancelados; a origem vem em português', async () => {
      const s = await ownerSession(t);
      const cancelled = await newEntry(s, { amount: 999 });
      await newEntry(s, { amount: 40 });
      await s.as('post', `/finance/entries/${cancelled.id}/cancel`).expect(204);

      const { body: all } = await s.as('get', '/finance/entries').expect(200);
      expect(all.total).toBe(2);
      expect(all.sums.expense).toBe(40);
      expect(all.items[0].sourceLabel).toBe('Manual');
      expect((await s.as('get', '/finance/entries?status=cancelled').expect(200)).body.sums.expense).toBe(999);

      const csv = await s.as('get', '/finance/entries.csv').expect(200);
      expect(csv.text).toContain(';Manual');
      expect(csv.text).not.toContain(';manual');
    });

    it('conta: renomeia e corrige saldo inicial com motivo, sem virar lançamento', async () => {
      const s = await ownerSession(t);
      const { body: bank } = await s.as('post', '/finance/accounts').send({ name: 'Banco', type: 'bank', initialBalance: 1000 }).expect(201);
      await s.as('patch', `/finance/accounts/${bank.id}`).send({ name: 'Banco do Brasil' }).expect(200);

      await s.as('post', `/finance/accounts/${bank.id}/initial-balance`).send({ initialBalance: 1500 }).expect(400);
      expect((await s.as('post', `/finance/accounts/${bank.id}/initial-balance`).send({ initialBalance: 1000, reason: 'Igual' }).expect(400)).body.code).toBe('SAME_BALANCE');
      await s.as('post', `/finance/accounts/${bank.id}/initial-balance`).send({ initialBalance: 1500, reason: 'Saldo do extrato informado errado' }).expect(200);

      const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
      expect(accounts.find((a: { id: string }) => a.id === bank.id)).toMatchObject({ name: 'Banco do Brasil', initialBalance: 1500, balance: 1500 });
      expect((await s.as('get', '/finance/entries').expect(200)).body.total).toBe(0);
      const { body: history } = await s.as('get', `/finance/accounts/${bank.id}/history`).expect(200);
      expect(history[0]).toMatchObject({ action: 'finance.account.initial_balance_corrected', data: { from: 1000, to: 1500, reason: 'Saldo do extrato informado errado' } });
    });
  });

  describe('convites', () => {
    const invite = async (s: Session, email: string, roleIds: string[] = []) => (await s.as('post', '/users/invite').send({ email, name: 'Convidada', roleIds }).expect(201)).body as { membershipId: string; emailEnabled: boolean };

    it('reenvia por e-mail e gera link que define a senha; só o último link vale', async () => {
      const s = await ownerSession(t);
      const email = uniqueEmail('convidada');
      const { membershipId, emailEnabled } = await invite(s, email);
      expect(emailEnabled).toBe(true);
      expect((await s.as('get', '/users/email-status').expect(200)).body).toEqual({ emailEnabled: true });

      const sent = t.mails.length;
      await s.as('post', `/users/${membershipId}/resend-invite`).expect(200);
      expect(t.mails.length).toBe(sent + 1);
      expect(t.mails.at(-1)!.to).toBe(email);
      expect(tokenFromMail(t.mails.at(-1))).toBeTruthy();

      const first = (await s.as('post', `/users/${membershipId}/invite-link`).expect(200)).body as { url: string };
      const second = (await s.as('post', `/users/${membershipId}/invite-link`).expect(200)).body as { url: string };
      const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
      await t.http().post('/api/auth/set-password').send({ token: tokenOf(first.url), password: PASSWORD }).expect(400);
      await t.http().post('/api/auth/set-password').send({ token: tokenOf(second.url), password: PASSWORD }).expect((r) => expect(r.status).toBeLessThan(300));
      await login(t, email);

      // Já tem senha: não há o que reenviar.
      expect((await s.as('post', `/users/${membershipId}/resend-invite`).expect(400)).body.code).toBe('NOT_PENDING');
      expect((await s.as('post', `/users/${membershipId}/invite-link`).expect(400)).body.code).toBe('NOT_PENDING');

      const { body: log } = await s.as('get', '/audit?action=user.invite_link_created').expect(200);
      expect(log).toHaveLength(2);
      expect(JSON.stringify(log)).not.toContain(tokenOf(second.url));
    });

    it('avisa quando o e-mail está desligado', async () => {
      const s = await ownerSession(t);
      const config = t.app.get(CoreConfig);
      const { nodeEnv, resendApiKey } = config;
      Object.assign(config, { nodeEnv: 'production', resendApiKey: undefined });
      try {
        expect((await s.as('get', '/users/email-status').expect(200)).body).toEqual({ emailEnabled: false });
        const { membershipId, emailEnabled } = await invite(s, uniqueEmail('sem-email'));
        expect(emailEnabled).toBe(false);
        expect((await s.as('post', `/users/${membershipId}/resend-invite`).expect(200)).body).toEqual({ emailEnabled: false });
        expect((await s.as('post', `/users/${membershipId}/invite-link`).expect(200)).body.url).toContain('/definir-senha?token=');
      } finally {
        Object.assign(config, { nodeEnv, resendApiKey });
      }
    });

    it('recusas do link: sem permissão, de outra empresa, desativado, convidado também por outra empresa', async () => {
      const a = await ownerSession(t);
      const b = await ownerSession(t);
      const email = uniqueEmail('dupla');
      const { membershipId } = await invite(a, email);

      // De outra empresa.
      await b.as('post', `/users/${membershipId}/invite-link`).expect(404);
      await b.as('post', `/users/${membershipId}/resend-invite`).expect(404);

      // Sem permissão.
      const memberEmail = uniqueEmail('membro');
      const { membershipId: memberId } = await invite(a, memberEmail);
      const memberLink = (await a.as('post', `/users/${memberId}/invite-link`).expect(200)).body as { url: string };
      await t.http().post('/api/auth/set-password').send({ token: new URL(memberLink.url).searchParams.get('token'), password: PASSWORD });
      const member = await login(t, memberEmail);
      await t.http().post(`/api/users/${membershipId}/invite-link`).set(auth(member.token)).expect(403);

      // Convidada também pela empresa B: o link é recusado nas duas; o e-mail continua valendo.
      const { membershipId: inB } = await invite(b, email);
      expect((await a.as('post', `/users/${membershipId}/invite-link`).expect(409)).body.code).toBe('INVITED_ELSEWHERE');
      expect((await b.as('post', `/users/${inB}/invite-link`).expect(409)).body.code).toBe('INVITED_ELSEWHERE');
      await a.as('post', `/users/${membershipId}/resend-invite`).expect(200);

      // Desativada.
      const { membershipId: off } = await invite(a, uniqueEmail('off'));
      await a.as('patch', `/users/${off}`).send({ status: 'disabled' }).expect(204);
      expect((await a.as('post', `/users/${off}/invite-link`).expect(400)).body.code).toBe('MEMBERSHIP_DISABLED');
    });

    it('só um dono gera o link de outro dono', async () => {
      const s = await ownerSession(t);
      const { body: roles } = await s.as('get', '/access/roles').expect(200);
      const ownerRole = roles.find((r: { key: string }) => r.key === 'core.owner').id;
      const { body: role } = await s.as('post', '/access/roles').send({ label: 'Gestor de usuários', permissions: ['core.users.manage', 'core.users.read'] }).expect(201);
      const managerEmail = uniqueEmail('gestor');
      const { membershipId: managerId } = await invite(s, managerEmail, [role.id]);
      const link = (await s.as('post', `/users/${managerId}/invite-link`).expect(200)).body as { url: string };
      await t.http().post('/api/auth/set-password').send({ token: new URL(link.url).searchParams.get('token'), password: PASSWORD });
      const manager = await login(t, managerEmail);
      const { membershipId: newOwner } = await invite(s, uniqueEmail('dono2'), [ownerRole]);
      expect((await t.http().post(`/api/users/${newOwner}/invite-link`).set(auth(manager.token)).expect(403)).body.code).toBe('OWNER_ONLY');
    });
  });

  describe('auditoria', () => {
    it('filtra por período, usuário, ação e busca, e lista as opções dos filtros', async () => {
      const s = await ownerSession(t);
      const e = await newEntry(s);
      await s.as('post', `/finance/entries/${e.id}/cancel`).send({ reason: 'Motivo único xyz' }).expect(204);

      const { body: options } = await s.as('get', '/audit/filters').expect(200);
      expect(options.actions).toEqual(expect.arrayContaining(['finance.entry.created', 'finance.entry.cancelled']));
      expect(options.users.map((u: { id: string }) => u.id)).toContain(s.ownerUserId);

      const only = async (q: string) => (await s.as('get', `/audit?${q}`).expect(200)).body as { action: string }[];
      expect((await only('action=finance.entry.cancelled')).map((x) => x.action)).toEqual(['finance.entry.cancelled']);
      expect((await only('q=%C3%BAnico%20xyz')).map((x) => x.action)).toEqual(['finance.entry.cancelled']);
      expect(await only('q=nada-disso')).toEqual([]);
      expect((await only(`userId=${s.ownerUserId}`)).length).toBeGreaterThanOrEqual(2);
      // A criação da empresa é da plataforma, sem usuário.
      expect((await only('userId=system')).map((x) => x.action)).toContain('tenant.created');
      expect(await only('from=2000-01-01&to=2000-01-31')).toEqual([]);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      expect((await only(`from=${today}&to=${today}`)).length).toBeGreaterThan(0);
      await s.as('get', '/audit?from=2026-02-01&to=2026-01-01').expect(400);
      await s.as('get', '/audit?userId=abc').expect(400);
    });
  });

  describe('módulos', () => {
    it('o dono desativa; recusa com dependente ativo e no core; os dados voltam ao contratar de novo', async () => {
      const s = await ownerSession(t, ['hr_consulting']);
      const { body: company } = await s.as('post', '/customers').send({ name: 'Alfa Ltda', type: 'company' }).expect(201);
      await s.as('put', `/hr-consulting/clients/${company.id}`).send({ feeMode: 'fixed', feeAmount: 100 }).expect(200);

      const { body: list } = await s.as('get', '/modules/contracted').expect(200);
      const hr = list.find((m: { key: string }) => m.key === 'hr');
      expect(hr).toMatchObject({ status: 'active', dependents: [{ key: 'hr_consulting', name: 'Consultoria de RH' }] });
      expect(list.some((m: { layer: string }) => m.layer === 'core')).toBe(false);

      expect((await s.as('post', '/modules/hr/deactivate').expect(400)).body).toMatchObject({ code: 'MODULE_IN_USE', message: expect.stringContaining('Consultoria de RH') });
      expect((await s.as('post', '/modules/core.finance/deactivate').expect(400)).body.code).toBe('CORE_MODULE');
      expect((await s.as('post', '/modules/nao-existe/deactivate').expect(400)).body.code).toBe('UNKNOWN_MODULE');

      await s.as('post', '/modules/hr_consulting/deactivate').expect(204);
      await s.as('get', '/hr-consulting/clients').expect(403);
      expect((await s.as('post', '/modules/hr_consulting/deactivate').expect(400)).body.code).toBe('NOT_ACTIVE');
      const { body: after } = await s.as('get', '/modules/contracted').expect(200);
      expect(after.find((m: { key: string }) => m.key === 'hr_consulting').status).toBe('inactive');
      expect((await s.as('get', '/audit?action=module.disabled').expect(200)).body).toHaveLength(1);

      // Contratando de novo, os dados do ramo estão lá.
      await s.as('post', '/modules/hr_consulting/activate').expect(200);
      expect((await s.as('get', '/hr-consulting/clients').expect(200)).body[0]).toMatchObject({ customerId: company.id, feeMode: 'fixed' });
    });

    it('só o dono desativa', async () => {
      const { tenantId, email } = await createTenant(t, { modules: ['hr'] });
      const owner = await login(t, email);
      const memberEmail = uniqueEmail('membro');
      const { body: invited } = await t.http().post('/api/users/invite').set(auth(owner.token)).send({ email: memberEmail, name: 'Membro' }).expect(201);
      const link = (await t.http().post(`/api/users/${invited.membershipId}/invite-link`).set(auth(owner.token)).expect(200)).body as { url: string };
      await t.http().post('/api/auth/set-password').send({ token: new URL(link.url).searchParams.get('token'), password: PASSWORD });
      const member = await login(t, memberEmail);
      expect((await t.http().post('/api/modules/hr/deactivate').set(auth(member.token)).expect(403)).body.code).toBe('OWNER_ONLY');
      expect(tenantId).toBeTruthy();
    });
  });

  describe('segmentos', () => {
    it('a exportação só leva o contato de quem autorizou o canal', async () => {
      const s = await ownerSession(t, ['laundry']);
      const cash = await cashOf(s);
      const customer = async (name: string, email: string, phone: string) => (await s.as('post', '/customers').send({ name, email, phone }).expect(201)).body as { id: string };
      const paid = (customerId: string) =>
        s.as('post', '/finance/entries').send({ kind: 'income', description: 'Serviço', amount: 50, status: 'paid', dueDate: '2026-10-01', paidAt: '2026-10-01', accountId: cash, customerId }).expect(201);
      const consent = (id: string, purpose: string, granted: boolean) => s.as('post', `/customers/${id}/consents`).send({ purpose, granted, source: 'teste' }).expect(201);

      const ana = await customer('Ana Autoriza', 'ana@teste.com', '11987650001');
      const bia = await customer('Bia Whats', 'bia@teste.com', '11987650002');
      const caio = await customer('Caio Revogou', 'caio@teste.com', '11987650003');
      const dani = await customer('Dani Nada', 'dani@teste.com', '11987650004');
      for (const c of [ana, bia, caio, dani]) await paid(c.id);
      await consent(ana.id, 'marketing_email', true);
      await consent(ana.id, 'marketing_whatsapp', true);
      await consent(bia.id, 'marketing_whatsapp', true);
      await consent(caio.id, 'marketing_email', true);
      await consent(caio.id, 'marketing_email', false);
      await s.as('post', '/segmentation/recompute').expect(201);

      const rowOf = (csv: string, name: string) => csv.split('\r\n').find((l) => l.startsWith(name)) ?? '';
      const { text: all } = await s.as('get', '/segmentation/customers.csv').expect(200);
      expect(all.split('\r\n')[0]).toContain('Autoriza ofertas por e-mail;Autoriza ofertas por WhatsApp');
      expect(rowOf(all, 'Ana Autoriza')).toContain('+5511987650001;ana@teste.com');
      expect(rowOf(all, 'Ana Autoriza').endsWith(';Sim;Sim')).toBe(true);
      expect(rowOf(all, 'Bia Whats')).toContain('+5511987650002;;');
      expect(rowOf(all, 'Bia Whats')).not.toContain('bia@teste.com');
      expect(rowOf(all, 'Caio Revogou')).toMatch(/^Caio Revogou;;;/);
      expect(rowOf(all, 'Caio Revogou').endsWith(';Não;Não')).toBe(true);
      expect(rowOf(all, 'Dani Nada')).toMatch(/^Dani Nada;;;/);
      expect(all).not.toContain('dani@teste.com');

      const onlyEmail = (await s.as('get', '/segmentation/customers.csv?consent=marketing_email').expect(200)).text;
      expect(onlyEmail).toContain('Ana Autoriza');
      expect(onlyEmail).not.toContain('Bia Whats');
      const onlyWhats = (await s.as('get', '/segmentation/customers.csv?consent=marketing_whatsapp').expect(200)).text;
      expect(onlyWhats).toContain('Bia Whats');
      expect(onlyWhats).not.toContain('Caio Revogou');
      await s.as('get', '/segmentation/customers.csv?consent=service_notifications').expect(400);

      // A tela continua vendo o cadastro, com a autorização ao lado; a exportação fica na auditoria.
      const { body: rows } = await s.as('get', '/segmentation/customers').expect(200);
      expect(rows.find((r: { customer: { id: string } }) => r.customer.id === dani.id)).toMatchObject({ marketingEmail: false, marketingWhatsapp: false, customer: { email: 'dani@teste.com' } });
      const { body: log } = await s.as('get', '/audit?action=segmentation.exported').expect(200);
      expect(log.length).toBe(3);
    });
  });
});
