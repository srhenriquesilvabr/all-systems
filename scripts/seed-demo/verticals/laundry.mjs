// Lavanderia (fake-lavanderia): catálogo de serviços e preços por peça, Pix e ordens em todas as
// etapas do fluxo (recebida → produção → pronta → entrega), com pagamentos, atrasos, retrabalho e ocorrência.
import { at, day, step, workday } from '../lib.mjs';

const PIECE_STAGES = ['washing', 'drying', 'ironing', 'ready'];

/** Serviços além dos quatro que o módulo cria ao ser ativado. */
const EXTRA_SERVICES = [
  { name: 'Lavagem de edredom', pricingUnit: 'piece', basePrice: 59.9, turnaroundHours: 72 },
  { name: 'Higienização de tênis', pricingUnit: 'piece', basePrice: 39.9, turnaroundHours: 72 },
  { name: 'Lavagem de tapete', pricingUnit: 'sqm', basePrice: 24.9, turnaroundHours: 120 },
  { name: 'Lavagem de cortina', pricingUnit: 'sqm', basePrice: 18.9, turnaroundHours: 96 },
  { name: 'Expresso 24h por quilo', pricingUnit: 'kg', basePrice: 29.9, turnaroundHours: 24 },
];

const EXTRA_GARMENTS = ['Tênis', 'Gravata', 'Vestido de festa', 'Roupão', 'Uniforme', 'Almofada'];

/** Preço por tipo de peça (o que não estiver aqui usa o preço base do serviço). */
const PRICES = {
  'Lavar e passar': { Camisa: 12.9, Camiseta: 9.9, Calça: 14.9, Vestido: 24.9, Blusa: 11.9, Casaco: 34.9, Jaqueta: 29.9, Lençol: 11.9, Toalha: 7.9, Uniforme: 13.9 },
  'Só passar': { Camisa: 6.9, Calça: 7.9, Vestido: 12.9, Saia: 7.9, Lençol: 6.9 },
  'Lavagem a seco': { Terno: 69.9, Paletó: 44.9, 'Vestido de festa': 89.9, Casaco: 59.9, Gravata: 19.9, Jaqueta: 49.9 },
  'Lavagem de edredom': { Edredom: 59.9, Cobertor: 54.9, Roupão: 34.9, Almofada: 24.9 },
};

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log } = ctx;

  await step(log, 'Pix (chave de demonstração)', () => seedPix(ctx));
  await step(log, 'serviços da lavanderia', () => seedServices(ctx));
  await step(log, 'tipos de peça', () => seedGarments(ctx));
  await step(log, 'preços por tipo de peça', () => seedPrices(ctx));
  await step(log, 'ordens de serviço', async () => {
    const existing = await api.get('/service-orders', { workflow: 'laundry', limit: 1 });
    if (existing.total >= 8) return log(`    já tem ${existing.total} ordens`);
    await seedOrders(ctx);
  });
}

async function seedPix({ api, log }) {
  const current = await api.get('/modules/integration.payments/settings');
  if (current.pixKey) return log(`    chave já configurada (${current.pixKey})`);
  await api.put('/modules/integration.payments/settings', {
    ...current,
    pixKey: 'pix@fake-lavanderia.demo',
    merchantName: 'Lavanderia Demonstracao',
    merchantCity: 'Sao Paulo',
  });
}

async function seedServices({ api, log }) {
  const services = await api.get('/laundry/services');
  const missing = EXTRA_SERVICES.filter((s) => !services.some((x) => x.name === s.name));
  for (const s of missing) await api.post('/laundry/services', s);
  log(`    ${services.length} existentes, ${missing.length} criados`);
}

async function seedGarments({ api, log }) {
  const garments = await api.get('/laundry/garment-types');
  const missing = EXTRA_GARMENTS.filter((name) => !garments.some((g) => g.name === name));
  for (const name of missing) await api.post('/laundry/garment-types', { name });
  log(`    ${garments.length} existentes, ${missing.length} criados`);
}

async function seedPrices({ api, log }) {
  const [services, garments] = await Promise.all([api.get('/laundry/services'), api.get('/laundry/garment-types')]);
  for (const [serviceName, table] of Object.entries(PRICES)) {
    const service = services.find((s) => s.name === serviceName);
    if (!service) continue;
    const current = await api.get(`/laundry/services/${service.id}/prices`);
    if (current.length) continue;
    const prices = Object.entries(table)
      .map(([garment, price]) => ({ garmentTypeId: garments.find((g) => g.name === garment)?.id, price }))
      .filter((p) => p.garmentTypeId);
    await api.put(`/laundry/services/${service.id}/prices`, { prices });
    log(`    ${serviceName}: ${prices.length} preços`);
  }
}

