// Padaria (fake-padaria): Pix e WhatsApp, catálogo com estoque (compras, produção, perdas e
// inventário), vendas no caixa (PDV) e encomendas para hoje e os próximos dias em todas as etapas.
import { at, day, step } from '../lib.mjs';

/** Produtos além dos doze que o módulo cria ao ser ativado. */
const EXTRA_PRODUCTS = [
  { name: 'Croissant', category: 'Pães', unit: 'un', price: 8.9, cost: 2.6, trackStock: false },
  { name: 'Pão de mel', category: 'Doces', unit: 'un', price: 7.9, cost: 2.4, trackStock: true, minStock: 10 },
  { name: 'Bolo de pote', category: 'Doces', unit: 'un', price: 12.9, cost: 4.1, trackStock: true, minStock: 6 },
  { name: 'Bolo de chocolate com brigadeiro (kg)', category: 'Bolos', unit: 'kg', price: 89.9, cost: 31, trackStock: false },
  { name: 'Bolo de morango com chantilly (kg)', category: 'Bolos', unit: 'kg', price: 99.9, cost: 36, trackStock: false },
  { name: 'Torta holandesa (inteira)', category: 'Bolos', unit: 'un', price: 119, cost: 42, trackStock: false },
  { name: 'Mini coxinha (cento)', category: 'Salgados para festa', unit: 'un', price: 75, cost: 28, trackStock: false },
  { name: 'Mini quibe (cento)', category: 'Salgados para festa', unit: 'un', price: 75, cost: 26, trackStock: false },
  { name: 'Brigadeiro gourmet (cento)', category: 'Doces para festa', unit: 'un', price: 140, cost: 48, trackStock: false },
  { name: 'Água mineral 500 ml', category: 'Bebidas', unit: 'un', price: 3.5, cost: 1.2, trackStock: true, minStock: 24, barcode: '7896000100018' },
  { name: 'Achocolatado 200 ml', category: 'Bebidas', unit: 'un', price: 4.5, cost: 2.1, trackStock: true, minStock: 12, barcode: '7896000100025' },
  { name: 'Manteiga 200 g', category: 'Mercearia', unit: 'un', price: 13.9, cost: 8.5, trackStock: true, minStock: 10, barcode: '7896000100032' },
  { name: 'Café torrado e moído 500 g', category: 'Mercearia', unit: 'pct', price: 29.9, cost: 18, trackStock: true, minStock: 5, barcode: '7896000100049' },
];

/** Custo e estoque mínimo dos produtos com estoque que o módulo cria sem esses dados. */
const PATCH_PRODUCTS = {
  'Presunto fatiado': { cost: 32, minStock: 3 },
  'Queijo muçarela fatiado': { cost: 36, minStock: 3 },
  'Leite integral 1 L': { cost: 3.8, minStock: 24, barcode: '7896000100056' },
  'Refrigerante lata 350 ml': { cost: 2.9, minStock: 24, barcode: '7896000100063' },
};

/** Movimentos iniciais de estoque. Café e achocolatado ficam abaixo do mínimo (alerta de estoque baixo). */
const STOCK_MOVES = [
  ['Presunto fatiado', [{ kind: 'purchase', quantity: 8, unitCost: 32, reason: 'NF 4471 — Frios Serra Azul' }]],
  ['Queijo muçarela fatiado', [{ kind: 'purchase', quantity: 6.5, unitCost: 36, reason: 'NF 4471 — Frios Serra Azul' }]],
  ['Leite integral 1 L', [
    { kind: 'purchase', quantity: 60, unitCost: 3.8, reason: 'NF 1189 — Laticínios Boa Vista' },
    { kind: 'loss', quantity: 2, reason: 'Embalagem violada' },
  ]],
  ['Refrigerante lata 350 ml', [{ kind: 'purchase', quantity: 96, unitCost: 2.9, reason: 'NF 9921 — Distribuidora Central' }]],
  ['Água mineral 500 ml', [{ kind: 'purchase', quantity: 48, unitCost: 1.2, reason: 'NF 9921 — Distribuidora Central' }]],
  ['Achocolatado 200 ml', [{ kind: 'purchase', quantity: 14, unitCost: 2.1, reason: 'NF 9921 — Distribuidora Central' }]],
  ['Manteiga 200 g', [{ kind: 'purchase', quantity: 20, unitCost: 8.5, reason: 'NF 1189 — Laticínios Boa Vista' }]],
  ['Café torrado e moído 500 g', [{ kind: 'purchase', quantity: 4, unitCost: 18, reason: 'Compra no atacado' }]],
  ['Pão de mel', [{ kind: 'production', quantity: 30, reason: 'Fornada da manhã' }]],
  ['Bolo de pote', [
    { kind: 'production', quantity: 20, reason: 'Produção do dia' },
    { kind: 'count', quantity: 19, reason: 'Contagem: um pote caiu na vitrine' },
  ]],
];

