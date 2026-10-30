// Pet shop: pets dos tutores, equipe do banho e tosa com expediente, agenda (histórico, quadro
// de hoje e próximos dias), produtos com estoque, vendas no PDV e chave Pix.
import { at, day, step } from '../lib.mjs';

const STORE_HOURS = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start: '08:00', end: '12:00' },
  { weekday, start: '13:00', end: '18:00' },
]).concat([{ weekday: 6, start: '08:00', end: '14:00' }]);
const TUE_SAT = STORE_HOURS.filter((h) => h.weekday !== 1);
const AFTERNOONS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '13:00', end: '18:00' })).concat([{ weekday: 6, start: '08:00', end: '14:00' }]);

/** Equipe da agenda. "tosa" faz tudo; "banho" faz banho, tosa higiênica e adicionais. */
const TEAM = [
  { name: 'Carla Mendes', role: 'tosa', color: '#e8590c', hours: STORE_HOURS },
  { name: 'Diego Albuquerque', role: 'tosa', color: '#2d4bff', hours: TUE_SAT },
  { name: 'Juliana Prado', role: 'banho', color: '#0ca678', hours: STORE_HOURS },
  { name: 'Rafael Nogueira', role: 'banho', color: '#7048e8', hours: STORE_HOURS },
  { name: 'Patrícia Lopes', role: 'banho', color: '#d6336c', hours: AFTERNOONS },
];

/** Tabela do módulo (criada ao ativar) e alguns serviços a mais. Preço em reais. */
const SERVICES = [
  { name: 'Banho — porte pequeno', category: 'Banho', durationMin: 60, price: 50 },
  { name: 'Banho — porte médio', category: 'Banho', durationMin: 75, price: 65 },
  { name: 'Banho — porte grande', category: 'Banho', durationMin: 90, price: 85 },
  { name: 'Banho e tosa — porte pequeno', category: 'Banho e tosa', durationMin: 90, price: 80 },
  { name: 'Banho e tosa — porte médio', category: 'Banho e tosa', durationMin: 120, price: 100 },
  { name: 'Banho e tosa — porte grande', category: 'Banho e tosa', durationMin: 150, price: 130 },
  { name: 'Tosa higiênica', category: 'Tosa', durationMin: 30, price: 35 },
  { name: 'Hidratação de pelos', category: 'Adicionais', durationMin: 20, price: 30 },
  { name: 'Corte de unhas', category: 'Adicionais', durationMin: 15, price: 20 },
  { name: 'Escovação de dentes', category: 'Adicionais', durationMin: 10, price: 15 },
  { name: 'Banho em gatos', category: 'Banho', durationMin: 60, bufferMin: 15, price: 90, description: 'Secagem em temperatura baixa e manejo calmo, longe dos cães.' },
  { name: 'Tosa na tesoura', category: 'Tosa', durationMin: 90, price: 120, description: 'Acabamento todo na tesoura, sem máquina.' },
  { name: 'Desembolo de pelos', category: 'Adicionais', durationMin: 30, price: 45, description: 'Para pelagens longas com nós; valor por sessão de 30 min.' },
  { name: 'Banho terapêutico', category: 'Banho', durationMin: 75, price: 95, online: false, description: 'Com shampoo prescrito pelo veterinário (trazido pelo tutor ou da loja).' },
];
const BATH_ONLY = (s) => s.category === 'Banho' || s.category === 'Adicionais' || s.name === 'Tosa higiênica';

