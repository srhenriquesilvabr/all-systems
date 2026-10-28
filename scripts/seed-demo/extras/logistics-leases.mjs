// Fluxos novos da lavanderia e da imobiliária:
// - fake-lavanderia: coletas e entregas ("Coletas e entregas" e "Minhas rotas") com um motorista
//   convidado: as da semana passada já feitas (registradas com o horário em que aconteceram, uma
//   entrega que não deu certo), a rota de hoje em várias situações e a de amanhã já montada;
// - fake-imobiliaria: contratos de locação ativos, com aluguéis recebidos, um inquilino em atraso
//   e os repasses aos proprietários dos meses recebidos.
// Pode rodar de novo: cada tarefa/contrato é achado pelo que o identifica e só anda o que falta.
import { seedPropertyPhotos } from '../photos.mjs';
import { createRng, day, step } from '../lib.mjs';
import { pickers } from '../verticals/_banking.mjs';

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  // Semente própria: as outras etapas de extras/ consomem o rng comum em quantidades que variam.
  const own = { ...ctx, rng: createRng(`${ctx.tenant.name}:logistics-leases`) };
  if (ctx.tenant.name === 'fake-lavanderia') await seedLaundryLogistics(own);
  if (ctx.tenant.name === 'fake-imobiliaria') await seedLeases(own);
}

// ================================================================================================
// Lavanderia: coletas e entregas
// ================================================================================================

/** Mesma janela que o módulo grava para cada período (a tarefa é achada pelo início da janela). */
const PERIOD_START = { morning: '08:00', afternoon: '12:00', evening: '18:00' };
const PIECE_STAGES = ['washing', 'drying', 'ironing', 'ready'];

const DRIVER = { name: 'Marcos Ferreira', email: 'marcos.ferreira+fake.lavanderia@example.com' };
const DEFAULT_FEES = { pickupFee: 12, deliveryFee: 15 };

/**
 * Rota de hoje, com o motorista (`driver: 'me'` = quem roda o seed). `target` é onde a tarefa termina: concluída, em rota, não
 * realizada ou ainda agendada. Coletas indicam o cliente (`who`); entregas pegam uma ordem pronta.
 * `order` na coleta concluída abre a ordem no balcão ligada a ela (como a tela faz).
 */
const TODAY_ROUTE = [
  {
    kind: 'pickup', window: ['08:00', '09:00'], who: 'p0', fee: 12, target: 'done', feeMethod: 'pix',
    notes: 'Peças separadas na portaria, em nome do morador.',
    order: [
      { service: 'Lavar e passar', garment: 'Camisa', quantity: 6, color: 'social, cores variadas' },
      { service: 'Lavar e passar', garment: 'Calça', quantity: 3 },
    ],
  },
  { kind: 'delivery', window: ['08:30', '09:30'], fee: 15, target: 'done', feeMethod: 'cash', collect: 'pix', receiver: 'Sr. Antônio (porteiro)' },
  { kind: 'delivery', window: ['09:30', '10:30'], fee: 15, target: 'failed', reason: 'Cliente ausente e a portaria não estava autorizada a receber' },
  {
    kind: 'pickup', window: ['10:30', '11:30'], who: 'c0', fee: 0, target: 'done', itemsCount: 38,
    notes: 'Coleta semanal do contrato: toalhas e uniformes. Sem taxa.',
  },
  { kind: 'delivery', window: ['13:00', '14:00'], fee: 15, target: 'en_route', notes: 'Cobrar o saldo na entrega (Pix ou cartão).' },
  // As duas da tarde ficam com quem roda o seed (o dono): aparecem em "Minhas rotas" de quem demonstra.
  { kind: 'pickup', window: ['14:30', '15:30'], who: 'p5', fee: 12, target: 'scheduled', driver: 'me', notes: 'Edredom e duas cortinas. Ligar ao chegar.' },
  { kind: 'delivery', window: ['16:00', '17:00'], fee: 15, target: 'scheduled', driver: 'me', notes: 'Entregar no apartamento; não deixar com o porteiro.' },
];

