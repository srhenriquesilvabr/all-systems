import { MetaGraphHttp } from '@all/consortium';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, login, ownerSession, PASSWORD, tokenFromMail, uniqueEmail, type TestApp } from './helpers';

// Captação do consórcio: simulador público (aceite LGPD, armadilha, deduplicação), indicação
// premiada até a venda, funil com distribuição e visibilidade por vendedor, retornos, WhatsApp,
// relatório, anonimização e as entradas de anúncio (Google com chave, Meta com assinatura e
// Graph API falsa). Nenhuma chamada externa real.

const META_SECRET = 'segredo-do-app-meta';
process.env.META_APP_SECRET = META_SECRET;
process.env.META_LEADS_VERIFY_TOKEN = 'token-de-verificacao';

const applicant = { name: 'João Indicado', document: '12345678909', monthlyIncome: 9000, birthDate: '1988-03-10' };
type Session = Awaited<ReturnType<typeof ownerSession>>;

/** Corretora com os planos das administradoras simuladas e o endereço público. */
async function brokerage(t: TestApp, modules = ['consortium']) {
  const s = await ownerSession(t, modules);
  await s.as('post', '/consortium/plans/sync').expect(200);
  const { body: me } = await s.as('get', '/me').expect(200);
  return { ...s, slug: me.tenant.slug as string, company: me.tenant.name as string };
}

const publicLead = (over: Record<string, unknown> = {}) => ({
  name: 'Marina Visitante',
  phone: '(11) 98877-6655',
  email: 'marina.visitante@example.com',
  city: 'São Paulo',
  state: 'SP',
  assetType: 'vehicle',
  creditValue: 80000,
  termMonths: 60,
  consent: true,
  consentVersion: 'v1',
  utm: { utm_source: 'instagram', utm_campaign: 'auto-out', outro: 'descartado' },
  startedAt: Date.now() - 10_000,
  ...over,
});

describe('captação: simulador público', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('mostra linhas e prazos dos planos, exige aceite, ignora robô e não duplica a mesma pessoa', async () => {
    const s = await brokerage(t);
    const { body: info } = await t.http().get(`/api/public/consortium/${s.slug}`).expect(200);
    expect(info.company.name).toBe(s.company);
    expect(info.lines).toEqual(expect.arrayContaining([{ assetType: 'vehicle', minCredit: 60000, maxCredit: 100000, terms: [60, 80] }]));
    expect(info.consent.text).toContain(s.company);
    expect(info.referrer).toBeNull();
    // Nome das administradoras não vai para a página pública.
    expect(JSON.stringify(info)).not.toContain('simulação)');

    await t.http().post(`/api/public/consortium/${s.slug}/leads`).send(publicLead({ consent: false })).expect(400);
    // Armadilha preenchida: responde ok e não grava nada.
    await t.http().post(`/api/public/consortium/${s.slug}/leads`).send(publicLead({ website: 'http://spam' })).expect(200);
    expect((await s.as('get', '/consortium/leads').expect(200)).body).toEqual([]);

    // 80 mil em 60 meses no plano de 15% + 2% + seguro 0,03%: 80.000 × 1,17 / 60 + 24 = 1.584.
    const { body: sent } = await t.http().post(`/api/public/consortium/${s.slug}/leads`).send(publicLead()).expect(200);
    expect(sent).toEqual({ ok: true, estimate: { min: 1584, max: 1584 } });
    const [lead] = (await s.as('get', '/consortium/leads').expect(200)).body;
    expect(lead).toMatchObject({ name: 'Marina Visitante', phone: '+5511988776655', source: 'simulator', status: 'new', assetType: 'vehicle', creditValue: 80000, termMonths: 60, estimatedInstallment: 1584, campaign: 'auto-out' });
    const { body: detail } = await s.as('get', `/consortium/leads/${lead.id}`).expect(200);
    expect(detail.utm).toEqual({ utm_source: 'instagram', utm_campaign: 'auto-out' });
    expect(detail.contactBasis).toBe('form_consent');
    expect(detail.consent).toMatchObject({ version: 'v1', text: info.consent.text });

    // A mesma pessoa simulando de novo: atualiza o lead em aberto.
    await t.http().post(`/api/public/consortium/${s.slug}/leads`).send(publicLead({ creditValue: 100000, termMonths: 80 })).expect(200);
    const leads = (await s.as('get', '/consortium/leads').expect(200)).body;
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ creditValue: 100000, termMonths: 80 });
    const { body: again } = await s.as('get', `/consortium/leads/${lead.id}`).expect(200);
    expect(again.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['created', 'simulation']));

    // Simulador desligado nas configurações: a página some.
    await s.as('put', '/modules/consortium/settings').send({ publicSimulator: false }).expect(204);
    await t.http().get(`/api/public/consortium/${s.slug}`).expect(404);
  });
});