const PETS = [
  { name: 'Thor', species: 'dog', breed: 'Golden Retriever', sex: 'male', birthDate: '2020-03-14', weightKg: 32.5, coat: 'Longa, dourada', size: 'large', neutered: true, microchip: '985141002345671', notes: 'Adora água. Usar shampoo para pelos claros.' },
  { name: 'Mel', species: 'dog', breed: 'Shih Tzu', sex: 'female', birthDate: '2021-07-02', weightKg: 6.2, coat: 'Longa', size: 'small', neutered: true, notes: 'Tutora prefere tosa bebê e laço rosa.' },
  { name: 'Bob', species: 'dog', breed: 'Spitz Alemão (Lulu da Pomerânia)', sex: 'male', birthDate: '2022-01-20', weightKg: 3.8, coat: 'Dupla, volumosa', size: 'small', notes: 'Não usar máquina no corpo (pelo duplo): só tesoura.' },
  { name: 'Luna', species: 'cat', breed: 'Persa', sex: 'female', birthDate: '2019-11-05', weightKg: 4.1, coat: 'Longa, branca', size: 'small', neutered: true, notes: 'Fica estressada com secador alto. Atender no fim da manhã, sala dos gatos.' },
  { name: 'Paçoca', species: 'dog', breed: 'SRD (caramelo)', sex: 'male', birthDate: '2018-09-10', weightKg: 14, coat: 'Curta', size: 'medium', neutered: true },
  { name: 'Nina', species: 'dog', breed: 'Poodle', sex: 'female', birthDate: '2016-05-22', weightKg: 5.5, coat: 'Encaracolada', size: 'small', neutered: true, notes: 'Idosa: banho rápido e com cuidado nas patas traseiras.' },
  { name: 'Max', species: 'dog', breed: 'Labrador', sex: 'male', birthDate: '2021-12-01', weightKg: 29.3, coat: 'Curta, preta', size: 'large', microchip: '985141002398812' },
  { name: 'Frida', species: 'dog', breed: 'Buldogue Francês', sex: 'female', birthDate: '2022-08-18', weightKg: 11.3, coat: 'Curta', size: 'medium', notes: 'Limpar dobras do focinho e secar bem. Dermatite de contato: shampoo hipoalergênico.' },
  { name: 'Simba', species: 'cat', breed: 'Maine Coon', sex: 'male', birthDate: '2020-06-30', weightKg: 7.8, coat: 'Longa', size: 'medium', neutered: true },
  { name: 'Pipoca', species: 'dog', breed: 'Yorkshire', sex: 'female', birthDate: '2023-02-11', weightKg: 2.9, coat: 'Longa, sedosa', size: 'small', notes: 'Morde no corte de unhas: segurar com toalha.' },
  { name: 'Zeus', species: 'dog', breed: 'Husky Siberiano', sex: 'male', birthDate: '2019-04-03', weightKg: 24, coat: 'Dupla (subpelo)', size: 'large', neutered: true, notes: 'Na troca de pelo, fazer desembolo/remoção de subpelo antes do banho.' },
  { name: 'Amora', species: 'cat', breed: 'SRD', sex: 'female', birthDate: '2022-10-09', weightKg: 3.6, coat: 'Curta, tricolor', size: 'small', neutered: true },
];

