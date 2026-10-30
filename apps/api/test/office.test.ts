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
      // Depois do dia 10, o honorário fica para o dia 10 do mês seguinte, para não nascer vencido.
      const [year, month, dayOfMonth] = localToday().split('-').map(Number) as [number, number, number];
      const feeMonth = dayOfMonth <= 10 ? localToday().slice(0, 7) : month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
      expect(entries.items).toEqual([expect.objectContaining({ amount: 450, dueDate: `${feeMonth}-10` })]);

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
    // Os valores destes testes foram conferidos à mão com o INSS de 2025: a empresa usa essa tabela.
    const inss2025 = [
      { upTo: 1518.0, rate: 0.075 },
      { upTo: 2793.88, rate: 0.09 },
      { upTo: 4190.83, rate: 0.12 },
      { upTo: 8157.41, rate: 0.14 },
    ];
    const hrSession = async () => {
      const s = await ownerSession(t, ['hr']);
      const { body } = await s.as('get', '/modules/hr/settings').expect(200);
      await s.as('put', '/modules/hr/settings').send({ ...body, tables: { ...body.tables, inss: inss2025 } }).expect(204);
      return s;
    };

    it('a folha aberta troca para as tabelas atuais só quando pedido', async () => {
      const s = await ownerSession(t, ['hr']);
      const competence = '2026-10';
      await s.as('post', '/hr/employees').send({ name: 'Tabela Teste', cpf: '111.444.777-35', position: 'Auxiliar', admissionDate: '2024-01-15', salary: 9000 }).expect(201);
      const { body: settings } = await s.as('get', '/modules/hr/settings').expect(200);
      expect(settings.tables.inss.at(-1).upTo).toBe(8475.55);

      await s.as('put', '/modules/hr/settings').send({ ...settings, tables: { ...settings.tables, label: 'Antiga', inss: inss2025 } }).expect(204);
      const { body: payroll } = await s.as('post', '/hr/payrolls').send({ competence }).expect(201);
      const teto = (p: { items: { inss: number }[] }) => p.items[0]!.inss;
      const antigo = teto(payroll);
      expect(payroll.tablesLabel).toBe('Antiga');

      await s.as('put', '/modules/hr/settings').send(settings).expect(204);
      const mantida = await s.as('post', `/hr/payrolls/${payroll.id}/recalculate`).send({}).expect(200);
      expect(teto(mantida.body)).toBe(antigo);

      const nova = await s.as('post', `/hr/payrolls/${payroll.id}/recalculate`).send({ useCurrentTables: true }).expect(200);
      expect(teto(nova.body)).toBe(988.09);
      expect(nova.body.tablesLabel).toContain('INSS 2026');
    });

    it('folha: proporcional na admissão, INSS/IRRF pelas tabelas, horas extras e fechamento no financeiro', async () => {
      const s = await hrSession();
      const competence = localToday().slice(0, 7);
      const admit = (body: Record<string, unknown>) => s.as('post', '/hr/employees').send({ position: 'Auxiliar', admissionDate: '2024-01-15', ...body }).expect(201);
      await admit({ name: 'Ana Analista', cpf: '111.444.777-35', salary: 6000, dependents: 0 });
      await admit({ name: 'Bruno Auxiliar', cpf: '22233344405', salary: 2200, weeklyHours: 44 });
      await admit({ name: 'Carla Nova', cpf: '33344455508', salary: 3000, admissionDate: `${competence}-16` });
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
      // Hora extra + DSR sobre ela: 150 ÷ dias úteis × domingos (competência variável, sem feriados informados).
      const dsr = Math.round((150 / payroll.calendar.workingDays) * payroll.calendar.restDays * 100) / 100;
      expect(b2).toMatchObject({ overtime: 150, dsr, gross: Math.round((2350 + dsr) * 100) / 100, otherDeductions: 132, fgts: Math.round((2350 + dsr) * 8) / 100 });

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
      const { body: emp } = await s.as('post', '/hr/employees').send({ name: 'Diego Férias', cpf: '44455566619', position: 'Vendedor', admissionDate: '2024-02-01', salary: 3000 }).expect(201);
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

    // Tabelas padrão: INSS 7,5% até 1.518; 9% até 2.793,88; 12% até 4.190,83 (1.518 × 7,5% = 113,85).
    // Bases de IRRF abaixo de 2.428,80 (isenção) em todos os casos: IRRF 0 com ou sem a redução da Lei 15.270.
    type Row = { employee: { name: string } };
    const byName = <T extends Row>(items: T[], name: string) => items.find((i) => i.employee.name === name)!;
    const expensesOf = async (s: Awaited<ReturnType<typeof ownerSession>>, sourceId: string) => {
      const { body } = await s.as('get', '/finance/entries?limit=100&kind=expense').expect(200);
      return (body.items as { sourceId: string; amount: number; dueDate: string }[])
        .filter((e) => e.sourceId === sourceId)
        .map((e) => [e.amount, e.dueDate])
        .sort((a, b) => Number(a[0]) - Number(b[0]));
    };

    it('13º: 1ª e 2ª parcelas, ano inteiro e admitido no meio do ano (avos)', async () => {
      const s = await hrSession();
      const admit = (body: Record<string, unknown>) => s.as('post', '/hr/employees').send({ position: 'Auxiliar', ...body }).expect(201);
      await admit({ name: 'Eva Integral', cpf: '55566677720', salary: 3000, admissionDate: '2024-01-15' });
      // Admitida em 10/04/2025: abril tem 21 dias trabalhados (≥ 15) e conta; abril a dezembro = 9 avos.
      await admit({ name: 'Fábio Meio-Ano', cpf: '66677788830', salary: 2400, admissionDate: '2025-04-10' });

      const { body: first } = await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 1 }).expect(201);
      expect(first).toMatchObject({ type: 'thirteenth_1', competence: '2025-11', status: 'draft' });
      await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 1 }).expect(409);
      // 2ª parcela só depois de fechar a 1ª.
      await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 2 }).expect(400);
      // Eva: 3.000 ÷ 12 × 12 ÷ 2 = 1.500, sem INSS/IRRF; FGTS 8% = 120.
      expect(byName(first.items, 'Eva Integral')).toMatchObject({ avos: 12, gross: 1500, inss: 0, irrf: 0, net: 1500, fgts: 120 });
      // Fábio: 2.400 ÷ 12 = 200 × 9 = 1.800 ÷ 2 = 900; FGTS 72.
      expect(byName(first.items, 'Fábio Meio-Ano')).toMatchObject({ avos: 9, gross: 900, inss: 0, irrf: 0, net: 900, fgts: 72 });
      expect(first.totals).toMatchObject({ gross: 2400, net: 2400, fgts: 192 });
      await s.as('post', `/hr/payrolls/${first.id}/close`).expect(200);
      // Líquido até 30/11; FGTS da 1ª parcela no dia 20 do mês seguinte.
      expect(await expensesOf(s, first.id)).toEqual([
        [192, '2025-12-20'],
        [2400, '2025-11-30'],
      ]);

      const { body: second } = await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 2 }).expect(201);
      expect(second).toMatchObject({ type: 'thirteenth_2', competence: '2025-12' });
      // Eva: 13º integral 3.000; INSS em separado = 113,85 + 1.275,88 × 9% (114,83) + 206,12 × 12% (24,73) = 253,41;
      // IRRF: 3.000 − 607,20 (simplificado) = 2.392,80 → isento; líquido 3.000 − 253,41 − 1.500 = 1.246,59; FGTS 8% × 1.500 = 120.
      expect(byName(second.items, 'Eva Integral')).toMatchObject({ avos: 12, gross: 3000, inss: 253.41, irrf: 0, advance: 1500, net: 1246.59, fgts: 120 });
      // Fábio: 200 × 9 = 1.800; INSS 113,85 + 282 × 9% (25,38) = 139,23; líquido 1.800 − 139,23 − 900 = 760,77; FGTS 8% × 900 = 72.
      expect(byName(second.items, 'Fábio Meio-Ano')).toMatchObject({ avos: 9, gross: 1800, inss: 139.23, irrf: 0, advance: 900, net: 760.77, fgts: 72 });
      await s.as('post', `/hr/payrolls/${second.id}/close`).expect(200);
      // Líquido (1.246,59 + 760,77) e INSS do 13º (253,41 + 139,23) em 20/12; FGTS em 20/01; IRRF zero não é lançado.
      expect(await expensesOf(s, second.id)).toEqual([
        [192, '2026-01-20'],
        [392.64, '2025-12-20'],
        [2007.36, '2025-12-20'],
      ]);
    });

    it('rescisão sem justa causa com aviso indenizado proporcional e pedido de demissão', async () => {
      const s = await hrSession();
      const { body: gil } = await s.as('post', '/hr/employees').send({ name: 'Gil Rescisão', cpf: '77788899941', position: 'Auxiliar', admissionDate: '2024-03-01', salary: 3000 }).expect(201);
      const sem = { type: 'without_cause', terminationDate: '2025-06-15', notice: 'indemnified', fgtsBalance: 4000 };
      const { body: preview } = await s.as('post', `/hr/employees/${gil.id}/termination/preview`).send(sem).expect(200);
      // 1 ano completo → aviso de 30 + 3 = 33 dias; projeção: 15/06 + 33 dias = 18/07/2025.
      expect(preview).toMatchObject({ id: null, yearsOfService: 1, noticeDays: 33, noticeDaysIndemnified: 33, projectedEnd: '2025-07-18', thirteenthAvos: 7, vacationAvos: 5 });
      const amounts = (lines: { code: string; amount: number }[]) => Object.fromEntries(lines.map((l) => [l.code, l.amount]));
      expect(amounts(preview.lines)).toEqual({
        '50': 1500, // saldo: 3.000 ÷ 30 × 15 dias
        '69': 3300, // aviso indenizado: 100 × 33
        '63': 1750, // 13º: jan–jun + jul (18 dias projetados ≥ 15) = 7/12 → 250 × 7
        '66': 3000, // férias vencidas do período 01/03/2024–28/02/2025 (no prazo, simples)
        '65': 1250, // proporcionais: mar–jun (4 meses) + 18 dias de julho (> 14) = 5/12 → 250 × 5
        '68': 1416.67, // 1/3 de (3.000 + 1.250)
        '112.1': 112.5, // INSS do saldo: 1.500 × 7,5% (aviso indenizado e férias indenizadas não têm INSS)
        '112.2': 134.73, // INSS do 13º em separado: 113,85 + 232 × 9% (20,88)
      });
      // Proventos 12.216,67 − descontos 247,23 = 11.969,44; FGTS 8% × (1.500 + 3.300 + 1.750) = 524;
      // multa 40% × (4.000 + 524) = 1.809,60; pagamento em até 10 dias (25/06).
      expect(preview).toMatchObject({ earnings: 12216.67, deductions: 247.23, net: 11969.44, payBy: '2025-06-25' });
      expect(preview.fgts).toMatchObject({ deposit: 524, balance: 4000, balanceSource: 'informed', fineRate: 0.4, fine: 1809.6, total: 2333.6 });
      expect((await s.as('get', `/hr/employees/${gil.id}`).expect(200)).body).toMatchObject({ status: 'active', termination: null });

      const { body: done } = await s.as('post', `/hr/employees/${gil.id}/termination`).send(sem).expect(201);
      expect(done).toMatchObject({ net: 11969.44, employee: { name: 'Gil Rescisão' } });
      await s.as('post', `/hr/employees/${gil.id}/termination`).send(sem).expect(409);
      expect((await s.as('get', `/hr/employees/${gil.id}`).expect(200)).body).toMatchObject({
        status: 'terminated',
        terminationDate: '2025-06-15',
        termination: { id: done.id, type: 'without_cause' },
      });
      expect((await s.as('get', `/hr/employees/${gil.id}/termination`).expect(200)).body).toMatchObject({ id: done.id, net: 11969.44 });
      // Líquido e guia do FGTS (depósito + multa) em 10 dias; INSS (112,50 + 134,73) no dia 20 do mês seguinte.
      expect(await expensesOf(s, done.id)).toEqual([
        [247.23, '2025-07-20'],
        [2333.6, '2025-06-25'],
        [11969.44, '2025-06-25'],
      ]);
      const { body: list } = await s.as('get', '/hr/payrolls').expect(200);
      expect(list).toEqual([expect.objectContaining({ type: 'termination', competence: '2025-06', totals: expect.objectContaining({ net: 11969.44, employees: 1 }) })]);

      // Pedido de demissão com aviso trabalhado: sem aviso indenizado nem multa do FGTS.
      const { body: helena } = await s.as('post', '/hr/employees').send({ name: 'Helena Pede', cpf: '88899900078', position: 'Auxiliar', admissionDate: '2024-08-01', salary: 2400 }).expect(201);
      const pede = { type: 'resignation', terminationDate: '2025-06-20', notice: 'worked', fgtsBalance: 1000 };
      await s.as('post', `/hr/employees/${helena.id}/termination/preview`).send({ ...pede, notice: 'indemnified' }).expect(400);
      const { body: hp } = await s.as('post', `/hr/employees/${helena.id}/termination/preview`).send(pede).expect(200);
      expect(amounts(hp.lines)).toEqual({
        '50': 1600, // saldo: 80 × 20 dias
        '63': 1200, // 13º: jan–jun (20 dias em junho) = 6/12 → 200 × 6
        '65': 2200, // férias proporcionais: 01/08/2024 a 20/06/2025 = 10 meses + 20 dias = 11/12 → 200 × 11
        '68': 733.33, // 1/3 de 2.200
        '112.1': 121.23, // INSS: 113,85 + 82 × 9% (7,38)
        '112.2': 90, // INSS do 13º: 1.200 × 7,5%
      });
      expect(hp).toMatchObject({ noticeDaysIndemnified: 0, projectedEnd: '2025-06-20', earnings: 5733.33, deductions: 211.23, net: 5522.1 });
      expect(hp.fgts).toMatchObject({ deposit: 224, fineRate: 0, fine: 0, total: 224 }); // 8% × (1.600 + 1.200)
      // Sem cumprir o aviso, a empresa desconta 30 dias de salário (art. 487 §2º): 5.522,10 − 2.400.
      const { body: hd } = await s.as('post', `/hr/employees/${helena.id}/termination/preview`).send({ ...pede, notice: 'deducted' }).expect(200);
      expect(hd).toMatchObject({ net: 3122.1 });
      expect(amounts(hd.lines)['103']).toBe(2400);
    });

    it('folha: DSR sobre horas extras, faltas com perda do DSR, afastamento pelo INSS e FGTS do aprendiz', async () => {
      const s = await ownerSession(t, ['hr']);
      const admit = async (body: Record<string, unknown>) => (await s.as('post', '/hr/employees').send({ position: 'Auxiliar', admissionDate: '2024-01-15', ...body }).expect(201)).body as { id: string };
      await admit({ name: 'Ivo Extra', cpf: '10120230364', salary: 2200 });
      await admit({ name: 'Joana Faltas', cpf: '20230340431', salary: 3000 });
      await admit({ name: 'Kauã Aprendiz', cpf: '30340450509', salary: 1500, category: 'apprentice' });
      const lia = await admit({ name: 'Lia Licença', cpf: '40450560686', salary: 3000 });
      // Doença o mês todo: a empresa paga os 15 primeiros dias; de 16/11 a 30/11 (15 dias) paga o INSS.
      const { body: leave } = await s.as('post', '/hr/leaves').send({ employeeId: lia.id, type: 'sick', startOn: '2025-11-01', endOn: '2025-11-30' }).expect(201);
      expect(leave).toMatchObject({ days: 30, companyDays: 15, inssDays: 15 });

      // Novembro/2025: 30 dias, 5 domingos (2, 9, 16, 23, 30) + 1 feriado em dia útil (20/11) → 6 de repouso e 24 úteis.
      const { body: payroll } = await s.as('post', '/hr/payrolls').send({ competence: '2025-11', holidays: 1 }).expect(201);
      expect(payroll.calendar).toMatchObject({ sundays: 5, restDays: 6, workingDays: 24 });
      // Aprendiz: FGTS 2% × 1.500 = 30.
      expect(byName(payroll.items, 'Kauã Aprendiz')).toMatchObject({ gross: 1500, fgts: 30, fgtsRate: 0.02 });
      // Lia: 30 − 15 dias do INSS = 15 dias × 100 = 1.500; FGTS 8% = 120.
      expect(byName(payroll.items, 'Lia Licença')).toMatchObject({ inssLeaveDays: 15, salaryDays: 15, baseSalary: 1500, gross: 1500, fgts: 120 });

      const ivo = byName(payroll.items as (Row & { id: string })[], 'Ivo Extra');
      const zero = { daysWorked: 30, overtime50Hours: 0, overtime100Hours: 0, otherEarnings: 0, otherDeductions: 0 };
      const { body: p1 } = await s.as('patch', `/hr/payrolls/${payroll.id}/items/${ivo.id}`).send({ ...zero, overtime50Hours: 10 }).expect(200);
      // Hora = 2.200 ÷ 220 = 10; 10h a 50% = 150; DSR = 150 ÷ 24 × 6 = 37,50; bruto 2.387,50; FGTS 8% = 191.
      expect(byName(p1.items, 'Ivo Extra')).toMatchObject({ overtime: 150, dsr: 37.5, variablePay: 187.5, gross: 2387.5, fgts: 191 });

      const joana = byName(payroll.items as (Row & { id: string })[], 'Joana Faltas');
      await s.as('patch', `/hr/payrolls/${payroll.id}/items/${joana.id}`).send({ ...zero, absences: 2, dsrLostDays: 7 }).expect(400);
      const { body: p2 } = await s.as('patch', `/hr/payrolls/${payroll.id}/items/${joana.id}`).send({ ...zero, absences: 2, dsrLostDays: 1 }).expect(200);
      // 2 faltas + 1 DSR perdido = 3 × 100 = 300 de desconto; base do INSS/FGTS 2.700; FGTS 216.
      expect(byName(p2.items, 'Joana Faltas')).toMatchObject({ baseSalary: 3000, absenceDeduction: 300, gross: 2700, fgts: 216 });
    });
  });
});
