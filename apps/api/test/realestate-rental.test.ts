import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

// Datas no mesmo formato e com as mesmas regras da API (dia limitado ao fim do mês).
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayOfMonth = (iso: string, months: number, day: number) => {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
};
const addMonths = (iso: string, n: number) => dayOfMonth(iso, n, Number(iso.slice(8, 10)));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

interface Charge {
  id: string;
  seq: number;
  periodStart: string;
  dueDate: string;
  payoutDate: string;
  rent: number;
  total: number;
  adminFee: number;
  payout: number;
  status: 'active' | 'cancelled';
  receipt: string;
}
interface Entry {
  id: string;
  kind: 'income' | 'expense';
  status: 'pending' | 'paid' | 'cancelled';
  amount: number;
  dueDate: string;
  sourceType: string;
  sourceId: string;
  settleInFinance: boolean;
}

describe('imobiliária: administração de locação', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const s = await ownerSession(t, ['real_estate']);
    const { body: owner } = await s.as('post', '/customers').send({ name: 'Proprietária Locadora' }).expect(201);
    const { body: renter } = await s.as('post', '/customers').send({ name: 'Inquilino Teste', email: uniqueEmail('inquilino'), phone: '(48) 99123-4567' }).expect(201);
    const propertyBody = {
      purpose: 'rent',
      type: 'apartment',
      title: 'Apto 2 quartos para alugar',
      ownerId: owner.id,
      street: 'Rua Bocaiúva',
      number: '200',
      district: 'Centro',
      city: 'Florianópolis',
      state: 'SC',
      rentPrice: 2500,
      condoFee: 400,
    };
    const { body: prop } = await s.as('post', '/real-estate/properties').send(propertyBody).expect(201);
    const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
    const cashId = accounts.find((a: { name: string }) => a.name === 'Caixa').id as string;
    const lease = (body: Record<string, unknown> = {}) =>
      s.as('post', '/real-estate/leases').send({ propertyId: prop.id, renterId: renter.id, startDate: localToday(), termMonths: 30, rent: 2500, dueDay: 10, adminFeePercent: 10, ...body });
    const entries = async (customerId: string, sourceType = 'real_estate_lease') =>
      ((await s.as('get', `/finance/entries?limit=200&customerId=${customerId}`).expect(200)).body.items as Entry[])
        .filter((e) => e.sourceType === sourceType)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const pay = (entryId: string) => s.as('post', `/finance/entries/${entryId}/pay`).send({ paidAt: localToday(), accountId: cashId }).expect(201);
    const detail = async (id: string) => (await s.as('get', `/real-estate/leases/${id}`).expect(200)).body as { rent: number; charges: Charge[]; adjustments: any[]; [k: string]: any };
    return { ...s, owner, renter, prop, propertyBody, lease, entries, pay, detail };
  }

  it('contrato: imóvel alugado, 12 mensalidades a receber e 12 repasses (aluguel − taxa + condomínio)', async () => {
    const s = await setup();
    const today = localToday();
    // Caução acima de 3 aluguéis e fiador com CPF inválido.
    await s.lease({ guaranteeType: 'deposit', guaranteeAmount: 9000 }).expect(400);
    await s.lease({ guaranteeType: 'guarantor', guarantorName: 'Fiador Teste', guarantorDocument: '111.111.111-11' }).expect(400);
    await s.lease({ renterId: s.owner.id }).expect(400);

    const { body: l } = await s.lease({ condoFee: 400, guaranteeType: 'deposit', guaranteeAmount: 7500 }).expect(201);
    expect(l).toMatchObject({
      number: 1,
      status: 'active',
      rent: 2500,
      startDate: today,
      endDate: plusDays(addMonths(today, 30), -1),
      owner: { id: s.owner.id },
      renter: { id: s.renter.id },
      guaranteeType: 'deposit',
      guaranteeAmount: 7500,
    });
    expect(l.charges).toHaveLength(12);
    const firstDue = dayOfMonth(today, 1, 10);
    expect(l.charges[0]).toMatchObject({
      seq: 1,
      periodStart: today,
      dueDate: firstDue,
      payoutDate: plusDays(firstDue, 5),
      rent: 2500,
      condoFee: 400,
      total: 2900,
      adminFee: 250,
      payout: 2650,
      receipt: 'pending',
      payoutStatus: 'pending',
    });
    expect(l.charges[11]).toMatchObject({ seq: 12, periodStart: addMonths(today, 11), dueDate: dayOfMonth(today, 12, 10) });

    // O imóvel acompanha o contrato: alugado, sem segundo contrato e sem voltar a "disponível" pela edição.
    expect((await s.as('get', `/real-estate/properties/${s.prop.id}`).expect(200)).body.status).toBe('rented');
    expect((await s.lease().expect(409)).body.code).toBe('PROPERTY_UNAVAILABLE');
    const refused = await s.as('patch', `/real-estate/properties/${s.prop.id}`).send({ ...s.propertyBody, status: 'available' }).expect(400);
    expect(refused.body.code).toBe('PROPERTY_RENTED');

    const rents = await s.entries(s.renter.id);
    expect(rents).toHaveLength(12);
    expect(rents.every((e) => e.kind === 'income' && e.status === 'pending' && e.amount === 2900 && e.settleInFinance)).toBe(true);
    const payouts = await s.entries(s.owner.id);
    expect(payouts).toHaveLength(12);
    expect(payouts.every((e) => e.kind === 'expense' && e.status === 'pending' && e.amount === 2650 && !e.settleInFinance)).toBe(true);
    expect(payouts[0]!.dueDate).toBe(plusDays(firstDue, 5));

    // Baixa do primeiro aluguel no financeiro aparece no contrato e no extrato do proprietário.
    await s.pay(rents[0]!.id);
    expect((await s.detail(l.id)).charges[0]).toMatchObject({ receipt: 'paid', receivedAt: today, payoutStatus: 'pending' });
    const { body: st } = await s.as('get', `/real-estate/leases/statement?ownerId=${s.owner.id}&month=${firstDue.slice(0, 7)}`).expect(200);
    expect(st.lines).toEqual([expect.objectContaining({ leaseNumber: 1, amount: 2900, receipt: 'paid', adminFee: 250, payout: 2650, payoutStatus: 'pending' })]);
    expect(st.totals).toEqual({ charged: 2900, received: 2900, adminFee: 250, payout: 2650, payoutPaid: 0 });

    const { body: byOwner } = await s.as('get', `/real-estate/leases?ownerId=${s.owner.id}`).expect(200);
    expect(byOwner.map((x: { id: string }) => x.id)).toEqual([l.id]);
    expect(byOwner[0].nextCharge).toMatchObject({ dueDate: dayOfMonth(today, 2, 10), overdue: false });
    expect((await s.as('get', `/real-estate/leases?renterId=${s.owner.id}`).expect(200)).body).toEqual([]);
  });

  it('job completa 12 meses à frente; reajuste recalcula só as mensalidades futuras em aberto e avisa o inquilino', async () => {
    const s = await setup();
    const today = localToday();
    // Contrato que faz aniversário daqui a ~10 dias; vencimento daqui a 2 dias (para o lembrete).
    const start = addMonths(plusDays(today, 10), -12);
    const dueOn = addMonths(start, 12);
    const reminderDate = plusDays(today, 2);
    const { body: l } = await s.lease({ startDate: start, dueDay: Number(reminderDate.slice(8, 10)), adjustmentIndex: 'igpm' }).expect(201);
    expect(l.charges).toHaveLength(12);
    expect(l.adjustments).toEqual([]);

    await t.jobs.runOnce('real_estate.leases');
    const extended = await s.detail(l.id);
    const horizon = addMonths(today, 12);
    expect(extended.charges.length).toBeGreaterThan(12);
    expect(extended.charges.map((c) => c.seq)).toEqual(extended.charges.map((_, i) => i + 1));
    expect(extended.charges.every((c) => c.dueDate <= horizon)).toBe(true);
    expect(extended.charges.at(-1)!.dueDate >= addMonths(today, 11)).toBe(true);
    // Idempotente.
    await t.jobs.runOnce('real_estate.leases');
    expect((await s.detail(l.id)).charges).toHaveLength(extended.charges.length);
    expect((await s.entries(s.renter.id)).filter((e) => e.status !== 'cancelled')).toHaveLength(extended.charges.length);
    expect((await s.as('get', '/real-estate/leases?dueThisMonth=true').expect(200)).body.map((x: { id: string }) => x.id)).toEqual([l.id]);

    // Lembrete do aluguel que vence em 2 dias.
    const dueSoon = extended.charges.find((c) => c.dueDate === reminderDate)!;
    expect(dueSoon).toBeDefined();
    await t.relay.drain();
    const { body: reminders } = await s.as('get', `/notifications?relatedEntity=re_lease_charge&relatedId=${dueSoon.id}`).expect(200);
    expect(reminders.map((m: { templateKey: string }) => m.templateKey)).toContain('real_estate.rent_due');

    // Reajuste pendente na lista.
    const { body: pending } = await s.as('get', '/real-estate/leases/adjustments?status=pending').expect(200);
    const adj = pending.find((a: { leaseId: string }) => a.leaseId === l.id);
    expect(adj).toMatchObject({ dueOn, index: 'igpm', previousRent: 2500, status: 'pending', lease: { number: l.number, renterName: 'Inquilino Teste' } });

    // Uma mensalidade futura já paga adiantada não muda.
    const future = extended.charges.filter((c) => c.periodStart >= dueOn);
    const before = extended.charges.filter((c) => c.periodStart < dueOn);
    expect(future.length).toBeGreaterThan(1);
    const prepaid = future[0]!;
    const prepaidEntry = (await s.entries(s.renter.id)).find((e) => e.sourceId === prepaid.id && e.status === 'pending')!;
    await s.pay(prepaidEntry.id);

    expect((await s.as('post', `/real-estate/leases/adjustments/${adj.id}/apply`).send({}).expect(400)).body.code).toBe('PERCENT_REQUIRED');
    const { body: applied } = await s.as('post', `/real-estate/leases/adjustments/${adj.id}/apply`).send({ percent: 4.5 }).expect(200);
    expect(applied).toMatchObject({ status: 'applied', percent: 4.5, previousRent: 2500, newRent: 2612.5 });
    await s.as('post', `/real-estate/leases/adjustments/${adj.id}/apply`).send({ percent: 4.5 }).expect(400);

    const after = await s.detail(l.id);
    expect(after.rent).toBe(2612.5);
    expect(after.charges).toHaveLength(extended.charges.length);
    for (const c of after.charges) {
      if (c.periodStart < dueOn) expect(c).toMatchObject({ rent: 2500, adminFee: 250, payout: 2250 });
      else if (c.id === prepaid.id) expect(c).toMatchObject({ rent: 2500, receipt: 'paid' });
      else expect(c).toMatchObject({ rent: 2612.5, adminFee: 261.25, payout: 2351.25, status: 'active' });
    }
    // No financeiro: as futuras em aberto foram canceladas e lançadas de novo; as anteriores ficaram.
    const rents = await s.entries(s.renter.id);
    expect(rents.filter((e) => e.status === 'cancelled')).toHaveLength(future.length - 1);
    expect(rents.filter((e) => e.status !== 'cancelled')).toHaveLength(after.charges.length);
    expect(rents.filter((e) => e.status === 'pending' && e.amount === 2612.5)).toHaveLength(future.length - 1);
    expect(rents.filter((e) => e.status !== 'cancelled' && e.amount === 2500)).toHaveLength(before.length + 1);
    const payouts = await s.entries(s.owner.id);
    expect(payouts.filter((e) => e.status === 'pending' && e.amount === 2351.25)).toHaveLength(future.length - 1);

    await t.relay.drain();
    const { body: notices } = await s.as('get', `/notifications?relatedEntity=re_lease&relatedId=${l.id}`).expect(200);
    expect(notices.map((m: { templateKey: string }) => m.templateKey)).toContain('real_estate.rent_adjusted');
  });

  it('índice fixo: aniversários anteriores ao cadastro ficam "não aplicados" e o próximo é aplicado sozinho pelo job', async () => {
    const s = await setup();
    const today = localToday();
    const start = addMonths(plusDays(today, 5), -24);
    const { body: l } = await s.lease({ startDate: start, termMonths: 30, adjustmentIndex: 'fixed', adjustmentPercent: 5 }).expect(201);
    expect(l.adjustments).toEqual([expect.objectContaining({ dueOn: addMonths(start, 12), status: 'skipped' })]);

    await t.jobs.runOnce('real_estate.leases');
    const after = await s.detail(l.id);
    const dueOn = addMonths(start, 24);
    expect(after.adjustments.map((a) => [a.dueOn, a.status, a.percent])).toEqual([
      [addMonths(start, 12), 'skipped', null],
      [dueOn, 'applied', 5],
    ]);
    expect(after.rent).toBe(2625);
    expect(after.charges.length).toBe(30); // o prazo todo cabe nos 12 meses à frente
    for (const c of after.charges) expect(c.rent).toBe(c.periodStart >= dueOn ? 2625 : 2500);
  });

  it('rescisão: cancela as mensalidades futuras em aberto, cobra o mês pelos dias, lança a multa e libera o imóvel', async () => {
    const s = await setup();
    const today = localToday();
    const { body: l } = await s.lease().expect(201);
    const date = addMonths(today, 3); // começo do 4º mês: nada proporcional
    expect((await s.as('post', `/real-estate/leases/${l.id}/terminate`).send({ date }).expect(400)).body.code).toBe('REASON_REQUIRED');
    const { body: done } = await s
      .as('post', `/real-estate/leases/${l.id}/terminate`)
      .send({ date, reason: 'Inquilino mudou de cidade', fine: { amount: 7500 } })
      .expect(200);
    expect(done).toMatchObject({ status: 'terminated', terminatedOn: date, terminationReason: 'Inquilino mudou de cidade' });
    expect(done.charges.filter((c: Charge) => c.status === 'active').map((c: Charge) => c.seq)).toEqual([1, 2, 3]);
    expect(done.charges.filter((c: Charge) => c.status === 'cancelled')).toHaveLength(9);
    expect(done.charges.filter((c: Charge) => c.status === 'active').every((c: Charge) => c.rent === 2500)).toBe(true);
    expect((await s.as('get', `/real-estate/properties/${s.prop.id}`).expect(200)).body.status).toBe('available');

    const rents = await s.entries(s.renter.id);
    expect(rents.filter((e) => e.status === 'pending')).toHaveLength(3);
    expect(rents.filter((e) => e.status === 'cancelled')).toHaveLength(9);
    const payouts = await s.entries(s.owner.id);
    expect(payouts.filter((e) => e.status === 'pending')).toHaveLength(3);
    expect(payouts.filter((e) => e.status === 'cancelled')).toHaveLength(9);
    // Multa rescisória: a receber do inquilino e repassada ao proprietário.
    expect(done.extras).toEqual([expect.objectContaining({ kind: 'fine', amount: 7500, dueDate: date, passToOwner: true, receipt: 'pending' })]);
    expect(await s.entries(s.renter.id, 'real_estate_lease_extra')).toEqual([expect.objectContaining({ kind: 'income', amount: 7500, status: 'pending' })]);
    expect(await s.entries(s.owner.id, 'real_estate_lease_extra')).toEqual([expect.objectContaining({ kind: 'expense', amount: 7500, status: 'pending' })]);
    expect((await s.as('post', `/real-estate/leases/${l.id}/terminate`).send({ date, reason: 'De novo' }).expect(400)).body.code).toBe('LEASE_CLOSED');

    // Imóvel liberado: novo contrato, rescindido no meio do primeiro mês (15 dias de uso).
    const { body: l2 } = await s.lease({ termMonths: 12 }).expect(201);
    const mid = plusDays(today, 14);
    const { body: d2 } = await s.as('post', `/real-estate/leases/${l2.id}/terminate`).send({ date: mid, reason: 'Acordo entre as partes' }).expect(200);
    const prorated = Math.round((250000 * 15) / daysBetween(today, addMonths(today, 1))) / 100;
    expect(d2.charges.filter((c: Charge) => c.status === 'active')).toEqual([expect.objectContaining({ seq: 1, rent: prorated, total: prorated })]);
    expect(d2.charges.filter((c: Charge) => c.status === 'cancelled')).toHaveLength(11);
    const l2Rents = (await s.entries(s.renter.id)).filter((e) => e.status === 'pending' && d2.charges.some((c: Charge) => c.id === e.sourceId));
    expect(l2Rents).toEqual([expect.objectContaining({ amount: prorated })]);
  });
});