/** O que se vende no balcão, com a faixa de quantidade (kg ou unidades). */
const COUNTER = [
  ['Pão francês', [0.25, 0.9]],
  ['Pão francês', [0.3, 1.2]],
  ['Pão de queijo', [0.15, 0.5]],
  ['Café expresso', [1, 2]],
  ['Pingado', [1, 2]],
  ['Sonho', [1, 3]],
  ['Coxinha', [1, 3]],
  ['Croissant', [1, 2]],
  ['Bolo de cenoura com chocolate (fatia)', [1, 2]],
  ['Leite integral 1 L', [1, 3]],
  ['Refrigerante lata 350 ml', [1, 4]],
  ['Água mineral 500 ml', [1, 2]],
  ['Achocolatado 200 ml', [1, 2]],
  ['Presunto fatiado', [0.15, 0.4]],
  ['Queijo muçarela fatiado', [0.15, 0.4]],
  ['Manteiga 200 g', [1, 1]],
  ['Pão de mel', [1, 3]],
  ['Bolo de pote', [1, 2]],
  ['Pão de forma caseiro', [1, 1]],
];

const SALES_TODAY = 26;

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log } = ctx;

  await step(log, 'Pix (chave de demonstração)', () => seedPix(ctx));
  await step(log, 'WhatsApp (modo manual)', () => seedWhatsApp(ctx));
  await step(log, 'configuração do caixa', () => seedSalesSettings(ctx));
  await step(log, 'produtos', () => seedProducts(ctx));
  await step(log, 'estoque', () => seedStock(ctx));
  await step(log, 'vendas no caixa', async () => {
    const existing = await api.get('/sales', { from: day(-30), to: day(0), limit: 500 });
    if (existing.length >= 15) return log(`    já tem ${existing.length} vendas nos últimos 30 dias`);
    await seedSales(ctx);
  });
  await step(log, 'encomendas', async () => {
    const existing = await api.get('/service-orders', { workflow: 'bakery', limit: 1 });
    if (existing.total >= 8) return log(`    já tem ${existing.total} encomendas`);
    await seedOrders(ctx);
  });
}

async function seedPix({ api, log }) {
  const current = await api.get('/modules/integration.payments/settings');
  if (current.pixKey) return log(`    chave já configurada (${current.pixKey})`);
  await api.put('/modules/integration.payments/settings', {
    ...current,
    pixKey: 'pix@fake-padaria.demo',
    merchantName: 'Padaria Demonstracao',
    merchantCity: 'Sao Paulo',
  });
}

/** Só o número exibido; o modo continua "manual" (a equipe envia pelo link, nada sai sozinho). */
async function seedWhatsApp({ api, rng, log }) {
  const current = await api.get('/modules/integration.whatsapp/settings');
  if (current.displayPhone) return log(`    número já configurado (${current.displayPhone})`);
  const phone = rng.phone();
  await api.put('/modules/integration.whatsapp/settings', {
    ...current,
    displayPhone: `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`,
  });
}

