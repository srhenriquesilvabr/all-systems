// Parte comum a toda empresa de demonstração: clientes, equipe, financeiro e segmentos (RFM).
import { COMPANIES, DISTRICTS, STREETS, day, personName, slugify, step } from './lib.mjs';

/**
 * Histórico de compras por cliente, em dias atrás, para os segmentos saírem variados:
 * campeões, fiéis, novos, em risco, hibernando, promissores e empresas recorrentes.
 */
const PURCHASE_PATTERNS = [
  [3, 12, 25, 40, 55, 70],
  [6, 18, 33, 47, 61, 80],
  [15, 45, 75, 105],
  [9, 39, 69],
  [5],
  [120, 150, 180, 210],
  [240],
  [20, 50],
  [10, 40, 70, 100],
  [28, 88],
];

const METHODS = ['pix', 'pix', 'credit_card', 'debit_card', 'cash'];
const OWNER_ROLE = 'core.owner';
const isOwner = (m) => m.roles.some((r) => r.key === OWNER_ROLE);

/**
 * @param {{ api, rng, log, tenant: {id,name}, profile: { income: string[], ticket: [number, number] } }} ctx
 * @returns {Promise<{ customers: object[], users: object[] }>}
 */
export default async function seedCore(ctx) {
  const { api, log } = ctx;
  const customers = (await step(log, 'clientes', () => seedCustomers(ctx))) ?? (await api.get('/customers', { limit: 100 })).items;
  const users = (await step(log, 'equipe', () => seedUsers(ctx))) ?? [];
  await step(log, 'financeiro', () => seedFinance(ctx, customers));
  await step(log, 'receitas avulsas semanais', () => seedWeeklyRevenue(ctx));
  await step(log, 'segmentos (RFM)', () => api.post('/segmentation/recompute'));
  return { customers, users };
}

