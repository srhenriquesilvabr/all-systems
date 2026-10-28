// Consultoria de RH na fake-rh: 3 empresas atendidas (clientes do tipo empresa) com honorários,
// colaboradores de cada uma (uma pessoa trabalha em duas), folhas dos 3 meses anteriores fechadas por
// empresa (honorários lançados; os já vencidos, recebidos), a folha do mês aberta numa delas e uma
// rescisão com honorário. Só completa o que falta: pode rodar de novo.
//
// Os colaboradores atuais da fake-rh são da própria empresa e já estão em folhas fechadas; a API não
// troca o empregador depois da primeira folha (EMPLOYER_LOCKED), então os das empresas atendidas são novos.
// Precisa do ramo Consultoria de RH ativo na empresa:
//   pnpm --filter @all/api cli module:enable --tenant <id da fake-rh> --module hr_consulting
import { day, slugify, step } from '../lib.mjs';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
/** Mesmo dia, ou a próxima segunda se cair no fim de semana. */
const nextWorkday = (iso) => (weekday(iso) === 6 ? addDays(iso, 2) : weekday(iso) === 0 ? addDays(iso, 1) : iso);
/** Mesmo dia, ou a sexta anterior se cair no fim de semana. */
const prevWorkday = (iso) => (weekday(iso) === 6 ? addDays(iso, -1) : weekday(iso) === 0 ? addDays(iso, -2) : iso);
const minDate = (a, b) => (a < b ? a : b);
const round2 = (n) => Math.round(n * 100) / 100;
const brl = (n) => `R$ ${n.toFixed(2)}`;

/**
 * Empresas atendidas. `fee`: honorário (PUT /hr-consulting/clients/:id). `staff`: colaboradores
 * (admitted = dias atrás; extra: overtime, commission, vt = vale-transporte 6%). `shared`: a pessoa
 * também trabalha em outra empresa atendida (mesmo CPF, outro contrato).
 */