/** Produtos criados ao ativar o módulo (completados aqui) e outros da loja. Preço e custo em reais. */
const PRODUCTS = [
  { name: 'Ração cães adultos 15 kg', category: 'Rações', unit: 'un', price: 189.9, cost: 132.0, minStock: 4, buy: 12 },
  { name: 'Ração gatos castrados 10 kg', category: 'Rações', unit: 'un', price: 219.9, cost: 151.5, minStock: 3, buy: 8 },
  { name: 'Sachê gatos 85 g', category: 'Rações', unit: 'un', price: 3.49, cost: 1.85, minStock: 48, buy: 120 },
  { name: 'Petisco bifinho 65 g', category: 'Petiscos', unit: 'un', price: 9.9, cost: 4.6, minStock: 15, buy: 40 },
  { name: 'Areia sanitária 4 kg', category: 'Higiene', unit: 'un', price: 24.9, cost: 13.2, minStock: 10, buy: 4 },
  { name: 'Tapete higiênico 30 un', category: 'Higiene', unit: 'pct', price: 59.9, cost: 34.0, minStock: 6, buy: 15 },
  { name: 'Coleira ajustável M', category: 'Acessórios', unit: 'un', price: 34.9, cost: 15.0, minStock: 3, buy: 10 },
  { name: 'Antipulgas cães 10–20 kg', category: 'Farmácia', unit: 'un', price: 89.9, cost: 58.0, minStock: 5, buy: 3 },
  { name: 'Ração filhotes 3 kg', category: 'Rações', unit: 'un', price: 79.9, cost: 52.0, minStock: 4, buy: 10 },
  { name: 'Ração premium a granel', category: 'Rações', unit: 'kg', price: 18.9, cost: 11.4, minStock: 10, buy: 50 },
  { name: 'Shampoo neutro pet 500 ml', category: 'Higiene', unit: 'un', price: 29.9, cost: 14.5, minStock: 5, buy: 18 },
  { name: 'Condicionador hidratante 500 ml', category: 'Higiene', unit: 'un', price: 34.9, cost: 17.0, minStock: 5, buy: 12 },
  { name: 'Brinquedo mordedor de corda', category: 'Acessórios', unit: 'un', price: 24.9, cost: 9.8, minStock: 5, buy: 20 },
  { name: 'Arranhador para gatos', category: 'Acessórios', unit: 'un', price: 119.9, cost: 64.0, minStock: 2, buy: 4 },
  { name: 'Cama pet média', category: 'Acessórios', unit: 'un', price: 149.9, cost: 78.0, minStock: 2, buy: 5 },
  { name: 'Vermífugo cães 10 kg (2 comprimidos)', category: 'Farmácia', unit: 'un', price: 32.9, cost: 18.5, minStock: 6, buy: 14 },
];

/** Vendas de balcão. pay: formas na ordem; [cash, valor entregue] gera troco. */
const SALES = [
  { items: [['Ração cães adultos 15 kg', 1], ['Petisco bifinho 65 g', 2]], pay: ['pix'], tutor: true },
  { items: [['Sachê gatos 85 g', 6], ['Areia sanitária 4 kg', 1]], pay: ['debit_card'], tutor: true },
  { items: [['Ração premium a granel', 2.5]], pay: [['cash', 50]] },
  { items: [['Antipulgas cães 10–20 kg', 1], ['Vermífugo cães 10 kg (2 comprimidos)', 1]], pay: ['credit_card'], tutor: true },
  { items: [['Tapete higiênico 30 un', 2]], pay: ['pix'], discount: 5, notes: 'Desconto de R$ 5 na segunda unidade.' },
  { items: [['Coleira ajustável M', 1], ['Brinquedo mordedor de corda', 1]], pay: [['cash', 100]] },
  { items: [['Ração gatos castrados 10 kg', 1], ['Sachê gatos 85 g', 12]], pay: ['pix', 'credit_card'], tutor: true },
  { items: [['Cama pet média', 1]], pay: ['on_account'], tutor: true, notes: 'Fiado: tutor acerta no próximo banho.' },
  { items: [['Shampoo neutro pet 500 ml', 1], ['Condicionador hidratante 500 ml', 1]], pay: ['debit_card'] },
  { items: [['Arranhador para gatos', 1]], pay: ['credit_card'], tutor: true },
  { items: [['Petisco bifinho 65 g', 3]], pay: [['cash', 30]] },
  { items: [['Ração filhotes 3 kg', 2]], pay: ['pix'], tutor: true, cancel: 'Cliente trocou pelo sabor cordeiro, sem estoque' },
  { items: [['Ração cães adultos 15 kg', 2]], pay: ['pix'], tutor: true, discount: 18.99, notes: '5% de desconto para cliente fiel.' },
  { items: [['Ração premium a granel', 1.2], ['Petisco bifinho 65 g', 1]], pay: ['debit_card'] },
];