/**
 * Semana passada (dias úteis; `weekday` 0 = segunda): coletas e entregas já feitas pelo motorista,
 * registradas com o horário de saída e de conclusão (o cliente não é avisado de nada que já passou) e
 * a taxa recebida na data da conclusão. Uma entrega não deu certo e ficou para o escritório reagendar.
 */
const LAST_WEEK_ROUTE = [
  { weekday: 0, kind: 'pickup', window: ['08:00', '09:00'], who: 'p1', fee: 12, target: 'done', feeMethod: 'pix', itemsCount: 9 },
  { weekday: 0, kind: 'delivery', window: ['14:00', '15:00'], fee: 15, target: 'done', feeMethod: 'cash', receiver: 'Dona Cida (moradora)' },
  {
    weekday: 1, kind: 'pickup', window: ['08:30', '09:30'], who: 'c0', fee: 0, target: 'done', itemsCount: 42,
    notes: 'Coleta semanal do contrato: toalhas e uniformes. Sem taxa.',
  },
  { weekday: 1, kind: 'delivery', window: ['10:00', '11:00'], fee: 15, target: 'done', feeMethod: 'pix', collect: 'pix', receiver: 'Sr. Antônio (porteiro)' },
  { weekday: 2, kind: 'delivery', window: ['09:00', '10:00'], fee: 15, target: 'failed', reason: 'Endereço não encontrado: número não confere com o da rua' },
  { weekday: 2, kind: 'pickup', window: ['15:00', '16:00'], who: 'p3', fee: 12, target: 'done', feeMethod: 'cash', itemsCount: 4, notes: 'Edredom e duas capas de almofada.' },
  { weekday: 3, kind: 'pickup', window: ['08:00', '09:00'], who: 'c1', fee: 0, target: 'done', itemsCount: 27, notes: 'Coleta semanal do contrato.' },
  // Taxa não recebida na entrega: fica "a receber" no financeiro.
  { weekday: 3, kind: 'delivery', window: ['13:30', '14:30'], fee: 15, target: 'done' },
  { weekday: 4, kind: 'delivery', window: ['09:30', '10:30'], fee: 15, target: 'done', feeMethod: 'debit_card', receiver: 'Recepção do prédio' },
  {
    weekday: 4, kind: 'pickup', window: ['16:00', '17:00'], who: 'p4', fee: 12, target: 'done', feeMethod: 'pix',
    notes: 'Cliente pediu orçamento de lavagem a seco do terno.',
    order: [
      { service: 'Lavagem a seco', garment: 'Terno', quantity: 1, color: 'azul-marinho' },
      { service: 'Lavar e passar', garment: 'Camisa', quantity: 4, color: 'social, cores variadas' },
    ],
  },
  { weekday: 4, kind: 'delivery', window: ['17:00', '18:00'], fee: 15, target: 'done', feeMethod: 'pix' },
];

/** Amanhã: parte já com o motorista, parte ainda sem ninguém (aparece em "sem motorista"). */
const TOMORROW_ROUTE = [
  { kind: 'pickup', period: 'morning', who: 'c1', fee: 0, driver: true, notes: 'Coleta semanal do contrato.' },
  { kind: 'delivery', window: ['10:00', '11:00'], fee: 15, driver: true },
  { kind: 'pickup', period: 'afternoon', who: 'p6', fee: 12, driver: false, notes: 'Terno e dois vestidos de festa para lavagem a seco.' },
  { kind: 'delivery', window: ['15:00', '16:00'], fee: 15, driver: false },
];

