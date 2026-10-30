import { normalizeCode } from '@all/consortium';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('código de grupo e de cota', () => {
  it('compara sem espaços, sem caixa e sem zeros à esquerda', () => {
    expect(normalizeCode('012')).toBe('12');
    expect(normalizeCode(' g 7a ')).toBe('G7A');
    expect(normalizeCode('000')).toBe('0');
    // Letra na frente: os zeros fazem parte do código.
    expect(normalizeCode('A012')).toBe('A012');
    expect(normalizeCode(null)).toBe('');
  });
});

describe('consórcio: administradora no resultado, correção, cancelamento e recompensa', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const applicant = { name: 'Carla Consorciada', document: '12345678909', monthlyIncome: 8000 };
  const plan = (name: string) => ({ name, assetType: 'vehicle', creditValue: 100000, termMonths: 80, adminFeePercent: 18, reserveFundPercent: 2, insurancePercent: 0.05 });

  /** Corretora só com administradoras manuais: grupo e cota são os que a equipe registra. */
  async function brokerage(names = ['Administradora A']) {
    const s = await ownerSession(t, ['consortium']);
    for (const c of (await s.as('get', '/banking/connections').expect(200)).body) await s.as('patch', `/banking/connections/${c.id}`).send({ ...c, active: false }).expect(200);
    const connections: Record<string, string> = {};
    for (const name of names) {
      const { body } = await s.as('post', '/banking/connections').send({ name, mode: 'manual', products: ['consortium'], manualPlans: [plan(`Plano ${name}`)] }).expect(201);
      connections[name] = body.id;
    }
    const { body: plans } = await s.as('post', '/consortium/plans/sync').expect(200);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Carla Consorciada', phone: '(48) 99111-2222', email: uniqueEmail('cons') }).expect(201);
    const planOf = (admin: string) => plans.find((p: { connectionId: string }) => p.connectionId === connections[admin]);
    /** Vende e registra a resposta da administradora com o grupo e a cota digitados. */
    async function activeQuota(groupCode: string, quotaNumber: string, opts: { admin?: string; leadId?: string; customerId?: string } = {}) {
      const { body: quota } = await s.as('post', '/consortium/quotas').send({ customerId: opts.customerId ?? customer.id, planId: planOf(opts.admin ?? names[0]!).id, applicant, leadId: opts.leadId }).expect(201);
      const { body: [proposal] } = await s.as('get', `/banking/proposals?sourceType=consortium_quota&sourceId=${quota.id}`).expect(200);
      await s.as('post', `/banking/proposals/${proposal.id}/manual`).send({ status: 'approved', groupCode, quotaNumber }).expect(200);
      await t.relay.drain();
      const { body: active } = await s.as('get', `/consortium/quotas/${quota.id}`).expect(200);
      expect(active.status).toBe('active');
      return active as { id: string; number: number; groupCode: string; quotaNumber: string };
    }
    const quotaOf = async (id: string) => (await s.as('get', `/consortium/quotas/${id}`).expect(200)).body;
    const notices = async (quotaId: string) => {
      await t.relay.drain();
      return ((await s.as('get', `/notifications?relatedEntity=cons_quota&relatedId=${quotaId}`).expect(200)).body as { templateKey: string }[]).map((m) => m.templateKey);
    };
    return { ...s, connections, customer, activeQuota, quotaOf, notices };
  }

  it('"12" encontra "012" e a caixa do grupo não importa, sem reescrever o que foi digitado', async () => {
    const s = await brokerage();
    const quota = await s.activeQuota('abc7', '012');
    const { body: held } = await s.as('post', '/consortium/assemblies').send({ groupCode: 'ABC7', heldOn: localToday(), drawn: ['12'] }).expect(201);
    expect(held.ourWinners).toEqual([expect.objectContaining({ quotaId: quota.id, type: 'draw' })]);
    expect(await s.quotaOf(quota.id)).toMatchObject({ status: 'contemplated', groupCode: 'abc7', quotaNumber: '012' });
    expect(held).toMatchObject({ groupCode: 'ABC7', drawn: ['12'] });

    // Filtros e duplicidade usam a mesma comparação.
    expect((await s.as('get', '/consortium/quotas?groupCode=ABC7').expect(200)).body.map((q: { id: string }) => q.id)).toEqual([quota.id]);
    expect((await s.as('get', '/consortium/assemblies?groupCode=abc7').expect(200)).body.map((a: { id: string }) => a.id)).toEqual([held.id]);
    expect((await s.as('post', '/consortium/assemblies').send({ groupCode: 'abc7', heldOn: localToday() }).expect(400)).body.code).toBe('ASSEMBLY_EXISTS');

    // Letra diferente não casa.
    const other = await s.activeQuota('abc7', 'A12');
    await s.as('post', '/consortium/assemblies').send({ groupCode: 'abc7', heldOn: addDays(localToday(), -1), drawn: ['12'] }).expect(201);
    expect((await s.quotaOf(other.id)).status).toBe('active');
  });

  it('o mesmo código em duas administradoras não se mistura', async () => {
    const s = await brokerage(['Administradora A', 'Administradora B']);
    const a = await s.activeQuota('G1', '005', { admin: 'Administradora A' });
    const b = await s.activeQuota('G1', '005', { admin: 'Administradora B' });
    const today = localToday();

    // Sem dizer qual, é recusado: contemplaria a cota errada.
    expect((await s.as('post', '/consortium/assemblies').send({ groupCode: 'G1', heldOn: today, drawn: ['005'] }).expect(400)).body.code).toBe('ADMINISTRATOR_REQUIRED');
    expect((await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G1', heldOn: addDays(today, 5) }).expect(400)).body.code).toBe('ADMINISTRATOR_REQUIRED');
    expect(await s.quotaOf(a.id)).toMatchObject({ status: 'active' });

    const { body: heldA } = await s.as('post', '/consortium/assemblies').send({ groupCode: 'G1', heldOn: today, connectionId: s.connections['Administradora A'], drawn: ['005'] }).expect(201);
    expect(heldA).toMatchObject({ connectionId: s.connections['Administradora A'], institution: 'Administradora A' });
    expect(heldA.ourWinners.map((w: { quotaId: string }) => w.quotaId)).toEqual([a.id]);
    expect((await s.quotaOf(b.id)).status).toBe('active');

    // A mesma data, na outra administradora, é outra assembleia.
    const { body: scheduledB } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G1', heldOn: addDays(today, 5), connectionId: s.connections['Administradora B'] }).expect(201);
    const { body: scheduledA } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G1', heldOn: addDays(today, 5), connectionId: s.connections['Administradora A'] }).expect(201);
    expect(scheduledA.id).not.toBe(scheduledB.id);

    // Lance só na assembleia da administradora da cota.
    expect((await s.as('post', `/consortium/quotas/${b.id}/bids`).send({ assemblyId: scheduledA.id, type: 'free', percent: 30 }).expect(400)).body.code).toBe('ASSEMBLY_OTHER_GROUP');
    await s.as('post', `/consortium/quotas/${b.id}/bids`).send({ assemblyId: scheduledB.id, type: 'free', percent: 30 }).expect(201);

    // Estatística separada por administradora.
    const { body: groups } = await s.as('get', '/consortium/groups').expect(200);
    expect(groups.map((g: { institution: string; assembliesHeld: number; ourQuotas: number }) => [g.institution, g.assembliesHeld, g.ourQuotas]).sort()).toEqual([
      ['Administradora A', 1, 1],
      ['Administradora B', 0, 1],
    ]);
    expect((await s.as('get', '/consortium/administrators').expect(200)).body.map((x: { institution: string }) => x.institution)).toEqual(['Administradora A', 'Administradora B']);
  });

  it('corrigir o resultado: quem sai volta a ativa e é avisado, quem entra é contemplado, lances refeitos e histórico guardado', async () => {
    const s = await brokerage();
    const wrong = await s.activeQuota('G2', '010');
    const right = await s.activeQuota('G2', '020');
    const today = localToday();
    const { body: scheduled } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G2', heldOn: addDays(today, 3) }).expect(201);
    const { body: bid } = await s.as('post', `/consortium/quotas/${wrong.id}/bids`).send({ assemblyId: scheduled.id, type: 'embedded', percent: 25 }).expect(201);

    // Não há o que corrigir antes do resultado.
    expect((await s.as('post', `/consortium/assemblies/${scheduled.id}/correct`).send({ drawn: [], bids: [], reason: 'Teste' }).expect(400)).body.code).toBe('ASSEMBLY_NOT_HELD');

    await s.as('post', `/consortium/assemblies/${scheduled.id}/results`).send({ drawn: [], bids: [{ quotaNumber: '010', percent: 25 }] }).expect(200);
    expect(await s.quotaOf(wrong.id)).toMatchObject({ status: 'contemplated', contemplationType: 'bid', bidPercent: 25 });
    expect((await s.as('get', `/consortium/quotas/${wrong.id}/credit`).expect(200)).body).toMatchObject({ status: 'awaiting_docs', amount: 75000 });
    expect(await s.notices(wrong.id)).toContain('consortium.contemplated');

    // Motivo é obrigatório.
    await s.as('post', `/consortium/assemblies/${scheduled.id}/correct`).send({ drawn: ['020'], bids: [] }).expect(400);

    const { body: corrected } = await s.as('post', `/consortium/assemblies/${scheduled.id}/correct`).send({ drawn: ['020'], bids: [], reason: 'Digitei o número errado' }).expect(200);
    expect(corrected).toMatchObject({ status: 'held', drawn: ['020'], bids: [] });
    expect(corrected.ourWinners.map((w: { quotaId: string }) => w.quotaId)).toEqual([right.id]);
    expect(corrected.corrections).toEqual([
      expect.objectContaining({
        kind: 'correction',
        reason: 'Digitei o número errado',
        before: expect.objectContaining({ bids: [{ quotaNumber: '010', percent: 25 }] }),
        after: expect.objectContaining({ drawn: ['020'] }),
        userName: 'Dono Teste',
        effects: expect.objectContaining({
          reverted: [expect.objectContaining({ quotaId: wrong.id, notified: true, creditRemoved: true })],
          contemplated: [expect.objectContaining({ quotaId: right.id, type: 'draw' })],
        }),
      }),
    ]);

    // Quem saiu: ativa de novo, sem crédito, lance refeito e aviso de correção.
    expect(await s.quotaOf(wrong.id)).toMatchObject({ status: 'active', contemplatedOn: null, contemplationType: null, bidPercent: null });
    expect((await s.as('get', `/consortium/quotas/${wrong.id}/credit`).expect(200)).body.status).toBeUndefined();
    const { body: bids } = await s.as('get', `/consortium/quotas/${wrong.id}/bids`).expect(200);
    expect(bids).toEqual([expect.objectContaining({ id: bid.id, status: 'lost' })]);
    expect(await s.notices(wrong.id)).toContain('consortium.contemplation_reverted');

    // Quem entrou: contemplada, com crédito, e avisada uma vez.
    expect(await s.quotaOf(right.id)).toMatchObject({ status: 'contemplated', contemplationType: 'draw', contemplatedOn: addDays(today, 3) });
    expect((await s.as('get', `/consortium/quotas/${right.id}/credit`).expect(200)).body).toMatchObject({ status: 'awaiting_docs', amount: 100000 });
    expect((await s.notices(right.id)).filter((k) => k === 'consortium.contemplated')).toHaveLength(1);

    const { body: audit } = await s.as('get', '/audit?limit=50').expect(200);
    expect((Array.isArray(audit) ? audit : audit.items).map((e: { action: string }) => e.action)).toContain('consortium.assembly.corrected');

    // Corrigir de novo sem mudar nada não avisa de novo.
    const before = (await s.notices(right.id)).length;
    await s.as('post', `/consortium/assemblies/${scheduled.id}/correct`).send({ drawn: ['20'], bids: [], reason: 'Conferência' }).expect(200);
    expect((await s.notices(right.id)).length).toBe(before);
  });

  it('crédito já liberado bloqueia a correção, sem mudar nada, até voltar a "aguardando documentação"', async () => {
    const s = await brokerage();
    const quota = await s.activeQuota('G3', '030');
    const today = localToday();
    const { body: held } = await s.as('post', '/consortium/assemblies').send({ groupCode: 'G3', heldOn: today, drawn: ['030'] }).expect(201);
    await s.as('put', `/consortium/quotas/${quota.id}/credit`).send({ status: 'released', releasedOn: today }).expect(200);

    const refused = await s.as('post', `/consortium/assemblies/${held.id}/correct`).send({ drawn: [], bids: [], reason: 'Foi engano' }).expect(400);
    expect(refused.body.code).toBe('CREDIT_ALREADY_RELEASED');
    expect((await s.as('post', `/consortium/quotas/${quota.id}/revert-contemplation`).send({ reason: 'Foi engano' }).expect(400)).body.code).toBe('CREDIT_ALREADY_RELEASED');
    expect(await s.quotaOf(quota.id)).toMatchObject({ status: 'contemplated' });
    const { body: [still] } = await s.as('get', '/consortium/assemblies?groupCode=G3').expect(200);
    expect(still).toMatchObject({ drawn: ['030'], corrections: [] });

    await s.as('put', `/consortium/quotas/${quota.id}/credit`).send({ status: 'awaiting_docs' }).expect(200);
    await s.as('post', `/consortium/assemblies/${held.id}/correct`).send({ drawn: [], bids: [], reason: 'Foi engano' }).expect(200);
    expect(await s.quotaOf(quota.id)).toMatchObject({ status: 'active' });
  });

  it('desfazer uma contemplação: a cota sai do resultado, com ou sem aviso, e depois pode ser contemplada de novo', async () => {
    const s = await brokerage();
    const quota = await s.activeQuota('G4', '040');
    const other = await s.activeQuota('G4', '041');
    const today = localToday();
    const { body: held } = await s.as('post', '/consortium/assemblies').send({ groupCode: 'G4', heldOn: today, drawn: ['040', '041'], bids: [{ quotaNumber: '999', percent: 40 }] }).expect(201);

    expect((await s.as('post', `/consortium/quotas/${quota.id}/revert-contemplation`).send({ reason: 'x' }).expect(400)).body.code).toBe('VALIDATION');
    const { body: reverted } = await s.as('post', `/consortium/quotas/${quota.id}/revert-contemplation`).send({ reason: 'Cota de outra pessoa', notifyCustomer: false }).expect(200);
    expect(reverted).toMatchObject({ status: 'active', contemplatedOn: null });
    expect(await s.notices(quota.id)).not.toContain('consortium.contemplation_reverted');
    expect((await s.as('post', `/consortium/quotas/${quota.id}/revert-contemplation`).send({ reason: 'De novo' }).expect(400)).body.code).toBe('QUOTA_NOT_CONTEMPLATED');

    const { body: [after] } = await s.as('get', '/consortium/assemblies?groupCode=G4').expect(200);
    expect(after).toMatchObject({ drawn: ['041'], bids: [{ quotaNumber: '999', percent: 40 }] });
    expect(after.ourWinners.map((w: { quotaId: string }) => w.quotaId)).toEqual([other.id]);
    expect(after.corrections[0]).toMatchObject({ kind: 'contemplation_reverted', reason: 'Cota de outra pessoa', effects: { reverted: [expect.objectContaining({ quotaId: quota.id, notified: false })] } });

    // Voltou a concorrer: outra correção a contempla de novo.
    await s.as('post', `/consortium/assemblies/${held.id}/correct`).send({ drawn: ['040', '041'], bids: [], reason: 'Conferido com a administradora' }).expect(200);
    expect(await s.quotaOf(quota.id)).toMatchObject({ status: 'contemplated' });
  });

  /** Lead indicado que virou venda: recompensa a pagar de R$ 200. */
  async function referredSale(s: Awaited<ReturnType<typeof brokerage>>, group: string, number: string) {
    await s.as('put', '/modules/consortium/settings').send({ referralReward: 'R$ 200 por cota ativa', referralRewardAmount: 200 }).expect(204);
    const { body: ana } = await s.as('post', '/customers').send({ name: 'Ana Indicadora', phone: '(48) 98888-7777', email: uniqueEmail('ana') }).expect(201);
    const { body: ref } = await s.as('post', '/consortium/referrers').send({ kind: 'customer', customerId: ana.id }).expect(201);
    const { body: lead } = await s.as('post', '/consortium/leads').send({ name: 'João Indicado', email: uniqueEmail('joao'), referrerId: ref.id }).expect(201);
    const quota = await s.activeQuota(group, number, { leadId: lead.id });
    const entries = async () =>
      ((await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as { id: string; sourceId: string; sourceType: string; kind: string; status: string; amount: number; settleInFinance: boolean; customerId: string | null }[]).filter((e) => e.sourceId === lead.id);
    const leadOf = async () => (await s.as('get', `/consortium/leads/${lead.id}`).expect(200)).body;
    return { lead, ref, ana, quota, entries, leadOf };
  }

  it('recompensa devida entra uma vez no financeiro como despesa a pagar; mudar o valor não duplica; baixa em qualquer lugar vale', async () => {
    const s = await brokerage();
    const { lead, ana, entries, leadOf } = await referredSale(s, 'G5', '050');
    expect(await leadOf()).toMatchObject({ status: 'won', rewardStatus: 'due', rewardAmount: 200 });
    const first = await entries();
    expect(first).toEqual([expect.objectContaining({ sourceType: 'consortium_lead', kind: 'expense', status: 'pending', amount: 200, settleInFinance: true, customerId: ana.id })]);

    // A mesma situação de novo não lança outra despesa.
    await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'due' }).expect(200);
    expect(await entries()).toHaveLength(1);

    // Valor novo: a anterior fica cancelada (com rastro) e só uma fica em aberto.
    await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'due', amount: 250 }).expect(200);
    const changed = await entries();
    expect(changed.map((e) => [e.status, e.amount]).sort()).toEqual([
      ['cancelled', 200],
      ['pending', 250],
    ]);

    // "Marcar paga" é a baixa da mesma despesa.
    await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'paid' }).expect(200);
    const paid = await entries();
    expect(paid.filter((e) => e.status === 'paid').map((e) => e.amount)).toEqual([250]);
    expect(paid.filter((e) => e.status === 'pending')).toEqual([]);
    expect(paid).toHaveLength(2);
    await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'paid' }).expect(200);
    expect(await entries()).toHaveLength(2);

    // O que foi pago não volta nem é cancelado pelo lead.
    expect((await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'cancelled' }).expect(400)).body.code).toBe('REWARD_ALREADY_PAID');
    expect((await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'due' }).expect(400)).body.code).toBe('REWARD_ALREADY_PAID');
  });

  it('baixa dada direto no financeiro faz o lead mostrar a recompensa paga', async () => {
    const s = await brokerage();
    const { entries, leadOf } = await referredSale(s, 'G6', '060');
    const [pending] = await entries();
    const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
    await s.as('post', `/finance/entries/${pending!.id}/pay`).send({ paidAt: localToday(), accountId: accounts[0].id }).expect(201);
    expect(await leadOf()).toMatchObject({ rewardStatus: 'paid' });
    expect((await s.as('get', '/consortium/referrers').expect(200)).body[0]).toMatchObject({ rewardsDue: 0, rewardsPaid: 1 });
  });

  it('cancelar a cota dentro do prazo: lead sai de "Venda", recompensa a pagar é cancelada', async () => {
    const s = await brokerage();
    const { quota, entries, leadOf } = await referredSale(s, 'G7', '070');
    await s.as('post', `/consortium/quotas/${quota.id}/cancel`).send({ reason: 'Cliente desistiu' }).expect(200);
    const lead = await leadOf();
    expect(lead).toMatchObject({ status: 'lost', rewardStatus: 'cancelled' });
    expect(lead.lostReason).toContain('Cliente desistiu');
    expect((await entries()).map((e) => [e.kind, e.status])).toEqual([['expense', 'cancelled']]);
    // Nunca há despesa em aberto de uma recompensa cancelada, e o lead pode ser reaberto.
    await s.as('post', `/consortium/leads/${lead.id}/status`).send({ status: 'contacting' }).expect(200);
    expect(await leadOf()).toMatchObject({ status: 'contacting', rewardStatus: 'cancelled' });
  });

  it('cancelar a cota dentro do prazo com a recompensa paga: estorno a receber, uma vez só', async () => {
    const s = await brokerage();
    const { lead, ana, quota, entries, leadOf } = await referredSale(s, 'G8', '080');
    await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'paid' }).expect(200);
    await s.as('post', `/consortium/quotas/${quota.id}/cancel`).send({ reason: 'Cliente desistiu' }).expect(200);
    expect(await leadOf()).toMatchObject({ status: 'lost', rewardStatus: 'reversed' });
    const all = await entries();
    // A despesa paga fica como está; o estorno é um lançamento novo, em aberto.
    expect(all.map((e) => [e.kind, e.status, e.amount]).sort()).toEqual([
      ['expense', 'paid', 200],
      ['income', 'pending', 200],
    ]);
    expect(all.find((e) => e.kind === 'income')).toMatchObject({ settleInFinance: true, customerId: ana.id });
    expect((await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'paid' }).expect(400)).body.code).toBe('REWARD_REVERSED');
    expect(await entries()).toHaveLength(2);
    await s.as('post', `/consortium/quotas/${quota.id}/cancel`).send({ reason: 'De novo' }).expect(400);
    expect(await entries()).toHaveLength(2);
  });

  it('cancelar a cota fora do prazo de estorno: lead sai de "Venda" e a recompensa fica como está', async () => {
    const s = await brokerage();
    const { lead, quota, entries, leadOf } = await referredSale(s, 'G9', '090');
    await s.as('put', '/modules/consortium/settings').send({ reversalMonths: 0 }).expect(204);
    await s.as('post', `/consortium/quotas/${quota.id}/cancel`).send({ reason: 'Cliente desistiu' }).expect(200);
    const after = await leadOf();
    expect(after).toMatchObject({ status: 'lost', rewardStatus: 'due' });
    expect(after.events.map((e: { text: string }) => e.text).join(' ')).toContain('fora do prazo de estorno');
    expect((await entries()).map((e) => [e.kind, e.status])).toEqual([['expense', 'pending']]);
    // Continua podendo ser paga, mesmo com o lead perdido.
    await s.as('post', `/consortium/leads/${lead.id}/reward`).send({ status: 'paid' }).expect(200);
    expect((await entries()).map((e) => [e.kind, e.status])).toEqual([['expense', 'paid']]);
  });

  it('cancelar cota em análise: o lead continua em proposta e nada entra no financeiro', async () => {
    const s = await brokerage();
    await s.as('put', '/modules/consortium/settings').send({ referralRewardAmount: 200 }).expect(204);
    const { body: ana } = await s.as('post', '/customers').send({ name: 'Ana Indicadora', email: uniqueEmail('ana') }).expect(201);
    const { body: ref } = await s.as('post', '/consortium/referrers').send({ kind: 'customer', customerId: ana.id }).expect(201);
    const { body: lead } = await s.as('post', '/consortium/leads').send({ name: 'João Indicado', email: uniqueEmail('joao'), referrerId: ref.id }).expect(201);
    const { body: [p] } = await s.as('get', '/consortium/plans').expect(200);
    const { body: quota } = await s.as('post', '/consortium/quotas').send({ customerId: s.customer.id, planId: p.id, applicant, leadId: lead.id }).expect(201);
    await s.as('post', `/consortium/quotas/${quota.id}/cancel`).send({ reason: 'Plano errado' }).expect(200);
    expect((await s.as('get', `/consortium/leads/${lead.id}`).expect(200)).body).toMatchObject({ status: 'proposal', rewardStatus: 'waiting' });
    const items = (await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as { sourceId: string }[];
    expect(items.filter((e) => e.sourceId === lead.id)).toEqual([]);
  });

  it('o aviso de atraso não promete uma regra que o sistema não aplica: quem decide é a administradora', async () => {
    const s = await brokerage();
    const quota = await s.activeQuota('G10', '100');
    const { body: { items } } = await s.as('get', `/consortium/quotas/${quota.id}/installments`).expect(200);
    const today = localToday();
    await s.as('post', `/consortium/quotas/${quota.id}/installments`).send({ firstDueOn: `${addDays(today, -60).slice(0, 7)}-05` }).expect(200);
    expect(items.length).toBeGreaterThan(0);

    // Em atraso, a cota continua podendo dar lance e ser contemplada: a lista é da administradora.
    const { body: a } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G10', heldOn: addDays(today, 2) }).expect(201);
    await s.as('post', `/consortium/quotas/${quota.id}/bids`).send({ assemblyId: a.id, type: 'free', percent: 20 }).expect(201);
    await s.as('post', `/consortium/assemblies/${a.id}/results`).send({ drawn: [], bids: [{ quotaNumber: '100', percent: 20 }] }).expect(200);
    expect(await s.quotaOf(quota.id)).toMatchObject({ status: 'contemplated' });

    const { consortiumManifest } = await import('@all/consortium');
    const late = consortiumManifest.notificationTemplates!.find((n) => n.key === 'consortium.installment_late')!;
    expect(late.email!.body).not.toContain('não concorre');
    expect(late.email!.body).toContain('confirme a situação com a administradora');
  });
});