const CANCEL_REASONS = ['Tutor remarcou por viagem', 'Pet com diarreia, tutor preferiu adiar', 'Cancelado pelo tutor pelo WhatsApp', 'Chuva forte, tutor não conseguiu trazer'];
const NOTES = ['Tutor pediu laço e perfume suave.', 'Atenção: otite no ouvido esquerdo, não molhar.', 'Usar shampoo hipoalergênico.', 'Buscar às 17h (tutor avisou).', 'Leva e traz: tutor pediu táxi dog.', null, null, null];
const PAY_METHODS = ['pix', 'pix', 'pix', 'credit_card', 'debit_card', 'cash'];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log, tenant } = ctx;

  await step(log, 'Pix (chave de demonstração)', async () => {
    const current = await api.get('/modules/integration.payments/settings');
    if (current.pixKey) return log('    Pix já configurado');
    await api.put('/modules/integration.payments/settings', { pixKey: `pix@${tenant.name}.demo`, merchantName: 'Pet Shop Demonstracao', merchantCity: 'Sao Paulo' });
  });

  await step(log, 'agenda online ligada', async () => {
    const current = await api.get('/modules/shared.scheduling/settings');
    if (current.onlineBooking) return log('    agendamento online já ligado');
    await api.put('/modules/shared.scheduling/settings', { ...current, onlineBooking: true });
  });

  await step(log, 'conta do PDV (Pix e cartões no banco)', async () => {
    const current = await api.get('/modules/shared.sales/settings');
    if (current.bankAccountId) return log('    conta já definida');
    const bank = (await api.get('/scheduling/payment-accounts')).find((a) => a.type === 'bank');
    if (!bank) return log('    sem conta bancária no financeiro, pulado');
    await api.put('/modules/shared.sales/settings', { ...current, bankAccountId: bank.id, receiptFooter: 'Obrigado! Seu pet agradece. Volte sempre!' });
  });

  await step(log, 'serviços de banho e tosa', () => seedServices(ctx));
  await step(log, 'equipe da agenda e expediente', () => seedResources(ctx));
  await step(log, 'folgas e bloqueios', () => seedTimeOff(ctx));
  const pets = (await step(log, 'pets', () => seedPets(ctx))) ?? [];
  await step(log, 'agenda: histórico e próximos dias', () => seedAgenda(ctx, pets));
  await step(log, 'quadro do banho e tosa de hoje', () => seedToday(ctx, pets));
  await step(log, 'produtos', () => seedProducts(ctx));
  await step(log, 'estoque (entradas, perda e inventário)', () => seedStock(ctx));
  await step(log, 'vendas no PDV', () => seedSales(ctx));
}

// ---- Agenda: configuração ----------------------------------------------------------------------

async function seedServices({ api, log }) {
  const existing = await api.get('/scheduling/services');
  const missing = SERVICES.filter((s) => !existing.some((e) => e.name === s.name));
  if (!missing.length) return log(`    já tem ${existing.length} serviços`);
  for (const s of missing) await api.post('/scheduling/services', { bufferMin: 0, online: true, active: true, ...s });
  log(`    ${missing.length} serviços criados`);
}

async function seedResources({ api, log }) {
  const existing = await api.get('/scheduling/resources');
  if (existing.length >= 5) return log(`    já tem ${existing.length} profissionais`);

  const services = await api.get('/scheduling/services');
  // Quem tem o papel de banho e tosa vira profissional da agenda (ligado ao usuário).
  const members = await api.get('/users');
  const groomers = members.filter((m) => m.roles.some((r) => r.key === 'petshop.groomer'));
  const team = TEAM.map((t, i) => (groomers[i] ? { ...t, name: groomers[i].user.name, userId: groomers[i].user.id } : t));

  let created = 0;
  for (const t of team) {
    if (existing.some((e) => e.name === t.name)) continue;
    const serviceIds = services.filter((s) => t.role === 'tosa' || BATH_ONLY(s)).map((s) => s.id);
    const { id } = await api.post('/scheduling/resources', { name: t.name, kind: 'professional', userId: t.userId ?? null, color: t.color, active: true, serviceIds });
    await api.put(`/scheduling/resources/${id}/hours`, { hours: t.hours });
    created++;
  }
  log(`    ${created} profissionais com expediente`);
}