/** Ordens novas quando faltam ordens prontas (ou em produção) para as entregas do plano. */
const FILLER_ORDERS = [
  [{ service: 'Lavar e passar', garment: 'Camisa', quantity: 4, color: 'branca' }, { service: 'Lavar e passar', garment: 'Calça', quantity: 2 }],
  [{ service: 'Lavagem de edredom', garment: 'Edredom', quantity: 1, color: 'azul' }, { service: 'Lavar e passar', garment: 'Lençol', quantity: 2 }],
  [{ service: 'Lavagem a seco', garment: 'Terno', quantity: 1, color: 'grafite' }, { service: 'Lavar e passar', garment: 'Camisa', quantity: 3 }],
  [{ service: 'Lavar e passar', garment: 'Vestido', quantity: 2 }, { service: 'Lavar e passar', garment: 'Blusa', quantity: 3 }],
];

async function seedLaundryLogistics(ctx) {
  const { api, log } = ctx;
  await step(log, 'taxas padrão de coleta e entrega', () => seedDefaultFees(ctx));
  const driver = await step(log, 'motorista (convite com o papel Motorista)', () => ensureDriver(ctx));
  const lx = await step(log, 'catálogo e contas para as ordens', () => laundryContext(ctx));
  if (!lx) return;
  const me = (await api.get('/me').catch(() => null))?.user ?? driver;
  const drivers = { driver, me };
  await step(log, 'coletas e entregas da semana passada', async () => {
    const monday = lastWeekMonday();
    for (const weekday of [0, 1, 2, 3, 4]) {
      await seedRoute(ctx, lx, day(monday + weekday), LAST_WEEK_ROUTE.filter((p) => p.weekday === weekday), drivers);
    }
  });
  await step(log, 'rota de hoje', () => seedRoute(ctx, lx, day(0), TODAY_ROUTE, drivers));
  await step(log, 'rota de amanhã', () => seedRoute(ctx, lx, day(1), TOMORROW_ROUTE, drivers));
}

async function seedDefaultFees({ api, log }) {
  const current = await api.get('/modules/laundry/settings');
  if (current.pickupFee || current.deliveryFee) return log(`    já configuradas (coleta R$ ${current.pickupFee}, entrega R$ ${current.deliveryFee})`);
  await api.put('/modules/laundry/settings', { ...current, ...DEFAULT_FEES });
}

/**
 * Motorista da equipe: quem já tem o papel, ou um convite novo. O convite fica pendente (e-mail
 * @example.com), mas a pessoa já é da equipe e pode receber tarefas.
 */
async function ensureDriver({ api, log }) {
  const roles = await api.get('/access/roles');
  let role = roles.find((r) => r.key === 'laundry.driver') ?? roles.find((r) => r.label === 'Motorista');
  if (!role) {
    // Empresa ainda sem o papel padrão (módulo atualizado depois): cria um equivalente.
    role = await api.post('/access/roles', { label: 'Motorista', permissions: ['laundry.logistics.drive'] });
  }
  const isDriver = (m) => m.status === 'active' && m.roles.some((r) => r.id === role.id);
  let members = await api.get('/users');
  if (!members.some(isDriver)) {
    const byEmail = members.find((m) => m.user.email === DRIVER.email);
    if (byEmail) await api.patch(`/users/${byEmail.membershipId}`, { roleIds: [...byEmail.roles.map((r) => r.id), role.id] });
    else await api.post('/users/invite', { email: DRIVER.email, name: DRIVER.name, roleIds: [role.id] });
    members = await api.get('/users');
  }
  const m = members.find(isDriver);
  if (!m) throw new Error('motorista não encontrado depois do convite');
  log(`    ${m.user.name}${m.pendingInvite ? ' (convite pendente)' : ''}`);
  return { id: m.user.id, name: m.user.name };
}

async function laundryContext({ api }) {
  const [services, garments, accounts] = await Promise.all([
    api.get('/laundry/services'),
    api.get('/laundry/garment-types'),
    api.get('/service-orders/payment-accounts'),
  ]);
  const bank = accounts.find((a) => a.type === 'bank') ?? accounts[0];
  if (!bank) throw new Error('nenhuma conta financeira para receber pagamentos');
  return {
    bank,
    serviceId(name) {
      const s = services.find((x) => x.name === name && x.active);
      if (!s) throw new Error(`serviço "${name}" não encontrado`);
      return s.id;
    },
    garmentId: (name) => (name ? (garments.find((g) => g.name === name)?.id ?? null) : null),
    /** Ordens já usadas nesta rodada (a mesma ordem não vai em duas entregas). */
    used: new Set(),
  };
}

