// RH e departamento pessoal: colaboradores, férias (gozadas, em curso e marcadas) e folhas
// dos dois meses anteriores (fechadas, já no financeiro) e do mês atual (aberta).
import { day, slugify, step } from '../lib.mjs';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Férias começam na segunda-feira (evita início nos 2 dias antes do repouso semanal). */
const nextMonday = (iso) => {
  const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, (8 - wd) % 7);
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const round2 = (n) => Math.round(n * 100) / 100;
const br = (iso) => iso.split('-').reverse().join('/');

/**
 * Quadro de pessoal. `admitted`: dias atrás (ou 'month' = neste mês). `extra`: lançamentos da folha
 * (commission, overtime, absence, vt = vale-transporte 6%, plan = coparticipação do plano, leave).
 * `vac`: history = férias gozadas nos períodos já vencidos; keepOverdue = deixa o último vencido em aberto;
 * latest = férias do período mais recente (n dias a partir de hoje; negativo = já começaram).
 */
const EMPLOYEES = [
  { name: 'Marcos Vinícius Andrade', position: 'Gerente administrativo', department: 'Administrativo', salary: 9800, dependents: 2, admitted: -1880, born: 1979, extra: ['plan'], vac: { history: true, latest: { n: 52, days: 20, sold: 10 } } },
  { name: 'Cláudia Regina Fontes', position: 'Analista de departamento pessoal', department: 'Recursos Humanos', salary: 4350, dependents: 1, admitted: -1490, born: 1986, extra: ['plan'], vac: { history: true } },
  { name: 'Rafael Augusto Prado', position: 'Coordenador comercial', department: 'Comercial', salary: 7200, dependents: 2, admitted: -1120, born: 1984, extra: ['commission'], vac: { history: true, keepOverdue: true } },
  { name: 'Juliana Ferraz Mota', position: 'Vendedora externa', department: 'Comercial', salary: 2900, dependents: 0, admitted: -820, born: 1993, extra: ['commission', 'vt'], vac: { history: true, latest: { n: 19, days: 15 } } },
  { name: 'Diego Henrique Moraes', position: 'Vendedor interno', department: 'Comercial', salary: 2350, dependents: 1, admitted: -610, born: 1996, extra: ['commission', 'vt'], vac: { latest: { n: -10, days: 30 } } },
  { name: 'Patrícia Lemos Cardoso', position: 'Analista financeira', department: 'Financeiro', salary: 4900, dependents: 1, admitted: -540, born: 1990, extra: ['plan'], vac: { latest: { n: 45, days: 30 } } },
  { name: 'Anderson Luiz Batista', position: 'Motorista entregador', department: 'Logística', salary: 2650, dependents: 3, admitted: -760, born: 1982, extra: ['overtime', 'vt'], vac: { history: true } },
  { name: 'Sebastião Ferreira Gomes', position: 'Auxiliar de logística', department: 'Logística', salary: 1980, dependents: 2, admitted: -430, born: 1988, extra: ['overtime', 'vt'] },
  { name: 'Fernanda Alves Rocha', position: 'Operadora de produção', department: 'Produção', salary: 2150, dependents: 1, admitted: -350, born: 1995, extra: ['vt', 'absence'] },
  { name: 'Roberto Carlos Nunes', position: 'Supervisor de produção', department: 'Produção', salary: 5400, dependents: 2, admitted: -1300, born: 1980, extra: ['overtime'], vac: { history: true, latest: { n: -60, days: 20, sold: 10 } } },
  { name: 'Aline Souza Barreto', position: 'Assistente administrativa', department: 'Administrativo', salary: 2450, dependents: 1, admitted: -700, born: 1994, status: 'on_leave', notes: 'Licença-maternidade de 120 dias.', extra: ['vt', 'leave'] },
  { name: 'Lucas Gabriel Pires', position: 'Jovem aprendiz — auxiliar administrativo', department: 'Administrativo', salary: 820, weeklyHours: 20, dependents: 0, admitted: -200, born: 2007, notes: 'Contrato de aprendizagem de 24 meses (SENAC). FGTS de 2%.', extra: ['vt'] },
  { name: 'Eduardo Martins Leal', position: 'Operador de produção', department: 'Produção', salary: 2150, dependents: 0, admitted: -95, born: 2000, notes: 'Contrato de experiência de 45 + 45 dias.', extra: ['overtime', 'vt'] },
  { name: 'Bianca Torres Siqueira', position: 'Recepcionista', department: 'Administrativo', salary: 1850, dependents: 0, admitted: 'month', born: 1998, extra: ['vt'] },
  { name: 'Gilberto Ramos Paiva', position: 'Auxiliar de logística', department: 'Logística', salary: 1980, dependents: 1, admitted: -980, born: 1975, status: 'terminated', notes: 'Pedido de demissão, aviso prévio trabalhado.' },
];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, rng, log } = ctx;
  const today = day(0);
  const month = today.slice(0, 7);
  const prev = shiftMonth(month, -1);
  const prev2 = shiftMonth(month, -2);
  const specOf = new Map(EMPLOYEES.map((e) => [e.name, e]));

  const admissionOf = (e) => {
    if (e.admitted !== 'month') return nextWorkday(day(e.admitted));
    const d = nextWorkday(`${month}-03`);
    return d <= today ? d : today;
  };

  await step(log, 'rh: colaboradores', async () => {
    const existing = new Set((await api.get('/hr/employees')).map((e) => e.name));
    let created = 0;
    for (const e of EMPLOYEES) {
      if (existing.has(e.name)) continue;
      const cpf = rng.cpf();
      await api.post('/hr/employees', {
        name: e.name,
        cpf,
        birthDate: `${e.born}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
        email: `${slugify(e.name)}@example.com`,
        phone: rng.phone(),
        position: e.position,
        department: e.department,
        admissionDate: admissionOf(e),
        salary: e.salary,
        weeklyHours: e.weeklyHours ?? 44,
        dependents: e.dependents,
        status: e.status ?? 'active',
        terminationDate: e.status === 'terminated' ? nextWorkday(`${prev}-18`) : null,
        pixKey: rng.chance(0.5) ? cpf : `${slugify(e.name)}@example.com`,
        notes: e.notes ?? null,
      });
      created++;
    }
    log(`    ${created} colaboradores criados (${existing.size} já existiam)`);
  });

  await step(log, 'rh: férias', async () => {
    const employees = await api.get('/hr/employees');
    let taken = 0;
    let planned = 0;
    for (const emp of employees) {
      const plan = specOf.get(emp.name)?.vac;
      if (!plan || emp.status === 'terminated') continue;
      if ((await api.get(`/hr/employees/${emp.id}/vacations`)).some((v) => v.status === 'scheduled')) continue;
      const earned = emp.periods.filter((p) => p.earned);
      const latest = earned.at(-1);
      // Períodos anteriores ao último: já venceram, então foram gozados (exceto o que fica em aberto de propósito).
      const older = earned.slice(0, -1);
      if (plan.keepOverdue) older.pop();
      if (plan.history) {
        for (const p of older) {
          const sold = rng.chance(0.3) ? 10 : 0;
          await api.post('/hr/vacations', { employeeId: emp.id, periodStart: p.start, startOn: nextMonday(addDays(p.end, rng.int(90, 240))), days: 30 - sold, soldDays: sold });
          taken++;
        }
      }
      if (plan.latest && latest) {
        const startOn = nextMonday(day(plan.latest.n));
        if (startOn > latest.end) {
          await api.post('/hr/vacations', { employeeId: emp.id, periodStart: latest.start, startOn, days: plan.latest.days, soldDays: plan.latest.sold ?? 0 });
          if (startOn > today) planned++;
          else taken++;
        }
      }
    }
    log(`    ${taken} férias gozadas ou em curso, ${planned} marcadas`);
  });

  /** Lançamentos do mês para um colaborador na folha; null quando não há nada a lançar. */
  const entriesFor = (item, competence) => {
    const spec = specOf.get(item.employee.name);
    if (!spec) return null;
    const isCurrent = competence === month;
    const extra = spec.extra ?? [];
    const mm = `${competence.slice(5)}/${competence.slice(0, 4)}`;
    let daysWorked = item.daysWorked;
    let overtime50Hours = 0;
    let overtime100Hours = 0;
    let otherEarnings = 0;
    let otherDeductions = 0;
    const notes = [];
    if (extra.includes('commission') && !isCurrent) {
      otherEarnings = rng.money(spec.salary > 5000 ? 1500 : 700, spec.salary > 5000 ? 3800 : 2600);
      notes.push(`Comissões sobre as vendas de ${mm}`);
    }
    if (extra.includes('overtime') && (!isCurrent || rng.chance(0.6))) {
      overtime50Hours = isCurrent ? rng.int(4, 10) : rng.int(8, 22);
      if (rng.chance(0.4)) overtime100Hours = rng.int(4, 8);
      notes.push(overtime100Hours ? 'Horas extras (inclui domingo/feriado a 100%)' : 'Horas extras a 50%');
    }
    if (extra.includes('absence') && competence === prev) {
      daysWorked = Math.max(0, daysWorked - 2);
      notes.push('2 faltas injustificadas');
    }
    if (extra.includes('vt')) {
      otherDeductions += round2(spec.salary * 0.06 * (daysWorked / 30));
      notes.push('Vale-transporte (6%)');
    }
    if (extra.includes('plan')) {
      otherDeductions += 89.9;
      notes.push('Coparticipação do plano de saúde');
    }
    if (extra.includes('leave') && isCurrent) notes.push('Licença-maternidade: salário-maternidade a compensar na DCTFWeb');
    if (spec.status === 'terminated' && item.daysWorked < 30) notes.push(`Desligado em ${br(nextWorkday(`${prev}-18`))}; verbas rescisórias calculadas à parte`);
    if (!notes.length) return null;
    return { daysWorked, overtime50Hours, overtime100Hours, otherEarnings, otherDeductions: round2(otherDeductions), notes: notes.join('; ') };
  };

  for (const competence of [prev2, prev, month]) {
    const closing = competence !== month;
    await step(log, `rh: folha ${competence}${closing ? ' (fechada)' : ' (aberta)'}`, async () => {
      const found = (await api.get('/hr/payrolls')).find((p) => p.competence === competence && p.type === 'monthly');
      let payroll = found ? await api.get(`/hr/payrolls/${found.id}`) : await api.post('/hr/payrolls', { competence });
      if (payroll.status === 'closed') {
        log(`    já fechada (${payroll.totals.employees} colaboradores)`);
        return;
      }
      let changed = 0;
      if (!payroll.items.some((i) => i.notes)) {
        for (const item of payroll.items) {
          const body = entriesFor(item, competence);
          if (!body) continue;
          payroll = await api.patch(`/hr/payrolls/${payroll.id}/items/${item.id}`, body);
          changed++;
        }
      }
      if (closing) payroll = await api.post(`/hr/payrolls/${payroll.id}/close`);
      const t = payroll.totals;
      log(`    ${t.employees} colaboradores, ${changed} com lançamentos; bruto R$ ${t.gross.toFixed(2)}, líquido R$ ${t.net.toFixed(2)}, FGTS R$ ${t.fgts.toFixed(2)}`);
    });
  }
}

/** Mesmo dia, ou a próxima segunda se cair no fim de semana. */
function nextWorkday(iso) {
  const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return wd === 6 ? addDays(iso, 2) : wd === 0 ? addDays(iso, 1) : iso;
}
