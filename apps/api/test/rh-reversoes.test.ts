import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cpf, createTestApp, login, ownerSession, PASSWORD, uniqueEmail, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const daysFromToday = (n: number) => {
  const d = new Date(`${localToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** RH e Consultoria de RH: situação, folha aberta, reabertura, rescisão desfeita e honorários. Inclui as recusas. */
describe('RH: situação e reversões', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  type Session = Awaited<ReturnType<typeof ownerSession>>;
  const job = { position: 'Auxiliar', admissionDate: '2024-01-15', salary: 3000 };
  const admit = async (s: Session, body: Record<string, unknown> = {}) => (await s.as('post', '/hr/employees').send({ ...job, name: 'Ana Colaboradora', cpf: cpf(), ...body }).expect(201)).body as { id: string; teamMemberId: string };
  const statusOf = async (s: Session, id: string) => (await s.as('get', `/hr/employees/${id}`).expect(200)).body as { status: string; currentLeave: unknown; manualLeave: boolean; terminatedWithoutTerm: boolean; termination: unknown; cancelledTerminations: { reason: string }[]; name: string; cpf: string };
  const entriesOf = async (s: Session, sourceId: string) => ((await s.as('get', '/finance/entries?limit=200').expect(200)).body.items as { id: string; sourceId: string; status: string; amount: number; sourceLabel: string }[]).filter((e) => e.sourceId === sourceId);
  const edit = (s: Session, id: string, e: { name: string; cpf: string }, body: Record<string, unknown>) => s.as('patch', `/hr/employees/${id}`).send({ ...job, name: e.name, cpf: e.cpf, ...body });
  const terminate = (s: Session, id: string, terminationDate = '2025-06-15') => s.as('post', `/hr/employees/${id}/termination`).send({ type: 'without_cause', terminationDate, notice: 'indemnified', fgtsBalance: 1000 });

  describe('Situação Desligado', () => {
    it('não existe sem termo pela edição; com termo, não sai pela edição', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s);
      const e = await statusOf(s, a.id);
      expect((await edit(s, a.id, e, { status: 'terminated', terminationDate: '2025-06-15' }).expect(400)).body.code).toBe('USE_TERMINATION');
      expect((await edit(s, a.id, e, { status: 'active', terminationDate: '2025-06-15' }).expect(400)).body.code).toBe('USE_TERMINATION');
      expect((await statusOf(s, a.id)).status).toBe('active');

      await terminate(s, a.id).expect(201);
      expect((await edit(s, a.id, e, { status: 'active' }).expect(400)).body.code).toBe('TERMINATION_LOCKED');
      expect((await edit(s, a.id, e, { status: 'terminated', terminationDate: '2025-06-20' }).expect(400)).body.code).toBe('TERMINATION_LOCKED');
      // Corrigir o resto do cadastro continua possível.
      await edit(s, a.id, e, { status: 'terminated', terminationDate: '2025-06-15', notes: 'Observação' }).expect(200);
      // Com termo, reativar não é o caminho.
      expect((await s.as('post', `/hr/employees/${a.id}/reactivate`).send({ reason: 'Engano' }).expect(400)).body.code).toBe('TERMINATION_EXISTS');
    });

    it('quem já está desligado sem termo: é apontado, pode rescindir de verdade ou reativar', async () => {
      const s = await ownerSession(t, ['hr']);
      // Hoje só a API de carga cria assim; é o estado de quem foi desligado pela edição antiga.
      const legado = await admit(s, { status: 'terminated', terminationDate: '2025-02-18' });
      const legado2 = await admit(s, { status: 'terminated', terminationDate: '2025-02-18' });
      const e = await statusOf(s, legado.id);
      expect(e).toMatchObject({ status: 'terminated', terminatedWithoutTerm: true, termination: null });
      expect((await s.as('get', '/hr/employees?status=terminated').expect(200)).body.find((x: { id: string }) => x.id === legado.id).terminatedWithoutTerm).toBe(true);

      // A edição não muda a situação nem a data.
      expect((await edit(s, legado.id, e, { status: 'active' }).expect(400)).body.code).toBe('USE_TERMINATION');
      expect((await edit(s, legado.id, e, { status: 'terminated', terminationDate: '2025-03-01' }).expect(400)).body.code).toBe('USE_TERMINATION');
      await edit(s, legado.id, e, { status: 'terminated', terminationDate: '2025-02-18', notes: 'x' }).expect(200);

      // Reativar exige motivo, volta a ativo e limpa o encerramento da pessoa.
      await s.as('post', `/hr/employees/${legado.id}/reactivate`).send({}).expect(400);
      await s.as('post', `/hr/employees/${legado.id}/reactivate`).send({ reason: 'Foi engano' }).expect(204);
      expect(await statusOf(s, legado.id)).toMatchObject({ status: 'active', terminatedWithoutTerm: false });
      expect((await s.as('get', `/team/${legado.teamMemberId}`).expect(200)).body.endedOn).toBeNull();
      const { body: log } = await s.as('get', '/audit?action=hr.employee.reactivated').expect(200);
      expect(log[0].data).toMatchObject({ reason: 'Foi engano', previousTerminationDate: '2025-02-18' });
      expect((await s.as('post', `/hr/employees/${legado.id}/reactivate`).send({ reason: 'De novo' }).expect(400)).body.code).toBe('NOT_TERMINATED');

      // Ou rescindir de verdade: gera termo e lançamentos.
      const { body: term } = await terminate(s, legado2.id, '2025-02-18').expect(201);
      expect(await statusOf(s, legado2.id)).toMatchObject({ status: 'terminated', terminatedWithoutTerm: false, termination: { id: term.id } });
      expect((await entriesOf(s, term.id)).length).toBeGreaterThan(0);
    });
  });

  describe('Situação Afastado', () => {
    it('acompanha as datas do afastamento, no cadastro e no filtro', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s);
      const ids = async (status: string) => ((await s.as('get', `/hr/employees?status=${status}`).expect(200)).body as { id: string }[]).map((x) => x.id);

      // Futuro: ainda ativo.
      const { body: future } = await s.as('post', '/hr/leaves').send({ employeeId: a.id, type: 'sick', startOn: daysFromToday(30), endOn: daysFromToday(35) }).expect(201);
      expect((await statusOf(s, a.id)).status).toBe('active');
      expect(await ids('on_leave')).toEqual([]);

      // Cobrindo hoje: afastado, sem mexer em nada mais.
      const { body: now } = await s.as('post', '/hr/leaves').send({ employeeId: a.id, type: 'sick', startOn: daysFromToday(-2), endOn: daysFromToday(2) }).expect(201);
      expect(await statusOf(s, a.id)).toMatchObject({ status: 'on_leave', manualLeave: false, currentLeave: { type: 'sick', endOn: daysFromToday(2) } });
      expect(await ids('on_leave')).toEqual([a.id]);
      expect(await ids('active')).toEqual([]);

      // Excluído: volta a ativo.
      await s.as('delete', `/hr/leaves/${now.id}`).expect(204);
      expect((await statusOf(s, a.id)).status).toBe('active');
      expect(await ids('active')).toEqual([a.id]);
      await s.as('delete', `/hr/leaves/${future.id}`).expect(204);

      // Já terminou: ativo.
      await s.as('post', '/hr/leaves').send({ employeeId: a.id, type: 'sick', startOn: daysFromToday(-20), endOn: daysFromToday(-10) }).expect(201);
      expect((await statusOf(s, a.id)).status).toBe('active');

      // Marcado à mão vale até desmarcar.
      const e = await statusOf(s, a.id);
      await edit(s, a.id, e, { status: 'on_leave' }).expect(200);
      expect(await statusOf(s, a.id)).toMatchObject({ status: 'on_leave', manualLeave: true, currentLeave: null });
      await edit(s, a.id, e, { status: 'active' }).expect(200);
      expect((await statusOf(s, a.id)).status).toBe('active');
    });

    it('afastamento em folha fechada não é excluído', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s);
      const { body: leave } = await s.as('post', '/hr/leaves').send({ employeeId: a.id, type: 'sick', startOn: '2025-11-01', endOn: '2025-11-05' }).expect(201);
      const { body: p } = await s.as('post', '/hr/payrolls').send({ competence: '2025-11' }).expect(201);
      await s.as('post', `/hr/payrolls/${p.id}/close`).expect(200);
      expect((await s.as('delete', `/hr/leaves/${leave.id}`).expect(400)).body.code).toBe('LEAVE_IN_CLOSED_PAYROLL');
      await s.as('post', `/hr/payrolls/${p.id}/reopen`).send({ reason: 'Atestado errado' }).expect(200);
      await s.as('delete', `/hr/leaves/${leave.id}`).expect(204);
    });
  });

  describe('Folha aberta', () => {
    it('aplica salário e dependentes da ficha, mantendo os lançamentos', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s, { name: 'Bia Aumento', salary: 2000 });
      const b = await admit(s, { name: 'Caio Igual', salary: 2000 });
      const { body: p } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10' }).expect(201);
      const itemA = p.items.find((i: { employee: { id: string } }) => i.employee.id === a.id);
      await s.as('patch', `/hr/payrolls/${p.id}/items/${itemA.id}`).send({ daysWorked: 30, overtime50Hours: 0, overtime100Hours: 0, otherEarnings: 100, otherDeductions: 0 }).expect(200);

      expect((await s.as('get', `/hr/payrolls/${p.id}/pending`).expect(200)).body).toEqual({ changes: [], missing: [] });
      const e = await statusOf(s, a.id);
      await edit(s, a.id, e, { salary: 3000, dependents: 2 }).expect(200);
      const { body: pending } = await s.as('get', `/hr/payrolls/${p.id}/pending`).expect(200);
      expect(pending.changes).toEqual([{ itemId: itemA.id, employeeId: a.id, name: 'Bia Aumento', salary: { from: 2000, to: 3000 }, dependents: { from: 0, to: 2 } }]);
      expect(pending.changes.map((c: { employeeId: string }) => c.employeeId)).not.toContain(b.id);

      // Nada muda sozinho.
      expect((await s.as('post', `/hr/payrolls/${p.id}/recalculate`).send({}).expect(200)).body.items.find((i: { id: string }) => i.id === itemA.id).salary).toBe(2000);

      const { body: after } = await s.as('post', `/hr/payrolls/${p.id}/apply-changes`).send({}).expect(200);
      expect(after.items.find((i: { id: string }) => i.id === itemA.id)).toMatchObject({ salary: 3000, otherEarnings: 100, employee: { dependents: 2 } });
      expect((await s.as('get', `/hr/payrolls/${p.id}/pending`).expect(200)).body.changes).toEqual([]);
      const { body: history } = await s.as('get', `/hr/payrolls/${p.id}/history`).expect(200);
      expect(history[0]).toMatchObject({ action: 'hr.payroll.changes_applied', data: { applied: [{ employeeId: a.id, salary: { from: 2000, to: 3000 } }] } });
    });

    it('inclui admitido depois, remove colaborador e recusa os casos errados', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s, { name: 'Ana Antiga' });
      const { body: p } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10' }).expect(201);
      const novo = await admit(s, { name: 'Davi Novo', admissionDate: '2025-10-20', salary: 3000 });
      const depois = await admit(s, { name: 'Eva Depois', admissionDate: '2025-11-03' });

      const { body: pending } = await s.as('get', `/hr/payrolls/${p.id}/pending`).expect(200);
      expect(pending.missing.map((m: { employeeId: string }) => m.employeeId)).toEqual([novo.id]);

      // Admitida depois do mês: fora.
      expect((await s.as('post', `/hr/payrolls/${p.id}/items`).send({ employeeId: depois.id }).expect(400)).body.code).toBe('NOT_ELIGIBLE');
      // Proporcional ao mês: entra com os dias certos.
      const { body: withNew } = await s.as('post', `/hr/payrolls/${p.id}/items`).send({ employeeId: novo.id }).expect(201);
      expect(withNew.items.find((i: { employee: { id: string } }) => i.employee.id === novo.id)).toMatchObject({ daysWorked: 11 });
      await s.as('post', `/hr/payrolls/${p.id}/items`).send({ employeeId: novo.id }).expect(409);

      const item = withNew.items.find((i: { employee: { id: string } }) => i.employee.id === novo.id);
      const { body: without } = await s.as('delete', `/hr/payrolls/${p.id}/items/${item.id}`).expect(200);
      expect(without.items.map((i: { employee: { id: string } }) => i.employee.id)).toEqual([a.id]);
      // Quem saiu aparece de novo em "faltam".
      expect((await s.as('get', `/hr/payrolls/${p.id}/pending`).expect(200)).body.missing.map((m: { employeeId: string }) => m.employeeId)).toEqual([novo.id]);
      // O último não sai: é excluir a folha.
      expect((await s.as('delete', `/hr/payrolls/${p.id}/items/${without.items[0].id}`).expect(400)).body.code).toBe('LAST_ITEM');

      const { body: history } = await s.as('get', `/hr/payrolls/${p.id}/history`).expect(200);
      expect(history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['hr.payroll.item_added', 'hr.payroll.item_removed']));

      // Fechada, nada disso vale.
      await s.as('post', `/hr/payrolls/${p.id}/close`).expect(200);
      expect((await s.as('post', `/hr/payrolls/${p.id}/items`).send({ employeeId: novo.id }).expect(400)).body.code).toBe('PAYROLL_CLOSED');
      expect((await s.as('post', `/hr/payrolls/${p.id}/apply-changes`).send({}).expect(400)).body.code).toBe('PAYROLL_CLOSED');
      expect((await s.as('delete', `/hr/payrolls/${p.id}/items/${without.items[0].id}`).expect(400)).body.code).toBe('PAYROLL_CLOSED');
      expect((await s.as('delete', `/hr/payrolls/${p.id}`).expect(400)).body.code).toBe('PAYROLL_CLOSED');
    });

    it('recusa colaborador de outra empresa', async () => {
      const s = await ownerSession(t, ['hr_consulting']);
      const { body: alfa } = await s.as('post', '/customers').send({ name: 'Alfa Ltda', type: 'company' }).expect(201);
      await admit(s, { name: 'Própria' });
      const deAlfa = await admit(s, { name: 'Da Alfa', employerCustomerId: alfa.id });
      const { body: p } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10' }).expect(201);
      expect((await s.as('post', `/hr/payrolls/${p.id}/items`).send({ employeeId: deAlfa.id }).expect(400)).body.code).toBe('OTHER_EMPLOYER');
    });

    it('exclui folha em aberto, sem rastro no financeiro e com o resumo na auditoria; termination nunca', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s);
      const { body: p } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10' }).expect(201);
      await s.as('delete', `/hr/payrolls/${p.id}`).expect(204);
      await s.as('get', `/hr/payrolls/${p.id}`).expect(404);
      expect((await s.as('get', '/audit?action=hr.payroll.deleted').expect(200)).body[0].data).toMatchObject({ competence: '2025-10', type: 'monthly', employees: ['Ana Colaboradora'] });
      // Dá para abrir de novo.
      await s.as('post', '/hr/payrolls').send({ competence: '2025-10' }).expect(201);

      await terminate(s, a.id).expect(201);
      const { body: list } = await s.as('get', '/hr/payrolls').expect(200);
      const terminations = list.find((x: { type: string }) => x.type === 'termination');
      expect((await s.as('delete', `/hr/payrolls/${terminations.id}`).expect(400)).body.code).toBe('TERMINATION_PAYROLL');
      expect((await s.as('post', `/hr/payrolls/${terminations.id}/reopen`).send({ reason: 'Teste' }).expect(400)).body.code).toBe('TERMINATION_PAYROLL');
    });
  });

  describe('Reabrir folha', () => {
    it('cancela os lançamentos em aberto, exige motivo e lança de novo ao fechar', async () => {
      const s = await ownerSession(t, ['hr']);
      await admit(s);
      const { body: p } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10' }).expect(201);
      await s.as('post', `/hr/payrolls/${p.id}/close`).expect(200);
      const first = await entriesOf(s, p.id);
      expect(first.length).toBeGreaterThan(0);
      expect(first[0]!.sourceLabel).toBe('Folha de pagamento');

      await s.as('post', `/hr/payrolls/${p.id}/reopen`).send({}).expect(400);
      const { body: reopened } = await s.as('post', `/hr/payrolls/${p.id}/reopen`).send({ reason: 'Faltou lançar comissão' }).expect(200);
      expect(reopened).toMatchObject({ status: 'draft', closedAt: null });
      const cancelled = await entriesOf(s, p.id);
      expect(cancelled.map((e) => e.status)).toEqual(first.map(() => 'cancelled'));
      expect((await s.as('post', `/hr/payrolls/${p.id}/reopen`).send({ reason: 'De novo' }).expect(400)).body.code).toBe('PAYROLL_NOT_CLOSED');

      const { body: history } = await s.as('get', `/hr/payrolls/${p.id}/history`).expect(200);
      expect(history[0]).toMatchObject({ action: 'hr.payroll.reopened', data: { reason: 'Faltou lançar comissão', cancelledEntries: first.length } });

      await s.as('post', `/hr/payrolls/${p.id}/close`).expect(200);
      const after = await entriesOf(s, p.id);
      expect(after.filter((e) => e.status === 'pending')).toHaveLength(first.length);
      expect(after.filter((e) => e.status === 'cancelled')).toHaveLength(first.length);
    });

    it('recusa com lançamento pago; estornada a baixa, reabre', async () => {
      const s = await ownerSession(t, ['hr']);
      await admit(s);
      const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
      const { body: p } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10' }).expect(201);
      await s.as('post', `/hr/payrolls/${p.id}/close`).expect(200);
      const [entry] = await entriesOf(s, p.id);
      await s.as('post', `/finance/entries/${entry!.id}/pay`).send({ paidAt: '2025-11-05', accountId: accounts[0].id }).expect(201);

      expect((await s.as('post', `/hr/payrolls/${p.id}/reopen`).send({ reason: 'Erro' }).expect(400)).body.code).toBe('PAYROLL_HAS_PAID_ENTRIES');
      await s.as('post', `/finance/entries/${entry!.id}/reverse`).send({ reason: 'Vamos reabrir a folha' }).expect(200);
      await s.as('post', `/hr/payrolls/${p.id}/reopen`).send({ reason: 'Erro' }).expect(200);
    });

    it('recusa 1ª parcela com 2ª calculada, folha com 13º posterior e rescisão depois do fechamento', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s, { name: 'Ana Fica' });
      const b = await admit(s, { name: 'Bruno Sai' });
      const { body: oct } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10' }).expect(201);
      await s.as('post', `/hr/payrolls/${oct.id}/close`).expect(200);

      const { body: first } = await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 1 }).expect(201);
      expect((await s.as('post', `/hr/payrolls/${oct.id}/reopen`).send({ reason: 'Erro' }).expect(400)).body.code).toBe('LATER_THIRTEENTH');
      await s.as('post', `/hr/payrolls/${first.id}/close`).expect(200);
      const { body: second } = await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 2 }).expect(201);
      expect((await s.as('post', `/hr/payrolls/${first.id}/reopen`).send({ reason: 'Erro' }).expect(400)).body.code).toBe('LATER_PAYROLL');
      // Excluída a 2ª em rascunho, a 1ª reabre.
      await s.as('delete', `/hr/payrolls/${second.id}`).expect(204);
      await s.as('post', `/hr/payrolls/${first.id}/reopen`).send({ reason: 'Erro nos avos' }).expect(200);
      await s.as('delete', `/hr/payrolls/${first.id}`).expect(204);

      // Rescisão depois do fechamento usou os valores da folha.
      await terminate(s, b.id, '2025-10-20').expect(201);
      expect((await s.as('post', `/hr/payrolls/${oct.id}/reopen`).send({ reason: 'Erro' }).expect(400)).body.code).toBe('TERMINATION_AFTER_CLOSE');
      await s.as('post', `/hr/employees/${b.id}/termination/undo`).send({ reason: 'Desistiu' }).expect(200);
      await s.as('post', `/hr/payrolls/${oct.id}/reopen`).send({ reason: 'Agora sim' }).expect(200);
      expect(a.id).toBeTruthy();
    });
  });

  describe('Desfazer rescisão', () => {
    it('guarda o termo, cancela lançamentos, volta a ativo e permite rescindir de novo', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s);
      const { body: term } = await terminate(s, a.id).expect(201);
      const before = await entriesOf(s, term.id);
      expect(before.length).toBeGreaterThan(0);
      expect((await s.as('get', `/team/${a.teamMemberId}`).expect(200)).body.endedOn).toBe('2025-06-15');

      await s.as('post', `/hr/employees/${a.id}/termination/undo`).send({}).expect(400);
      const { body: undone } = await s.as('post', `/hr/employees/${a.id}/termination/undo`).send({ reason: 'Rescisão lançada no colaborador errado' }).expect(200);
      expect(undone).toMatchObject({ terminationId: term.id, cancelledEntries: before.length });

      expect(await statusOf(s, a.id)).toMatchObject({ status: 'active', termination: null, cancelledTerminations: [{ reason: 'Rescisão lançada no colaborador errado' }] });
      expect((await entriesOf(s, term.id)).every((e) => e.status === 'cancelled')).toBe(true);
      expect((await s.as('get', `/team/${a.teamMemberId}`).expect(200)).body.endedOn).toBeNull();
      await s.as('get', `/hr/employees/${a.id}/termination`).expect(404);
      // A folha de rescisões vazia sai da lista.
      expect((await s.as('get', '/hr/payrolls').expect(200)).body.some((p: { type: string }) => p.type === 'termination')).toBe(false);
      const { body: log } = await s.as('get', '/audit?action=hr.termination.undone').expect(200);
      expect(log[0].data).toMatchObject({ terminationId: term.id, reason: 'Rescisão lançada no colaborador errado' });
      expect((await s.as('post', `/hr/employees/${a.id}/termination/undo`).send({ reason: 'De novo' }).expect(404)).body.code).toBe('TERMINATION_NOT_FOUND');

      // Rescinde de novo, na mesma competência.
      const { body: again } = await terminate(s, a.id).expect(201);
      expect(again.id).not.toBe(term.id);
      expect(await statusOf(s, a.id)).toMatchObject({ status: 'terminated', termination: { id: again.id } });
    });

    it('recusa com pagamento registrado e com folha fechada sem o colaborador', async () => {
      const s = await ownerSession(t, ['hr']);
      const a = await admit(s, { name: 'Ana Sai' });
      await admit(s, { name: 'Bruno Fica' });
      const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
      const { body: term } = await terminate(s, a.id, '2025-06-15').expect(201);
      const [entry] = await entriesOf(s, term.id);
      await s.as('post', `/finance/entries/${entry!.id}/pay`).send({ paidAt: '2025-06-20', accountId: accounts[0].id }).expect(201);
      expect((await s.as('post', `/hr/employees/${a.id}/termination/undo`).send({ reason: 'Erro' }).expect(400)).body.code).toBe('TERMINATION_HAS_PAID_ENTRIES');
      await s.as('post', `/finance/entries/${entry!.id}/reverse`).send({ reason: 'Devolvido' }).expect(200);

      // Junho fechou depois, sem ela: a rescisão não desfaz até reabrir junho.
      const { body: june } = await s.as('post', '/hr/payrolls').send({ competence: '2025-06' }).expect(201);
      expect(june.items.map((i: { employee: { name: string } }) => i.employee.name)).toEqual(['Bruno Fica']);
      await s.as('post', `/hr/payrolls/${june.id}/close`).expect(200);
      expect((await s.as('post', `/hr/employees/${a.id}/termination/undo`).send({ reason: 'Erro' }).expect(400)).body.code).toBe('LATER_PAYROLL_CLOSED');

      await s.as('post', `/hr/payrolls/${june.id}/reopen`).send({ reason: 'Vai entrar a Ana' }).expect(200);
      await s.as('post', `/hr/employees/${a.id}/termination/undo`).send({ reason: 'Erro' }).expect(200);
      // Volta como pendente de inclusão na folha aberta.
      expect((await s.as('get', `/hr/payrolls/${june.id}/pending`).expect(200)).body.missing.map((m: { employeeId: string }) => m.employeeId)).toEqual([a.id]);
    });
  });

  describe('Consultoria de RH', () => {
    const company = async (s: Session, name: string) => (await s.as('post', '/customers').send({ name, type: 'company' }).expect(201)).body as { id: string };

    it('honorário: corrige e cancela em aberto, recusa pago, com rastro', async () => {
      const s = await ownerSession(t, ['hr_consulting']);
      const alfa = await company(s, 'Alfa Ltda');
      await s.as('put', `/hr-consulting/clients/${alfa.id}`).send({ feeMode: 'fixed', feeAmount: 900, feeDueDay: 10 }).expect(200);
      await admit(s, { employerCustomerId: alfa.id });
      const { body: oct } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10', employerCustomerId: alfa.id }).expect(201);
      await s.as('post', `/hr/payrolls/${oct.id}/close`).expect(200);

      const fees = async () => (await s.as('get', `/hr-consulting/clients/${alfa.id}/fee-entries`).expect(200)).body as { id: string; status: string; amount: number; dueDate: string }[];
      const [fee] = await fees();
      expect(fee).toMatchObject({ amount: 900, status: 'pending', dueDate: '2025-11-10' });

      // Sem motivo ou sem nada para mudar: recusado.
      await s.as('patch', `/hr-consulting/fee-entries/${fee!.id}`).send({ amount: 800 }).expect(400);
      await s.as('patch', `/hr-consulting/fee-entries/${fee!.id}`).send({ reason: 'Sem campo' }).expect(400);

      const { body: corrected } = await s.as('patch', `/hr-consulting/fee-entries/${fee!.id}`).send({ amount: 750, dueDate: '2025-11-20', reason: 'Desconto combinado' }).expect(200);
      expect(corrected).toMatchObject({ amount: 750, dueDate: '2025-11-20' });
      const { body: history } = await s.as('get', `/finance/entries/${fee!.id}/history`).expect(200);
      expect(history[0]).toMatchObject({ action: 'hr_consulting.fee.corrected', data: { reason: 'Desconto combinado', from: { amount: 900 }, to: { amount: 750 } } });

      // Honorário não é lançamento de outro ramo: a rota só aceita a origem dela.
      const { body: manual } = await s.as('post', '/finance/entries').send({ kind: 'income', description: 'Manual', amount: 10, status: 'pending', dueDate: '2026-01-01' }).expect(201);
      await s.as('patch', `/hr-consulting/fee-entries/${manual.id}`).send({ amount: 5, reason: 'Tentativa' }).expect(404);
      await s.as('post', `/hr-consulting/fee-entries/${manual.id}/cancel`).send({ reason: 'Tentativa' }).expect(404);

      // Pago: recusa até estornar.
      const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
      await s.as('post', `/finance/entries/${fee!.id}/pay`).send({ paidAt: '2025-11-20', accountId: accounts[0].id }).expect(201);
      expect((await s.as('patch', `/hr-consulting/fee-entries/${fee!.id}`).send({ amount: 700, reason: 'Outra' }).expect(400)).body.code).toBe('ENTRY_PAID');
      expect((await s.as('post', `/hr-consulting/fee-entries/${fee!.id}/cancel`).send({ reason: 'Outra' }).expect(400)).body.code).toBe('ENTRY_PAID');
      await s.as('post', `/finance/entries/${fee!.id}/reverse`).send({ reason: 'Recebido por engano' }).expect(200);

      // Cancelado fica na lista, marcado.
      await s.as('post', `/hr-consulting/fee-entries/${fee!.id}/cancel`).send({}).expect(400);
      await s.as('post', `/hr-consulting/fee-entries/${fee!.id}/cancel`).send({ reason: 'Folha já cobrada por fora' }).expect(204);
      expect((await fees())[0]).toMatchObject({ id: fee!.id, status: 'cancelled' });
      expect((await s.as('post', `/hr-consulting/fee-entries/${fee!.id}/cancel`).send({ reason: 'De novo' }).expect(400)).body.code).toBe('ENTRY_CANCELLED');
    });

    it('reabrir folha e desfazer rescisão de empresa: honorário cai junto; recebido, recusa', async () => {
      const s = await ownerSession(t, ['hr_consulting']);
      const alfa = await company(s, 'Beta Ltda');
      await s.as('put', `/hr-consulting/clients/${alfa.id}`).send({ feeMode: 'fixed', feeAmount: 900, terminationFee: 150 }).expect(200);
      const a = await admit(s, { employerCustomerId: alfa.id });
      await admit(s, { name: 'Outro Colaborador', employerCustomerId: alfa.id });
      const { body: accounts } = await s.as('get', '/finance/accounts').expect(200);
      const { body: oct } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10', employerCustomerId: alfa.id }).expect(201);
      await s.as('post', `/hr/payrolls/${oct.id}/close`).expect(200);
      const [fee] = await entriesOf(s, oct.id);

      await s.as('post', `/finance/entries/${fee!.id}/pay`).send({ paidAt: '2025-11-10', accountId: accounts[0].id }).expect(201);
      expect((await s.as('post', `/hr/payrolls/${oct.id}/reopen`).send({ reason: 'Erro' }).expect(400)).body.code).toBe('FEE_PAID');
      await s.as('post', `/finance/entries/${fee!.id}/reverse`).send({ reason: 'Devolvido' }).expect(200);
      await s.as('post', `/hr/payrolls/${oct.id}/reopen`).send({ reason: 'Erro de horas' }).expect(200);
      expect((await entriesOf(s, oct.id)).map((e) => e.status)).toEqual(['cancelled']);
      await s.as('post', `/hr/payrolls/${oct.id}/close`).expect(200);
      expect((await entriesOf(s, oct.id)).map((e) => e.status).sort()).toEqual(['cancelled', 'pending']);

      const { body: term } = await terminate(s, a.id, '2025-11-10').expect(201);
      const [termFee] = await entriesOf(s, term.id);
      expect(termFee).toMatchObject({ amount: 150, status: 'pending' });
      await s.as('post', `/hr/employees/${a.id}/termination/undo`).send({ reason: 'Colaborador ficou' }).expect(200);
      expect((await entriesOf(s, term.id)).map((e) => e.status)).toEqual(['cancelled']);
    });

    it('Analista de DP vê os honorários sem acesso ao financeiro e não corrige', async () => {
      const s = await ownerSession(t, ['hr_consulting']);
      const alfa = await company(s, 'Gama Ltda');
      await s.as('put', `/hr-consulting/clients/${alfa.id}`).send({ feeMode: 'fixed', feeAmount: 500 }).expect(200);
      await admit(s, { employerCustomerId: alfa.id });
      const { body: oct } = await s.as('post', '/hr/payrolls').send({ competence: '2025-10', employerCustomerId: alfa.id }).expect(201);
      await s.as('post', `/hr/payrolls/${oct.id}/close`).expect(200);
      const [fee] = await entriesOf(s, oct.id);

      const { body: roles } = await s.as('get', '/access/roles').expect(200);
      const email = uniqueEmail('analista');
      const { body: invited } = await s.as('post', '/users/invite').send({ email, name: 'Analista', roleIds: [roles.find((r: { key: string }) => r.key === 'hr.analyst').id] }).expect(201);
      const { body: link } = await s.as('post', `/users/${invited.membershipId}/invite-link`).expect(200);
      await t.http().post('/api/auth/set-password').send({ token: new URL(link.url).searchParams.get('token'), password: PASSWORD });
      const analyst = await login(t, email);

      await t.http().get('/api/finance/entries').set(auth(analyst.token)).expect(403);
      const { body: list } = await t.http().get(`/api/hr-consulting/clients/${alfa.id}/fee-entries`).set(auth(analyst.token)).expect(200);
      expect(list.map((e: { id: string }) => e.id)).toEqual([fee!.id]);
      await t.http().patch(`/api/hr-consulting/fee-entries/${fee!.id}`).set(auth(analyst.token)).send({ amount: 1, reason: 'Tentativa' }).expect(403);
      await t.http().post(`/api/hr-consulting/fee-entries/${fee!.id}/cancel`).set(auth(analyst.token)).send({ reason: 'Tentativa' }).expect(403);
    });
  });

  describe('Head hunter', () => {
    it('a contratação devolve a empresa da vaga como empregador; há papel padrão com a permissão de privacidade', async () => {
      const s = await ownerSession(t, ['hr_consulting', 'recruiting']);
      const { body: alfa } = await s.as('post', '/customers').send({ name: 'Alfa Vagas Ltda', type: 'company' }).expect(201);
      const { body: job } = await s.as('post', '/recruiting/jobs').send({ title: 'Analista financeiro', description: 'Rotina de contas a pagar e receber.', requirements: ['Excel avançado'], customerId: alfa.id }).expect(201);
      await s.as('post', `/recruiting/jobs/${job.id}/status`).send({ status: 'open' }).expect(200);
      const { body: candidate } = await s.as('post', '/recruiting/candidates').send({ name: 'Carla Candidata', email: uniqueEmail('carla') }).expect(201);
      const { body: application } = await s.as('post', '/recruiting/applications').send({ candidateId: candidate.id, jobId: job.id, analysis: 'heuristic' }).expect(201);
      const { body: detail } = await s.as('get', `/recruiting/applications/${application.id}`).expect(200);
      expect(detail.job.customerId).toBe(alfa.id);
      const hiredStage = detail.job.stages.find((st: { kind: string }) => st.kind === 'hired');
      await s.as('post', `/recruiting/applications/${application.id}/move`).send({ stageId: hiredStage.id }).expect(200);
      const { body: hired } = await s.as('post', `/recruiting/applications/${application.id}/hire`).send({}).expect(200);
      expect(hired).toMatchObject({ created: true, hrActive: true, employerCustomerId: alfa.id });
      // Repetir devolve o mesmo empregador.
      expect((await s.as('post', `/recruiting/applications/${application.id}/hire`).send({}).expect(200)).body).toMatchObject({ created: false, employerCustomerId: alfa.id });

      const { body: roles } = await s.as('get', '/access/roles').expect(200);
      const manager = roles.find((r: { key: string }) => r.key === 'recruiting.manager');
      expect(manager.permissions).toContain('recruiting.candidates.privacy');
      expect(roles.find((r: { key: string }) => r.key === 'recruiting.recruiter').permissions).not.toContain('recruiting.candidates.privacy');
    });
  });
});