async function seedTimeOff({ api, log }) {
  const existing = await api.get('/scheduling/time-off', { from: at(-1, 0), to: at(30, 0) });
  if (existing.length) return log(`    já tem ${existing.length} bloqueios`);
  const resources = await api.get('/scheduling/resources');
  const pick = (i) => resources.find((r) => r.name === TEAM[i].name) ?? resources[i];
  const blocks = [
    [pick(1), nextWeekday(3, [2, 3, 4, 5]), '08:00', '18:00', 'Folga (banco de horas)'],
    [pick(2), nextWeekday(2, [1, 2, 3, 4, 5]), '14:00', '16:00', 'Consulta médica'],
    [pick(0), nextWeekday(9, [1, 2, 3, 4, 5]), '13:00', '18:00', 'Curso de tosa asiática'],
  ];
  for (const [r, n, start, end, reason] of blocks) {
    if (!r) continue;
    await api.post(`/scheduling/resources/${r.id}/time-off`, { startsAt: `${day(n)}T${start}:00-03:00`, endsAt: `${day(n)}T${end}:00-03:00`, reason });
  }
  log(`    ${blocks.length} bloqueios na agenda`);
}

// ---- Pets ----------------------------------------------------------------------------------------

async function seedPets({ api, log, customers }) {
  const existing = await api.get('/pets', { limit: 200 });
  if (existing.length >= 8) {
    log(`    já tem ${existing.length} pets`);
    return existing.filter((p) => !p.deceased);
  }
  const tutors = customers.filter((c) => c.type === 'person');
  if (!tutors.length) throw new Error('nenhum cliente pessoa física para ser tutor');
  let created = 0;
  for (const [i, pet] of PETS.entries()) {
    if (existing.some((e) => e.name === pet.name)) continue;
    await api.post('/pets', { ...pet, customerId: tutors[i % tutors.length].id });
    created++;
  }
  log(`    ${created} pets cadastrados`);
  return (await api.get('/pets', { limit: 200 })).filter((p) => !p.deceased);
}

// ---- Agenda: atendimentos ----------------------------------------------------------------------

/** Serviços do atendimento conforme espécie e porte, às vezes com um adicional. */
function servicesFor(pet, services, rng) {
  const byName = (name) => services.find((s) => s.name === name && s.active);
  const porte = pet.size === 'small' ? 'pequeno' : pet.size === 'medium' ? 'médio' : 'grande';
  const main =
    pet.species === 'cat'
      ? byName('Banho em gatos') ?? byName('Banho — porte pequeno')
      : byName(rng.chance(0.5) ? `Banho e tosa — porte ${porte}` : `Banho — porte ${porte}`);
  const list = [main ?? services.find((s) => s.active)];
  if (pet.species === 'dog' && rng.chance(0.35)) {
    const extra = byName(rng.pick(['Hidratação de pelos', 'Corte de unhas', 'Escovação de dentes']));
    if (extra) list.push(extra);
  }
  return list.map((s) => s.id);
}

