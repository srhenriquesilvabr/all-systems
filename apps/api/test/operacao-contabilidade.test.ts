import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('contabilidade: catálogo, mudança de regime, honorário e anexos', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function setup() {
    const s = await ownerSession(t, ['accounting']);
    const { body: customer } = await s.as('post', '/customers').send({ type: 'company', name: 'Padaria Exemplo' }).expect(201);
    return { ...s, customer };
  }
  type S = Awaited<ReturnType<typeof setup>>;

  const body = (s: S, extra: object = {}) => ({ customerId: s.customer.id, taxRegime: 'simples', hasEmployees: false, monthlyFee: 0, feeDueDay: 10, ...extra });
  const pendingOf = async (s: S, clientId: string) => (await s.as('get', `/accounting/obligations?clientId=${clientId}&status=pending`).expect(200)).body as { id: string; type: { code: string }; dueOn: string; notes: string | null }[];

  it('cria obrigação no catálogo e ela entra na geração; código repetido e sem regime são recusados', async () => {
    const s = await setup();
    const input = { code: 'GIA', name: 'GIA estadual', regimes: ['simples'], requiresEmployees: false, frequency: 'monthly', dueDay: 12, active: true };
    const { body: type } = await s.as('post', '/accounting/obligation-types').send(input).expect(201);
    expect((await s.as('post', '/accounting/obligation-types').send(input).expect(409)).body.code).toBe('TYPE_EXISTS');
    await s.as('post', '/accounting/obligation-types').send({ ...input, code: 'OUTRA', regimes: [] }).expect(400);

    const { body: client } = await s.as('post', '/accounting/clients').send(body(s)).expect(201);
    expect((await pendingOf(s, client.id)).map((o) => o.type.code)).toContain('GIA');

    await s.as('patch', `/accounting/obligation-types/${type.id}`).send({ ...input, frequency: 'annual', dueMonth: 4, dueDay: 30 }).expect(200);
    const { body: types } = await s.as('get', '/accounting/obligation-types').expect(200);
    expect(types.find((x: { id: string }) => x.id === type.id)).toMatchObject({ frequency: 'annual', dueMonth: 4, dueDay: 30 });
  });

  it('mudar o regime dispensa o que ainda não venceu, mantém o vencido e deixa rastro; reabrir desfaz', async () => {
    const s = await setup();
    const { body: client } = await s.as('post', '/accounting/clients').send(body(s)).expect(201);
    const before = await pendingOf(s, client.id);
    const das = before.filter((o) => o.type.code === 'DAS');
    expect(das.length).toBeGreaterThan(0);

    const { body: impact } = await s.as('get', `/accounting/clients/${client.id}/regime-impact?taxRegime=presumido&hasEmployees=false`).expect(200);
    expect(impact.map((i: { id: string }) => i.id).sort()).toEqual(before.filter((o) => ['DAS', 'DEFIS'].includes(o.type.code)).map((o) => o.id).sort());

    const { body: saved } = await s.as('patch', `/accounting/clients/${client.id}`).send(body(s, { taxRegime: 'presumido' })).expect(200);
    const overdue = impact.filter((i: { overdue: boolean }) => i.overdue).length;
    expect(saved.regimeChange).toEqual({ waived: impact.length - overdue, kept: overdue });

    const { body: waived } = await s.as('get', `/accounting/obligations?clientId=${client.id}&status=waived`).expect(200);
    expect(waived).toHaveLength(impact.length - overdue);
    for (const o of waived) expect(o.notes).toMatch(/regime mudou de Simples Nacional para Lucro Presumido/);
    // O regime novo já ganha as obrigações dele.
    expect((await pendingOf(s, client.id)).map((o) => o.type.code)).toContain('PISCOFINS');

    if (waived[0]) {
      await s.as('post', `/accounting/obligations/${waived[0].id}/status`).send({ status: 'pending' }).expect(204);
      expect((await pendingOf(s, client.id)).map((o) => o.id)).toContain(waived[0].id);
    }
  });

  it('a pessoa escolhe quais dispensar: a escolha vale mesmo sobre a regra padrão, e as outras ficam com observação', async () => {
    const s = await setup();
    const { body: client } = await s.as('post', '/accounting/clients').send(body(s)).expect(201);
    const { body: impact } = await s.as('get', `/accounting/clients/${client.id}/regime-impact?taxRegime=real&hasEmployees=false`).expect(200);
    const [chosen, ...rest] = impact as { id: string }[];
    const { body: saved } = await s.as('patch', `/accounting/clients/${client.id}`).send(body(s, { taxRegime: 'real', waiveObligationIds: [chosen!.id] })).expect(200);
    expect(saved.regimeChange).toEqual({ waived: 1, kept: rest.length });
    const pending = await pendingOf(s, client.id);
    for (const r of rest) expect(pending.find((o) => o.id === r.id)?.notes).toMatch(/confira se esta ainda precisa ser entregue/);
    // Salvar sem mudar o regime não mexe em nada.
    const { body: same } = await s.as('patch', `/accounting/clients/${client.id}`).send(body(s, { taxRegime: 'real' })).expect(200);
    expect(same.regimeChange).toBeUndefined();
  });

  it('honorário não nasce vencido: passou o dia, vai para o mês seguinte, com aviso; no prazo, fica no mês', async () => {
    const s = await setup();
    const today = localToday();
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    // Dia 1 só "já passou" a partir do dia 2; no próprio dia 1 a regra não tem o que mover.
    await s.as('post', '/accounting/clients').send(body(s, { monthlyFee: 300, feeDueDay: 1 })).expect(201);
    const { body: run } = await s.as('post', '/accounting/generate').expect(200);
    expect(run.fees).toBe(1);
    const { body: entries } = await s.as('get', `/finance/entries?limit=50&customerId=${s.customer.id}`).expect(200);
    if (d > 1) {
      expect(entries.items).toEqual([expect.objectContaining({ amount: 300, status: 'pending', dueDate: `${nextMonth}-01`, notes: expect.stringMatching(/já tinha passado/) })]);
      expect(run.feesMoved).toEqual([{ name: 'Padaria Exemplo', dueOn: `${nextMonth}-01` }]);
    } else {
      expect(entries.items).toEqual([expect.objectContaining({ dueDate: today })]);
    }
    // Rodar de novo não lança outro.
    expect((await s.as('post', '/accounting/generate').expect(200)).body.fees).toBe(0);
  });

  it('a obrigação aceita observação e anexo; o anexo não sai pelo download genérico', async () => {
    const s = await setup();
    const { body: client } = await s.as('post', '/accounting/clients').send(body(s)).expect(201);
    const [o] = await pendingOf(s, client.id);

    await s.as('patch', `/accounting/obligations/${o!.id}/notes`).send({ notes: 'Guia enviada ao cliente' }).expect(204);
    const { body: file } = await s.as('post', `/accounting/obligations/${o!.id}/attachments`).attach('file', PNG_1PX, { filename: 'guia.png', contentType: 'image/png' }).expect(201);
    await s.as('post', `/accounting/obligations/${o!.id}/attachments`).attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);
    await s.as('post', `/accounting/obligations/${o!.id}/attachments`).expect(400);

    const [listed] = (await s.as('get', `/accounting/obligations?clientId=${client.id}&status=pending`).expect(200)).body.filter((x: { id: string }) => x.id === o!.id);
    expect(listed).toMatchObject({ notes: 'Guia enviada ao cliente', attachments: [expect.objectContaining({ id: file.id, filename: 'guia.png' })] });

    await s.as('get', `/accounting/attachments/${file.id}`).buffer(true).expect(200);
    await s.as('get', `/files/${file.id}`).expect(404);
    await s.as('delete', `/accounting/obligations/${o!.id}/attachments/${file.id}`).expect(204);
  });
});