const CLIENTS = [
  {
    key: 'metal',
    name: 'Metalúrgica Santa Clara Ltda',
    email: 'dp@santaclara.example.com',
    street: 'Av. do Estado',
    district: 'Cambuci',
    notes: 'Folha fechada até o dia 3; holerites enviados por e-mail ao RH da empresa.',
    fee: { feeMode: 'per_employee', feeAmount: 65, feeDueDay: 10, thirteenthFee: true, terminationFee: 180, notes: 'Contrato de DP completo (folha, férias, rescisões e eSocial).' },
    openCurrent: true,
    staff: [
      { name: 'Antônio Carlos Ribeiro', position: 'Soldador', department: 'Produção', salary: 3450, dependents: 2, admitted: -1650, born: 1978, extra: ['overtime', 'vt'] },
      { name: 'Wellington Souza Prates', position: 'Torneiro mecânico', department: 'Produção', salary: 3900, dependents: 1, admitted: -980, born: 1986, extra: ['overtime'] },
      { name: 'Priscila Andrade Nogueira', position: 'Assistente de compras', department: 'Administrativo', salary: 2700, dependents: 0, admitted: -720, born: 1994, extra: ['vt'] },
      { name: 'Márcio Henrique Teles', position: 'Encarregado de produção', department: 'Produção', salary: 5200, dependents: 3, admitted: -2300, born: 1975, extra: ['overtime'] },
      { name: 'Jéssica Lima Fagundes', position: 'Auxiliar de expedição', department: 'Logística', salary: 2100, dependents: 1, admitted: -50, born: 2001, extra: ['vt'] },
    ],
  },
  {
    key: 'clinic',
    name: 'Clínica Bem Viver Ltda',
    email: 'administrativo@bemviver.example.com',
    street: 'Rua Pamplona',
    district: 'Jardim Paulista',
    notes: 'Plantões aos sábados pagos como hora extra a 100%.',
    fee: { feeMode: 'fixed', feeAmount: 1450, feeDueDay: 5, thirteenthFee: false, terminationFee: 0, notes: 'Mensalidade fixa até 10 colaboradores.' },
    staff: [
      { name: 'Dra. Helena Duarte Campos', position: 'Médica do trabalho', department: 'Clínico', salary: 9800, dependents: 1, admitted: -1200, born: 1982 },
      { name: 'Simone Aparecida Rocha', position: 'Técnica de enfermagem', department: 'Clínico', salary: 3100, dependents: 2, admitted: -860, born: 1989, extra: ['overtime100', 'vt'] },
      { name: 'Joana Macedo Pires', position: 'Recepcionista (meio período)', department: 'Recepção', salary: 1450, weeklyHours: 24, dependents: 0, admitted: -400, born: 1999, shared: 'shop', extra: ['vt'] },
      { name: 'Paulo Roberto Assis', position: 'Auxiliar de limpeza', department: 'Apoio', salary: 1750, dependents: 1, admitted: -530, born: 1983, extra: ['vt'] },
    ],
  },
  {
    key: 'shop',
    name: 'Supermercado Bom Dia Ltda',
    email: 'rh@bomdia.example.com',
    street: 'Rua Voluntários da Pátria',
    district: 'Santana',
    notes: 'Comissão dos repositores por meta de ruptura; vale-transporte para todos.',
    fee: { feeMode: 'per_employee', feeAmount: 52, feeDueDay: 10, thirteenthFee: true, terminationFee: 150, notes: null },
    terminate: 'Rogério Batista Leme',
    staff: [
      { name: 'Cristiane Moura Dantas', position: 'Gerente de loja', department: 'Gerência', salary: 6200, dependents: 2, admitted: -1800, born: 1980, extra: ['commission'] },
      { name: 'Rogério Batista Leme', position: 'Repositor', department: 'Loja', salary: 1980, dependents: 0, admitted: -610, born: 1997, extra: ['overtime', 'vt'] },
      { name: 'Tainá Ferreira Gomes', position: 'Operadora de caixa', department: 'Frente de caixa', salary: 1900, dependents: 1, admitted: -330, born: 2000, extra: ['vt'] },
      { name: 'Edson Luiz Cardoso', position: 'Açougueiro', department: 'Açougue', salary: 2650, dependents: 2, admitted: -1400, born: 1979, extra: ['overtime', 'vt'] },
      // Mesma pessoa da clínica, com outro contrato (meio período à tarde).
      { name: 'Joana Macedo Pires', position: 'Operadora de caixa (meio período)', department: 'Frente de caixa', salary: 1200, weeklyHours: 20, dependents: 0, admitted: -250, born: 1999, extra: ['vt'] },
    ],
  },
];

const FEE_SOURCE = 'hrc_fee';

/** @param {{ api, rng, log, tenant: {id,name}, customers: object[], users: object[] }} ctx */
export default async function seedHrConsulting(ctx) {
  if (ctx.tenant.name !== 'fake-rh') return;
  const { api, log } = ctx;
  let employers;
  try {
    employers = await api.get('/hr/employers');
  } catch (err) {
    return log(`  ✗ consultoria de RH: a API ainda não tem as empresas atendidas (${err.status ?? err.message})`);
  }
  if (!employers.enabled) {
    return log('  ✗ consultoria de RH: ative o ramo na fake-rh (cli module:enable --module hr_consulting) e rode de novo');
  }
  const clients = await step(log, 'consultoria de RH: empresas atendidas', () => seedClients(ctx, employers.items));
  if (!clients) return;
  await step(log, 'consultoria de RH: honorários', () => seedFees(ctx, clients));
  await step(log, 'consultoria de RH: colaboradores das empresas', () => seedStaff(ctx, clients));
  for (const c of CLIENTS) {
    await step(log, `consultoria de RH: folhas — ${c.name}`, () => seedPayrolls(ctx, c, clients.get(c.key)));
  }
  await step(log, 'consultoria de RH: rescisão em empresa atendida', () => seedTermination(ctx, clients));
  await step(log, 'consultoria de RH: honorários recebidos', () => receiveFees(ctx));
}