describe('captação: indicação premiada até a venda', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('link do cliente → lead indicado → cota aceita → recompensa a pagar → paga', async () => {
    const s = await brokerage(t);
    const { body: carla } = await s.as('post', '/customers').send({ name: 'Carla Cliente', phone: '(48) 99111-2222', email: uniqueEmail('carla') }).expect(201);
    await s.as('put', '/modules/consortium/settings').send({ referralReward: 'R$ 200 por cota ativa', referralRewardAmount: 200 }).expect(204);

    const { body: ref } = await s.as('post', '/consortium/referrers').send({ kind: 'customer', customerId: carla.id }).expect(201);
    expect(ref.url).toBe(`http://admin.test/consorcio/${s.slug}?ind=${ref.code}`);
    expect((await s.as('post', '/consortium/referrers').send({ kind: 'customer', customerId: carla.id }).expect(201)).body.id).toBe(ref.id);

    const { body: info } = await t.http().get(`/api/public/consortium/${s.slug}?ind=${ref.code}`).expect(200);
    expect(info.referrer).toEqual({ name: 'Carla', reward: 'R$ 200 por cota ativa' });
    await t.http().post(`/api/public/consortium/${s.slug}/leads`).send(publicLead({ name: 'João Indicado', phone: '(11) 97000-1111', email: 'joao.indicado@example.com', ref: ref.code })).expect(200);
    const [lead] = (await s.as('get', '/consortium/leads').expect(200)).body;
    expect(lead).toMatchObject({ source: 'referral', rewardStatus: 'waiting', referrer: { id: ref.id, name: 'Carla Cliente' } });

    // Venda a partir do lead: cliente criado com os dados do lead, cota ligada, lead em proposta.
    const { body: c } = await s.as('post', `/consortium/leads/${lead.id}/customer`).expect(200);
    expect(c.created).toBe(true);
    const { body: [plan] } = await s.as('get', '/consortium/plans?assetType=vehicle&maxCredit=70000').expect(200);
    const { body: quota } = await s.as('post', '/consortium/quotas').send({ customerId: c.customerId, planId: plan.id, applicant, leadId: lead.id }).expect(201);
    expect((await s.as('get', `/consortium/leads/${lead.id}`).expect(200)).body).toMatchObject({ status: 'proposal', quotaId: quota.id, customerId: c.customerId });

    const { body: props } = await s.as('get', `/banking/proposals?sourceType=consortium_quota&sourceId=${quota.id}`).expect(200);
    await s.as('post', `/banking/proposals/${props[0].id}/refresh`).expect(200);
    await t.relay.drain();
    const { body: won } = await s.as('get', `/consortium/leads/${lead.id}`).expect(200);
    expect(won).toMatchObject({ status: 'won', rewardStatus: 'due', rewardAmount: 200, quota: { id: quota.id, status: 'active' } });
    // Lead que virou venda não volta no funil pela mão.
    await s.as('post', `/consortium/leads/${lead.id}/status`).send({ status: 'contacting' }).expect(400);

    await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'paid' }).expect(200);
    const { body: refs } = await s.as('get', '/consortium/referrers').expect(200);
    expect(refs[0]).toMatchObject({ leads: 1, won: 1, rewardsDue: 0, rewardsPaid: 1 });
  });
});