/** Pix e cartões entram na conta bancária (dinheiro vai para o caixa). */
async function seedSalesSettings({ api, log }) {
  const current = await api.get('/modules/shared.sales/settings');
  if (current.bankAccountId) return log('    conta bancária já definida');
  const bank = (await api.get('/service-orders/payment-accounts')).find((a) => a.type === 'bank');
  if (!bank) return log('    sem conta bancária: Pix e cartões vão para o caixa');
  await api.put('/modules/shared.sales/settings', { ...current, bankAccountId: bank.id, receiptFooter: 'Obrigado e volte sempre! Encomendas pelo WhatsApp.' });
}

async function seedProducts({ api, log }) {
  const products = await api.get('/sales/products', { limit: 500 });
  const missing = EXTRA_PRODUCTS.filter((p) => !products.some((x) => x.name === p.name));
  for (const p of missing) await api.post('/sales/products', { active: true, ...p });

  let patched = 0;
  for (const [name, data] of Object.entries(PATCH_PRODUCTS)) {
    const p = products.find((x) => x.name === name);
    if (!p || p.cost !== null) continue;
    await api.patch(`/sales/products/${p.id}`, data);
    patched++;
  }
  log(`    ${products.length} existentes, ${missing.length} criados, ${patched} com custo e mínimo`);
}

async function seedStock({ api, log }) {
  const products = await api.get('/sales/products', { limit: 500 });
  let moved = 0;
  for (const [name, moves] of STOCK_MOVES) {
    const p = products.find((x) => x.name === name);
    if (!p?.trackStock) continue;
    // Já tem movimento (de uma rodada anterior ou de venda): não mexe.
    if ((await api.get(`/sales/products/${p.id}/moves`)).length) continue;
    for (const m of moves) await api.post('/sales/stock-moves', { productId: p.id, ...m });
    moved++;
  }
  log(`    ${moved} produtos com entrada de estoque`);
}

/** Vendas do dia no caixa: pão na chapa, café, frios no peso; pagamentos variados, troco, fiado e um cancelamento. */
async function seedSales({ api, rng, log, customers }) {
  const products = (await api.get('/sales/products', { limit: 500 })).filter((p) => p.active);
  const byName = new Map(products.map((p) => [p.name, p]));
  const counter = COUNTER.filter(([name]) => byName.has(name));
  if (!counter.length) throw new Error('nenhum produto do balcão encontrado');
  const companies = customers.filter((c) => c.type === 'company');
  const people = customers.filter((c) => c.type !== 'company');
  const methods = ['pix', 'pix', 'pix', 'debit_card', 'debit_card', 'credit_card', 'cash', 'cash'];

  const created = [];
  for (let i = 0; i < SALES_TODAY; i++) {
    const lines = new Map();
    for (let k = rng.int(1, 4); k > 0; k--) {
      const [name, [min, max]] = rng.pick(counter);
      const p = byName.get(name);
      const fractional = p.unit === 'kg' || p.unit === 'l';
      const q = fractional ? Math.round((min + rng.next() * (max - min)) * 1000) / 1000 : rng.int(min, max);
      lines.set(p.id, Math.round(((lines.get(p.id) ?? 0) + q) * 1000) / 1000);
    }
    const items = [...lines].map(([productId, quantity]) => ({ productId, quantity }));
    const totalCents = items.reduce((s, it) => s + Math.round(it.quantity * Math.round(products.find((p) => p.id === it.productId).price * 100)), 0);
    const discount = i === 5 && totalCents > 1000 ? 1 : 0;
    const due = totalCents - discount * 100;

    let customerId = null;
    let payments;
    if (i === 7 && companies.length) {
      // Fiado: café da equipe de um cliente empresa, a receber no fim do mês.
      customerId = companies[0].id;
      payments = [{ method: 'on_account', amount: due / 100 }];
    } else if (i === 12) {
      // Pagamento dividido: parte no Pix, o resto em dinheiro.
      const pix = Math.floor(due / 200) * 100;
      payments = pix > 0 ? [{ method: 'pix', amount: pix / 100 }, { method: 'cash', amount: (due - pix) / 100 }] : [{ method: 'cash', amount: due / 100 }];
    } else {
      const method = rng.pick(methods);
      // Dinheiro costuma vir arredondado para cima: o caixa devolve troco.
      const paid = method === 'cash' ? Math.ceil(due / 500) * 500 + (rng.chance(0.3) ? 500 : 0) : due;
      payments = [{ method, amount: paid / 100 }];
    }
    if (!customerId && people.length && rng.chance(0.3)) customerId = rng.pick(people).id;

    created.push(await api.post('/sales', { customerId, items, discount, payments, notes: i === 7 ? 'Café da reunião da equipe' : null }));
  }

  // Um cancelamento (o estoque volta e o lançamento do financeiro é cancelado).
  const toCancel = created[2];
  if (toCancel) await api.post(`/sales/${toCancel.id}/cancel`, { reason: 'Cliente desistiu: produto lançado em duplicidade' });
  log(`    ${created.length} vendas hoje (1 cancelada)`);
}

