import { createHmac } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const APP_SECRET = 'segredo-do-app-meta-para-testes';
process.env.WHATSAPP_APP_SECRET = APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = 'token-de-verificacao';

const OFFSET = '-03:00';
const at = (date: string, time: string) => new Date(`${date}T${time}:00${OFFSET}`).toISOString();

/** Próximo dia útil a pelo menos 2 dias de hoje (no fuso de São Paulo). */
function nextWeekday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  for (;;) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    const wd = new Date(`${local}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return local;
    d.setTime(d.getTime() + 86_400_000);
  }
}

describe('agenda, WhatsApp e salão', () => {
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

  async function salon(modules = ['beauty']) {
    const s = await ownerSession(t, modules);
    const email = uniqueEmail('cliente');
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Bia Cliente', email, phone: '(48) 99911-2233' }).expect(201);
    const { body: services } = await s.as('get', '/scheduling/services').expect(200);
    const { body: ana } = await s.as('post', '/scheduling/resources').send({ name: 'Ana' }).expect(201);
    const { body: bruno } = await s.as('post', '/scheduling/resources').send({ name: 'Bruno' }).expect(201);
    const service = (name: string) => services.find((x: { name: string }) => x.name === name);
    const book = (body: Record<string, unknown>) =>
      s.as('post', '/scheduling/appointments').send({ customerId: customer.id, resourceId: ana.id, serviceIds: [service('Corte feminino').id], ...body });
    return { ...s, customer, customerEmail: email, ana, bruno, service, book };
  }

  it('o salão já vem com os serviços típicos', async () => {
    const s = await salon();
    expect(s.service('Corte feminino')).toMatchObject({ durationMin: 60, price: 90 });
    expect(s.service('Manicure')).toBeTruthy();
  });

  it('mostra só horários livres e respeita o expediente', async () => {
    const s = await salon();
    const day = nextWeekday();
    const before = await s.as('get', `/scheduling/availability?date=${day}&serviceIds=${s.service('Corte feminino').id}&resourceId=${s.ana.id}`).expect(200);
    // Expediente padrão: 9h–12h e 13h–18h; corte de 60 min.
    expect(before.body[0].slots.slice(0, 3)).toEqual(['09:00', '09:15', '09:30']);
    expect(before.body[0].slots).not.toContain('11:15');
    expect(before.body[0].slots).toContain('13:00');

    await s.book({ startsAt: at(day, '09:00') }).expect(201);
    const after = await s.as('get', `/scheduling/availability?date=${day}&serviceIds=${s.service('Corte feminino').id}&resourceId=${s.ana.id}`).expect(200);
    expect(after.body[0].slots[0]).toBe('10:00');
  });

  it('nunca deixa dois horários sobrepostos para o mesmo profissional, nem em marcações simultâneas', async () => {
    const s = await salon();
    const day = nextWeekday();
    await s.book({ startsAt: at(day, '14:00') }).expect(201);
    const overlap = await s.book({ startsAt: at(day, '14:30') }).expect(409);
    expect(overlap.body.code).toBe('SLOT_TAKEN');
    // Outro profissional no mesmo horário pode.
    await s.book({ startsAt: at(day, '14:30'), resourceId: s.bruno.id }).expect(201);

    const results = await Promise.all([s.book({ startsAt: at(day, '16:00') }), s.book({ startsAt: at(day, '16:00') })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('cancelar exige motivo e libera o horário', async () => {
    const s = await salon();
    const day = nextWeekday();
    const { body: a } = await s.book({ startsAt: at(day, '10:00') }).expect(201);
    await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'cancelled' }).expect(400);
    await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'cancelled', reason: 'Cliente pediu' }).expect(200);
    await s.book({ startsAt: at(day, '10:00') }).expect(201);
  });

  it('atendimento concluído vira "a receber" e o pagamento baixa', async () => {
    const s = await salon();
    const day = nextWeekday();
    const { body: a } = await s.book({ startsAt: at(day, '11:00'), serviceIds: [s.service('Corte feminino').id, s.service('Escova').id] }).expect(201);
    expect(a.total).toBe(150);
    for (const status of ['arrived', 'in_service', 'done']) await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status }).expect(200);

    const entries = async () => (await s.as('get', '/finance/entries?limit=100').expect(200)).body.items.filter((e: { sourceId: string }) => e.sourceId === a.id);
    expect(await entries()).toEqual([expect.objectContaining({ status: 'pending', amount: 150 })]);

    const { body: accounts } = await s.as('get', '/scheduling/payment-accounts').expect(200);
    const paid = await s.as('post', `/scheduling/appointments/${a.id}/payments`).send({ amount: 150, method: 'pix', accountId: accounts[0].id, paidAt: day }).expect(201);
    expect(paid.body.paymentStatus).toBe('paid');
    expect((await entries()).map((e: { status: string }) => e.status).sort()).toEqual(['cancelled', 'paid']);
  });

  describe('WhatsApp', () => {
    it('modo manual: a mensagem fica pronta com o link do WhatsApp', async () => {
      const s = await salon(['beauty', 'integration.whatsapp']);
      const { body: a } = await s.book({ startsAt: at(nextWeekday(), '09:00') }).expect(201);
      await t.relay.drain();

      const { body: msgs } = await s.as('get', `/notifications?relatedEntity=appointment&relatedId=${a.id}`).expect(200);
      const wa = msgs.find((m: { channel: string }) => m.channel === 'whatsapp');
      expect(wa.status).toBe('manual');
      expect(wa.actionUrl).toMatch(/^https:\/\/wa\.me\/5548999112233\?text=Ol%C3%A1%2C%20Bia%20Cliente/);
      expect(msgs.find((m: { channel: string }) => m.channel === 'email').status).toBe('sent');

      await s.as('post', `/notifications/${wa.id}/sent`).expect(204);
      await s.as('post', `/notifications/${wa.id}/sent`).expect(404);
    });

    it('API oficial: lembrete com template e botões; o cliente confirma pelo webhook', async () => {
      const s = await salon(['beauty', 'integration.whatsapp']);
      const phoneNumberId = `pn-${Date.now()}`;
      await s
        .as('put', '/modules/integration.whatsapp/settings')
        .send({ mode: 'cloud_api', phoneNumberId, accessToken: 'TOKEN-SECRETO-1234', displayPhone: '(48) 3333-0000' })
        .expect(204);
      // O token volta mascarado e continua valendo se a tela salvar sem mexer nele.
      const { body: settings } = await s.as('get', '/modules/integration.whatsapp/settings').expect(200);
      expect(settings.accessToken).toBe('••••1234');
      await s.as('put', '/modules/integration.whatsapp/settings').send({ ...settings }).expect(204);
      const { rows } = await admin.query(`select settings->>'accessToken' as token from tenant_modules where tenant_id = $1 and module_key = 'integration.whatsapp'`, [s.tenantId]);
      expect(rows[0].token).toMatch(/^enc:v1:/);

      await s.as('put', '/modules/shared.scheduling/settings').send({ reminderHours: 24 }).expect(204);
      const startsAt = new Date(Date.now() + 3 * 3600_000);
      const { body: a } = await s.book({ startsAt: startsAt.toISOString() }).expect(201);
      // Marcado "há dois dias": cai na janela do lembrete.
      await admin.query(`update sch_appointments set created_at = now() - interval '2 days' where id = $1`, [a.id]);

      t.whatsapp.length = 0;
      await t.jobs.runOnce('scheduling.reminders');
      await t.relay.drain();
      const reminder = t.whatsapp.find((c) => c.body.template?.name === 'lembrete_agendamento');
      expect(reminder).toBeTruthy();
      expect(reminder!.url).toContain(`/${phoneNumberId}/messages`);
      expect(reminder!.token).toBe('TOKEN-SECRETO-1234');
      expect(reminder!.body.to).toBe('5548999112233');
      const buttons = reminder!.body.template.components.filter((c: { type: string }) => c.type === 'button');
      expect(buttons[0].parameters[0].payload).toBe(`scheduling:confirm:${a.id}`);

      // Lembrete não sai duas vezes.
      t.whatsapp.length = 0;
      await t.jobs.runOnce('scheduling.reminders');
      await t.relay.drain();
      expect(t.whatsapp.filter((c) => c.body.template?.name === 'lembrete_agendamento')).toEqual([]);

      // O cliente toca em "Confirmar".
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: phoneNumberId },
                  messages: [{ id: `wamid.in.${a.id}`, from: '5548999112233', type: 'button', button: { payload: `scheduling:confirm:${a.id}`, text: 'Confirmar' } }],
                },
              },
            ],
          },
        ],
      };
      const raw = JSON.stringify(payload);
      const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
      await t.http().post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=errada').send(raw).expect(401);
      const ok = await t.http().post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(raw).expect(200);
      expect(ok.body.processed).toBe(1);
      // A Meta reenvia: não conta duas vezes.
      const again = await t.http().post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(raw).expect(200);
      expect(again.body.processed).toBe(0);

      await t.relay.drain();
      const { body: confirmed } = await s.as('get', `/scheduling/appointments/${a.id}`).expect(200);
      expect(confirmed.status).toBe('confirmed');
    });

    it('verificação do webhook pela Meta', async () => {
      await t.http().get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123').expect(403);
      const res = await t.http().get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-de-verificacao&hub.challenge=123').expect(200);
      expect(res.text).toBe('123');
    });
  });

  describe('agendamento online', () => {
    it('cliente marca pelo link público, sem login', async () => {
      const s = await salon();
      const { body: me } = await s.as('get', '/me').expect(200);
      const slug = me.tenant.slug as string;
      const pub = (path = '') => `/api/public/booking/${slug}${path}`;

      await t.http().get(pub()).expect(404); // desligado por padrão
      await s.as('put', '/modules/shared.scheduling/settings').send({ onlineBooking: true, onlineMinNoticeHours: 0 }).expect(204);

      const { body: info } = await t.http().get(pub()).expect(200);
      expect(info.services.map((x: { name: string }) => x.name)).toContain('Corte masculino');
      const serviceId = info.services.find((x: { name: string }) => x.name === 'Corte masculino').id;
      const day = nextWeekday();
      const { body: avail } = await t.http().get(pub(`/availability?date=${day}&serviceIds=${serviceId}&resourceId=${s.bruno.id}`)).expect(200);
      expect(avail[0].slots).toContain('15:00');

      const booked = await t.http()
        .post(pub())
        .send({ name: 'Carlos Online', phone: '48 98877-6655', resourceId: s.bruno.id, serviceIds: [serviceId], startsAt: at(day, '15:00') })
        .expect(201);
      expect(booked.body).toMatchObject({ professional: 'Bruno', services: ['Corte masculino'] });

      // O horário escolhido de novo já não está livre.
      const taken = await t.http()
        .post(pub())
        .send({ name: 'Outra Pessoa', phone: '48 98877-0000', resourceId: s.bruno.id, serviceIds: [serviceId], startsAt: at(day, '15:00') })
        .expect(400);
      expect(taken.body.code).toBe('SLOT_UNAVAILABLE');

      const { body: customers } = await s.as('get', '/customers?q=Carlos').expect(200);
      expect(customers.items[0].phone).toBe('+5548988776655');
      const { body: list } = await s.as('get', `/scheduling/appointments?customerId=${customers.items[0].id}`).expect(200);
      expect(list[0].source).toBe('online');
    });
  });

  it('comissões por profissional, com percentual por serviço', async () => {
    const s = await salon();
    const day = nextWeekday();
    await s.as('put', `/beauty/commission-rules/${s.ana.id}`).send({ defaultRate: 40, services: [{ serviceId: s.service('Escova').id, rate: 50 }] }).expect(204);
    const { body: a } = await s.book({ startsAt: at(day, '09:00'), serviceIds: [s.service('Corte feminino').id, s.service('Escova').id] }).expect(201);
    await s.as('post', `/scheduling/appointments/${a.id}/status`).send({ status: 'done' }).expect(200);
    // Não concluído: não entra.
    await s.book({ startsAt: at(day, '13:00') }).expect(201);

    const { body: report } = await s.as('get', `/beauty/commissions?from=${day}&to=${day}`).expect(200);
    const ana = report.professionals.find((p: { name: string }) => p.name === 'Ana');
    // 90 × 40% + 60 × 50%
    expect(ana).toMatchObject({ appointments: 1, revenue: 150, commission: 66 });
  });
});