/** Clientes do tipo empresa (as empresas atendidas). Devolve key → id. */
async function seedClients({ api, rng, log }, existing) {
  const out = new Map();
  let created = 0;
  for (const c of CLIENTS) {
    let found = existing.find((e) => e.name === c.name);
    if (!found) {
      found = await api.post('/customers', {
        type: 'company',
        name: c.name,
        document: rng.cnpj(),
        email: c.email,
        phone: rng.phone(),
        birthDate: null,
        address: { zip: `0${rng.int(1000, 5999)}${rng.int(100, 999)}`, street: c.street, number: String(rng.int(10, 2500)), district: c.district, city: 'São Paulo', state: 'SP' },
        notes: c.notes,
      });
      created++;
    }
    out.set(c.key, found.id);
  }
  log(`    ${created} empresas cadastradas (${CLIENTS.length - created} já existiam)`);
  return out;
}

/** Honorários de cada empresa (só configura o que ainda não tem: não desfaz ajustes feitos na tela). */
async function seedFees({ api, log }, clients) {
  const fees = await api.get('/hr-consulting/clients');
  let saved = 0;
  for (const c of CLIENTS) {
    const id = clients.get(c.key);
    if (fees.some((f) => f.customerId === id)) continue;
    await api.put(`/hr-consulting/clients/${id}`, c.fee);
    saved++;
  }
  log(`    ${saved} empresas com honorário configurado agora`);
}

