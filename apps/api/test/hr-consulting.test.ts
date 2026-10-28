import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpf, createTestApp, ownerSession, type TestApp } from './helpers';

/**
 * Consultoria de RH: colaboradores e folhas por empregador (empresa-cliente = cliente do tipo
 * empresa), sem salários no financeiro da consultoria e com honorários ao fechar a folha.
 */
describe('Consultoria de RH', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  type Session = Awaited<ReturnType<typeof ownerSession>>;
  const job = { position: 'Auxiliar administrativo', admissionDate: '2024-01-15', salary: 3000 };
  const company = async (s: Session, name: string, document?: string) => (await s.as('post', '/customers').send({ name, type: 'company', document }).expect(201)).body as { id: string };
  const admit = async (s: Session, body: Record<string, unknown>) => (await s.as('post', '/hr/employees').send({ ...job, ...body }).expect(201)).body as { id: string; teamMemberId: string };
  const entries = async (s: Session, query: string) => (await s.as('get', `/finance/entries?limit=200&${query}`).expect(200)).body.items as { amount: number; dueDate: string; sourceType: string; sourceId: string; customerId: string | null; kind: string }[];

  it('colaborador de empresa-cliente: só cliente empresa, um contrato por empregador, a mesma pessoa em várias', async () => {
    const s = await ownerSession(t, ['hr_consulting']);
    const alfa = await company(s, 'Alfa Indústria Ltda', '11222333000181');
    const beta = await company(s, 'Beta Comércio Ltda');
    const { body: pessoa } = await s.as('post', '/customers').send({ name: 'Cliente Pessoa Física', type: 'person' }).expect(201);

    const { body: employers } = await s.as('get', '/hr/employers').expect(200);
    expect(employers.enabled).toBe(true);
    expect(employers.items.map((e: { name: string }) => e.name)).toEqual(['Alfa Indústria Ltda', 'Beta Comércio Ltda']);

    expect((await s.as('post', '/hr/employees').send({ ...job, name: 'Rita PF', cpf: cpf(), employerCustomerId: pessoa.id }).expect(400)).body.code).toBe('EMPLOYER_NOT_COMPANY');

    // A mesma pessoa: na Alfa, na Beta e na própria consultoria (um contrato em cada).
    const doc = cpf();
    const naAlfa = await admit(s, { name: 'Marta Dupla', cpf: doc, employerCustomerId: alfa.id });
    const naBeta = await admit(s, { name: 'Marta Dupla', cpf: doc, employerCustomerId: beta.id, admissionDate: '2025-03-01' });
    expect(naBeta.teamMemberId).toBe(naAlfa.teamMemberId);
    expect((await s.as('post', '/hr/employees').send({ ...job, name: 'Marta Dupla', cpf: doc, employerCustomerId: alfa.id }).expect(409)).body.code).toBe('CPF_TAKEN');
    const propria = await admit(s, { name: 'Marta Dupla', cpf: doc, admissionDate: '2025-06-02' });
    expect(propria.teamMemberId).toBe(naAlfa.teamMemberId);

    // Início na empresa (da pessoa) vem só do contrato da própria consultoria.
    const { body: person } = await s.as('get', `/team/${naAlfa.teamMemberId}`).expect(200);
    expect(person.startedOn).toBe('2025-06-02');
    expect(person.links.map((l: { label: string }) => l.label).sort()).toEqual(['Colaborador (RH)', 'Colaborador (RH) — Alfa Indústria Ltda', 'Colaborador (RH) — Beta Comércio Ltda']);

    const { body: e } = await s.as('get', `/hr/employees/${naAlfa.id}`).expect(200);
    expect(e).toMatchObject({ employerCustomerId: alfa.id, employer: { id: alfa.id, name: 'Alfa Indústria Ltda', document: '11222333000181' } });

    // Filtros por empregador.
    const names = async (q: string) => ((await s.as('get', `/hr/employees${q}`).expect(200)).body as { id: string }[]).map((x) => x.id).sort();
    expect(await names(`?employer=${alfa.id}`)).toEqual([naAlfa.id]);
    expect(await names('?employer=own')).toEqual([propria.id]);
    expect(await names('')).toHaveLength(3);

    // Editar sem mandar o empregador mantém o atual.
    await s.as('patch', `/hr/employees/${naBeta.id}`).send({ ...job, name: 'Marta Dupla', cpf: doc, admissionDate: '2025-03-01', salary: 3200 }).expect(200);
    expect((await s.as('get', `/hr/employees/${naBeta.id}`).expect(200)).body).toMatchObject({ employerCustomerId: beta.id, salary: 3200 });
  });

  it('folha por empresa: não lança salários no financeiro, lança honorários; a da própria empresa continua como antes', async () => {
    const s = await ownerSession(t, ['hr_consulting']);
    const alfa = await company(s, 'Alfa Serviços Ltda');
    const beta = await company(s, 'Beta Logística Ltda');
    await s.as('put', `/hr-consulting/clients/${alfa.id}`).send({ feeMode: 'per_employee', feeAmount: 45, feeDueDay: 10, terminationFee: 150 }).expect(200);
    await s.as('put', `/hr-consulting/clients/${beta.id}`).send({ feeMode: 'fixed', feeAmount: 0 }).expect(400);
    await s.as('put', `/hr-consulting/clients/${beta.id}`).send({ feeMode: 'fixed', feeAmount: 900, feeDueDay: 5 }).expect(200);
    const { body: pf } = await s.as('post', '/customers').send({ name: 'Pessoa Física', type: 'person' }).expect(201);
    await s.as('put', `/hr-consulting/clients/${pf.id}`).send({ feeMode: 'fixed', feeAmount: 100 }).expect(400);

    const a1 = await admit(s, { name: 'Ana Alfa', cpf: cpf(), employerCustomerId: alfa.id });
    await admit(s, { name: 'Bruno Alfa', cpf: cpf(), employerCustomerId: alfa.id, salary: 2500 });
    await admit(s, { name: 'Caio Beta', cpf: cpf(), employerCustomerId: beta.id });
    await admit(s, { name: 'Dora Própria', cpf: cpf() });

    const competence = '2025-10';
    const { body: pa } = await s.as('post', '/hr/payrolls').send({ competence, employerCustomerId: alfa.id }).expect(201);
    expect(pa.employer).toMatchObject({ id: alfa.id, name: 'Alfa Serviços Ltda' });
    expect(pa.items.map((i: { employee: { name: string } }) => i.employee.name)).toEqual(['Ana Alfa', 'Bruno Alfa']);
    await s.as('post', '/hr/payrolls').send({ competence, employerCustomerId: alfa.id }).expect(409);
    const { body: pb } = await s.as('post', '/hr/payrolls').send({ competence, employerCustomerId: beta.id }).expect(201);
    const { body: own } = await s.as('post', '/hr/payrolls').send({ competence }).expect(201);
    expect(own.employer).toBeNull();
    expect(own.items.map((i: { employee: { name: string } }) => i.employee.name)).toEqual(['Dora Própria']);

    const { body: listA } = await s.as('get', `/hr/payrolls?employer=${alfa.id}`).expect(200);
    expect(listA.map((p: { id: string }) => p.id)).toEqual([pa.id]);
    expect((await s.as('get', '/hr/payrolls?employer=own').expect(200)).body.map((p: { id: string }) => p.id)).toEqual([own.id]);

    await s.as('post', `/hr/payrolls/${pa.id}/close`).expect(200);
    await s.as('post', `/hr/payrolls/${pb.id}/close`).expect(200);
    const { body: ownClosed } = await s.as('post', `/hr/payrolls/${own.id}/close`).expect(200);

    // Nada de salários/encargos da empresa-cliente no financeiro da consultoria.
    const expenses = await entries(s, 'kind=expense');
    expect(expenses.filter((x) => x.sourceId === pa.id || x.sourceId === pb.id)).toEqual([]);
    expect(expenses.filter((x) => x.sourceId === own.id).map((x) => x.amount).sort((a, b) => a - b)).toEqual(
      [ownClosed.totals.fgts, Math.round((ownClosed.totals.inss + ownClosed.totals.irrf) * 100) / 100, ownClosed.totals.net].sort((a, b) => a - b),
    );

    // Honorários: 2 × 45 na Alfa (vence dia 10 do mês seguinte) e 900 fixos na Beta.
    expect(await entries(s, `kind=income&customerId=${alfa.id}`)).toEqual([expect.objectContaining({ amount: 90, dueDate: '2025-11-10', sourceType: 'hrc_fee', sourceId: pa.id })]);
    expect(await entries(s, `kind=income&customerId=${beta.id}`)).toEqual([expect.objectContaining({ amount: 900, dueDate: '2025-11-05', sourceType: 'hrc_fee' })]);

    // Empresas atendidas: quadro ativo e última folha.
    const { body: employers } = await s.as('get', '/hr/employers').expect(200);
    expect(employers.items.find((x: { id: string }) => x.id === alfa.id)).toMatchObject({ activeEmployees: 2, lastPayroll: { id: pa.id, competence, type: 'monthly', status: 'closed' } });
    const { body: fees } = await s.as('get', '/hr-consulting/clients').expect(200);
    expect(fees.find((f: { customerId: string }) => f.customerId === alfa.id)).toMatchObject({ feeMode: 'per_employee', feeAmount: 45, terminationFee: 150 });

    // Já está numa folha: não troca de empregador.
    const { body: ana } = await s.as('get', `/hr/employees/${a1.id}`).expect(200);
    const anaBody = { ...job, name: ana.name, cpf: ana.cpf };
    expect((await s.as('patch', `/hr/employees/${a1.id}`).send({ ...anaBody, employerCustomerId: beta.id }).expect(400)).body.code).toBe('EMPLOYER_LOCKED');
    expect((await s.as('patch', `/hr/employees/${a1.id}`).send({ ...anaBody, employerCustomerId: null }).expect(400)).body.code).toBe('EMPLOYER_LOCKED');

    // Férias de colaborador da empresa-cliente: sem despesa na consultoria.
    const { body: vac } = await s.as('post', '/hr/vacations').send({ employeeId: a1.id, periodStart: '2024-01-15', startOn: '2025-12-01', days: 10 }).expect(201);
    expect((await entries(s, 'kind=expense')).filter((x) => x.sourceId === vac.id)).toEqual([]);

    // Rescisão: entra na folha de rescisões da Alfa, sem despesa; honorário por rescisão; a pessoa não é encerrada.
    const { body: term } = await s
      .as('post', `/hr/employees/${a1.id}/termination`)
      .send({ type: 'without_cause', terminationDate: '2025-11-10', notice: 'indemnified', fgtsBalance: 0 })
      .expect(201);
    expect(term.employee.employer).toMatchObject({ id: alfa.id });
    expect((await entries(s, 'kind=expense')).filter((x) => x.sourceId === term.id)).toEqual([]);
    expect((await entries(s, `kind=income&customerId=${alfa.id}`)).find((x) => x.sourceId === term.id)).toMatchObject({ amount: 150, dueDate: '2025-12-10' });
    const { body: rescisoes } = await s.as('get', `/hr/payrolls?employer=${alfa.id}`).expect(200);
    expect(rescisoes.find((p: { type: string }) => p.type === 'termination')).toMatchObject({ competence: '2025-11', employer: { id: alfa.id } });
    expect((await s.as('get', '/hr/payrolls?employer=own').expect(200)).body.some((p: { type: string }) => p.type === 'termination')).toBe(false);
    const { body: person } = await s.as('get', `/team/${a1.teamMemberId}`).expect(200);
    expect(person.endedOn).toBeNull();
  });

  it('13º por empresa: cada empresa tem as suas parcelas', async () => {
    const s = await ownerSession(t, ['hr_consulting']);
    const alfa = await company(s, 'Alfa Têxtil Ltda');
    await admit(s, { name: 'Elisa Alfa', cpf: cpf(), employerCustomerId: alfa.id });
    await admit(s, { name: 'Fábio Próprio', cpf: cpf() });
    const { body: first } = await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 1, employerCustomerId: alfa.id }).expect(201);
    expect(first.items.map((i: { employee: { name: string } }) => i.employee.name)).toEqual(['Elisa Alfa']);
    await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 1, employerCustomerId: alfa.id }).expect(409);
    // A 1ª parcela da Alfa em aberto não trava a da própria empresa.
    expect((await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 2, employerCustomerId: alfa.id }).expect(400)).body.code).toBe('FIRST_INSTALLMENT_OPEN');
    const { body: ownFirst } = await s.as('post', '/hr/payrolls/thirteenth').send({ year: 2025, installment: 1 }).expect(201);
    expect(ownFirst.items.map((i: { employee: { name: string } }) => i.employee.name)).toEqual(['Fábio Próprio']);
  });

  it('sem o ramo Consultoria de RH, o RH não aceita empregador de fora', async () => {
    const s = await ownerSession(t, ['hr']);
    const alfa = await company(s, 'Alfa Sem Consultoria Ltda');
    expect((await s.as('get', '/hr/employers').expect(200)).body).toEqual({ enabled: false, items: [] });
    expect((await s.as('post', '/hr/employees').send({ ...job, name: 'Gil', cpf: cpf(), employerCustomerId: alfa.id }).expect(400)).body.code).toBe('EMPLOYERS_DISABLED');
    expect((await s.as('post', '/hr/payrolls').send({ competence: '2025-10', employerCustomerId: alfa.id }).expect(400)).body.code).toBe('EMPLOYERS_DISABLED');
    await s.as('get', '/hr-consulting/clients').expect(403);
  });
});