/** Hora de Brasília agora (0–23). */
function brasiliaHour() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}

/**
 * Retirada a n dias às hh:mm. A API recusa retirada no passado: se hoje o horário já passou,
 * empurra para daqui a duas horas e, se não couber mais no dia, para amanhã no mesmo horário.
 */
function pickup(n, hh, mm = 0) {
  if (n !== 0) return at(n, hh, mm);
  const earliest = brasiliaHour() + 2;
  if (hh >= earliest) return at(0, hh, mm);
  if (earliest <= 22) return at(0, earliest, mm);
  return at(1, hh, mm);
}

function orderPlans({ customers, users }) {
  const people = customers.filter((c) => c.type !== 'company');
  const companies = customers.filter((c) => c.type === 'company');
  const person = (i) => (people.length ? people[i % people.length] : customers[i % customers.length]);
  const company = (i) => (companies.length ? companies[i % companies.length] : customers[i % customers.length]);
  const by = (i) => (users.length ? `Anotada por ${users[i % users.length].name}.` : null);

  return [
    // Hoje: produção do dia em todas as etapas.
    {
      customer: person(0),
      dueAt: pickup(0, 9, 30),
      items: [{ description: 'Bolo de cenoura com cobertura de chocolate 1,5 kg', quantity: 1, unitPrice: 95 }],
      payments: [{ part: 1, method: 'cash' }],
      then: ['in_production', 'ready', 'delivered'],
      notesInternal: by(0),
    },
    {
      customer: person(1),
      dueAt: pickup(0, 11),
      items: [{ product: 'Torta holandesa (inteira)', quantity: 1 }],
      then: ['in_production', 'ready', 'delivered'],
      payments: [{ part: 1, method: 'debit_card' }],
    },
    {
      customer: person(2),
      dueAt: pickup(0, 15),
      items: [{ product: 'Bolo de chocolate com brigadeiro (kg)', quantity: 2.5 }, { product: 'Brigadeiro gourmet (cento)', quantity: 1 }],
      payments: [{ part: 0.5, method: 'pix' }],
      then: ['in_production'],
      notesCustomer: 'Escrever "Parabéns, Lívia!" em cima do bolo.',
      notesInternal: 'Vela de número 7 por conta da cliente.',
    },
    {
      customer: person(3),
      dueAt: pickup(0, 17),
      items: [{ product: 'Mini coxinha (cento)', quantity: 2 }, { product: 'Mini quibe (cento)', quantity: 1 }],
      payments: [{ part: 1, method: 'pix' }],
      then: ['in_production', 'ready'],
      notesCustomer: 'Salgados fritos na hora da retirada.',
    },
    {
      customer: person(4),
      dueAt: pickup(0, 18, 30),
      items: [{ description: 'Bolo de aniversário 3 kg — massa branca, doce de leite com ameixa, tema Frozen', quantity: 1, unitPrice: 320 }],
      payments: [{ part: 0.5, method: 'pix' }],
      notesInternal: 'Topo de bolo impresso já pago. ' + (by(1) ?? ''),
    },
    // Amanhã.
    {
      customer: company(0),
      dueAt: pickup(1, 7, 30),
      items: [
        { product: 'Pão francês', quantity: 5 },
        { product: 'Pão de queijo', quantity: 2 },
        { product: 'Mini coxinha (cento)', quantity: 3 },
      ],
      notesCustomer: 'Café da manhã da equipe. Nota fiscal no CNPJ.',
      notesInternal: 'Separar em sacos de 1 kg.',
    },
    {
      customer: person(5),
      dueAt: pickup(1, 16),
      items: [{ product: 'Bolo de morango com chantilly (kg)', quantity: 2 }],
      payments: [{ part: 0.5, method: 'pix' }],
      then: ['in_production'],
    },
    // Próximos dias.
    {
      customer: person(6),
      dueAt: pickup(2, 14),
      items: [{ product: 'Brigadeiro gourmet (cento)', quantity: 2 }, { product: 'Bolo de pote', quantity: 20 }],
      notesCustomer: 'Lembrancinhas de chá de bebê: forminhas azuis.',
    },
    {
      customer: company(1),
      dueAt: pickup(3, 9),
      items: [
        { product: 'Mini quibe (cento)', quantity: 2 },
        { product: 'Mini coxinha (cento)', quantity: 2 },
        { product: 'Pão de queijo', quantity: 1.5 },
        { description: 'Sanduíche natural (bandeja com 20)', quantity: 2, unitPrice: 95 },
      ],
      payments: [{ part: 0.3, method: 'transfer' }],
      discount: 20,
      notesCustomer: 'Coffee break do treinamento — entregar na recepção.',
    },
    {
      customer: person(7),
      dueAt: pickup(5, 15),
      items: [{ description: 'Bolo de casamento 3 andares, 8 kg — naked cake com frutas vermelhas', quantity: 1, unitPrice: 980 }],
      payments: [{ part: 0.5, method: 'pix' }],
      notesInternal: 'Degustação feita. Cliente traz os topos de flores naturais.',
    },
    {
      customer: person(0),
      dueAt: pickup(7, 10),
      items: [{ product: 'Torta holandesa (inteira)', quantity: 2 }],
    },
    // Cancelada.
    {
      customer: person(2),
      dueAt: pickup(4, 16),
      items: [{ product: 'Bolo de chocolate com brigadeiro (kg)', quantity: 1.5 }],
      then: ['cancelled'],
      cancelReason: 'Cliente cancelou a festa.',
    },
  ];
}