async function seedCustomers({ api, rng, log }) {
  const existing = await api.get('/customers', { limit: 100 });
  if (existing.total >= 8) {
    log(`    já tem ${existing.total} clientes`);
    return existing.items;
  }

  const used = new Set(existing.items.map((c) => c.name));
  const created = [];
  // Completa até 10 (8 pessoas e 2 empresas), mesmo se uma rodada anterior parou no meio.
  const companies = existing.items.filter((c) => c.type === 'company').length;
  const people = existing.items.length - companies;
  const plan = [...Array(Math.max(0, 8 - people)).fill(false), ...Array(Math.max(0, 2 - companies)).fill(true)];
  for (const company of plan) {
    const name = company ? COMPANIES[rng.int(0, COMPANIES.length - 1)] : personName(rng, used);
    if (used.has(name) && company) continue;
    used.add(name);
    const email = `${slugify(name)}@example.com`;
    const customer = await api
      .post('/customers', {
        type: company ? 'company' : 'person',
        name,
        document: company ? rng.cnpj() : rng.cpf(),
        email,
        phone: rng.phone(),
        birthDate: company ? null : `${rng.int(1965, 2002)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
        address: {
          zip: `0${rng.int(1000, 5999)}${rng.int(100, 999)}`,
          street: rng.pick(STREETS),
          number: String(rng.int(10, 2500)),
          district: rng.pick(DISTRICTS),
          city: 'São Paulo',
          state: 'SP',
        },
        notes: rng.chance(0.3) ? rng.pick(['Prefere contato pelo WhatsApp.', 'Cliente indicado por outro cliente.', 'Atender preferencialmente no período da tarde.']) : null,
      })
      .catch((err) => (err.status === 409 ? null : Promise.reject(err)));
    if (!customer) continue;
    created.push(customer);
    if (rng.chance(0.6)) {
      await api.post(`/customers/${customer.id}/consents`, { purpose: 'marketing_whatsapp', granted: true, source: 'Cadastro no balcão' });
    }
  }
  log(`    ${created.length} clientes criados`);
  return [...existing.items, ...created];
}

const STAFF = 5;

async function seedUsers({ api, rng, log, tenant }) {
  const members = await api.get('/users');
  const roles = (await api.get('/access/roles')).filter((r) => r.key !== OWNER_ROLE);
  const toUser = (m) => ({ membershipId: m.membershipId, name: m.user.name, email: m.user.email, roleKeys: m.roles.map((r) => r.key) });
  if (members.length > STAFF) {
    log(`    já tem ${members.length} pessoas na equipe`);
    return members.filter((m) => !isOwner(m)).map(toUser);
  }

  // Convites ficam pendentes (e-mails @example.com não recebem nada): servem para mostrar a equipe e os papéis.
  const used = new Set(members.map((m) => m.user.name));
  const slug = slugify(tenant.name);
  for (let i = 0; i < STAFF; i++) {
    const name = personName(rng, used);
    const role = roles.length ? roles[i % roles.length] : null;
    await api.post('/users/invite', {
      email: `${slugify(name)}+${slug}@example.com`,
      name: name.split(' ').slice(0, 2).join(' '),
      roleIds: role ? [role.id] : [],
    });
  }
  const after = await api.get('/users');
  log(`    ${STAFF} convites (${roles.map((r) => r.label).join(', ') || 'sem papéis do setor'})`);
  return after.filter((m) => !isOwner(m)).map(toUser);
}

async function seedFinance({ api, rng, log, profile }, customers) {
  const expensesSoFar = (await api.get('/finance/entries', { kind: 'expense', limit: 1 })).total;

  let accounts = await api.get('/finance/accounts');
  if (!accounts.some((a) => a.type === 'bank')) {
    await api.post('/finance/accounts', { name: 'Conta Itaú', type: 'bank', initialBalance: 18500 });
    accounts = await api.get('/finance/accounts');
  }
  const cash = accounts.find((a) => a.type === 'cash') ?? accounts[0];
  const bank = accounts.find((a) => a.type === 'bank') ?? cash;
  const categories = await api.get('/finance/categories');
  const cat = (key, kind) => (categories.find((c) => c.systemKey === key) ?? categories.find((c) => c.kind === kind))?.id ?? null;

  const income = (customer, daysAgo, paid) => {
    const method = rng.pick(METHODS);
    return api.post('/finance/entries', {
      kind: 'income',
      description: `${rng.pick(profile.income)} — ${customer.name}`,
      amount: Math.round(rng.money(...profile.ticket) * (customer.type === 'company' ? 3 : 1) * 100) / 100,
      status: paid ? 'paid' : 'pending',
      dueDate: day(-daysAgo),
      paidAt: paid ? day(-daysAgo) : null,
      accountId: paid ? (method === 'cash' ? cash.id : bank.id) : null,
      categoryId: cat('services', 'income'),
      customerId: customer.id,
      paymentMethod: paid ? method : null,
    });
  };

  // Recebimentos pagos, que alimentam o RFM.
  let count = 0;
  for (const [i, customer] of customers.slice(0, PURCHASE_PATTERNS.length).entries()) {
    // Por cliente: quem já tem lançamento (de uma rodada anterior) fica como está.
    if ((await api.get('/finance/entries', { kind: 'income', customerId: customer.id, limit: 1 })).total > 0) continue;
    for (const daysAgo of PURCHASE_PATTERNS[i]) {
      await income(customer, daysAgo, true);
      count++;
    }
  }
  // A receber: um vencido e dois a vencer.
  const pending = (await api.get('/finance/entries', { kind: 'income', status: 'pending', limit: 1 })).total;
  if (pending === 0) {
    for (const [daysAgo, customer] of [[8, customers[2]], [-5, customers[0]], [-12, customers[8] ?? customers[1]]]) {
      if (customer) await income(customer, daysAgo, false), count++;
    }
  }
  if (expensesSoFar >= 10) {
    log(`    já tem ${expensesSoFar} despesas`);
    return log(`    ${count} lançamentos`);
  }

  // Despesas do mês: fixas pagas nos últimos meses e contas a pagar (uma vencida).
  const expenses = [
    ['Aluguel do ponto', 'rent', 4200, [-65, -35, -5]],
    ['Energia elétrica', 'other_expense', rng.money(480, 760), [-58, -28]],
    ['Folha de pagamento', 'payroll', rng.money(9800, 14500), [-60, -30]],
    ['Insumos e materiais', 'supplies', rng.money(900, 2100), [-40, -12]],
    ['Simples Nacional', 'taxes', rng.money(1200, 2400), [-45, -15]],
    ['Tarifas bancárias e maquininha', 'fees', rng.money(90, 220), [-31, -2]],
  ];
  for (const [description, key, amount, dates] of expenses) {
    for (const d of dates) {
      await api.post('/finance/entries', {
        kind: 'expense', description, amount, status: 'paid', dueDate: day(d), paidAt: day(d), accountId: bank.id, categoryId: cat(key, 'expense'), paymentMethod: 'pix',
      });
      count++;
    }
  }
  for (const [description, key, amount, d] of [
    ['Aluguel do ponto', 'rent', 4200, 25],
    ['Energia elétrica', 'other_expense', rng.money(480, 760), 2],
    ['Fornecedor de materiais — NF 4821', 'supplies', rng.money(700, 1600), -3],
    ['Simples Nacional', 'taxes', rng.money(1200, 2400), 13],
  ]) {
    await api.post('/finance/entries', { kind: 'expense', description, amount, status: 'pending', dueDate: day(d), categoryId: cat(key, 'expense') });
    count++;
  }
  log(`    ${count} lançamentos`);
}

const WEEKLY = 'Receitas avulsas da semana';

/**
 * Receita do dia a dia sem cliente identificado, somada por semana, nas últimas 13 semanas.
 * Sem ela a empresa de demonstração só teria a receita dos 10 clientes cadastrados e
 * apareceria no prejuízo diante das despesas fixas.
 */
async function seedWeeklyRevenue({ api, rng, log }) {
  // Semana a semana: uma rodada interrompida no meio é completada sem duplicar.
  const done = new Set((await api.get('/finance/entries', { kind: 'income', q: WEEKLY, limit: 50 })).items.map((e) => e.dueDate));
  if (done.size >= 13) return log(`    já tem ${done.size} semanas`);
  const accounts = await api.get('/finance/accounts');
  const bank = accounts.find((a) => a.type === 'bank') ?? accounts[0];
  const categories = await api.get('/finance/categories');
  const category = (categories.find((c) => c.systemKey === 'services') ?? categories.find((c) => c.kind === 'income'))?.id ?? null;
  let created = 0;
  for (let week = 1; week <= 13; week++) {
    const d = day(-(week * 7 - 2));
    const amount = rng.money(7000, 9500);
    if (done.has(d)) continue;
    created++;
    await api.post('/finance/entries', {
      kind: 'income', description: WEEKLY, amount, status: 'paid', dueDate: d, paidAt: d, accountId: bank.id, categoryId: category, paymentMethod: 'pix',
    });
  }
  log(`    ${created} semanas`);
}
