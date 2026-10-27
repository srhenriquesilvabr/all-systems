import { cnjCheckDigits, parseCnj } from '@all/legal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Número CNJ válido a partir do sequencial (Justiça Estadual de SC, foro 0023). */
const cnj = (seq: number) => {
  const n = String(seq).padStart(7, '0');
  return `${n}-${cnjCheckDigits(n, '2026', '8', '24', '0023')}.2026.8.24.0023`;
};

function nextWeekday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  for (;;) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    const wd = new Date(`${local}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return local;
    d.setTime(d.getTime() + 86_400_000);
  }
}

describe('escritório de advocacia', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('valida o número CNJ pelo dígito verificador', () => {
    // Dígitos verificadores errados.
    expect(parseCnj('0001234-55.2026.8.24.0023')).toBeNull();
    const valid = cnj(1234);
    expect(parseCnj(valid.replace(/\D/g, ''))).toBe(valid);
    const [n, rest] = valid.split('-') as [string, string];
    const wrong = `${n}-${String((Number(rest.slice(0, 2)) + 1) % 100).padStart(2, '0')}${rest.slice(2)}`;
    expect(parseCnj(wrong)).toBeNull();
    expect(parseCnj('123')).toBeNull();
  });

  async function office() {
    const s = await ownerSession(t, ['legal']);
    const { body: client } = await s.as('post', '/customers').send({ name: 'Carlos Cliente', email: uniqueEmail('cliente') }).expect(201);
    const { body: team } = await s.as('get', '/legal/team').expect(200);
    const newCase = (body: Record<string, unknown> = {}) =>
      s.as('post', '/legal/cases').send({ customerId: client.id, title: 'Reclamação trabalhista — horas extras', area: 'labor', ...body });
    return { ...s, client, owner: team[0] as { id: string; name: string }, newCase };
  }

  it('processo: número validado e único por escritório, andamentos e situação', async () => {
    const s = await office();
    expect(String((await s.newCase({ number: '1234567-00.2026.8.24.0023' }).expect(400)).body.message)).toMatch(/CNJ inválido/);
    const number = cnj(4821);
    const { body: lc } = await s.newCase({ number: number.replace(/\D/g, ''), responsibleUserId: s.owner.id, claimValue: '15000.50' }).expect(201);
    expect(lc).toMatchObject({ number, status: 'active', claimValue: 15000.5, responsible: { id: s.owner.id } });
    expect((await s.newCase({ number }).expect(409)).body.code).toBe('CASE_NUMBER_TAKEN');
    // Consultivo, sem número: vários podem existir.
    await s.newCase({ title: 'Parecer societário', role: 'advisory' }).expect(201);
    await s.newCase({ title: 'Revisão de contrato', role: 'advisory' }).expect(201);

    await s.as('post', `/legal/cases/${lc.id}/updates`).send({ occurredOn: localToday(), description: 'Petição inicial protocolada' }).expect(201);
    await s.as('patch', `/legal/cases/${lc.id}`).send({ status: 'settled' }).expect(200);
    const { body: updates } = await s.as('get', `/legal/cases/${lc.id}/updates`).expect(200);
    expect(updates.map((u: { description: string }) => u.description).sort()).toEqual(['Petição inicial protocolada', 'Situação alterada para: Acordo']);

    const other = await ownerSession(t, ['legal']);
    await other.as('get', `/legal/cases/${lc.id}`).expect(404);
    await other.as('post', '/legal/cases').send({ customerId: other.tenantId, title: 'x', responsibleUserId: s.owner.id }).expect(400);
  });

  it('prazo: alerta por e-mail a quem cuida, uma vez, com a antecedência pedida', async () => {
    const s = await office();
    const { body: lc } = await s.newCase({ number: cnj(77) }).expect(201);
    const deadline = (title: string, dueOn: string, alertDays: number) =>
      s.as('post', '/legal/deadlines').send({ caseId: lc.id, title, dueOn, alertDays, assignedUserId: s.owner.id }).expect(201);
    const { body: soon } = await deadline('Réplica à contestação', plusDays(localToday(), 2), 3);
    await deadline('Memoriais', plusDays(localToday(), 10), 3);

    const before = t.mails.length;
    await t.jobs.runOnce('legal.deadline-alerts');
    await t.jobs.runOnce('legal.deadline-alerts');
    await new Promise((r) => setTimeout(r, 50)); // envio em segundo plano
    const sent = t.mails.slice(before).filter((m) => m.to === s.email);
    expect(sent.map((m) => m.subject)).toEqual([`Prazo em ${plusDays(localToday(), 2).split('-').reverse().join('/')}: Réplica à contestação`]);
    expect(sent[0]!.text).toContain(lc.number);

    const { body: open } = await s.as('get', `/legal/deadlines?status=open&until=${plusDays(localToday(), 30)}`).expect(200);
    expect(open.map((d: { title: string }) => d.title)).toEqual(['Réplica à contestação', 'Memoriais']);
    await s.as('post', `/legal/deadlines/${soon.id}/done`).expect(204);
    const { body: c } = await s.as('get', `/legal/cases/${lc.id}`).expect(200);
    expect(c.nextDeadline.title).toBe('Memoriais');
  });

  it('prazo cumprido em data passada: andamento com essa data; data futura é recusada', async () => {
    const s = await office();
    const { body: lc } = await s.newCase({ number: cnj(78) }).expect(201);
    const lastWeek = plusDays(localToday(), -7);
    const { body: d } = await s.as('post', '/legal/deadlines').send({ caseId: lc.id, title: 'Contestação', dueOn: plusDays(localToday(), -5) }).expect(201);

    const future = await s.as('post', `/legal/deadlines/${d.id}/done`).send({ doneOn: plusDays(localToday(), 1) }).expect(400);
    expect(String(future.body.message)).toMatch(/não pode ser no futuro/);

    await s.as('post', `/legal/cases/${lc.id}/updates`).send({ occurredOn: localToday(), description: 'Juntada de documentos' }).expect(201);
    await s.as('post', `/legal/deadlines/${d.id}/done`).send({ doneOn: lastWeek }).expect(204);

    const { body: done } = await s.as('get', `/legal/deadlines?caseId=${lc.id}&status=done`).expect(200);
    expect(done).toHaveLength(1);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(done[0].doneAt))).toBe(lastWeek);
    // Andamentos do mais recente ao mais antigo, pela data informada (não pela de cadastro).
    const { body: updates } = await s.as('get', `/legal/cases/${lc.id}/updates`).expect(200);
    expect(updates.map((u: { occurredOn: string; description: string }) => [u.occurredOn, u.description])).toEqual([
      [localToday(), 'Juntada de documentos'],
      [lastWeek, 'Prazo cumprido: Contestação'],
    ]);
  });

  it('honorários: parcelas fixas, êxito sobre o valor obtido e cancelamento', async () => {
    const s = await office();
    const { body: lc } = await s.newCase().expect(201);
    const { body: fixed } = await s.as('post', '/legal/fees').send({ caseId: lc.id, kind: 'fixed', amount: 3000, installments: 3, firstDueOn: '2026-11-05' }).expect(201);
    const { body: success } = await s.as('post', '/legal/fees').send({ caseId: lc.id, kind: 'success', successPercent: 20 }).expect(201);
    await s.as('post', '/legal/fees').send({ caseId: lc.id, kind: 'success' }).expect(400);

    await s.as('post', `/legal/fees/${success.id}/success`).send({ obtainedAmount: 48250.5, dueOn: '2026-12-10' }).expect(204);
    await s.as('post', `/legal/fees/${success.id}/success`).send({ obtainedAmount: 1, dueOn: '2026-12-10' }).expect(400);
    let { body: fees } = await s.as('get', `/legal/cases/${lc.id}/fees`).expect(200);
    expect(fees.map((f: { kind: string; receivable: { total: number } }) => [f.kind, f.receivable.total])).toEqual([
      ['fixed', 3000],
      ['success', 9650.1],
    ]);

    await s.as('post', `/legal/fees/${fixed.id}/cancel`).expect(204);
    ({ body: fees } = await s.as('get', `/legal/cases/${lc.id}/fees`).expect(200));
    expect(fees[0]).toMatchObject({ status: 'cancelled', receivable: { total: 0 } });
  });

  it('parcela de honorário recebe baixa no financeiro, mas só é cancelada pelo processo', async () => {
    const s = await office();
    const { body: lc } = await s.newCase().expect(201);
    await s.as('post', '/legal/fees').send({ caseId: lc.id, kind: 'fixed', amount: 1200, installments: 2, firstDueOn: '2026-11-05' }).expect(201);
    const { body: entries } = await s.as('get', '/finance/entries?limit=50&q=Honorários').expect(200);
    const [first] = entries.items;
    expect(first).toMatchObject({ sourceType: 'legal_fee', settleInFinance: true, status: 'pending' });

    const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
    const { body: paid } = await s
      .as('post', `/finance/entries/${first.id}/pay`)
      .send({ paidAt: '2026-11-05', accountId: accounts[0].id, paymentMethod: 'pix' })
      .expect(201);
    expect(paid).toMatchObject({ status: 'paid', paidAt: '2026-11-05' });

    const second = entries.items[1];
    const { body: refused } = await s.as('post', `/finance/entries/${second.id}/cancel`).expect(400);
    expect(refused.code).toBe('ENTRY_FROM_MODULE');
  });

  it('audiência na agenda ligada ao processo, sem custo', async () => {
    const s = await office();
    const { body: lc } = await s.newCase({ number: cnj(9001) }).expect(201);
    const { body: services } = await s.as('get', '/scheduling/services').expect(200);
    const { body: lawyer } = await s.as('post', '/scheduling/resources').send({ name: 'Dra. Marina' }).expect(201);
    const hearing = services.find((x: { name: string }) => x.name === 'Audiência');
    const { body: a } = await s
      .as('post', '/scheduling/appointments')
      .send({
        customerId: s.client.id,
        resourceId: lawyer.id,
        serviceIds: [hearing.id],
        startsAt: new Date(`${nextWeekday()}T14:00:00-03:00`).toISOString(),
        subject: { type: 'legal_case', id: lc.id, label: lc.number },
      })
      .expect(201);
    expect(a).toMatchObject({ total: 0, subject: { type: 'legal_case', id: lc.id } });
  });
});