async function seedOrders(ctx) {
  const { api, log } = ctx;
  const [products, accounts] = await Promise.all([api.get('/sales/products', { limit: 500 }), api.get('/service-orders/payment-accounts')]);
  const cash = accounts.find((a) => a.type === 'cash') ?? accounts[0];
  const bank = accounts.find((a) => a.type === 'bank') ?? cash;
  if (!cash) throw new Error('nenhuma conta financeira para receber pagamentos');

  const counts = {};
  for (const plan of orderPlans(ctx)) {
    const items = plan.items.map((i) => {
      if (!i.product) return { productId: null, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice };
      const p = products.find((x) => x.name === i.product);
      if (!p) throw new Error(`produto "${i.product}" não encontrado`);
      return { productId: p.id, description: p.name, quantity: i.quantity, unitPrice: p.price };
    });
    const order = await api.post('/bakery/orders', {
      customerId: plan.customer.id,
      dueAt: plan.dueAt,
      items,
      discount: plan.discount ?? 0,
      notesCustomer: plan.notesCustomer ?? null,
      notesInternal: plan.notesInternal || null,
    });

    // Sinal (ou pagamento total) antes de mudar o status: retirada só depois de pagar.
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
    const final = plan.then?.at(-1) ?? 'received';
    counts[final] = (counts[final] ?? 0) + 1;
  }
  log(`    ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ')}`);
}