/** Ordens em cada etapa. `stage` é até onde as peças andam; `then` é o que acontece com a ordem depois. */
function orderPlans({ customers, users }) {
  const people = customers.filter((c) => c.type !== 'company');
  const companies = customers.filter((c) => c.type === 'company');
  const person = (i) => (people.length ? people[i % people.length] : customers[i % customers.length]);
  const company = (i) => (companies.length ? companies[i % companies.length] : customers[i % customers.length]);
  const attendant = (i) => users.length ? `Atendido por ${users[i % users.length].name}.` : null;

  return [
    // Entregues e pagas (aparecem no relatório de entregas).
    {
      customer: person(0),
      dueAt: at(workday(2), 18),
      lines: [
        { service: 'Lavar e passar', garment: 'Camisa', quantity: 5, color: 'branca' },
        { service: 'Lavar e passar', garment: 'Calça', quantity: 2, color: 'azul-marinho' },
      ],
      stage: 'ready',
      payments: [{ part: 1, method: 'pix' }],
      then: ['delivered'],
      notesInternal: attendant(0),
    },
    {
      customer: person(1),
      dueAt: at(-2, 17),
      lines: [{ service: 'Lavagem a seco', garment: 'Terno', quantity: 1, brand: 'Hugo Boss', intakeNotes: 'Botão do punho esquerdo faltando' }],
      stage: 'ready',
      payments: [{ part: 1, method: 'credit_card' }],
      then: ['delivered'],
      notesCustomer: 'Cliente pediu vinco marcado na calça.',
    },
    {
      customer: company(0),
      dueAt: at(1, 10),
      lines: [
        { service: 'Lavagem por quilo', quantity: 40, weightKg: 18.4, intakeNotes: 'Toalhas de rosto e avental' },
        { service: 'Lavar e passar', garment: 'Uniforme', quantity: 8, color: 'branco' },
      ],
      stage: 'ready',
      payments: [{ part: 1, method: 'transfer' }],
      then: ['out_for_delivery', 'delivered'],
      discount: 15,
      notesInternal: 'Cliente empresa: coleta e entrega toda semana.',
    },
    // Pronta, esperando retirada (uma paga em parte, outra sem pagamento).
    {
      customer: person(2),
      dueAt: at(0, 18),
      lines: [{ service: 'Lavar e passar', garment: 'Vestido', quantity: 2, color: 'vermelho' }],
      stage: 'ready',
      payments: [{ part: 0.5, method: 'pix' }],
    },
    {
      customer: person(3),
      dueAt: at(-1, 18),
      lines: [
        { service: 'Lavagem de edredom', garment: 'Edredom', quantity: 1, color: 'bege' },
        { service: 'Só passar', garment: 'Camisa', quantity: 3 },
      ],
      stage: 'ready',
    },
    // Saiu para entrega.
    {
      customer: company(1),
      dueAt: at(0, 16),
      lines: [{ service: 'Lavagem por quilo', quantity: 25, weightKg: 9.7 }, { service: 'Lavar e passar', garment: 'Toalha', quantity: 6 }],
      stage: 'ready',
      payments: [{ part: 1, method: 'pix' }],
      then: ['out_for_delivery'],
    },
    // Em produção, dentro do prazo, com peças em etapas diferentes.
    {
      customer: person(4),
      dueAt: at(workday(2), 18),
      lines: [
        { service: 'Lavar e passar', garment: 'Camisa', quantity: 4, color: 'azul-claro' },
        { service: 'Lavar e passar', garment: 'Blusa', quantity: 2, color: 'preta', brand: 'Zara' },
      ],
      stage: 'washing',
      partial: { count: 3, stage: 'ironing' },
      payments: [{ part: 1, method: 'debit_card' }],
    },
    {
      customer: person(5),
      dueAt: at(workday(3), 12),
      lines: [{ service: 'Lavagem de tapete', garment: 'Tapete', quantity: 1, areaSqm: 6, color: 'cinza', intakeNotes: 'Mancha de vinho no canto' }],
      stage: 'drying',
      payments: [{ part: 0.5, method: 'pix' }],
      incident: 'A mancha de vinho clareou, mas não saiu por completo.',
    },
    // Atrasadas (prazo vencido e ainda em produção).
    {
      customer: person(6),
      dueAt: at(-2, 18),
      lines: [
        { service: 'Lavagem a seco', garment: 'Vestido de festa', quantity: 1, color: 'verde-esmeralda', intakeNotes: 'Bordado delicado; pedraria solta na barra' },
        { service: 'Lavagem a seco', garment: 'Paletó', quantity: 1, color: 'grafite' },
      ],
      stage: 'ironing',
      notesInternal: 'Atrasou por falta de solvente. Cliente já avisado por telefone.',
    },
    {
      customer: person(7),
      dueAt: at(-1, 12),
      lines: [{ service: 'Higienização de tênis', garment: 'Tênis', quantity: 2, brand: 'Nike', color: 'branco' }],
      stage: 'ready',
      rework: 'washing',
    },
    // Recebidas hoje, ainda na fila.
    {
      customer: person(0),
      dueAt: null,
      lines: [{ service: 'Lavagem de cortina', garment: 'Cortina', quantity: 2, areaSqm: 7.5, color: 'linho cru' }],
      stage: null,
      notesCustomer: 'Retirar os ganchos antes de lavar.',
    },
    {
      customer: person(2),
      dueAt: null,
      lines: [{ service: 'Expresso 24h por quilo', quantity: 12, weightKg: 4.2 }],
      stage: null,
      payments: [{ part: 1, method: 'cash' }],
    },
    // Cancelada.
    {
      customer: person(3),
      dueAt: at(workday(2), 18),
      lines: [{ service: 'Lavagem a seco', garment: 'Casaco', quantity: 1, color: 'camelo' }],
      stage: null,
      then: ['cancelled'],
      cancelReason: 'Cliente desistiu e retirou a peça no balcão.',
    },
  ];
}