/**
 * Cria a tarefa que falta em cada horário do dia e leva cada uma até a situação do plano. Num dia que
 * já passou, a tarefa é registrada depois: saída e conclusão com o horário em que aconteceram.
 */
async function seedRoute(ctx, lx, date, plan, drivers) {
  const { api, log } = ctx;
  const who = pickers(ctx.customers);
  const existing = await api.get('/laundry/logistics/jobs', { date });
  const counts = { created: 0 };
  for (const p of plan) {
    const start = p.period ? PERIOD_START[p.period] : p.window[0];
    let job = existing.find((j) => j.kind === p.kind && j.windowStart === start);
    const driverId = p.driver === false ? null : p.driver === 'me' ? (drivers.me?.id ?? null) : (drivers.driver?.id ?? null);
    if (!job) {
      const base = {
        date,
        ...(p.period ? { period: p.period } : { windowStart: p.window[0], windowEnd: p.window[1] }),
        fee: p.fee,
        driverUserId: driverId,
        notes: p.notes ?? null,
      };
      if (p.kind === 'pickup') {
        const customer = who(p.who);
        job = await api.post('/laundry/logistics/pickups', { customerId: customer.id, address: await jobAddress(api, customer), ...base });
      } else {
        const order = await orderForDelivery(ctx, lx, p.target === undefined ? 'in_process' : 'ready', date);
        job = await api.post(`/laundry/orders/${order.id}/delivery`, { address: await jobAddress(api, order.customer), ...base });
      }
      counts.created++;
    } else if (driverId && !job.driver && (job.status === 'scheduled' || job.status === 'failed')) {
      job = await api.patch(`/laundry/logistics/jobs/${job.id}`, { driverUserId: driverId });
    }
    job = await driveJob(ctx, lx, job, p, date < day(0) ? whenFor(date, p) : null);
    counts[job.status] = (counts[job.status] ?? 0) + 1;
  }
  const { created, ...byStatus } = counts;
  log(`    ${date}: ${created} criadas; ${Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(', ')}`);
}

/** Endereço do cadastro do cliente; sem endereço cadastrado, um de demonstração. */
async function jobAddress(api, customer) {
  const c = await api.get(`/customers/${customer.id}`).catch(() => null);
  const a = c?.address ?? {};
  if (a.street || a.zip) return null; // o módulo usa o do cadastro
  return { street: 'Rua Cardeal Arcoverde', number: String(100 + (customer.name.length * 37) % 1900), district: 'Pinheiros', city: 'São Paulo', state: 'SP', zip: '05407-001' };
}

/**
 * Ordem para a entrega do dia `date`: primeiro as que já estão no status pedido e sem entrega
 * agendada (num dia que já passou, só as que entraram até dois dias antes: a entrega não pode ser
 * antes da entrada); se faltar, abre uma nova (com entrada dois dias antes) e leva as peças até lá.
 */