describe('captação: funil, vendedores, retornos e relatório', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** Convida um consultor (papel padrão do consórcio) e devolve o id e a sessão dele. */
  async function seller(s: Session, name: string) {
    const { body: roles } = await s.as('get', '/access/roles').expect(200);
    const role = roles.find((r: { key: string }) => r.key === 'consortium.seller');
    const email = uniqueEmail('consultor');
    await s.as('post', '/users/invite').send({ email, name, roleIds: [role.id] }).expect(201);
    const token = tokenFromMail(t.mails.findLast((m) => m.to === email));
    await t.http().post('/api/auth/set-password').send({ token, password: PASSWORD, name }).expect(204);
    const { token: access } = await login(t, email);
    const { body: team } = await s.as('get', '/users/team').expect(200);
    const id = team.find((u: { name: string }) => u.name === name).id as string;
    const as = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => t.http()[method](`/api${path}`).set(auth(access));
    return { id, as };
  }

  it('rodízio, visibilidade por vendedor, etapas, WhatsApp, retornos, relatório e LGPD', async () => {
    const s = await brokerage(t);
    const ana = await seller(s, 'Ana Consultora');
    const bia = await seller(s, 'Bia Consultora');
    await s.as('put', '/modules/consortium/settings').send({ leadRoundRobin: true, leadSellerIds: [ana.id, bia.id] }).expect(204);

    const create = (name: string, phone: string, extra: Record<string, unknown> = {}) =>
      s.as('post', '/consortium/leads').send({ name, phone, assetType: 'vehicle', creditValue: 60000, termMonths: 60, campaign: 'Feira', ...extra });
    const l1 = (await create('Lucas Um', '(11) 91111-0001').expect(201)).body;
    const l2 = (await create('Lia Dois', '(11) 91111-0002').expect(201)).body;
    const l3 = (await create('Leo Três', '(11) 91111-0003').expect(201)).body;
    expect([l1.seller.id, l2.seller.id, l3.seller.id]).toEqual([ana.id, bia.id, ana.id]);
    // 60 mil em 60 meses (15% + 2% + seguro 0,03%): 60.000 × 1,17 / 60 + 18 = 1.188.
    expect(l1).toMatchObject({ source: 'manual', estimatedInstallment: 1188 });
    // Mesmo telefone de um lead em aberto: recusa.
    const dup = await create('Lucas Repetido', '11911110001').expect(409);
    expect(dup.body.code).toBe('LEAD_EXISTS');

    // Sem rodízio, o lead fica sem vendedor e qualquer consultor pode assumir.
    await s.as('put', '/modules/consortium/settings').send({}).expect(204);
    const l4 = (await create('Lara Quatro', '(11) 91111-0004', { email: 'lara@example.com' }).expect(201)).body;
    expect(l4.seller).toBeNull();

    // Consultora vê os dela e os sem vendedor; o da colega, não.
    const anaList = (await ana.as('get', '/consortium/leads').expect(200)).body.map((l: { id: string }) => l.id);
    expect(anaList.sort()).toEqual([l1.id, l3.id, l4.id].sort());
    await ana.as('get', `/consortium/leads/${l2.id}`).expect(403);
    await ana.as('post', '/consortium/leads').send({ name: 'Sem permissão', phone: '(11) 92222-0000' }).expect(403);
    expect((await ana.as('post', `/consortium/leads/${l4.id}/claim`).expect(200)).body.seller.id).toBe(ana.id);
    await bia.as('post', `/consortium/leads/${l4.id}/claim`).expect(400);

    // Etapas: perdido exige motivo; WhatsApp tira de "novo" e a mensagem vem preenchida.
    await ana.as('post', `/consortium/leads/${l1.id}/status`).send({ status: 'lost' }).expect(400);
    await ana.as('post', `/consortium/leads/${l1.id}/status`).send({ status: 'lost', lostReason: 'Parcela não cabe no orçamento' }).expect(200);
    const { body: wa } = await ana.as('post', `/consortium/leads/${l3.id}/whatsapp`).expect(200);
    expect(wa.status).toBe('contacting');
    expect(wa.whatsappText).toMatch(/^Olá, Leo! Aqui é Ana, da /);
    expect(wa.whatsappText).toMatch(/60\.000,00 em 60 meses/);

    // Retorno agendado aparece nos retornos da consultora até ser feito.
    const due = new Date(Date.now() + 2 * 3_600_000).toISOString();
    await ana.as('post', `/consortium/leads/${l3.id}/tasks`).send({ title: 'Mandar a simulação', dueAt: due }).expect(200);
    const { body: tasks } = await ana.as('get', '/consortium/lead-tasks').expect(200);
    expect(tasks).toEqual([expect.objectContaining({ leadId: l3.id, title: 'Mandar a simulação', assignedTo: { id: ana.id, name: 'Ana Consultora' } })]);
    expect((await bia.as('get', '/consortium/lead-tasks').expect(200)).body).toEqual([]);
    await ana.as('post', `/consortium/lead-tasks/${tasks[0].id}/done`).expect(200);
    expect((await ana.as('get', '/consortium/lead-tasks').expect(200)).body).toEqual([]);
    await ana.as('post', `/consortium/leads/${l3.id}/notes`).send({ text: 'Prefere parcela até R$ 1.300' }).expect(200);
    const { body: l3d } = await ana.as('get', `/consortium/leads/${l3.id}`).expect(200);
    expect(l3d.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['created', 'assigned', 'whatsapp', 'status', 'task', 'task_done', 'note']));

    // Relatório por origem e por vendedor.
    const { body: report } = await s.as('get', '/consortium/leads-report').expect(200);
    expect(report.totals).toMatchObject({ total: 4, contacted: 2, lost: 1, won: 0 });
    expect(report.bySource).toEqual([expect.objectContaining({ key: 'manual', total: 4 })]);
    expect(report.bySeller.find((r: { key: string }) => r.key === ana.id)).toMatchObject({ label: 'Ana Consultora', total: 3 });
    expect(report.byCampaign).toEqual([expect.objectContaining({ label: 'Feira', total: 4 })]);
    expect(report.lostReasons).toEqual([{ reason: 'Parcela não cabe no orçamento', count: 1 }]);
    await ana.as('get', '/consortium/leads-report').expect(403);

    // Pedido do titular: dados apagados, lead fica para as estatísticas e não é mais trabalhado.
    const { body: anon } = await s.as('post', `/consortium/leads/${l4.id}/anonymize`).expect(200);
    expect(anon).toMatchObject({ name: 'Anonimizado', phone: null, email: null, anonymized: true });
    await ana.as('post', `/consortium/leads/${l4.id}/notes`).send({ text: 'x' }).expect(400);
  });
});