async function seedOrders(ctx) {
  const { api, log } = ctx;
  const [services, garments, accounts] = await Promise.all([
    api.get('/laundry/services'),
    api.get('/laundry/garment-types'),
    api.get('/service-orders/payment-accounts'),
  ]);
  const serviceId = (name) => {
    const s = services.find((x) => x.name === name && x.active);
    if (!s) throw new Error(`serviço "${name}" não encontrado`);
    return s.id;
  };
  const garmentId = (name) => (name ? (garments.find((g) => g.name === name)?.id ?? null) : null);
  const cash = accounts.find((a) => a.type === 'cash') ?? accounts[0];
  const bank = accounts.find((a) => a.type === 'bank') ?? cash;
  if (!cash) throw new Error('nenhuma conta financeira para receber pagamentos');

  const counts = {};
  for (const plan of orderPlans(ctx)) {
    const { order, pieces } = await api.post('/laundry/orders', {
      customerId: plan.customer.id,
      lines: plan.lines.map((l) => ({
        serviceId: serviceId(l.service),
        garmentTypeId: garmentId(l.garment),
        quantity: l.quantity,
        weightKg: l.weightKg ?? null,
        areaSqm: l.areaSqm ?? null,
        color: l.color ?? null,
        brand: l.brand ?? null,
        intakeNotes: l.intakeNotes ?? null,
      })),
      discount: plan.discount ?? 0,
      dueAt: plan.dueAt,
      notesCustomer: plan.notesCustomer ?? null,
      notesInternal: plan.notesInternal ?? null,
    });
    const ids = pieces.map((p) => p.itemId);

    // Peças andam etapa a etapa, para o histórico de cada uma ficar completo.
    if (plan.stage) await advance(api, ids, plan.stage);
    if (plan.partial) await advance(api, ids.slice(0, plan.partial.count), plan.partial.stage, plan.stage);
    if (plan.rework) {
      // Uma peça volta da etapa "Pronta" (retrabalho): a ordem retorna para "Em produção".
      await api.post(`/laundry/pieces/${ids[0]}/status`, { status: plan.rework });
    }
    if (plan.incident) await api.post(`/laundry/pieces/${ids[0]}/incident`, { notes: plan.incident });

    for (const p of plan.payments ?? []) {
      const amount = Math.round(order.total * p.part * 100) / 100;
      if (amount <= 0) continue;
      await api.post(`/service-orders/${order.id}/payments`, {
        amount,
        method: p.method,
        accountId: p.method === 'cash' ? cash.id : bank.id,
        paidAt: day(0),
      });
    }
    for (const to of plan.then ?? []) {
      await api.post(`/service-orders/${order.id}/transition`, { to, reason: to === 'cancelled' ? plan.cancelReason : null });
    }

    const final = plan.then?.at(-1) ?? (plan.rework ? 'in_process (retrabalho)' : plan.stage === 'ready' ? 'ready' : plan.stage ? 'in_process' : 'received');
    counts[final] = (counts[final] ?? 0) + 1;
  }
  log(`    ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ')}`);
}

/** Move as peças por cada etapa até `to`, a partir da etapa seguinte a `from`. */
async function advance(api, itemIds, to, from = 'received') {
  if (!itemIds.length) return;
  const start = from === 'received' ? 0 : PIECE_STAGES.indexOf(from) + 1;
  const end = PIECE_STAGES.indexOf(to);
  for (let i = start; i <= end; i++) await api.post('/laundry/pieces/status', { itemIds, status: PIECE_STAGES[i] });
}