async function orderForDelivery(ctx, lx, status, date) {
  const { api } = ctx;
  const latest = date < day(0) ? new Date(`${addDays(date, -2)}T12:00:00-03:00`).getTime() : Infinity;
  const { items } = await api.get('/service-orders', { workflow: 'laundry', status, limit: 50 });
  for (const o of items) {
    if (lx.used.has(o.id) || Date.parse(o.receivedAt) > latest) continue;
    lx.used.add(o.id);
    const jobs = await api.get('/laundry/logistics/jobs', { orderId: o.id });
    if (!jobs.some((j) => j.kind === 'delivery')) return o;
  }
  const people = ctx.customers.filter((c) => c.type !== 'company');
  const customer = people[(lx.used.size * 3) % people.length] ?? ctx.customers[0];
  const lines = FILLER_ORDERS[lx.used.size % FILLER_ORDERS.length];
  const { order, pieces } = await api.post('/laundry/orders', {
    customerId: customer.id,
    lines: lines.map((l) => ({ serviceId: lx.serviceId(l.service), garmentTypeId: lx.garmentId(l.garment), quantity: l.quantity, color: l.color ?? null })),
    receivedAt: addDays(date, -2),
    dueAt: `${date}T18:00:00-03:00`,
    notesCustomer: 'Cliente pediu entrega no endereço.',
  });
  // Peça a peça pelas etapas, como no quadro de produção: todas prontas deixam a ordem "Pronta".
  const ids = pieces.map((p) => p.itemId);
  const last = status === 'ready' ? 'ready' : 'washing';
  for (const s of PIECE_STAGES.slice(0, PIECE_STAGES.indexOf(last) + 1)) await api.post('/laundry/pieces/status', { itemIds: ids, status: s });
  lx.used.add(order.id);
  return { ...order, customer: order.customer ?? customer };
}

/**
 * Horários de uma tarefa de um dia que já passou: o motorista sai uns minutos depois do início da
 * janela e conclui (ou desiste) meia hora depois.
 */
function whenFor(date, p) {
  const [hh, mm] = p.window.map((w) => w.split(':').map(Number))[0];
  const iso = (plus) => {
    const m = hh * 60 + mm + plus;
    return `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00-03:00`;
  };
  return { start: iso(5), done: iso(p.target === 'failed' ? 25 : 35) };
}

/**
 * Leva a tarefa até a situação do plano, pelo mesmo caminho do motorista (sair → concluir/não deu).
 * `when` (dia que já passou): saída e conclusão registradas com o horário em que aconteceram.
 */
async function driveJob({ api }, lx, job, p, when) {
  const target = p.target ?? 'scheduled';
  if (job.status === target || job.status === 'done' || job.status === 'cancelled' || job.status === 'failed') {
    return finishPickup(api, lx, job, p, when);
  }
  if (target === 'scheduled') return job;

  const occurredAt = (moment) => (when ? { occurredAt: when[moment] } : {});
  if (job.status === 'scheduled') job = await api.post(`/laundry/logistics/jobs/${job.id}/start`, occurredAt('start'));
  if (target === 'failed') return api.post(`/laundry/logistics/jobs/${job.id}/fail`, { reason: p.reason, ...occurredAt('done') });
  if (target !== 'done') return job;

  if (job.kind === 'delivery') {
    // O motorista recebeu o saldo da ordem na entrega (no dia da entrega).
    const balance = job.order ? Math.round((job.order.total - job.order.paidAmount) * 100) / 100 : 0;
    if (p.collect && balance > 0) {
      await api.post(`/service-orders/${job.order.id}/payments`, { amount: balance, method: p.collect, accountId: lx.bank.id, paidAt: job.date });
    }
    job = await api.post(`/laundry/logistics/jobs/${job.id}/complete`, {
      receiverName: p.receiver ?? job.customer.name.split(' ')[0],
      feeMethod: p.fee > 0 ? (p.feeMethod ?? null) : null,
      ...occurredAt('done'),
    });
  } else {
    const itemsCount = p.itemsCount ?? (p.order ?? []).reduce((s, l) => s + l.quantity, 0);
    job = await api.post(`/laundry/logistics/jobs/${job.id}/complete`, {
      itemsCount: Math.max(1, itemsCount),
      feeMethod: p.fee > 0 ? (p.feeMethod ?? null) : null,
      ...occurredAt('done'),
    });
  }
  return finishPickup(api, lx, job, p, when);
}

/**
 * Coleta concluída com `order`: abre a ordem no balcão ligada à coleta (se ainda não foi aberta).
 * Coleta de um dia que já passou: a ordem entra naquele dia, logo depois da coleta.
 */