describe('captação: anúncios (Google Ads e Meta Lead Ads)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('Google: chave no corpo, campos do formulário e sem duplicar no reenvio', async () => {
    const s = await brokerage(t);
    const { body: ch } = await s.as('post', '/consortium/lead-channels').send({ kind: 'google', name: 'Google Ads', mode: 'api', webhookKey: 'chave-google-123', assetType: 'real_estate' }).expect(201);
    expect(ch).toMatchObject({ hasWebhookKey: true, webhookUrl: `http://admin.test/api/public/consortium-leads/google/${ch.id}` });
    expect(JSON.stringify(ch)).not.toContain('chave-google-123');
    const body = (key: string) => ({
      lead_id: 'GL-001',
      google_key: key,
      campaign_id: '123',
      form_id: '987',
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Paula Google' },
        { column_id: 'PHONE_NUMBER', string_value: '+55 11 98765-4321' },
        { column_id: 'EMAIL', string_value: 'Paula@Example.com' },
        { column_id: 'CITY', string_value: 'Campinas' },
        { column_id: 'QUAL_O_VALOR', column_name: 'Qual o valor?', string_value: '300 mil' },
      ],
    });
    await t.http().post(`/api/public/consortium-leads/google/${ch.id}`).send(body('errada')).expect(401);
    await t.http().post(`/api/public/consortium-leads/google/${ch.id}`).send(body('chave-google-123')).expect(200);
    await t.http().post(`/api/public/consortium-leads/google/${ch.id}`).send(body('chave-google-123')).expect(200);
    await t.http().post('/api/public/consortium-leads/google/00000000-0000-4000-8000-000000000000').send(body('chave-google-123')).expect(404);
    const leads = (await s.as('get', '/consortium/leads').expect(200)).body;
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: 'Paula Google', phone: '+5511987654321', email: 'paula@example.com', source: 'google', assetType: 'real_estate', campaign: 'Google Ads 123' });
    const { body: d } = await s.as('get', `/consortium/leads/${leads[0].id}`).expect(200);
    expect(d.notes).toContain('QUAL_O_VALOR: 300 mil');
    expect((await s.as('get', '/consortium/lead-channels').expect(200)).body[0].leads).toBe(1);
  });

  it('Meta: verificação, assinatura, leitura pela Graph API no worker, filtro de formulário e página única', async () => {
    const s = await brokerage(t);
    const { body: ch } = await s
      .as('post', '/consortium/lead-channels')
      .send({ kind: 'meta', name: 'Instagram', mode: 'api', pageId: '1234567890', formIds: ['555000111'], accessToken: 'token-da-pagina' })
      .expect(201);
    expect(ch.webhookUrl).toBe('http://admin.test/api/public/consortium-leads/meta');
    // A mesma página não pode estar em outra empresa.
    const other = await brokerage(t);
    expect((await other.as('post', '/consortium/lead-channels').send({ kind: 'meta', name: 'Outra', mode: 'api', pageId: '1234567890', accessToken: 'x' }).expect(409)).body.code).toBe('PAGE_IN_USE');

    await t.http().get('/api/public/consortium-leads/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': 'abc' }).expect(403);
    const verified = await t.http().get('/api/public/consortium-leads/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-de-verificacao', 'hub.challenge': 'abc' }).expect(200);
    expect(verified.text).toBe('abc');

    const graph = t.app.get(MetaGraphHttp);
    const calls: { url: string; token: string }[] = [];
    graph.get = async (url: string, token: string) => {
      calls.push({ url, token });
      return {
        ok: true,
        status: 200,
        body: {
          field_data: [
            { name: 'full_name', values: ['Rita Meta'] },
            { name: 'phone_number', values: ['+5548999887766'] },
            { name: 'email', values: ['rita@example.com'] },
            { name: 'valor_da_carta', values: ['Imóvel de 300 mil'] },
          ],
          campaign_name: 'Imóvel outubro',
          ad_id: 'AD9',
          form_id: '555000111',
        },
      };
    };
    const notice = (leadgenId: string, formId = '555000111') =>
      JSON.stringify({ object: 'page', entry: [{ id: '1234567890', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: '1234567890', form_id: formId, ad_id: 'AD9', created_time: 1700000000 } }] }] });
    const post = (raw: string, sig = `sha256=${createHmac('sha256', META_SECRET).update(raw).digest('hex')}`) =>
      t.http().post('/api/public/consortium-leads/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw);

    await post(notice('LG-1'), 'sha256=errada').expect(401);
    expect((await post(notice('LG-1')).expect(200)).body).toEqual({ queued: 1 });
    await t.relay.drain();
    expect(calls).toEqual([{ url: expect.stringContaining('/LG-1?fields='), token: 'token-da-pagina' }]);
    const leads = (await s.as('get', '/consortium/leads').expect(200)).body;
    expect(leads).toEqual([expect.objectContaining({ name: 'Rita Meta', phone: '+5548999887766', source: 'meta', campaign: 'Imóvel outubro', assetType: 'real_estate' })]);
    // Reenvio da Meta e formulário fora da lista: nada novo.
    expect((await post(notice('LG-1')).expect(200)).body).toEqual({ queued: 0 });
    expect((await post(notice('LG-2', '999')).expect(200)).body).toEqual({ queued: 0 });

    // Canal simulado: o botão de teste cria um lead fictício pelo mesmo caminho.
    const { body: sim } = await s.as('post', '/consortium/lead-channels').send({ kind: 'meta', name: 'Demonstração', mode: 'simulated', pageId: '999000999' }).expect(201);
    const { body: test } = await s.as('post', `/consortium/lead-channels/${sim.id}/test`).expect(200);
    const { body: testLead } = await s.as('get', `/consortium/leads/${test.leadId}`).expect(200);
    expect(testLead).toMatchObject({ source: 'meta', notes: 'Lead de teste' });
    expect(testLead.email).toMatch(/@example\.com$/);
    // No modo API, o teste é pela ferramenta da Meta.
    await s.as('post', `/consortium/lead-channels/${ch.id}/test`).expect(400);
  });
});
