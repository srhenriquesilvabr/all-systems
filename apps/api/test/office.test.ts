import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ownerSession, type TestApp } from './helpers';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

describe('contabilidade e RH', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  describe('escritório de contabilidade', () => {
    it('a carteira gera o calendário pelo regime, avisa o responsável e lança os honorários uma vez', async () => {
      const s = await ownerSession(t, ['accounting']);
      const { body: team } = await s.as('get', '/users/team').expect(200);
      const company = async (name: string) => (await s.as('post', '/customers').send({ name, type: 'company' }).expect(201)).body as { id: string };
      const padaria = await company('Padaria Exemplo ME');
      const industria = await company('Indústria Exemplo Ltda');
      await s.as('post', '/accounting/clients').send({ customerId: padaria.id, taxRegime: 'simples', hasEmployees: false, monthlyFee: 450, feeDueDay: 10, responsibleUserId: team[0].id }).expect(201);
      await s.as('post', '/accounting/clients').send({ customerId: industria.id, taxRegime: 'presumido', hasEmployees: true, monthlyFee: 1800 }).expect(201);
      await s.as('post', '/accounting/clients').send({ customerId: padaria.id, taxRegime: 'mei' }).expect(409);

      const { body: all } = await s.as('get', '/accounting/obligations').expect(200);
      const codesOf = (name: string) => [...new Set(all.filter((o: { client: { name: string } }) => o.client.name === name).map((o: { type: { code: string } }) => o.type.code))].sort();
      expect(codesOf('Padaria Exemplo ME')).toEqual(['DAS', 'DEFIS']);
      expect(codesOf('Indústria Exemplo Ltda')).toEqual(['DCTFWEB', 'ECD', 'ECF', 'ESOCIAL', 'FGTS', 'IRPJCSLL', 'ISS', 'PISCOFINS', 'REINF']);

      // Gerar de novo não duplica.
      const { body: again } = await s.as('post', '/accounting/generate').expect(200);
      expect(again.obligations).toBe(0);
      expect(again.fees).toBe(2);
      expect((await s.as('post', '/accounting/generate').expect(200)).body.fees).toBe(0);
      const { body: entries } = await s.as('get', `/finance/entries?limit=50&customerId=${padaria.id}`).expect(200);
      expect(entries.items).toEqual([expect.objectContaining({ amount: 450, dueDate: `${localToday().slice(0, 7)}-10` })]);

      const das = all.find((o: { type: { code: string }; competence: string }) => o.type.code === 'DAS');
      await s.as('post', `/accounting/obligations/${das.id}/status`).send({ status: 'done' }).expect(204);
      const { body: done } = await s.as('get', `/accounting/obligations?status=done`).expect(200);
      expect(done).toEqual([expect.objectContaining({ id: das.id, doneBy: expect.any(String) })]);

      const before = t.mails.length;
      await t.jobs.runOnce('accounting.daily');
      await new Promise((r) => setTimeout(r, 50));
      const alerts = t.mails.slice(before).filter((m) => m.to === s.email);
      // Se houver algo vencendo em até 3 dias, vem num e-mail só com a lista.
      expect(alerts.length).toBeLessThanOrEqual(1);
    });
  });

  describe('RH e departamento pessoal', () => {
    it('folha: proporcional na admissão, INSS/IRRF pelas tabelas, horas extras e fechamento no financeiro', async () => {
      const s = await ownerSession(t, ['hr']);
      const competence = localToday().slice(0, 7);
      const admit = (body: Record<string, unknown>) => s.as('post', '/hr/employees').send({ position: 'Auxiliar', admissionDate: '2024-01-15', ...body }).expect(201);
      await admit({ name: 'Ana Analista', cpf: '111.444.777-35', salary: 6000, dependents: 0 });
      await admit({ name: 'Bruno Auxiliar', cpf: '22233344405', salary: 2200, weeklyHours: 44 });
      await admit({ name: 'Carla Nova', cpf: '33344455506', salary: 3000, admissionDate: `${competence}-16` });
      await s.as('post', '/hr/employees').send({ name: 'Duplicada', cpf: '11144477735', position: 'Auxiliar', admissionDate: '2024-01-01', salary: 1000 }).expect(409);

      const { body: payroll } = await s.as('post', '/hr/payrolls').send({ competence }).expect(201);
      await s.as('post', '/hr/payrolls').send({ competence }).expect(409);
      const item = (name: string) => payroll.items.find((i: { employee: { name: string } }) => i.employee.name === name);
      expect(item('Ana Analista')).toMatchObject({ gross: 6000, inss: 649.6, irrf: 382.88 });
      expect(item('Carla Nova')).toMatchObject({ daysWorked: 15, baseSalary: 1500 });

      const bruno = item('Bruno Auxiliar');
      const { body: updated } = await s
        .as('patch', `/hr/payrolls/${payroll.id}/items/${bruno.id}`)
        .send({ daysWorked: 30, overtime50Hours: 10, overtime100Hours: 0, otherEarnings: 0, otherDeductions: 132 })
        .expect(200);
      const b2 = updated.items.find((i: { id: string }) => i.id === bruno.id);
      expect(b2).toMatchObject({ overtime: 150, gross: 2350, otherDeductions: 132, fgts: 188 });

      const { body: closed } = await s.as('post', `/hr/payrolls/${payroll.id}/close`).expect(200);
      expect(closed.status).toBe('closed');
      await s.as('patch', `/hr/payrolls/${payroll.id}/items/${bruno.id}`).send({ daysWorked: 30, overtime50Hours: 0, overtime100Hours: 0, otherEarnings: 0, otherDeductions: 0 }).expect(400);
      const { body: entries } = await s.as('get', '/finance/entries?limit=50&kind=expense').expect(200);
      const mine = entries.items.filter((e: { sourceId: string }) => e.sourceId === payroll.id);
      expect(mine.map((e: { amount: number }) => e.amount).sort((a: number, b: number) => a - b)).toEqual(
        [closed.totals.fgts, Math.round((closed.totals.inss + closed.totals.irrf) * 100) / 100, closed.totals.net].sort((a, b) => a - b),
      );
    });

    it('férias: saldo por período aquisitivo, mínimo de 5 dias, abono e pagamento antecipado', async () => {
      const s = await ownerSession(t, ['hr']);
      const { body: emp } = await s.as('post', '/hr/employees').send({ name: 'Diego Férias', cpf: '44455566607', position: 'Vendedor', admissionDate: '2024-02-01', salary: 3000 }).expect(201);
      const { body: e } = await s.as('get', `/hr/employees/${emp.id}`).expect(200);
      expect(e.periods[0]).toMatchObject({ start: '2024-02-01', end: '2025-01-31', earned: true, balance: 30 });
      const start = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
      const book = (body: Record<string, unknown>) => s.as('post', '/hr/vacations').send({ employeeId: emp.id, periodStart: '2024-02-01', startOn: start, ...body });
      await book({ days: 4 }).expect(400);
      await book({ days: 25, soldDays: 10 }).expect(400);
      const { body: v } = await book({ days: 20, soldDays: 10 }).expect(201);
      expect(v.pay).toEqual({ vacation: 2666.67, allowance: 1333.33 });
      const { body: after } = await s.as('get', `/hr/employees/${emp.id}`).expect(200);
      expect(after.periods[0].balance).toBe(0);
      const { body: entries } = await s.as('get', '/finance/entries?limit=50&kind=expense').expect(200);
      expect(entries.items.filter((x: { sourceId: string }) => x.sourceId === v.id)).toEqual([expect.objectContaining({ amount: 4000, dueDate: v.payBy })]);
      await s.as('post', `/hr/vacations/${v.id}/cancel`).expect(204);
      expect((await s.as('get', `/hr/employees/${emp.id}`).expect(200)).body.periods[0].balance).toBe(30);
    });
  });
});