async function finishPickup(api, lx, job, p, when) {
  if (job.kind !== 'pickup' || job.status !== 'done' || !p.order || job.order) return job;
  const arrived = when ? new Date(Date.parse(job.completedAt ?? when.done) + 30 * 60_000).toISOString() : null;
  await api.post('/laundry/orders', {
    customerId: job.customer.id,
    lines: p.order.map((l) => ({ serviceId: lx.serviceId(l.service), garmentTypeId: lx.garmentId(l.garment), quantity: l.quantity, color: l.color ?? null })),
    notesInternal: 'Peças trazidas pela coleta.',
    pickupJobId: job.id,
    ...(arrived ? { receivedAt: arrived } : {}),
  });
  return api.get(`/laundry/logistics/jobs/${job.id}`);
}

/** Deslocamento (em dias a partir de hoje) da segunda-feira da semana passada. */
function lastWeekMonday() {
  const weekday = new Date(`${day(0)}T12:00:00-03:00`).getUTCDay();
  return -(weekday === 0 ? 6 : weekday - 1) - 7;
}

// ================================================================================================
// Imobiliária: locações
// ================================================================================================

const CITY = { city: 'São Paulo', state: 'SP' };

/** Imóveis de locação que só este seed cadastra (achados pelo título). */
const RENTAL_PROPERTIES = [
  {
    key: 'brooklin', owner: 'p2', purpose: 'rent', type: 'house', title: 'Casa 3 dormitórios com quintal — Brooklin',
    street: 'Rua Barão do Triunfo', number: '1350', district: 'Brooklin', zip: '04602-002',
    areaM2: 160, landM2: 250, bedrooms: 3, suites: 1, bathrooms: 3, parking: 2, rentPrice: 6200, iptuYearly: 2640, financeable: false,
    description: 'Casa térrea com quintal e churrasqueira, rua tranquila a 10 minutos do metrô Brooklin.',
  },
  {
    key: 'vilaolimpia', owner: 'c0', purpose: 'rent', type: 'office', title: 'Sala comercial de 60 m² com 2 vagas — Vila Olímpia',
    street: 'Rua Funchal', number: '418', complement: 'Conjunto 72', district: 'Vila Olímpia', zip: '04551-060',
    areaM2: 60, bedrooms: 0, suites: 0, bathrooms: 2, parking: 2, rentPrice: 5400, condoFee: 1300, iptuYearly: 3120, financeable: false,
    description: 'Andar alto, piso elevado e ar-condicionado. Prédio com recepção e controle de acesso.',
  },
  {
    key: 'mourato', owner: 'p1', purpose: 'rent', type: 'apartment', title: 'Apartamento 1 dormitório perto do metrô — Vila Madalena',
    street: 'Rua Mourato Coelho', number: '980', complement: 'Apto 34', district: 'Vila Madalena', zip: '05417-001',
    areaM2: 42, bedrooms: 1, suites: 0, bathrooms: 1, parking: 1, rentPrice: 2900, condoFee: 720, iptuYearly: 960, financeable: false,
    description: 'Reformado, cozinha americana, a 400 m do metrô Fradique Coutinho.',
  },
];

/**
 * Contratos: imóvel (título do seed da imobiliária ou acima), inquilino, início (meses atrás e dia),
 * valores e garantia. `overdue` deixa o aluguel vencido mais recente em aberto (inquilino em atraso).
 */
