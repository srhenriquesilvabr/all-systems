import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** 'YYYY-MM' deslocado n meses. */
const shiftMonth = (iso: string, n: number) => {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

interface Inst {
  id: string;
  seq: number;
  dueOn: string;
  amount: number;
  status: string;
  daysLate: number;
  paidOn: string | null;
  paidAmount: number | null;
}

describe('consórcio: parcelas, lances, assembleias agendadas, crédito, grupos e comissões', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const applicant = { name: 'Carla Consorciada', document: '12345678909', monthlyIncome: 8000, birthDate: '1990-05-10' };

  /** Corretora com planos sincronizados e uma cliente. `activeQuota` vende e ativa (adesão aceita). */
  async function brokerage() {
    const s = await ownerSession(t, ['consortium', 'integration.whatsapp']);
    const { body: customer } = await s.as('post', '/customers').send({ name: 'Carla Consorciada', phone: '(48) 99111-2222', email: uniqueEmail('cons') }).expect(201);
    await s.as('post', '/consortium/plans/sync').expect(200);
    const { body: [auto100] } = await s.as('get', '/consortium/plans?assetType=vehicle&minCredit=90000').expect(200);
    const { body: [auto60] } = await s.as('get', '/consortium/plans?assetType=vehicle&maxCredit=70000').expect(200);
    expect(auto100).toMatchObject({ name: 'Auto 100 mil', installment: 1505 });
    expect(auto60).toMatchObject({ name: 'Auto 60 mil' });
    async function activeQuota(planId = auto100.id as string) {
      const { body: quota } = await s.as('post', '/consortium/quotas').send({ customerId: customer.id, planId, applicant }).expect(201);
      const { body: props } = await s.as('get', `/banking/proposals?sourceType=consortium_quota&sourceId=${quota.id}`).expect(200);
      await s.as('post', `/banking/proposals/${props[0].id}/refresh`).expect(200);
      await t.relay.drain();
      const { body: active } = await s.as('get', `/consortium/quotas/${quota.id}`).expect(200);
      expect(active.status).toBe('active');
      return active as { id: string; number: number; groupCode: string; quotaNumber: string; commission: number; commissionPercent: number; commissionReversed: boolean };
    }
    const entriesOf = async (sourceId: string) =>
      ((await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as { id: string; sourceId: string; sourceType: string; kind: string; status: string; amount: number }[]).filter((e) => e.sourceId === sourceId);
    return { ...s, customer, auto100, auto60, activeQuota, entriesOf };
  }

  it('parcelas: geradas na ativação, marcar paga (sem lançar no financeiro), inadimplência e aviso de atraso', async () => {
    const s = await brokerage();
    const quota = await s.activeQuota();
    const today = localToday();

    // Ativação: 80 parcelas de R$ 1.505, todo dia 10, a partir do próximo dia 10.
    const { body: inst } = await s.as('get', `/consortium/quotas/${quota.id}/installments`).expect(200);
    expect(inst).toMatchObject({ generated: true, total: 80, monthly: 1505, dueDay: 10, paidCount: 0, lateCount: 0 });
    expect(inst.items[0]).toMatchObject({ seq: 1, amount: 1505, status: 'upcoming', daysLate: 0 });
    expect(inst.items[0].dueOn > today).toBe(true);
    expect(inst.items[0].dueOn.slice(8)).toBe('10');
    expect(inst.items[1].dueOn.slice(0, 7)).toBe(shiftMonth(inst.items[0].dueOn, 1));

    // Cota de grupo em andamento: calendário refeito a partir de três meses atrás, dia 5.
    const firstDueOn = `${shiftMonth(today, -3)}-05`;
    await s.as('post', `/consortium/quotas/${quota.id}/installments`).send({ firstDueOn: `${shiftMonth(today, -3)}-30` }).expect(400); // dia > 28
    const { body: redone } = await s.as('post', `/consortium/quotas/${quota.id}/installments`).send({ firstDueOn }).expect(200);
    expect(redone).toMatchObject({ total: 80, dueDay: 5 });
    const late = (redone.items as Inst[]).filter((i) => i.dueOn < today);
    expect(late.length).toBeGreaterThanOrEqual(3);
    expect(redone.lateCount).toBe(late.length);
    expect(redone.lateAmount).toBe(late.length * 1505);
    expect(redone.items[0]).toMatchObject({ dueOn: firstDueOn, status: 'late', daysLate: daysBetween(firstDueOn, today) });
    expect((await s.as('get', `/consortium/quotas/${quota.id}`).expect(200)).body.dueDay).toBe(5);

    // Marcar paga: data informada; não pode ser futura nem paga duas vezes.
    const [first, second] = redone.items as Inst[];
    const { body: paid } = await s.as('post', `/consortium/installments/${first!.id}/pay`).send({ paidOn: addDays(first!.dueOn, 2), notes: 'Comprovante pelo WhatsApp' }).expect(200);
    expect(paid).toMatchObject({ status: 'paid', paidOn: addDays(first!.dueOn, 2), paidAmount: 1505, daysLate: 0 });
    expect((await s.as('post', `/consortium/installments/${first!.id}/pay`).send({ paidOn: today }).expect(400)).body.code).toBe('INSTALLMENT_PAID');
    expect((await s.as('post', `/consortium/installments/${second!.id}/pay`).send({ paidOn: addDays(today, 1) }).expect(400)).body.code).toBe('PAID_IN_FUTURE');
    // Com parcela paga o calendário não é refeito.
    expect((await s.as('post', `/consortium/quotas/${quota.id}/installments`).send({ firstDueOn }).expect(400)).body.code).toBe('INSTALLMENTS_PAID');

    // O pagamento é só acompanhamento: no financeiro continua apenas a comissão.
    expect((await s.entriesOf(quota.id)).map((e) => [e.kind, e.amount])).toEqual([['income', 2000]]);

    // Inadimplência: a cota aparece com as parcelas em aberto, a mais antiga primeiro.
    const { body: lateList } = await s.as('get', '/consortium/installments/late').expect(200);
    expect(lateList).toHaveLength(1);
    expect(lateList[0]).toMatchObject({
      quota: { id: quota.id, groupCode: quota.groupCode, status: 'active' },
      customer: { id: s.customer.id, name: 'Carla Consorciada' },
      lateCount: late.length - 1,
      lateAmount: (late.length - 1) * 1505,
      oldestDueOn: second!.dueOn,
      daysLate: daysBetween(second!.dueOn, today),
      lastNoticeAt: null,
    });
    expect((await s.as('get', '/consortium/installments/late?minDays=400').expect(200)).body).toEqual([]);

    // Aviso automático (atraso acima de 5 dias, padrão): uma vez só.
    await t.jobs.runOnce('consortium.late-notices');
    await t.relay.drain();
    const lateNotices = async () =>
      ((await s.as('get', `/notifications?relatedEntity=cons_quota&relatedId=${quota.id}`).expect(200)).body as { templateKey: string }[]).filter((m) => m.templateKey === 'consortium.installment_late').length;
    const sent = await lateNotices();
    expect(sent).toBeGreaterThan(0);
    await t.jobs.runOnce('consortium.late-notices');
    expect(await lateNotices()).toBe(sent);
    expect((await s.as('get', '/consortium/installments/late').expect(200)).body[0].lastNoticeAt).toEqual(expect.any(String));

    // Aviso manual e desfazer pagamento.
    await s.as('post', `/consortium/quotas/${quota.id}/late-notice`).expect(200);
    const { body: undone } = await s.as('post', `/consortium/installments/${first!.id}/unpay`).expect(200);
    expect(undone).toMatchObject({ status: 'late', paidOn: null });

    // Cota cancelada sai da inadimplência e as parcelas em aberto ficam canceladas.
    await s.as('post', `/consortium/quotas/${quota.id}/cancel`).send({ reason: 'Cliente desistiu' }).expect(200);
    expect((await s.as('get', '/consortium/installments/late').expect(200)).body).toEqual([]);
    const { body: after } = await s.as('get', `/consortium/quotas/${quota.id}/installments`).expect(200);
    expect(after.items[0].status).toBe('cancelled');
    expect((await s.as('post', `/consortium/installments/${second!.id}/pay`).send({ paidOn: today }).expect(400)).body.code).toBe('QUOTA_CLOSED');
  });

  it('assembleia futura: agendar, remarcar, excluir e depois lançar o resultado', async () => {
    const s = await brokerage();
    const today = localToday();
    const date = addDays(today, 10);
    expect((await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G0001', heldOn: addDays(today, -1) }).expect(400)).body.code).toBe('ASSEMBLY_IN_PAST');
    const { body: a } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G0001', heldOn: date, notes: 'Assembleia ordinária' }).expect(201);
    expect(a).toMatchObject({ status: 'scheduled', groupCode: 'G0001', heldOn: date, drawn: [], bids: [], ourWinners: [], ourBids: [] });
    expect((await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G0001', heldOn: date }).expect(400)).body.code).toBe('ASSEMBLY_EXISTS');

    // No calendário do mês e na lista de agendadas.
    const { body: month } = await s.as('get', `/consortium/assemblies?from=${date.slice(0, 7)}-01&to=${addDays(date, 1)}`).expect(200);
    expect(month.map((x: { id: string }) => x.id)).toContain(a.id);
    expect((await s.as('get', '/consortium/assemblies?status=held').expect(200)).body).toEqual([]);

    // Remarcar.
    const moved = addDays(today, 12);
    expect((await s.as('patch', `/consortium/assemblies/${a.id}`).send({ heldOn: moved }).expect(200)).body).toMatchObject({ heldOn: moved, status: 'scheduled', notes: 'Assembleia ordinária' });

    // Resultado pelo fluxo antigo (grupo + data): preenche a agendada, sem criar outra.
    const { body: held } = await s.as('post', '/consortium/assemblies').send({ groupCode: 'G0001', heldOn: moved, drawn: ['007'], bids: [{ quotaNumber: '120', percent: 41 }] }).expect(201);
    expect(held).toMatchObject({ id: a.id, status: 'held', drawn: ['007'], bids: [{ quotaNumber: '120', percent: 41 }] });
    expect((await s.as('post', '/consortium/assemblies').send({ groupCode: 'G0001', heldOn: moved }).expect(400)).body.code).toBe('ASSEMBLY_EXISTS');
    expect((await s.as('post', `/consortium/assemblies/${a.id}/results`).send({ drawn: [] }).expect(400)).body.code).toBe('ASSEMBLY_EXISTS');
    expect((await s.as('patch', `/consortium/assemblies/${a.id}`).send({ heldOn: addDays(today, 20) }).expect(400)).body.code).toBe('ASSEMBLY_HELD');
    await s.as('delete', `/consortium/assemblies/${a.id}`).expect(400);

    // Agendada sem lances pode ser excluída.
    const { body: other } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'G0002', heldOn: date }).expect(201);
    await s.as('delete', `/consortium/assemblies/${other.id}`).expect(204);
    expect((await s.as('get', '/consortium/assemblies?groupCode=G0002').expect(200)).body).toEqual([]);
  });

  it('lances: registrado e enviado antes da assembleia; o resultado marca perdedor e vencedor; crédito e grupo', async () => {
    const s = await brokerage();
    const quota = await s.activeQuota();
    const today = localToday();
    const d1 = addDays(today, 7);
    const d2 = addDays(today, 37);

    const { body: a1 } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: quota.groupCode, heldOn: d1 }).expect(201);
    const { body: foreign } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: 'OUTRO1', heldOn: d1 }).expect(201);

    // Lance livre de 30%: o valor é calculado sobre o crédito (R$ 100.000).
    const { body: bid1 } = await s.as('post', `/consortium/quotas/${quota.id}/bids`).send({ assemblyId: a1.id, type: 'free', percent: 30 }).expect(201);
    expect(bid1).toMatchObject({ type: 'free', percent: 30, amount: 30000, status: 'registered', assembly: { id: a1.id, status: 'scheduled' } });
    expect((await s.as('post', `/consortium/quotas/${quota.id}/bids`).send({ assemblyId: a1.id, type: 'free', percent: 31 }).expect(400)).body.code).toBe('BID_EXISTS');
    expect((await s.as('post', `/consortium/quotas/${quota.id}/bids`).send({ assemblyId: foreign.id, type: 'free', percent: 31 }).expect(400)).body.code).toBe('ASSEMBLY_OTHER_GROUP');
    await s.as('post', `/consortium/quotas/${quota.id}/bids`).send({ assemblyId: a1.id, type: 'free' }).expect(400); // sem percentual nem valor
    expect((await s.as('patch', `/consortium/bids/${bid1.id}`).send({ status: 'sent' }).expect(200)).body.status).toBe('sent');
    await s.as('patch', `/consortium/bids/${bid1.id}`).send({ status: 'won' }).expect(400); // vencedor só pelo resultado
    expect((await s.as('get', '/consortium/assemblies?status=scheduled').expect(200)).body.find((x: { id: string }) => x.id === a1.id).ourBids).toEqual([
      expect.objectContaining({ id: bid1.id, quotaId: quota.id, status: 'sent', percent: 30 }),
    ]);

    // Resultado sem a nossa cota: lance perdedor, cota segue ativa.
    const { body: r1 } = await s.as('post', `/consortium/assemblies/${a1.id}/results`).send({ drawn: ['999'], bids: [{ quotaNumber: '998', percent: 40 }] }).expect(200);
    expect(r1).toMatchObject({ status: 'held', ourWinners: [], ourBids: [expect.objectContaining({ id: bid1.id, status: 'lost' })] });
    expect((await s.as('get', `/consortium/quotas/${quota.id}`).expect(200)).body.status).toBe('active');
    expect((await s.as('patch', `/consortium/bids/${bid1.id}`).send({ status: 'registered' }).expect(400)).body.code).toBe('BID_CLOSED');
    expect((await s.as('post', `/consortium/quotas/${quota.id}/bids`).send({ assemblyId: a1.id, type: 'free', percent: 20 }).expect(400)).body.code).toBe('ASSEMBLY_HELD');

    // Próxima assembleia: lance embutido de R$ 25.000 (= 25%) e a cota vence por lance.
    const { body: a2 } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: quota.groupCode, heldOn: d2 }).expect(201);
    const { body: bid2 } = await s.as('post', `/consortium/quotas/${quota.id}/bids`).send({ assemblyId: a2.id, type: 'embedded', amount: 25000 }).expect(201);
    expect(bid2).toMatchObject({ percent: 25, amount: 25000, status: 'registered' });
    const { body: r2 } = await s.as('post', `/consortium/assemblies/${a2.id}/results`).send({ drawn: ['999'], bids: [{ quotaNumber: quota.quotaNumber, percent: 25 }] }).expect(200);
    expect(r2.ourWinners).toEqual([expect.objectContaining({ quotaId: quota.id, type: 'bid' })]);
    expect(r2.ourBids).toEqual([expect.objectContaining({ id: bid2.id, status: 'won' })]);
    expect((await s.as('get', `/consortium/quotas/${quota.id}`).expect(200)).body).toMatchObject({ status: 'contemplated', contemplationType: 'bid', bidPercent: 25, contemplatedOn: d2 });
    const { body: bids } = await s.as('get', `/consortium/quotas/${quota.id}/bids`).expect(200);
    expect(bids.map((b: { id: string; status: string }) => [b.id, b.status])).toEqual([
      [bid2.id, 'won'],
      [bid1.id, 'lost'],
    ]);
    // Contemplada não dá mais lance.
    const { body: a3 } = await s.as('post', '/consortium/assemblies/schedule').send({ groupCode: quota.groupCode, heldOn: addDays(today, 67) }).expect(201);
    expect((await s.as('post', `/consortium/quotas/${quota.id}/bids`).send({ assemblyId: a3.id, type: 'free', percent: 10 }).expect(400)).body.code).toBe('QUOTA_NOT_ACTIVE');

    // Crédito: aberto na contemplação, já sem o lance embutido.
    expect((await s.as('get', `/consortium/quotas/${quota.id}/credit`).expect(200)).body).toMatchObject({ status: 'awaiting_docs', amount: 75000, releasedOn: null });
    await s.as('put', `/consortium/quotas/${quota.id}/credit`).send({ status: 'released' }).expect(400); // falta a data
    expect((await s.as('put', `/consortium/quotas/${quota.id}/credit`).send({ status: 'released', releasedOn: today }).expect(200)).body).toMatchObject({ status: 'released', amount: 75000, releasedOn: today });
    await s.as('put', `/consortium/quotas/${quota.id}/credit`).send({ status: 'acquired', releasedOn: today }).expect(400); // falta o bem
    const { body: acquired } = await s
      .as('put', `/consortium/quotas/${quota.id}/credit`)
      .send({ status: 'acquired', releasedOn: today, assetDescription: 'VW T-Cross 2024', acquiredOn: today })
      .expect(200);
    expect(acquired).toMatchObject({ status: 'acquired', assetDescription: 'VW T-Cross 2024', acquiredOn: today, amount: 75000 });

    // Grupo: cadastrado na ativação; lance médio das assembleias lançadas (40% e 25%).
    const { body: group } = await s.as('get', `/consortium/quotas/${quota.id}/group`).expect(200);
    expect(group).toMatchObject({
      id: expect.any(String),
      groupCode: quota.groupCode,
      plan: { id: s.auto100.id, name: 'Auto 100 mil' },
      members: null,
      assembliesHeld: 2,
      averageWinningBid: 32.5,
      minWinningBid: 25,
      maxWinningBid: 40,
      nextAssembly: { id: a3.id, heldOn: addDays(today, 67) },
      ourQuotas: 1,
    });
    const { body: saved } = await s.as('put', '/consortium/groups').send({ planId: s.auto100.id, groupCode: quota.groupCode, members: 300, monthsRemaining: 70 }).expect(200);
    expect(saved).toMatchObject({ id: group.id, members: 300, monthsRemaining: 70 });
    const { body: groups } = await s.as('get', '/consortium/groups').expect(200);
    expect(groups).toEqual([expect.objectContaining({ groupCode: quota.groupCode, members: 300, averageWinningBid: 32.5 })]);
  });

  it('comissão por administradora e por plano; estorno quando a cota é cancelada cedo', async () => {
    const s = await brokerage();
    const { body: table } = await s.as('get', '/consortium/commissions').expect(200);
    const admin = table.institutions.find((i: { institution: string }) => i.institution === 'Administradora de Consórcio D (simulação)');
    expect(table).toMatchObject({ defaultPercent: 2, reversalMonths: 6 });
    expect(admin).toMatchObject({ percent: null });
    expect(admin.plans).toHaveLength(6);
    expect(admin.plans.every((p: { effectivePercent: number }) => p.effectivePercent === 2)).toBe(true);

    // Administradora a 3%, e o Auto 100 mil a 4%.
    await s.as('put', `/consortium/commissions/institutions/${admin.connectionId}`).send({ percent: 3 }).expect(200);
    const { body: after } = await s.as('put', `/consortium/commissions/plans/${s.auto100.id}`).send({ percent: 4 }).expect(200);
    const plans = after.institutions.find((i: { connectionId: string }) => i.connectionId === admin.connectionId).plans as { id: string; percent: number | null; effectivePercent: number }[];
    expect(plans.find((p) => p.id === s.auto100.id)).toMatchObject({ percent: 4, effectivePercent: 4 });
    expect(plans.find((p) => p.id === s.auto60.id)).toMatchObject({ percent: null, effectivePercent: 3 });

    const big = await s.activeQuota(s.auto100.id);
    const small = await s.activeQuota(s.auto60.id);
    expect(big).toMatchObject({ commissionPercent: 4, commission: 4000 });
    expect(small).toMatchObject({ commissionPercent: 3, commission: 1800 });
    expect((await s.entriesOf(big.id)).map((e) => [e.kind, e.status, e.amount])).toEqual([['income', 'pending', 4000]]);

    // Mudar o percentual depois não altera a cota já ativa.
    await s.as('put', `/consortium/commissions/plans/${s.auto100.id}`).send({ percent: 5 }).expect(200);
    expect((await s.as('get', `/consortium/quotas/${big.id}`).expect(200)).body).toMatchObject({ commissionPercent: 4, commission: 4000 });
    await s.as('put', `/consortium/commissions/plans/${s.auto100.id}`).send({ percent: null }).expect(200); // volta a herdar

    // Cancelada cedo com a comissão ainda a receber: o "a receber" é cancelado, sem despesa.
    const { body: cancelledSmall } = await s.as('post', `/consortium/quotas/${small.id}/cancel`).send({ reason: 'Desistência' }).expect(200);
    expect(cancelledSmall).toMatchObject({ status: 'cancelled', commissionReversed: true, cancelledAt: expect.any(String) });
    expect((await s.entriesOf(small.id)).map((e) => [e.kind, e.status, e.amount])).toEqual([['income', 'cancelled', 1800]]);

    // Cancelada cedo com a comissão já recebida: despesa de estorno a acertar no financeiro.
    const [commission] = await s.entriesOf(big.id);
    const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
    await s.as('post', `/finance/entries/${commission!.id}/pay`).send({ paidAt: localToday(), accountId: accounts[0].id }).expect(201);
    expect((await s.as('post', `/consortium/quotas/${big.id}/cancel`).send({ reason: 'Desistência' }).expect(200)).body.commissionReversed).toBe(true);
    const bigEntries = await s.entriesOf(big.id);
    expect(bigEntries.map((e) => [e.sourceType, e.kind, e.status, e.amount]).sort()).toEqual(
      [
        ['consortium_commission_reversal', 'expense', 'pending', 4000],
        ['consortium_quota', 'income', 'paid', 4000],
      ].sort(),
    );

    // Sem prazo de estorno (0): cancelar não mexe na comissão.
    await s.as('put', '/modules/consortium/settings').send({ commissionPercent: 2, reversalMonths: 0, lateNoticeDays: 5 }).expect(204);
    const late = await s.activeQuota(s.auto60.id);
    expect(late.commission).toBe(1800); // 3% da administradora continua valendo
    const { body: kept } = await s.as('post', `/consortium/quotas/${late.id}/cancel`).send({ reason: 'Desistência' }).expect(200);
    expect(kept.commissionReversed).toBe(false);
    expect((await s.entriesOf(late.id)).map((e) => [e.kind, e.status, e.amount])).toEqual([['income', 'pending', 1800]]);
  });
});