async function seedStaff({ api, rng, log }, clients) {
  let created = 0;
  const cpfByName = new Map();
  for (const c of CLIENTS) {
    for (const e of await api.get('/hr/employees', { employer: clients.get(c.key) })) cpfByName.set(e.name, e.cpf);
  }
  for (const c of CLIENTS) {
    const employer = clients.get(c.key);
    const existing = new Set((await api.get('/hr/employees', { employer })).map((e) => e.name));
    for (const s of c.staff) {
      if (existing.has(s.name)) continue;
      // A pessoa que já trabalha em outra empresa atendida entra com o mesmo CPF (a API liga à mesma pessoa).
      const cpf = cpfByName.get(s.name) ?? rng.cpf();
      cpfByName.set(s.name, cpf);
      await api.post('/hr/employees', {
        employerCustomerId: employer,
        name: s.name,
        cpf,
        birthDate: `${s.born}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
        email: `${slugify(s.name)}@example.com`,
        phone: rng.phone(),
        position: s.position,
        department: s.department,
        admissionDate: nextWorkday(day(s.admitted)),
        salary: s.salary,
        weeklyHours: s.weeklyHours ?? 44,
        dependents: s.dependents,
        status: 'active',
        terminationDate: null,
        pixKey: cpf,
        notes: s.shared ? 'Também trabalha em outra empresa atendida (outro contrato, mesma pessoa).' : null,
      });
      created++;
    }
  }
  log(`    ${created} colaboradores admitidos nas empresas atendidas`);
}

/** Lançamentos do mês de um colaborador (horas extras, comissões, vale-transporte). */
function entriesFor(rng, spec, item, competence) {
  const extra = spec?.extra ?? [];
  const mm = `${competence.slice(5)}/${competence.slice(0, 4)}`;
  let overtime50Hours = 0;
  let overtime100Hours = 0;
  let commissions = 0;
  let otherDeductions = 0;
  const notes = [];
  if (extra.includes('overtime')) {
    overtime50Hours = rng.int(6, 18);
    notes.push('Horas extras a 50% (cartão de ponto)');
  }
  if (extra.includes('overtime100')) {
    overtime100Hours = rng.int(6, 12);
    notes.push('Plantões de sábado a 100%');
  }
  if (extra.includes('commission')) {
    commissions = rng.money(800, 2200);
    notes.push(`Comissão por meta de ${mm}`);
  }
  if (extra.includes('vt')) {
    otherDeductions = round2(spec.salary * 0.06 * (item.daysWorked / 30));
    notes.push('Vale-transporte (6%)');
  }
  if (!notes.length) return null;
  return { daysWorked: item.daysWorked, overtime50Hours, overtime100Hours, commissions, otherEarnings: 0, otherDeductions, absences: 0, dsrLostDays: 0, notes: notes.join('; ') };
}

/** Folhas mensais dos 3 meses anteriores (fechadas: o honorário é lançado) e, numa empresa, a do mês (aberta). */
async function seedPayrolls({ api, rng, log }, client, employer) {
  const month = day(0).slice(0, 7);
  const specs = new Map(client.staff.map((s) => [s.name, s]));
  const competences = [shiftMonth(month, -3), shiftMonth(month, -2), shiftMonth(month, -1), ...(client.openCurrent ? [month] : [])];
  const out = [];
  for (const competence of competences) {
    const closing = competence !== month;
    const found = (await api.get('/hr/payrolls', { employer })).find((p) => p.competence === competence && p.type === 'monthly' && p.employer?.id === employer);
    let payroll;
    if (found) payroll = await api.get(`/hr/payrolls/${found.id}`);
    else {
      try {
        payroll = await api.post('/hr/payrolls', { competence, employerCustomerId: employer });
      } catch (err) {
        // Ninguém admitido ainda naquele mês (ex.: empresa nova): segue para o próximo.
        if (err.status === 400 && err.body.includes('NO_EMPLOYEES')) continue;
        throw err;
      }
    }
    if (payroll.status === 'closed') {
      out.push(`${competence} já fechada`);
      continue;
    }
    if (!payroll.items.some((i) => i.notes)) {
      for (const item of payroll.items) {
        const body = entriesFor(rng, specs.get(item.employee.name), item, competence);
        if (body) payroll = await api.patch(`/hr/payrolls/${payroll.id}/items/${item.id}`, body);
      }
    }
    if (closing) payroll = await api.post(`/hr/payrolls/${payroll.id}/close`);
    out.push(`${competence} ${closing ? 'fechada' : 'aberta'} (${payroll.totals.employees} colab., líquido ${brl(payroll.totals.net)})`);
  }
  log(`    ${out.join('; ') || 'nada a fazer'}`);
}

/** Dispensa sem justa causa no mês atual (honorário por rescisão vai para o financeiro). */
async function seedTermination({ api, log }, clients) {
  const client = CLIENTS.find((c) => c.terminate);
  const employer = clients.get(client.key);
  const emp = (await api.get('/hr/employees', { employer })).find((e) => e.name === client.terminate);
  if (!emp) return log(`    ${client.terminate} não encontrado`);
  if (emp.status === 'terminated') return log(`    já registrada (${emp.name}, ${emp.terminationDate})`);
  const today = day(0);
  // No mês atual (as folhas fechadas dos meses anteriores já pagaram os salários deles).
  const terminationDate = Number(today.slice(8)) >= 8 ? prevWorkday(day(-3)) : today;
  const months = Math.max(1, Math.round((Date.parse(terminationDate) - Date.parse(emp.admissionDate)) / (30.44 * 86_400_000)));
  const t = await api.post(`/hr/employees/${emp.id}/termination`, {
    type: 'without_cause',
    terminationDate,
    notice: 'indemnified',
    fgtsBalance: round2(emp.salary * 0.08 * months * (13.33 / 12)),
    otherEarnings: 0,
    otherDeductions: 0,
    notes: 'Fechamento do turno da noite. Aviso prévio indenizado; termo enviado à empresa para pagamento.',
  });
  log(`    ${emp.name} (${client.name}): ${terminationDate}, líquido ${brl(t.net)} a pagar pela empresa até ${t.payBy}`);
}

const bankAccount = async (api) => {
  const accounts = await api.get('/finance/accounts');
  const bank = accounts.find((a) => a.type === 'bank' && a.active !== false) ?? accounts.find((a) => a.active !== false) ?? accounts[0];
  if (!bank) throw new Error('nenhuma conta no financeiro');
  return bank;
};

/** Honorários já vencidos: recebidos entre o vencimento e alguns dias depois (nunca no futuro). */
async function receiveFees({ api, rng, log }) {
  const today = day(0);
  const pending = (await api.get('/finance/entries', { kind: 'income', status: 'pending', to: today, limit: 200 })).items.filter((e) => e.sourceType === FEE_SOURCE && e.dueDate <= today);
  if (!pending.length) return log('    nada vencido em aberto');
  const bank = await bankAccount(api);
  for (const e of pending) {
    await api.post(`/finance/entries/${e.id}/pay`, { paidAt: minDate(addDays(e.dueDate, rng.int(0, 4)), today), accountId: bank.id, paymentMethod: rng.chance(0.7) ? 'pix' : 'boleto' });
  }
  log(`    ${pending.length} honorários recebidos (${brl(round2(pending.reduce((s, e) => s + e.amount, 0)))})`);
}