const LEASES = [
  {
    property: 'Studio mobiliado a duas quadras da Av. Paulista — Bela Vista', renter: 'p4', monthsAgo: 5, startDay: 1,
    rent: 2800, condoFee: 650, iptuMonthly: 75, dueDay: 5, termMonths: 30, adjustmentIndex: 'igpm', adminFeePercent: 10,
    guaranteeType: 'insurance', guaranteeProvider: 'Seguradora Fiança Paulista (demonstração)', guaranteeNumber: 'SF-2026-004812',
    notes: 'Imóvel entregue mobiliado; vistoria de entrada com 42 fotos.',
  },
  {
    property: 'Apartamento 2 dormitórios reformado — Perdizes', renter: 'p6', monthsAgo: 11, startDay: 15,
    rent: 3900, condoFee: 1050, iptuMonthly: 150, dueDay: 10, termMonths: 30, adjustmentIndex: 'ipca', adminFeePercent: 10,
    guaranteeType: 'guarantor', guarantorName: 'Roberto Almeida Teixeira',
    notes: 'Reajuste anual pelo IPCA no aniversário do contrato.',
  },
  {
    property: 'Casa 3 dormitórios com quintal — Brooklin', renter: 'p7', monthsAgo: 4, startDay: 1,
    rent: 6200, condoFee: 0, iptuMonthly: 220, dueDay: 10, termMonths: 30, adjustmentIndex: 'igpm', adminFeePercent: 8,
    guaranteeType: 'deposit', depositRents: 3,
    notes: 'Caução de três aluguéis depositada em conta poupança.',
  },
  {
    property: 'Sala comercial de 60 m² com 2 vagas — Vila Olímpia', renter: 'c1', monthsAgo: 8, startDay: 1,
    rent: 5400, condoFee: 1300, iptuMonthly: 260, dueDay: 5, termMonths: 36, adjustmentIndex: 'igpm', adminFeePercent: 8,
    guaranteeType: 'capitalization', guaranteeProvider: 'Capitaliza Brasil (demonstração)', guaranteeNumber: 'TC-883410', depositRents: 2,
    notes: 'Locação não residencial; o inquilino fez a divisória por conta própria.',
  },
  {
    property: 'Apartamento 1 dormitório perto do metrô — Vila Madalena', renter: 'p5', monthsAgo: 3, startDay: 10,
    rent: 2900, condoFee: 720, iptuMonthly: 80, dueDay: 15, termMonths: 30, adjustmentIndex: 'igpm', adminFeePercent: 10,
    guaranteeType: 'deposit', depositRents: 2, overdue: true,
    notes: 'Inquilino avisou que vai atrasar o aluguel deste mês.',
  },
];

async function seedLeases(ctx) {
  const { api, log } = ctx;
  const who = pickers(ctx.customers);
  const created = await step(log, 'imóveis para locação', () => seedRentalProperties(ctx, who));
  if (created) await seedPropertyPhotos({ api, log });

  const accounts = await api.get('/finance/accounts');
  const bank = accounts.find((a) => a.type === 'bank' && a.active !== false) ?? accounts[0];
  for (const [i, l] of LEASES.entries()) {
    const lease = await step(log, `locação: ${l.property}`, () => ensureLease(ctx, who, l));
    if (lease && bank) await step(log, `aluguéis e repasses do contrato nº ${lease.number}`, () => settleLease(ctx, lease, l, i, bank));
  }
}

/** Cadastra os imóveis de locação que faltam; devolve quantos foram criados. */
async function seedRentalProperties({ api, log }, who) {
  const existing = await api.get('/real-estate/properties');
  let created = 0;
  for (const { key, owner, ...p } of RENTAL_PROPERTIES) {
    if (existing.some((x) => x.title === p.title)) continue;
    await api.post('/real-estate/properties', { status: 'available', ...CITY, ...p, ownerId: who(owner).id });
    created++;
  }
  log(`    ${created ? `${created} imóveis cadastrados` : 'imóveis de locação já cadastrados'}`);
  return created;
}