async function loadAgenda(api, fromDay, toDay) {
  const [resources, services, appointments, timeOff] = await Promise.all([
    api.get('/scheduling/resources'),
    api.get('/scheduling/services'),
    api.get('/scheduling/appointments', { from: at(fromDay, 0), to: at(toDay, 0) }),
    api.get('/scheduling/time-off', { from: at(fromDay, 0), to: at(toDay, 0) }),
  ]);
  const busy = [...appointments.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show'), ...timeOff];
  return { resources, services, appointments, planner: createPlanner(resources, services, busy) };
}

async function seedAgenda(ctx, pets) {
  const { api, rng, log } = ctx;
  if (!pets.length) throw new Error('sem pets para agendar');
  const { services, appointments, planner } = await loadAgenda(api, -30, 16);
  // Dia a dia: só preenche os dias ainda vazios (uma rodada interrompida é completada).
  const filled = new Set(appointments.map((a) => localDate(a.startsAt)));
  const accounts = await paymentAccounts(api);

  const counts = {};
  const tally = (s) => (counts[s] = (counts[s] ?? 0) + 1);
  let k = 0;

  // Últimas duas semanas: a maioria concluída e paga, algumas faltas e cancelamentos.
  for (let n = -14; n <= -1; n++) {
    if (filled.has(day(n))) continue;
    const perDay = rng.int(2, 4);
    for (let j = 0; j < perDay; j++, k++) {
      const pet = pets[k % pets.length];
      const a = await book(api, planner, { pet, serviceIds: servicesFor(pet, services, rng), n, fromMin: rng.pick([480, 540, 600, 780, 840, 900]), rot: k, notes: rng.pick(NOTES) });
      if (!a) continue;
      const r = rng.next();
      if (r < 0.08) {
        await setStatus(api, a.id, 'no_show');
        tally('faltou');
      } else if (r < 0.16) {
        await setStatus(api, a.id, 'cancelled', rng.pick(CANCEL_REASONS));
        tally('cancelado');
      } else {
        await setStatus(api, a.id, 'done');
        tally('concluído');
        if (rng.chance(0.88)) await pay(api, a, accounts, rng.pick(PAY_METHODS), day(n));
        else tally('a receber');
      }
    }
  }

  // Próximos 7 dias: marcados, os mais próximos já confirmados, um cancelado.
  for (let n = 1; n <= 7; n++) {
    if (filled.has(day(n))) continue;
    const perDay = rng.int(2, 3);
    for (let j = 0; j < perDay; j++, k++) {
      const pet = pets[k % pets.length];
      const a = await book(api, planner, { pet, serviceIds: servicesFor(pet, services, rng), n, fromMin: rng.pick([480, 540, 600, 780, 840]), rot: k, notes: rng.pick(NOTES) });
      if (!a) continue;
      if (n === 4 && j === 0) {
        await setStatus(api, a.id, 'cancelled', 'Tutor vai viajar, remarca na volta');
        tally('cancelado');
      } else if (n <= 2 && rng.chance(0.6)) {
        await setStatus(api, a.id, 'confirmed');
        tally('confirmado');
      } else tally('agendado');
    }
  }
  log(`    ${Object.entries(counts).map(([s, c]) => `${c} ${s}`).join(', ')}`);
}

/** Hoje: um pet em cada etapa do quadro (a chegar, na loja, no banho, pronto). */
async function seedToday(ctx, pets) {
  const { api, rng, log } = ctx;
  if (!pets.length) throw new Error('sem pets para agendar');
  const { resources, services, appointments, planner } = await loadAgenda(api, -45, 1);

  // Atendimentos de dias anteriores que ficaram abertos (de execuções passadas) são encerrados.
  const stale = appointments.filter((a) => localDate(a.startsAt) < day(0) && ['scheduled', 'confirmed', 'arrived', 'in_service'].includes(a.status));
  for (const a of stale) await setStatus(api, a.id, 'done');
  if (stale.length) log(`    ${stale.length} atendimentos antigos encerrados`);

  const today = appointments.filter((a) => localDate(a.startsAt) === day(0));
  if (today.length >= 4) return log(`    hoje já tem ${today.length} atendimentos`);
  const wd = weekdayOf(0);
  if (!resources.some((r) => r.hours.some((h) => h.weekday === wd))) return log('    loja fechada hoje, quadro pulado');
  const accounts = await paymentAccounts(api);

  const stages = [
    ['arrived', 'in_service', 'done', 'pay'],
    ['arrived', 'in_service', 'done'],
    ['arrived', 'in_service'],
    ['arrived', 'in_service'],
    ['arrived'],
    ['confirmed'],
    [],
    [],
  ];
  const starts = [480, 480, 510, 540, 600, 780, 840, 900];
  const order = rng.shuffle(pets);
  let created = 0;
  for (const [i, path] of stages.entries()) {
    const pet = order[i % order.length];
    const a = await book(api, planner, { pet, serviceIds: servicesFor(pet, services, rng), n: 0, fromMin: starts[i], rot: i, notes: rng.pick(NOTES) });
    if (!a) continue;
    for (const s of path) {
      if (s === 'pay') await pay(api, a, accounts, 'pix', day(0));
      else await setStatus(api, a.id, s);
    }
    created++;
  }
  log(`    ${created} pets no quadro de hoje`);
}

// ---- Loja ----------------------------------------------------------------------------------------

async function seedProducts({ api, log }) {
  const existing = await api.get('/sales/products', { limit: 500 });
  let created = 0;
  let completed = 0;
  for (const [i, p] of PRODUCTS.entries()) {
    const { buy: _buy, ...data } = p;
    const extra = { sku: `PET-${String(i + 1).padStart(3, '0')}`, barcode: ean13(`7891234${String(50100 + i * 7).padStart(5, '0')}`) };
    const found = existing.find((e) => e.name === p.name);
    if (!found) {
      await api.post('/sales/products', { ...data, ...extra, trackStock: true, active: true });
      created++;
    } else if (found.minStock == null) {
      // Produto criado ao ativar o módulo: completa custo, estoque mínimo e código de barras.
      await api.patch(`/sales/products/${found.id}`, { ...extra, cost: p.cost, minStock: p.minStock });
      completed++;
    }
  }
  if (!created && !completed) return log(`    já tem ${existing.length} produtos`);
  log(`    ${created} produtos criados, ${completed} completados`);
}

async function seedStock({ api, log }) {
  const products = await api.get('/sales/products', { limit: 500 });
  let moves = 0;
  for (const p of PRODUCTS) {
    const product = products.find((e) => e.name === p.name);
    if (!product || !product.trackStock) continue;
    if ((await api.get(`/sales/products/${product.id}/moves`)).length) continue;
    await api.post('/sales/stock-moves', { productId: product.id, kind: 'purchase', quantity: p.buy, unitCost: p.cost, reason: `NF ${4100 + moves} — Distribuidora PetMix` });
    moves++;
    if (p.name === 'Sachê gatos 85 g') {
      await api.post('/sales/stock-moves', { productId: product.id, kind: 'loss', quantity: 6, reason: 'Validade vencida' });
      moves++;
    }
    if (p.name === 'Petisco bifinho 65 g') {
      await api.post('/sales/stock-moves', { productId: product.id, kind: 'count', quantity: p.buy - 1, reason: 'Inventário mensal' });
      moves++;
    }
  }
  log(moves ? `    ${moves} movimentos de estoque` : '    estoque já lançado');
}

async function seedSales({ api, rng, log, customers }) {
  const existing = await api.get('/sales', { from: day(-365), to: day(0), limit: 500 });
  if (existing.length >= 10) return log(`    já tem ${existing.length} vendas`);
  const products = await api.get('/sales/products', { limit: 500 });
  const tutors = customers.filter((c) => c.type === 'person');

  let count = 0;
  let cancelled = 0;
  for (const s of SALES) {
    const items = s.items
      .map(([name, quantity]) => ({ product: products.find((p) => p.name === name && p.active), quantity }))
      .filter((i) => i.product);
    if (!items.length) continue;
    const totalCents = items.reduce((sum, i) => sum + Math.round(i.quantity * Math.round(i.product.price * 100)), 0) - Math.round((s.discount ?? 0) * 100);
    const customerId = s.tutor && tutors.length ? rng.pick(tutors).id : null;
    const sale = await api.post('/sales', {
      customerId,
      items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
      discount: s.discount ?? 0,
      payments: splitPayments(s.pay, totalCents, !!customerId),
      notes: s.notes ?? null,
    });
    count++;
    if (s.cancel) {
      await api.post(`/sales/${sale.id}/cancel`, { reason: s.cancel });
      cancelled++;
    }
  }
  log(`    ${count} vendas (${cancelled} cancelada)`);
}

/** Pagamentos que fecham o total: dividido entre duas formas, ou dinheiro com troco. */
function splitPayments(pay, totalCents, hasCustomer) {
  const methods = pay.map((p) => (Array.isArray(p) ? p[0] : p)).map((m) => (m === 'on_account' && !hasCustomer ? 'pix' : m));
  if (methods.length === 2) {
    const first = Math.round(totalCents / 2);
    return [
      { method: methods[0], amount: first / 100 },
      { method: methods[1], amount: (totalCents - first) / 100 },
    ];
  }
  const given = Array.isArray(pay[0]) ? pay[0][1] * 100 : 0;
  const cents = methods[0] === 'cash' ? Math.max(given, Math.ceil(totalCents / 1000) * 1000) : totalCents;
  return [{ method: methods[0], amount: cents / 100 }];
}

// ---- utilitários -------------------------------------------------------------------------------

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const weekdayOf = (n) => new Date(`${day(n)}T12:00:00-03:00`).getUTCDay();
const localDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

/** Próximo dia (a partir de n) cujo dia da semana está na lista. */
function nextWeekday(n, weekdays) {
  for (let i = n; ; i++) if (weekdays.includes(weekdayOf(i))) return i;
}

/**
 * Encontra horários livres dentro do expediente, sem sobrepor atendimentos e bloqueios do
 * profissional (a mesma regra do banco). Reveza os profissionais para dividir a agenda.
 */
function createPlanner(resources, services, busyList) {
  const busy = new Map(resources.map((r) => [r.id, []]));
  for (const b of busyList) busy.get(b.resourceId)?.push({ start: Date.parse(b.startsAt), end: Date.parse(b.endsAt) });
  const svc = (id) => services.find((s) => s.id === id);
  const canDo = (r, ids) => r.active && r.kind === 'professional' && ids.every((id) => !svc(id).resourceIds.length || svc(id).resourceIds.includes(r.id));

  return {
    find(n, fromMin, serviceIds, rot = 0) {
      const duration = serviceIds.reduce((sum, id) => sum + svc(id).durationMin + svc(id).bufferMin, 0);
      const wd = weekdayOf(n);
      const candidates = resources.filter((r) => canDo(r, serviceIds));
      const rotated = candidates.map((_, i) => candidates[(i + rot) % candidates.length]);
      for (const r of rotated) {
        for (const w of r.hours.filter((h) => h.weekday === wd).sort((a, b) => a.start.localeCompare(b.start))) {
          for (let t = Math.max(toMin(w.start), fromMin); t + duration <= toMin(w.end); t += 15) {
            const startsAt = at(n, Math.floor(t / 60), t % 60);
            const start = Date.parse(startsAt);
            const end = start + duration * 60_000;
            if (busy.get(r.id).some((b) => b.start < end && b.end > start)) continue;
            busy.get(r.id).push({ start, end });
            return { resourceId: r.id, startsAt };
          }
        }
      }
      return null;
    },
  };
}

/** Marca o horário do pet no primeiro espaço livre a partir de fromMin (minutos desde 0h). */
async function book(api, planner, { pet, serviceIds, n, fromMin, rot, notes }) {
  const slot = planner.find(n, fromMin, serviceIds, rot) ?? planner.find(n, 480, serviceIds, rot);
  if (!slot) return null;
  return api.post('/scheduling/appointments', { overrideSchedule: true,
    customerId: pet.customerId,
    resourceId: slot.resourceId,
    startsAt: slot.startsAt,
    serviceIds,
    notes: notes ?? null,
    subject: { type: 'pet', id: pet.id, label: pet.name },
  });
}

const setStatus = (api, id, status, reason) => api.post(`/scheduling/appointments/${id}/status`, { status, reason: reason ?? null });

async function paymentAccounts(api) {
  const accounts = await api.get('/scheduling/payment-accounts');
  const cash = accounts.find((a) => a.type === 'cash') ?? accounts[0];
  const bank = accounts.find((a) => a.type === 'bank') ?? cash;
  if (!cash) throw new Error('nenhuma conta no financeiro');
  return { cash, bank };
}

function pay(api, appointment, { cash, bank }, method, paidAt) {
  if (!(appointment.total > 0)) return null;
  return api.post(`/scheduling/appointments/${appointment.id}/payments`, { amount: appointment.total, method, accountId: method === 'cash' ? cash.id : bank.id, paidAt });
}

/** EAN-13 com dígito verificador (só para os códigos parecerem reais). */
function ean13(base12) {
  const sum = [...base12].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (sum % 10)) % 10);
}
