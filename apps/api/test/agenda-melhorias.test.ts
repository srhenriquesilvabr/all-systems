import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Próximo dia útil a pelo menos 2 dias de hoje. */
function nextWeekday(): string {
  let day = plusDays(localToday(), 2);
  while ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = plusDays(day, 1);
  return day;
}

/** Próximo domingo: sem expediente no horário padrão. */
function nextSunday(): string {
  let day = plusDays(localToday(), 1);
  while (new Date(`${day}T12:00:00Z`).getUTCDay() !== 0) day = plusDays(day, 1);
  return day;
}

describe('melhorias da agenda e dos ramos', () => {
  let t: TestApp;
  const admin = new Client({ connectionString: testEnv.MIGRATION_DATABASE_URL });
  beforeAll(async () => {
    t = await createTestApp();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await t.close();
  });

  /** Convida alguém com um papel padrão e devolve um atalho autenticado como essa pessoa. */
  async function member(owner: { token: string }, roleKey: string) {
    const roles = await t.http().get('/api/access/roles').set(auth(owner.token)).expect(200);
    const email = uniqueEmail('equipe');
    await t.http()
      .post('/api/users/invite')
      .set(auth(owner.token))
      .send({ email, name: 'Pessoa da Equipe', roleIds: [roles.body.find((r: { key: string }) => r.key === roleKey).id] })
      .expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name: 'Pessoa da Equipe' }).expect(204);
    const session = await login(t, email);
    const { body: me } = await t.http().get('/api/me').set(auth(session.token)).expect(200);
    return {
      userId: me.user.id as string,
      as: (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => t.http()[method](`/api${path}`).set(auth(session.token)),
    };
  }

  async function salon() {
    const s = await ownerSession(t, ['beauty']);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Bia Cliente', email: uniqueEmail('cliente'), phone: '(48) 99911-2233' }).expect(201);
    const { body: services } = await s.as('get', '/scheduling/services').expect(200);
    const { body: ana } = await s.as('post', '/scheduling/resources').send({ name: 'Ana' }).expect(201);
    const { body: bruno } = await s.as('post', '/scheduling/resources').send({ name: 'Bruno' }).expect(201);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name) as { id: string; name: string; price: number; durationMin: number };
    const book = (body: Record<string, unknown>) => s.as('post', '/scheduling/appointments').send({ customerId: customer.id, resourceId: ana.id, serviceIds: [service('Corte feminino').id], ...body });
    const entries = async (id: string) => (await s.as('get', '/finance/entries?limit=200').expect(200)).body.items.filter((e: { sourceId: string }) => e.sourceId === id) as { id: string; status: string; amount: number; paidAt: string; accountId: string }[];
    const { body: accounts } = await s.as('get', '/scheduling/payment-accounts').expect(200);
    return { ...s, customer, ana, bruno, service, book, entries, accounts: accounts as { id: string; name: string }[] };
  }

  describe('agenda', () => {
    it('marcação avulsa confere expediente e folga; a exceção é consciente e exige permissão', async () => {
      const s = await salon();
      const day = nextWeekday();
      expect((await s.book({ startsAt: at(day, '20:00') }).expect(409)).body.code).toBe('OUTSIDE_SCHEDULE');
      expect((await s.book({ startsAt: at(nextSunday(), '10:00') }).expect(409)).body.code).toBe('OUTSIDE_SCHEDULE');
      // Passa do fim da manhã (12h) por 30 minutos.
      expect((await s.book({ startsAt: at(day, '11:30') }).expect(409)).body.code).toBe('OUTSIDE_SCHEDULE');

      await s.as('post', `/scheduling/resources/${s.ana.id}/time-off`).send({ startsAt: at(day, '14:00'), endsAt: at(day, '16:00'), reason: 'Consulta' }).expect(201);
      const off = await s.book({ startsAt: at(day, '15:00') }).expect(409);
      expect(off.body.code).toBe('OUTSIDE_SCHEDULE');
      expect(off.body.message).toMatch(/folga/);

      // Quem não configura a agenda não fura.
      const reception = await member(s, 'beauty.reception');
      const body = { customerId: s.customer.id, resourceId: s.ana.id, serviceIds: [s.service('Corte feminino').id], startsAt: at(day, '15:00'), overrideSchedule: true };
      await reception.as('post', '/scheduling/appointments').send(body).expect(403);

      const { body: forced } = await s.book({ startsAt: at(day, '15:00'), overrideSchedule: true }).expect(201);
      const { rows } = await admin.query(`select data from audit_logs where entity_id = $1 and action = 'appointment.created'`, [forced.id]);
      expect(rows[0].data.scheduleOverride).toMatch(/folga/);
      // A sobreposição continua barrada mesmo com a exceção.
      expect((await s.book({ startsAt: at(day, '15:30'), overrideSchedule: true }).expect(409)).body.code).toBe('SLOT_TAKEN');
    });

    it('remarcar passa pela mesma conferência', async () => {
      const s = await salon();
      const day = nextWeekday();
      const { body: a } = await s.book({ startsAt: at(day, '09:00') }).expect(201);
      expect((await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '21:00') }).expect(409)).body.code).toBe('OUTSIDE_SCHEDULE');
      await s.as('post', `/scheduling/appointments/${a.id}/reschedule`).send({ startsAt: at(day, '21:00'), overrideSchedule: true }).expect(200);
    });

    it('em atendimento não cancela (a tela segue a mesma regra)', async () => {
      const s = await salon();
      const { body: a } = await s.book({ startsAt: at(nextWeekday(), '09:00') }).expect(201);
      await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'in_service' }).expect(200);
      expect((await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'cancelled', reason: 'Desistiu' }).expect(400)).body.code).toBe('INVALID_TRANSITION');
    });

    it('horário marcado: troca profissional, serviço, preço e desconto, com as mesmas validações', async () => {
      const s = await salon();
      const day = nextWeekday();
      const corte = s.service('Corte feminino');
      const escova = s.service('Escova');
      const { body: a } = await s.book({ startsAt: at(day, '09:00') }).expect(201);
      const edit = (body: Record<string, unknown>) => s.as('patch', `/scheduling/appointments/${a.id}`).send(body);

      const { body: other } = await edit({ resourceId: s.bruno.id }).expect(200);
      expect(other).toMatchObject({ resourceId: s.bruno.id, total: 90 });

      // Escova entra: duração e total acompanham, com o preço do cadastro.
      const { body: both } = await edit({ services: [{ serviceId: corte.id }, { serviceId: escova.id }] }).expect(200);
      expect(both.total).toBe(150);
      expect(new Date(both.endsAt).getTime()).toBe(new Date(at(day, '09:00')).getTime() + 105 * 60_000);

      // Desconto em reais: price é o cobrado; o preço de tabela vira 100 nesta linha.
      const { body: priced } = await edit({ services: [{ serviceId: corte.id, price: 100, discount: 20 }, { serviceId: escova.id }] }).expect(200);
      expect(priced.total).toBe(140);
      expect(priced.services.find((l: { serviceId: string }) => l.serviceId === corte.id)).toMatchObject({ price: 80, discount: 20 });
      // Sem mandar valores, a linha mantida guarda os dela.
      const { body: kept } = await edit({ notes: 'Trazer foto' }).expect(200);
      expect(kept).toMatchObject({ total: 140, notes: 'Trazer foto' });

      expect((await edit({ services: [{ serviceId: corte.id, discount: 500 }] }).expect(400)).body.code).toBe('DISCOUNT_EXCEEDS_PRICE');
      expect((await edit({ services: [] }).expect(400)).body.message).toBeTruthy();

      // Quem faz: o serviço ligado à Ana não vai para o Bruno.
      await s.as('patch', `/scheduling/services/${escova.id}`).send({ name: escova.name, durationMin: 45, price: 60, resourceIds: [s.ana.id] }).expect(200);
      const { body: second } = await s.book({ startsAt: at(day, '14:00'), resourceId: s.bruno.id }).expect(201);
      expect((await s.as('patch', `/scheduling/appointments/${second.id}`).send({ services: [{ serviceId: corte.id }, { serviceId: escova.id }] }).expect(400)).body.code).toBe('RESOURCE_NOT_ELIGIBLE');

      // A duração nova não pode furar o expediente nem cair em cima de outro horário.
      const { body: late } = await s.book({ startsAt: at(day, '17:00'), resourceId: s.ana.id }).expect(201);
      const longer = s.as('patch', `/scheduling/appointments/${late.id}`).send({ services: [{ serviceId: corte.id }, { serviceId: s.service('Coloração').id }] });
      expect((await longer.expect(409)).body.code).toBe('OUTSIDE_SCHEDULE');
    });

    it('não altera horário encerrado nem deixa o total abaixo do pago', async () => {
      const s = await salon();
      const day = nextWeekday();
      const { body: a } = await s.book({ startsAt: at(day, '09:00') }).expect(201);
      await s.as('post', `/scheduling/appointments/${a.id}/payments`).send({ amount: 50, method: 'pix', accountId: s.accounts[0]!.id }).expect(201);
      const low = await s.as('patch', `/scheduling/appointments/${a.id}`).send({ services: [{ serviceId: s.service('Corte feminino').id, price: 40 }] }).expect(400);
      expect(low.body.code).toBe('TOTAL_BELOW_PAID');

      await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'done' }).expect(200);
      expect((await s.as('patch', `/scheduling/appointments/${a.id}`).send({ notes: 'x' }).expect(400)).body.code).toBe('APPOINTMENT_CLOSED');
    });

    it('editar o preço atualiza o "a receber" sem duplicar', async () => {
      const s = await salon();
      const { body: a } = await s.book({ startsAt: at(nextWeekday(), '09:00') }).expect(201);
      await s.as('post', `/scheduling/appointments/${a.id}/payments`).send({ amount: 30, method: 'pix', accountId: s.accounts[0]!.id }).expect(201);
      await s.as('patch', `/scheduling/appointments/${a.id}`).send({ services: [{ serviceId: s.service('Corte feminino').id, discount: 10 }] }).expect(200);
      const pending = (await s.entries(a.id)).filter((e) => e.status === 'pending');
      expect(pending.map((e) => e.amount)).toEqual([50]);
    });

    it('pagamento: data informada, padrão hoje, sem futuro', async () => {
      const s = await salon();
      const { body: a } = await s.book({ startsAt: at(nextWeekday(), '09:00') }).expect(201);
      const pay = (body: Record<string, unknown>) => s.as('post', `/scheduling/appointments/${a.id}/payments`).send({ method: 'pix', accountId: s.accounts[0]!.id, ...body });
      expect((await pay({ amount: 10, paidAt: plusDays(localToday(), 1) }).expect(400)).body.code).toBe('INVALID_DATE');
      await pay({ amount: 10 }).expect(201);
      await pay({ amount: 20, paidAt: plusDays(localToday(), -3) }).expect(201);
      const paid = (await s.entries(a.id)).filter((e) => e.status === 'paid').map((e) => e.paidAt).sort();
      expect(paid).toEqual([plusDays(localToday(), -3), localToday()]);
    });

    it('pagamento entra no caixa aberto sem contar duas vezes no financeiro', async () => {
      const s = await salon();
      const { body: register } = await s.as('post', '/sales/registers').send({ name: 'Caixa 1' }).expect(201);
      const { body: fechado } = await s.as('post', '/sales/registers').send({ name: 'Caixa 2' }).expect(201);
      const { body: session } = await s.as('post', '/sales/registers/sessions').send({ registerId: register.id, openingFloat: 100 }).expect(201);
      const { body: open } = await s.as('get', '/scheduling/payment-registers').expect(200);
      expect(open).toEqual([{ id: register.id, name: 'Caixa 1' }]);

      const day = nextWeekday();
      const { body: a } = await s.book({ startsAt: at(day, '09:00') }).expect(201);
      const pay = (body: Record<string, unknown>) => s.as('post', `/scheduling/appointments/${a.id}/payments`).send(body);

      expect((await pay({ amount: 10, method: 'cash', registerId: fechado.id }).expect(409)).body.code).toBe('REGISTER_CLOSED');
      await pay({ amount: 40, method: 'cash', registerId: register.id }).expect(201);
      await pay({ amount: 30, method: 'pix', accountId: s.accounts[0]!.id, registerId: register.id }).expect(201);
      // Data passada não entra na sessão de hoje.
      await pay({ amount: 20, method: 'cash', accountId: s.accounts[0]!.id, paidAt: plusDays(localToday(), -2), registerId: register.id }).expect(201);

      const { body: live } = await s.as('get', `/sales/registers/sessions/${session.id}`).expect(200);
      expect(live.totals.find((x: { method: string }) => x.method === 'cash').expected).toBe(140);
      expect(live.totals.find((x: { method: string }) => x.method === 'pix').expected).toBe(30);
      expect(live.moves.filter((m: { kind: string }) => m.kind === 'service_receipt')).toHaveLength(2);
      expect(live).toMatchObject({ salesCount: 0, salesTotal: 0, withdrawals: 0, deposits: 0, expectedCash: 140 });

      // Financeiro: um lançamento pago por recebimento, nada a mais do caixa.
      const all = (await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as { sourceId: string; sourceType: string; status: string; amount: number }[];
      expect(all.filter((e) => e.status === 'paid').map((e) => e.amount).sort((x, y) => x - y)).toEqual([20, 30, 40]);
      expect(all.filter((e) => e.status === 'paid').every((e) => e.sourceId === a.id)).toBe(true);
      expect(all.filter((e) => e.sourceType === 'sales_register_move' || e.sourceType === 'sales_register_session')).toEqual([]);

      // Fechar conferindo o que entrou não gera quebra nem sobra.
      const { body: closed } = await s.as('post', `/sales/registers/sessions/${session.id}/close`).send({ counted: { cash: 140, pix: 30 } }).expect(201);
      expect(closed.cashDifference).toBe(0);
    });
  });

  describe('agendamento online', () => {
    it('serviço novo nasce fora do link; o link mostra só o liberado e respeita o limite de dias', async () => {
      const s = await salon();
      const { body: me } = await s.as('get', '/me').expect(200);
      const pub = `/api/public/booking/${me.tenant.slug}`;
      await s.as('put', '/modules/shared.scheduling/settings').send({ onlineBooking: true, onlineMinNoticeHours: 0, onlineMaxDays: 60 }).expect(204);

      const { body: created } = await s.as('post', '/scheduling/services').send({ name: 'Serviço novo', durationMin: 30, price: 10 }).expect(201);
      const { body: list } = await s.as('get', '/scheduling/services').expect(200);
      expect(list.find((x: { id: string }) => x.id === created.id).online).toBe(false);
      // Os exemplos do ramo também.
      expect(list.every((x: { online: boolean }) => !x.online)).toBe(true);

      let { body: info } = await t.http().get(pub).expect(200);
      expect(info.services).toEqual([]);
      expect(info.maxDays).toBe(60);
      // Serviço fora do link não aceita marcação direta.
      await t.http().post(pub).send({ name: 'Visitante', phone: '48 98877-6655', resourceId: s.ana.id, serviceIds: [created.id], startsAt: at(nextWeekday(), '09:00') }).expect(400);

      await s.as('put', '/scheduling/services/online').send({ serviceIds: [created.id] }).expect(204);
      ({ body: info } = await t.http().get(pub).expect(200));
      expect(info.services.map((x: { id: string }) => x.id)).toEqual([created.id]);

      // Dia 45 está além dos antigos 14 e dentro do limite; depois do limite, nada.
      let far = plusDays(localToday(), 45);
      while ([0, 6].includes(new Date(`${far}T12:00:00Z`).getUTCDay())) far = plusDays(far, 1);
      const { body: within } = await t.http().get(`${pub}/availability?date=${far}&serviceIds=${created.id}&resourceId=${s.ana.id}`).expect(200);
      expect(within[0].slots.length).toBeGreaterThan(0);
      const { body: beyond } = await t.http().get(`${pub}/availability?date=${plusDays(localToday(), 90)}&serviceIds=${created.id}&resourceId=${s.ana.id}`).expect(200);
      expect(beyond).toEqual([]);

      await s.as('put', '/scheduling/services/online').send({ serviceIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
    });

    it('advocacia: Audiência não nasce marcável por visitante', async () => {
      const s = await ownerSession(t, ['legal']);
      const { body: services } = await s.as('get', '/scheduling/services').expect(200);
      expect(services.find((x: { name: string }) => x.name === 'Audiência').online).toBe(false);
    });
  });

  describe('salão', () => {
    const finish = (s: Awaited<ReturnType<typeof salon>>, id: string) => s.as('post', `/scheduling/appointments/${id}/status`).send({ status: 'done' }).expect(200);

    it('o percentual fica gravado: mudar hoje não recalcula o passado', async () => {
      const s = await salon();
      const day = nextWeekday();
      await s.as('put', `/beauty/commission-rules/${s.ana.id}`).send({ defaultRate: 40, services: [] }).expect(204);
      const { body: a } = await s.book({ startsAt: at(day, '09:00') }).expect(201);
      await finish(s, a.id);

      await s.as('put', `/beauty/commission-rules/${s.ana.id}`).send({ defaultRate: 10, services: [] }).expect(204);
      const { body: b } = await s.book({ startsAt: at(day, '13:00') }).expect(201);
      await finish(s, b.id);

      const { body: report } = await s.as('get', `/beauty/commissions?from=${day}&to=${day}`).expect(200);
      const ana = report.professionals.find((p: { name: string }) => p.name === 'Ana');
      expect(ana.lines.map((l: { rate: number; commission: number }) => [l.rate, l.commission])).toEqual([
        [40, 36],
        [10, 9],
      ]);
      expect(ana).toMatchObject({ commission: 45, launched: 0, toLaunch: 45 });
    });

    it('comissão vira despesa a pagar, por período, sem duplicar', async () => {
      const s = await salon();
      const day = nextWeekday();
      await s.as('put', `/beauty/commission-rules/${s.ana.id}`).send({ defaultRate: 50, services: [] }).expect(204);
      await s.as('put', `/beauty/commission-rules/${s.bruno.id}`).send({ defaultRate: 10, services: [] }).expect(204);
      const { body: a } = await s.book({ startsAt: at(day, '09:00') }).expect(201);
      await finish(s, a.id);
      const { body: b } = await s.book({ startsAt: at(day, '09:00'), resourceId: s.bruno.id }).expect(201);
      await finish(s, b.id);

      const launch = (from = day, to = day) => s.as('post', '/beauty/commissions/payouts').send({ from, to, dueDate: plusDays(day, 5) });
      const { body: created } = await launch().expect(201);
      expect(created.map((p: { resourceName: string; amount: number }) => [p.resourceName, p.amount]).sort()).toEqual([
        ['Ana', 45],
        ['Bruno', 9],
      ]);
      const expenses = async () => (await s.as('get', '/finance/entries?limit=200').expect(200)).body.items.filter((e: { sourceType: string; status: string }) => e.sourceType === 'beauty_commission' && e.status !== 'cancelled') as { id: string; amount: number; status: string; kind: string; settleInFinance: boolean; sourceId: string }[];
      expect((await expenses()).map((e) => e.amount).sort((x, y) => x - y)).toEqual([9, 45]);
      expect((await expenses())[0]).toMatchObject({ kind: 'expense', status: 'pending', settleInFinance: true });

      // Repetir, ou lançar um período que cruza, não duplica.
      expect((await launch().expect(409)).body.code).toBe('NOTHING_TO_LAUNCH');
      expect((await launch(plusDays(day, -5), plusDays(day, 5)).expect(409)).body.code).toBe('NOTHING_TO_LAUNCH');
      expect(await expenses()).toHaveLength(2);

      // Só o atendimento novo entra no período que cruza.
      const { body: c } = await s.book({ startsAt: at(day, '13:00') }).expect(201);
      await finish(s, c.id);
      const { body: more } = await launch(plusDays(day, -5), plusDays(day, 5)).expect(201);
      expect(more.map((p: { amount: number }) => p.amount)).toEqual([45]);
      const { body: report } = await s.as('get', `/beauty/commissions?from=${day}&to=${day}`).expect(200);
      expect(report.professionals.find((p: { name: string }) => p.name === 'Ana')).toMatchObject({ commission: 90, launched: 90, toLaunch: 0 });

      // Cancelar devolve as linhas; relançar não soma em dobro.
      const payout = more[0];
      await s.as('post', `/beauty/commissions/payouts/${payout.id}/cancel`).send({ reason: 'x' }).expect(400);
      await s.as('post', `/beauty/commissions/payouts/${payout.id}/cancel`).send({ reason: 'Lançado errado' }).expect(200);
      await s.as('post', `/beauty/commissions/payouts/${payout.id}/cancel`).send({ reason: 'De novo' }).expect(409);
      expect((await s.as('get', `/beauty/commissions?from=${day}&to=${day}`).expect(200)).body.professionals.find((p: { name: string }) => p.name === 'Ana')).toMatchObject({ launched: 45, toLaunch: 45 });
      const { body: again } = await launch().expect(201);
      expect(again.map((p: { amount: number }) => p.amount)).toEqual([45]);

      // Paga, não cancela por aqui.
      const entry = (await expenses()).find((e) => e.sourceId === again[0].id)!;
      const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
      await s.as('post', `/finance/entries/${entry.id}/pay`).send({ paidAt: localToday(), accountId: accounts[0].id, paymentMethod: 'pix' }).expect(201);
      expect((await s.as('post', `/beauty/commissions/payouts/${again[0].id}/cancel`).send({ reason: 'Lançado errado' }).expect(409)).body.code).toBe('PAYOUT_PAID');
    });

    it('o profissional vê só a própria comissão', async () => {
      const s = await salon();
      const day = nextWeekday();
      await s.as('put', `/beauty/commission-rules/${s.ana.id}`).send({ defaultRate: 50, services: [] }).expect(204);
      await s.as('put', `/beauty/commission-rules/${s.bruno.id}`).send({ defaultRate: 10, services: [] }).expect(204);
      const { body: a } = await s.book({ startsAt: at(day, '09:00') }).expect(201);
      await finish(s, a.id);
      const { body: b } = await s.book({ startsAt: at(day, '09:00'), resourceId: s.bruno.id }).expect(201);
      await finish(s, b.id);

      const professional = await member(s, 'beauty.professional');
      await professional.as('get', `/beauty/commissions?from=${day}&to=${day}`).expect(403);
      const unlinked = await professional.as('get', `/beauty/commissions/mine?from=${day}&to=${day}`).expect(200);
      expect(unlinked.body).toMatchObject({ linked: false, professionals: [] });

      await s.as('patch', `/scheduling/resources/${s.ana.id}`).send({ name: 'Ana', userId: professional.userId }).expect(200);
      const { body: mine } = await professional.as('get', `/beauty/commissions/mine?from=${day}&to=${day}`).expect(200);
      expect(mine.linked).toBe(true);
      expect(mine.professionals.map((p: { name: string; commission: number }) => [p.name, p.commission])).toEqual([['Ana', 45]]);
    });
  });

  describe('estética', () => {
    async function clinic(specialties: string[] = []) {
      const s = await ownerSession(t, ['aesthetics']);
      const { body: customer } = await s.as('post', '/customers').send({ name: 'Paula Paciente', email: uniqueEmail('paciente'), phone: '(48) 99700-3344' }).expect(201);
      const pro = async (name: string) => (await s.as('post', '/scheduling/resources').send({ name }).expect(201)).body as { id: string; teamMemberId: string };
      const enable = async (list: string[], extra: Record<string, unknown> = {}) => {
        const { body: current } = await s.as('get', '/modules/aesthetics/settings').expect(200);
        await s.as('put', '/modules/aesthetics/settings').send({ ...current, specialties: list, ...extra }).expect(204);
      };
      if (specialties.length) await enable(specialties);
      const credential = (resourceId: string, body: Record<string, unknown>) => s.as('put', `/aesthetics/credentials/${resourceId}`).send(body).expect(204);
      const record = (body: Record<string, unknown>) => s.as('post', '/aesthetics/records').send({ customerId: customer.id, ...body });
      const services = async () => (await s.as('get', '/scheduling/services').expect(200)).body as { id: string; name: string; requiresRoom: boolean; resourceIds: string[] }[];
      return { ...s, customer, pro, enable, credential, record, services };
    }

    /** Produto com estoque e lote, para conferir rastreio e baixa. */
    async function stocked(s: Awaited<ReturnType<typeof clinic>>, kind: string, unit: string, unitsPerPackage: number) {
      const { body: item } = await s.as('post', '/sales/products').send({ name: `Estoque ${kind}`, price: 100, unit: 'un', trackStock: true }).expect(201);
      await s.as('post', '/sales/stock-moves').send({ productId: item.id, kind: 'purchase', quantity: 10, unitCost: 50 }).expect(201);
      const { body: product } = await s.as('post', '/aesthetics/products').send({ name: `Produto ${kind}`, kind, unit, unitsPerPackage, salesProductId: item.id }).expect(201);
      const { body: withLot } = await s.as('post', '/aesthetics/lots').send({ productId: product.id, lot: 'L1', expiresOn: plusDays(localToday(), 300) }).expect(201);
      const stock = async () => (await s.as('get', `/sales/products?q=${encodeURIComponent(`Estoque ${kind}`)}`).expect(200)).body[0].stock as number;
      return { item, product, lot: withLot.lots[0] as { id: string }, stock };
    }

    it('falta que consome sessão de pacote obedece à configuração', async () => {
      const s = await clinic();
      const { body: pro } = await s.as('post', '/scheduling/resources').send({ name: 'Dra. Helena' }).expect(201);
      const drainage = (await s.services()).find((x) => x.name === 'Drenagem linfática')!;
      const { body: pkg } = await s.as('post', '/aesthetics/packages').send({ customerId: s.customer.id, serviceId: drainage.id, totalSessions: 4, price: 400 }).expect(201);
      const day = nextWeekday();
      const book = async (time: string) => (await s.as('post', '/scheduling/appointments').send({ customerId: s.customer.id, resourceId: pro.id, serviceIds: [drainage.id], startsAt: at(day, time) }).expect(201)).body;
      const current = async () => (await s.as('get', `/aesthetics/packages?customerId=${s.customer.id}`).expect(200)).body[0];

      const a = await book('09:00');
      await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'no_show' }).expect(200);
      await t.relay.drain();
      expect((await current()).usedSessions).toBe(0);

      await s.enable([], { noShowConsumesSession: true });
      const b = await book('13:00');
      await s.as('post', `/scheduling/appointments/${b.id}/status`).send({ status: 'no_show' }).expect(200);
      await t.relay.drain();
      expect(await current()).toMatchObject({ id: pkg.id, usedSessions: 1 });
    });

    it('trocar o serviço do horário devolve a sessão reservada do pacote', async () => {
      const s = await clinic();
      const { body: pro } = await s.as('post', '/scheduling/resources').send({ name: 'Dra. Helena' }).expect(201);
      const list = await s.services();
      const drainage = list.find((x) => x.name === 'Drenagem linfática')!;
      const massage = list.find((x) => x.name === 'Massagem modeladora')!;
      await s.as('post', '/aesthetics/packages').send({ customerId: s.customer.id, serviceId: drainage.id, totalSessions: 2, price: 200 }).expect(201);
      const { body: a } = await s.as('post', '/scheduling/appointments').send({ customerId: s.customer.id, resourceId: pro.id, serviceIds: [drainage.id], startsAt: at(nextWeekday(), '09:00') }).expect(201);
      expect(a.services[0]).toMatchObject({ price: 0, covered: true });
      expect((await s.as('patch', `/scheduling/appointments/${a.id}`).send({ services: [{ serviceId: drainage.id, price: 50 }] }).expect(400)).body.code).toBe('LINE_COVERED');

      // Quem marca mas não recebe pagamento troca o serviço, sem mexer em valor.
      const doctor = await member(s, 'aesthetics.doctor');
      await doctor.as('patch', `/scheduling/appointments/${a.id}`).send({ services: [{ serviceId: massage.id, price: 10 }] }).expect(403);
      await doctor.as('patch', `/scheduling/appointments/${a.id}`).send({ notes: 'Pode trocar a observação' }).expect(200);

      const { body: edited } = await s.as('patch', `/scheduling/appointments/${a.id}`).send({ services: [{ serviceId: massage.id }] }).expect(200);
      expect(edited.total).toBe(140);
      expect((await s.as('get', `/aesthetics/packages?customerId=${s.customer.id}`).expect(200)).body[0].reservedSessions).toBe(0);

      // Volta para o serviço do pacote: reserva de novo, sem conflito no índice único.
      const { body: back } = await s.as('patch', `/scheduling/appointments/${a.id}`).send({ services: [{ serviceId: drainage.id }] }).expect(200);
      expect(back.total).toBe(0);
      expect((await s.as('get', `/aesthetics/packages?customerId=${s.customer.id}`).expect(200)).body[0].reservedSessions).toBe(1);
    });

    it('clareamento com lote exige quantidade, entra no rastreio e baixa o estoque', async () => {
      const s = await clinic(['whitening']);
      const dentist = await s.pro('Dr. Bruno');
      await s.credential(dentist.id, { council: 'CRO', number: '12345', uf: 'SC' });
      const { lot, stock } = await stocked(s, 'whitening_gel', 'ml', 10);
      const base = { specialty: 'whitening', formKey: 'aesthetics.whitening', professionalId: dentist.id };

      expect((await s.record({ ...base, data: { type: 'Consultório', lotId: lot.id } }).expect(400)).body.code).toBe('LOT_AMOUNT_REQUIRED');
      await s.record({ ...base, data: { type: 'Consultório', lotId: lot.id, amount: 5 } }).expect(201);
      const { body: trace } = await s.as('get', `/aesthetics/lots/${lot.id}/trace`).expect(200);
      expect(trace.usages.map((u: { amount: number }) => u.amount)).toEqual([5]);
      expect(await stock()).toBeCloseTo(9.5, 3);
    });

    it('retificar a ficha corrige lote e estoque com estorno em linha nova', async () => {
      const s = await clinic(['harmonization']);
      const helena = await s.pro('Dra. Helena');
      await s.credential(helena.id, { council: 'CRM', number: '123456', uf: 'SP' });
      const { lot, stock, product } = await stocked(s, 'toxin', 'U', 100);
      const { body: withOther } = await s.as('post', '/aesthetics/lots').send({ productId: product.id, lot: 'L2', expiresOn: plusDays(localToday(), 300) }).expect(201);
      const other = withOther.lots.find((l: { lot: string }) => l.lot === 'L2');
      const points = (rows: { lotId: string; amount: number }[]) => rows.map((r, i) => ({ region: `Ponto ${i}`, x: 100, y: 80, unit: '', ...r }));
      const { body: entry } = await s
        .record({ specialty: 'harmonization', formKey: 'aesthetics.harmonization', professionalId: helena.id, data: { procedure: 'Toxina botulínica', points: points([{ lotId: lot.id, amount: 30 }]) } })
        .expect(201);
      expect(await stock()).toBeCloseTo(9.7, 3);

      // Retificada com menos: estorno de 10, sem tocar na linha antiga.
      const { body: first } = await s
        .as('post', `/medical-records/${entry.id}/amend`)
        .send({ reason: 'Quantidade errada', data: { ...entry.data, points: points([{ lotId: lot.id, amount: 20 }]) } })
        .expect(201);
      expect(first.data.points[0]).toMatchObject({ lot: 'L1', amount: 20 });
      let { body: trace } = await s.as('get', `/aesthetics/lots/${lot.id}/trace`).expect(200);
      expect(trace.usages.map((u: { amount: number; reversalOf: string | null }) => [u.amount, !!u.reversalOf]).sort()).toEqual([
        [-10, true],
        [30, false],
      ]);
      expect(trace.lot.used).toBe(20);
      expect(await stock()).toBeCloseTo(9.8, 3);
      const { body: moves } = await s.as('get', `/sales/products/${(await s.as('get', '/sales/products?q=Estoque').expect(200)).body[0].id}/moves`).expect(200);
      expect(moves[0]).toMatchObject({ kind: 'consumption', quantity: 0.1 });
      expect(moves[0].reason).toContain('Estorno');
      expect(moves[0].reason).not.toContain('Paula');

      // Retificada sem mudar: nada novo.
      const { body: second } = await s.as('post', `/medical-records/${first.id}/amend`).send({ reason: 'Só a observação', notes: 'Texto', data: first.data }).expect(201);
      expect((await s.as('get', `/aesthetics/lots/${lot.id}/trace`).expect(200)).body.usages).toHaveLength(2);

      // Lote errado: sai de um, entra no outro, e o estoque fica igual.
      await s.as('post', `/medical-records/${second.id}/amend`).send({ reason: 'Lote errado', data: { ...second.data, points: points([{ lotId: other.id, amount: 20 }]) } }).expect(201);
      ({ body: trace } = await s.as('get', `/aesthetics/lots/${lot.id}/trace`).expect(200));
      expect(trace.lot.used).toBe(0);
      expect((await s.as('get', `/aesthetics/lots/${other.id}/trace`).expect(200)).body.lot.used).toBe(20);
      expect(await stock()).toBeCloseTo(9.8, 3);

      // Só a versão mais recente pode ser retificada: o estorno não acontece duas vezes.
      await s.as('post', `/medical-records/${entry.id}/amend`).send({ reason: 'De novo', data: entry.data }).expect(409);
      expect((await s.as('get', `/aesthetics/lots/${lot.id}/trace`).expect(200)).body.lot.used).toBe(0);
    });

    it('ligar o laser faz a depilação dos exemplos básicos exigir sala e ligar ao aparelho', async () => {
      const s = await clinic();
      const before = (await s.services()).find((x) => x.name === 'Depilação a laser (área pequena)')!;
      expect(before).toMatchObject({ requiresRoom: false, resourceIds: [] });
      await s.enable(['laser']);
      const { body: resources } = await s.as('get', '/scheduling/resources').expect(200);
      const device = resources.find((r: { name: string }) => r.name === 'Laser de diodo (equipamento)');
      const after = (await s.services()).find((x) => x.name === 'Depilação a laser (área pequena)')!;
      expect(after.requiresRoom).toBe(true);
      expect(after.resourceIds).toContain(device.id);

      // Decisão da clínica depois disso fica: salvar de novo não religa.
      await s.as('patch', `/scheduling/services/${after.id}`).send({ name: after.name, durationMin: 30, price: 150, requiresRoom: false }).expect(200);
      await s.enable(['laser']);
      expect((await s.services()).find((x) => x.id === after.id)!.requiresRoom).toBe(false);
    });

    it('cirurgia: ficha e termo sem tratamento escolhido ligam sozinhos ao único caso aberto', async () => {
      const s = await clinic(['plastic_surgery']);
      const surgeon = await s.pro('Dr. Rafael');
      await s.credential(surgeon.id, { council: 'CRM', number: '145678', uf: 'SP', rqe: '7788' });
      const preop = () => s.record({ specialty: 'plastic_surgery', formKey: 'aesthetics.surgery.preop', professionalId: surgeon.id, data: { anesthesiaClearance: true, released: true } });
      // Sem caso: entra, mas sem vínculo.
      expect((await preop().expect(201)).body.data.caseId).toBeUndefined();

      const open = async (title: string) => (await s.as('post', '/aesthetics/cases').send({ customerId: s.customer.id, specialty: 'plastic_surgery', title, professionalId: surgeon.id }).expect(201)).body;
      const c = await open('Mamoplastia');
      expect((await preop().expect(201)).body.data.caseId).toBe(c.id);

      const { body: templates } = await s.as('get', '/aesthetics/consent-templates?specialty=plastic_surgery').expect(200);
      const surgical = templates.find((x: { key: string }) => x.key === 'plastic_surgery.default');
      const general = templates.find((x: { key: string }) => x.key === 'common.image-use');
      const consent = (templateId: string) =>
        s.as('post', '/aesthetics/consents').send({ customerId: s.customer.id, templateId, specialty: 'plastic_surgery', procedure: 'Mamoplastia', professionalId: surgeon.id, signedBy: 'Paula Paciente' });
      // Uso de imagem não libera a cirurgia.
      expect((await consent(general.id).expect(201)).body.data.caseId).toBeUndefined();
      expect((await consent(surgical.id).expect(201)).body.data.caseId).toBe(c.id);
      expect((await s.as('get', `/aesthetics/cases?customerId=${s.customer.id}`).expect(200)).body[0]).toMatchObject({ id: c.id, consentAccepted: true, stage: 'preop' });

      await open('Abdominoplastia');
      expect((await preop().expect(400)).body.code).toBe('CASE_REQUIRED');
      expect((await consent(surgical.id).expect(400)).body.code).toBe('CASE_REQUIRED');
    });

    it('cirurgia marcada fora do expediente pede a exceção', async () => {
      const s = await clinic(['plastic_surgery']);
      const surgeon = await s.pro('Dr. Rafael');
      await s.credential(surgeon.id, { council: 'CRM', number: '145678', uf: 'SP', rqe: '7788' });
      const { body: c } = await s.as('post', '/aesthetics/cases').send({ customerId: s.customer.id, specialty: 'plastic_surgery', title: 'Rinoplastia', professionalId: surgeon.id }).expect(201);
      await s.as('put', `/aesthetics/cases/${c.id}/budget`).send({ items: [{ kind: 'surgeon', description: 'Honorários', amount: 1000, billedBy: 'clinic' }] }).expect(200);
      await s.as('post', `/aesthetics/cases/${c.id}/budget/approve`).send({ installments: 1 }).expect(201);
      const { body: templates } = await s.as('get', '/aesthetics/consent-templates?specialty=plastic_surgery').expect(200);
      await s.as('post', '/aesthetics/consents').send({ customerId: s.customer.id, templateId: templates.find((x: { key: string }) => x.key === 'plastic_surgery.default').id, procedure: 'Rinoplastia', professionalId: surgeon.id, signedBy: 'Paula Paciente' }).expect(201);
      await s.record({ specialty: 'plastic_surgery', formKey: 'aesthetics.surgery.preop', professionalId: surgeon.id, data: { anesthesiaClearance: true, released: true } }).expect(201);
      const service = (await s.services()).find((x) => x.name === 'Cirurgia plástica (centro cirúrgico)')!;
      const schedule = (body: Record<string, unknown> = {}) => s.as('post', `/aesthetics/cases/${c.id}/surgery`).send({ resourceId: surgeon.id, serviceId: service.id, startsAt: at(nextWeekday(), '20:00'), location: 'Hospital', ...body });
      expect((await schedule().expect(409)).body.code).toBe('OUTSIDE_SCHEDULE');
      await schedule({ overrideSchedule: true }).expect(201);
    });

    it('micropigmentação aceita a foto do desenho; título do tratamento é editável', async () => {
      const s = await clinic(['micropigmentation']);
      const pro = await s.pro('Carla');
      const { body: c } = await s.as('post', '/aesthetics/cases').send({ customerId: s.customer.id, specialty: 'micropigmentation', title: 'Sobrancelhas' }).expect(201);
      const { body: renamed } = await s.as('patch', `/aesthetics/cases/${c.id}`).send({ title: 'Sobrancelhas fio a fio' }).expect(200);
      expect(renamed.title).toBe('Sobrancelhas fio a fio');
      const { rows } = await admin.query(`select data from audit_logs where entity_id = $1 and action = 'aesthetics.case.renamed'`, [c.id]);
      expect(rows[0].data).toMatchObject({ from: 'Sobrancelhas', to: 'Sobrancelhas fio a fio' });

      const { body: entry } = await s
        .record({ specialty: 'micropigmentation', formKey: 'aesthetics.micropigmentation', professionalId: pro.id, data: { area: 'Sobrancelhas', designApproved: true, pigments: [{ color: 'Castanho' }] } })
        .expect(201);
      await s.as('post', `/medical-records/${entry.id}/attachments`).attach('file', PNG_1PX, { filename: 'desenho.png', contentType: 'image/png' }).expect(201);
      const { body: patient } = await s.as('get', `/aesthetics/patients/${s.customer.id}`).expect(200);
      expect(patient.entries.find((e: { id: string }) => e.id === entry.id).attachments).toEqual([expect.objectContaining({ filename: 'desenho.png' })]);
    });

    it('pacote vendido a partir da cirurgia fica ligado ao caso', async () => {
      const s = await clinic(['plastic_surgery']);
      const { body: c } = await s.as('post', '/aesthetics/cases').send({ customerId: s.customer.id, specialty: 'plastic_surgery', title: 'Lipoaspiração' }).expect(201);
      const drainage = (await s.services()).find((x) => x.name === 'Drenagem linfática')!;
      const sell = (body: Record<string, unknown>) => s.as('post', '/aesthetics/packages').send({ customerId: s.customer.id, serviceId: drainage.id, totalSessions: 5, price: 500, ...body });
      const { body: pkg } = await sell({ caseId: c.id }).expect(201);
      expect(pkg.case).toEqual({ id: c.id, title: 'Lipoaspiração' });
      const { body: cases } = await s.as('get', `/aesthetics/cases?customerId=${s.customer.id}`).expect(200);
      expect(cases[0].packages).toEqual([expect.objectContaining({ id: pkg.id, service: 'Drenagem linfática', totalSessions: 5, usedSessions: 0 })]);

      // Caso de outro paciente é recusado.
      const { body: other } = await s.as('post', '/customers').send({ name: 'Outra Paciente', email: uniqueEmail('outra') }).expect(201);
      expect((await s.as('post', '/aesthetics/packages').send({ customerId: other.id, serviceId: drainage.id, totalSessions: 5, price: 500, caseId: c.id }).expect(400)).body.code).toBe('CASE_MISMATCH');
    });
  });

  describe('ortodontia', () => {
    async function clinic() {
      const s = await ownerSession(t, ['orthodontics']);
      const { body: customer } = await s.as('post', '/customers').send({ name: 'Paula Paciente', email: uniqueEmail('paciente') }).expect(201);
      const { body: services } = await s.as('get', '/scheduling/services').expect(200);
      const { body: pro } = await s.as('post', '/scheduling/resources').send({ name: 'Dra. Helena' }).expect(201);
      const install = services.find((x: { name: string }) => x.name === 'Instalação de aparelho');
      const book = (time: string) => s.as('post', '/scheduling/appointments').send({ customerId: customer.id, resourceId: pro.id, serviceIds: [install.id], startsAt: at(nextWeekday(), time) });
      const start = (body: Record<string, unknown> = {}) =>
        s.as('post', '/orthodontics/treatments').send({ customerId: customer.id, appliance: 'fixed_metal', startedOn: localToday(), expectedMonths: 12, entryFee: 800, monthlyFee: 200, dueDay: 10, ...body });
      return { ...s, customer, install, book, start };
    }

    it('com taxa no tratamento, a instalação sai sem custo uma vez; sem taxa, cobra o serviço', async () => {
      const s = await clinic();
      expect(s.install.category).toBe('Instalação');
      await s.start().expect(201);
      const { body: first } = await s.book('09:00').expect(201);
      expect(first.total).toBe(0);
      expect(first.services[0].name).toBe('Instalação de aparelho (na taxa do tratamento)');
      expect((await s.book('13:00').expect(201)).body.total).toBe(500);
    });

    it('tratamento sem taxa não cobre a instalação', async () => {
      const s = await clinic();
      await s.start({ entryFee: 0 }).expect(201);
      expect((await s.book('09:00').expect(201)).body.total).toBe(500);
    });

    it('instalação marcada antes fica sem custo ao lançar a taxa, sem duplicar o "a receber"', async () => {
      const s = await clinic();
      const { body: a } = await s.book('09:00').expect(201);
      expect(a.total).toBe(500);
      await s.start().expect(201);
      const { body: after } = await s.as('get', `/scheduling/appointments/${a.id}`).expect(200);
      expect(after.total).toBe(0);
      await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'done' }).expect(200);
      const { body: entries } = await s.as('get', `/finance/entries?limit=100&customerId=${s.customer.id}`).expect(200);
      expect(entries.items.filter((e: { sourceId: string; status: string }) => e.sourceId === a.id && e.status === 'pending')).toEqual([]);
    });

    it('instalação já cobrada: a taxa só entra com confirmação', async () => {
      const s = await clinic();
      const { body: a } = await s.book('09:00').expect(201);
      const { body: accounts } = await s.as('get', '/scheduling/payment-accounts').expect(200);
      await s.as('post', `/scheduling/appointments/${a.id}/payments`).send({ amount: 500, method: 'pix', accountId: accounts[0].id }).expect(201);

      expect((await s.start().expect(409)).body.code).toBe('INSTALLATION_ALREADY_CHARGED');
      const { body: none } = await s.as('get', `/orthodontics/treatments?customerId=${s.customer.id}`).expect(200);
      expect(none).toEqual([]);
      await s.start({ confirmInstallationCharged: true }).expect(201);
      expect((await s.as('get', `/scheduling/appointments/${a.id}`).expect(200)).body.total).toBe(500);
    });
  });

  describe('advocacia', () => {
    async function office() {
      const s = await ownerSession(t, ['legal']);
      const { body: client } = await s.as('post', '/customers').send({ name: 'Carlos Cliente', email: uniqueEmail('cliente') }).expect(201);
      const newCase = (body: Record<string, unknown> = {}) => s.as('post', '/legal/cases').send({ customerId: client.id, title: 'Reclamação trabalhista', area: 'labor', ...body });
      const deadline = (body: Record<string, unknown>) => s.as('post', '/legal/deadlines').send({ title: 'Réplica', dueOn: plusDays(localToday(), 20), ...body });
      const history = async (caseId: string) => (await s.as('get', `/legal/cases/${caseId}/updates`).expect(200)).body as { id: string; description: string; auto: boolean; editedAt: string | null; occurredOn: string }[];
      return { ...s, client, newCase, deadline, history };
    }

    it('andamento lançado à mão se edita e exclui, com rastro; o automático, não', async () => {
      const s = await office();
      const { body: lc } = await s.newCase().expect(201);
      const { body: u } = await s.as('post', `/legal/cases/${lc.id}/updates`).send({ occurredOn: localToday(), description: 'Texto errado' }).expect(201);
      await s.as('patch', `/legal/updates/${u.id}`).send({ occurredOn: localToday(), description: 'Texto certo' }).expect(200);
      expect((await s.history(lc.id))[0]).toMatchObject({ description: 'Texto certo', auto: false, editedAt: expect.any(String) });
      const { rows } = await admin.query(`select data from audit_logs where entity_id = $1 and action = 'legal.update.edited'`, [u.id]);
      expect(rows[0].data.before.description).toBe('Texto errado');

      await s.as('post', `/legal/updates/${u.id}/delete`).send({ reason: 'x' }).expect(400);
      await s.as('post', `/legal/updates/${u.id}/delete`).send({ reason: 'Lançado no processo errado' }).expect(204);
      expect(await s.history(lc.id)).toEqual([]);
      // O registro fica no banco, com o motivo.
      const stored = await admin.query(`select description, delete_reason from legal_updates where id = $1`, [u.id]);
      expect(stored.rows[0]).toEqual({ description: 'Texto certo', delete_reason: 'Lançado no processo errado' });
      await s.as('patch', `/legal/updates/${u.id}`).send({ occurredOn: localToday(), description: 'De novo' }).expect(404);

      await s.as('patch', `/legal/cases/${lc.id}`).send({ status: 'suspended' }).expect(200);
      const [auto] = await s.history(lc.id);
      expect(auto).toMatchObject({ auto: true });
      expect((await s.as('patch', `/legal/updates/${auto!.id}`).send({ occurredOn: localToday(), description: 'Mudei' }).expect(400)).body.code).toBe('UPDATE_AUTOMATIC');
      expect((await s.as('post', `/legal/updates/${auto!.id}/delete`).send({ reason: 'Quero tirar' }).expect(400)).body.code).toBe('UPDATE_AUTOMATIC');
    });

    it('prazo errado se corrige ou exclui, sem virar cumprido', async () => {
      const s = await office();
      const { body: lc } = await s.newCase().expect(201);
      const { body: d } = await s.deadline({ caseId: lc.id, alertDays: 3 }).expect(201);
      const newDue = plusDays(localToday(), 30);
      await s.as('patch', `/legal/deadlines/${d.id}`).send({ dueOn: newDue, title: 'Réplica à contestação' }).expect(200);
      const { body: list } = await s.as('get', `/legal/deadlines?caseId=${lc.id}`).expect(200);
      expect(list[0]).toMatchObject({ dueOn: newDue, title: 'Réplica à contestação', alertDays: 3, status: 'open' });
      const { rows } = await admin.query(`select data from audit_logs where entity_id = $1 and action = 'legal.deadline.updated'`, [d.id]);
      expect(rows[0].data.before.dueOn).not.toBe(newDue);

      await s.as('post', `/legal/deadlines/${d.id}/delete`).send({ reason: 'Prazo do processo errado' }).expect(204);
      expect((await s.as('get', `/legal/deadlines?caseId=${lc.id}`).expect(200)).body).toEqual([]);
      expect((await s.as('get', `/legal/cases/${lc.id}`).expect(200)).body.nextDeadline).toBeNull();
      // Nada de "Prazo cumprido" no histórico.
      expect(await s.history(lc.id)).toEqual([]);
      await s.as('post', `/legal/deadlines/${d.id}/done`).expect(404);
    });

    it('prazo excluído não dispara aviso', async () => {
      const s = await office();
      const { body: lc } = await s.newCase().expect(201);
      const { body: d } = await s.deadline({ caseId: lc.id, dueOn: plusDays(localToday(), 1), title: 'Não avisar' }).expect(201);
      await s.as('post', `/legal/deadlines/${d.id}/delete`).send({ reason: 'Cadastrado por engano' }).expect(204);
      const before = t.mails.length;
      await t.jobs.runOnce('legal.deadline-alerts');
      await new Promise((r) => setTimeout(r, 50));
      expect(t.mails.slice(before).filter((m) => m.subject.includes('Não avisar'))).toEqual([]);
    });

    it('prazo cumprido precisa ser reaberto antes de mudar; reabrir tira o andamento e libera o aviso', async () => {
      const s = await office();
      const { body: lc } = await s.newCase().expect(201);
      const { body: d } = await s.deadline({ caseId: lc.id, dueOn: plusDays(localToday(), 1), title: 'Memoriais', alertDays: 3 }).expect(201);
      const count = async () => {
        const before = t.mails.length;
        await t.jobs.runOnce('legal.deadline-alerts');
        await new Promise((r) => setTimeout(r, 50));
        return t.mails.slice(before).filter((m) => m.subject.includes('Memoriais')).length;
      };
      expect(await count()).toBe(1);
      expect(await count()).toBe(0);

      await s.as('post', `/legal/deadlines/${d.id}/done`).expect(204);
      expect((await s.as('post', `/legal/deadlines/${d.id}/done`).expect(409)).body.code).toBe('DEADLINE_SAME_STATUS');
      expect((await s.history(lc.id)).map((u) => u.description)).toEqual(['Prazo cumprido: Memoriais']);
      expect((await s.as('patch', `/legal/deadlines/${d.id}`).send({ title: 'Outro' }).expect(400)).body.code).toBe('DEADLINE_DONE');
      expect((await s.as('post', `/legal/deadlines/${d.id}/delete`).send({ reason: 'Quero tirar' }).expect(400)).body.code).toBe('DEADLINE_DONE');

      await s.as('post', `/legal/deadlines/${d.id}/reopen`).expect(204);
      expect((await s.as('post', `/legal/deadlines/${d.id}/reopen`).expect(409)).body.code).toBe('DEADLINE_SAME_STATUS');
      expect((await s.history(lc.id)).map((u) => u.description)).toEqual(['Prazo reaberto: Memoriais']);
      expect(await count()).toBe(1);

      // Mudar a data libera o aviso de novo.
      await s.as('patch', `/legal/deadlines/${d.id}`).send({ dueOn: plusDays(localToday(), 2) }).expect(200);
      expect(await count()).toBe(1);
      // Mudar só o título, não.
      await s.as('patch', `/legal/deadlines/${d.id}`).send({ title: 'Memoriais finais' }).expect(200);
      expect(await count()).toBe(0);
    });

    it('"Só os meus" inclui os prazos dos processos em que a pessoa é responsável', async () => {
      const s = await office();
      const { body: team } = await s.as('get', '/legal/team').expect(200);
      const me = team[0].id as string;
      const lawyer = await member(s, 'legal.lawyer');
      const { body: mine } = await s.newCase({ responsibleUserId: me, title: 'Meu processo' }).expect(201);
      const { body: theirs } = await s.newCase({ responsibleUserId: lawyer.userId, title: 'Processo do colega' }).expect(201);
      const { body: nobody } = await s.newCase({ title: 'Sem responsável' }).expect(201);
      await s.deadline({ caseId: mine.id, title: 'No meu, sem designado' }).expect(201);
      await s.deadline({ caseId: mine.id, title: 'No meu, de outra pessoa', assignedUserId: lawyer.userId }).expect(201);
      await s.deadline({ caseId: theirs.id, title: 'No do colega, designado a mim', assignedUserId: me }).expect(201);
      await s.deadline({ caseId: theirs.id, title: 'No do colega' }).expect(201);
      await s.deadline({ caseId: nobody.id, title: 'Sem ninguém' }).expect(201);

      const { body: list } = await s.as('get', `/legal/deadlines?status=open&mine=true`).expect(200);
      expect(list.map((d: { title: string }) => d.title).sort()).toEqual(['No do colega, designado a mim', 'No meu, de outra pessoa', 'No meu, sem designado']);
      const { body: all } = await s.as('get', '/legal/deadlines?status=open').expect(200);
      expect(all).toHaveLength(5);
    });

    it('a aba Agenda recebe a situação dos horários, inclusive cancelados', async () => {
      const s = await office();
      const { body: lc } = await s.newCase().expect(201);
      const { body: services } = await s.as('get', '/scheduling/services').expect(200);
      const { body: lawyer } = await s.as('post', '/scheduling/resources').send({ name: 'Dra. Marina' }).expect(201);
      const { body: a } = await s
        .as('post', '/scheduling/appointments')
        .send({ customerId: s.client.id, resourceId: lawyer.id, serviceIds: [services.find((x: { name: string }) => x.name === 'Audiência').id], startsAt: at(nextWeekday(), '14:00'), subject: { type: 'legal_case', id: lc.id, label: lc.title } })
        .expect(201);
      await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'cancelled', reason: 'Adiada pelo juízo' }).expect(200);
      const { body: list } = await s.as('get', `/scheduling/appointments?customerId=${s.client.id}`).expect(200);
      expect(list[0]).toMatchObject({ status: 'cancelled', cancelReason: 'Adiada pelo juízo' });
    });
  });
});