/** O contrato do imóvel; sem contrato, assina um com início no passado (o sistema lança as mensalidades). */
async function ensureLease({ api, rng, log }, who, l) {
  const properties = await api.get('/real-estate/properties');
  const property = properties.find((p) => p.title === l.property);
  if (!property) throw new Error('imóvel não cadastrado');
  const current = (await api.get('/real-estate/leases', { propertyId: property.id })).find((x) => x.status === 'active');
  if (current) {
    log(`    contrato nº ${current.number} já existe`);
    return current;
  }

  // Imóvel marcado "Alugado" sem contrato no sistema (cadastro antigo): volta a disponível para registrar o contrato.
  if (property.status === 'rented') {
    await api.patch(`/real-estate/properties/${property.id}`, { ...property, ownerId: property.owner.id, status: 'available' });
  } else if (property.status !== 'available') {
    throw new Error(`imóvel está ${property.status}`);
  }

  let renter = who(l.renter);
  for (let i = 1; renter.id === property.owner.id && i < 10; i++) renter = who(`${l.renter[0]}${Number(l.renter.slice(1)) + i}`);
  const { property: _t, renter: _r, monthsAgo, startDay, depositRents, overdue, ...terms } = l;
  const body = {
    ...terms,
    propertyId: property.id,
    renterId: renter.id,
    startDate: monthDay(-monthsAgo, startDay),
  };
  if (l.guaranteeType === 'deposit' || l.guaranteeType === 'capitalization') body.guaranteeAmount = l.rent * (depositRents ?? 1);
  if (l.guaranteeType === 'guarantor') body.guarantorDocument = rng.cpf();
  const lease = await api.post('/real-estate/leases', body);
  log(`    contrato nº ${lease.number}: ${renter.name}, desde ${body.startDate}, ${lease.charges.length} mensalidades lançadas`);
  return lease;
}

/**
 * Baixa no financeiro dos aluguéis já vencidos (pagos perto do vencimento) e dos repasses desses
 * meses na data do repasse. No contrato `overdue`, o vencido mais recente fica em aberto.
 */
async function settleLease({ api, log }, lease, l, index, bank) {
  const today = day(0);
  const detail = await api.get(`/real-estate/leases/${lease.id}`);
  const past = detail.charges.filter((c) => c.status === 'active' && c.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const keepOpen = l.overdue ? past.at(-1)?.id : null;

  const q = `contrato ${detail.number}, imóvel`;
  const [incomes, payouts] = await Promise.all([
    api.get('/finance/entries', { kind: 'income', status: 'pending', customerId: detail.renter.id, q, limit: 200 }),
    api.get('/finance/entries', { kind: 'expense', status: 'pending', customerId: detail.owner.id, q, limit: 200 }),
  ]);
  const entryFor = (list, chargeId) => list.items.find((e) => e.sourceType === 'real_estate_lease' && e.sourceId === chargeId);

  let received = 0;
  let paidOut = 0;
  for (const c of past) {
    if (c.id === keepOpen) continue;
    let receivedAt = c.receivedAt;
    if (c.receipt !== 'paid') {
      const entry = entryFor(incomes, c.id);
      if (!entry) continue;
      // Uns pagam antes, outros um ou dois dias depois do vencimento.
      receivedAt = minDate(addDays(c.dueDate, ((c.seq * 7 + index * 3) % 6) - 3), today);
      await api.post(`/finance/entries/${entry.id}/pay`, { paidAt: receivedAt, accountId: bank.id, paymentMethod: c.seq % 3 === 0 ? 'transfer' : 'pix' });
      received++;
    }
    // Repasse ao proprietário só do que foi recebido, na data combinada (se já chegou).
    if (c.payoutStatus === 'pending' && c.payoutDate <= today) {
      const entry = entryFor(payouts, c.id);
      if (!entry) continue;
      await api.post(`/finance/entries/${entry.id}/pay`, { paidAt: maxDate(c.payoutDate, receivedAt), accountId: bank.id, paymentMethod: 'pix' });
      paidOut++;
    }
  }
  const open = keepOpen ? past.find((c) => c.id === keepOpen) : null;
  log(`    ${received} aluguéis recebidos, ${paidOut} repasses pagos${open ? `; em atraso desde ${open.dueDate}` : ''}`);
}

// ---- Datas (YYYY-MM-DD) --------------------------------------------------------------------------

/** Dia `dd` do mês a `offset` meses do mês atual (nos meses curtos, o último dia). */
function monthDay(offset, dd) {
  const [y, m] = day(0).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(dd, last));
  return first.toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);
