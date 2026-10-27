// Popula a empresa de demonstração pela API (dados fictícios), para capturas de tela e manual.
const B = 'http://localhost:3000/api';
let token;

async function call(method, path, body) {
  const res = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return data;
}

token = (await call('POST', '/auth/login', { email: 'dono@demo.com', password: 'demo123456' })).accessToken;

const people = [
  ['Ana Beatriz Souza', '(48) 99812-3344', 'ana.souza@exemplo.com'],
  ['Carlos Eduardo Lima', '(48) 99655-1020', 'carlos.lima@exemplo.com'],
  ['Fernanda Rocha', '(48) 98877-6655', 'fernanda.rocha@exemplo.com'],
  ['Hotel Mar Azul Ltda', '(48) 3433-2211', 'compras@hotelmarazul.exemplo.com'],
  ['João Pedro Martins', '(48) 99123-4567', null],
  ['Mariana Alves', '(48) 99701-8899', 'mariana.alves@exemplo.com'],
  ['Restaurante Sabor da Serra', '(48) 3437-9090', 'contato@saborserra.exemplo.com'],
];
const existing = (await call('GET', '/customers?limit=100')).items;
const customers = [];
for (const [name, phone, email] of people) {
  const found = existing.find((c) => c.name === name);
  customers.push(found ?? (await call('POST', '/customers?allowDuplicates=true', { name, phone, email, type: name.includes('Ltda') || name.includes('Restaurante') ? 'company' : 'person' })));
}

// Serviços padrão que faltarem (a demo foi criada antes do catálogo inicial existir).
const wanted = [
  { name: 'Só passar', pricingUnit: 'piece', basePrice: 8.9, turnaroundHours: 24 },
  { name: 'Lavagem a seco', pricingUnit: 'piece', basePrice: 29.9, turnaroundHours: 72 },
  { name: 'Lavagem por quilo', pricingUnit: 'kg', basePrice: 19.9, turnaroundHours: 48 },
];
let services = await call('GET', '/laundry/services');
for (const s of wanted) if (!services.some((x) => x.name === s.name)) await call('POST', '/laundry/services', s);
services = await call('GET', '/laundry/services');
const svc = (n) => services.find((s) => s.name === n).id;
const garments = await call('GET', '/laundry/garment-types');
const gar = (n) => garments.find((g) => g.name === n).id;

await call('PUT', `/laundry/services/${svc('Lavar e passar')}/prices`, {
  prices: [
    { garmentTypeId: gar('Camisa'), price: 12.9 },
    { garmentTypeId: gar('Calça'), price: 14.9 },
    { garmentTypeId: gar('Terno'), price: 39.9 },
    { garmentTypeId: gar('Vestido'), price: 24.9 },
    { garmentTypeId: gar('Edredom'), price: 49.9 },
  ],
});
await call('PUT', '/modules/integration.payments/settings', { pixKey: 'pix@bolhaazul.com.br', merchantName: 'Lavanderia Bolha Azul', merchantCity: 'Criciuma' });
const account = (await call('GET', '/service-orders/payment-accounts'))[0].id;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const plans = [
  { c: 0, lines: [{ serviceId: svc('Lavar e passar'), garmentTypeId: gar('Camisa'), quantity: 4, color: 'branca' }, { serviceId: svc('Lavar e passar'), garmentTypeId: gar('Calça'), quantity: 2, color: 'azul-marinho' }], move: [['washing', 3]], pay: 'all' },
  { c: 1, lines: [{ serviceId: svc('Lavagem a seco'), garmentTypeId: gar('Terno'), quantity: 1, brand: 'Hugo Boss', intakeNotes: 'Botão do punho faltando' }], move: [['ironing', 1]] },
  { c: 3, lines: [{ serviceId: svc('Lavagem por quilo'), quantity: 40, weightKg: 18.4 }], move: [['drying', 1]], pay: 'half' },
  { c: 2, lines: [{ serviceId: svc('Lavar e passar'), garmentTypeId: gar('Vestido'), quantity: 2, color: 'vermelho' }], move: [['ready', 2]], pay: 'all' },
  { c: 6, lines: [{ serviceId: svc('Lavagem por quilo'), quantity: 25, weightKg: 9.7 }, { serviceId: svc('Lavar e passar'), garmentTypeId: gar('Toalha'), quantity: 6 }], move: [] },
  { c: 5, lines: [{ serviceId: svc('Lavar e passar'), garmentTypeId: gar('Edredom'), quantity: 1, color: 'bege' }, { serviceId: svc('Só passar'), garmentTypeId: gar('Camisa'), quantity: 3 }], move: [['washing', 2]] },
  { c: 4, lines: [{ serviceId: svc('Só passar'), garmentTypeId: gar('Calça'), quantity: 2 }], move: [['ready', 2]], deliver: true, pay: 'all' },
];

for (const p of plans) {
  const { order, pieces } = await call('POST', '/laundry/orders', { customerId: customers[p.c].id, lines: p.lines });
  for (const [status, n] of p.move) {
    const ids = pieces.slice(0, n).map((x) => x.itemId);
    if (status !== 'washing') await call('POST', '/laundry/pieces/status', { itemIds: ids, status: 'washing' });
    await call('POST', '/laundry/pieces/status', { itemIds: ids, status });
  }
  if (p.pay) {
    const amount = p.pay === 'all' ? order.total : Math.round(order.total * 50) / 100;
    await call('POST', `/service-orders/${order.id}/payments`, { amount, method: p.pay === 'all' ? 'pix' : 'credit_card', accountId: account, paidAt: today });
  }
  if (p.deliver) await call('POST', `/service-orders/${order.id}/transition`, { to: 'delivered' });
  console.log(`OS ${order.number} · ${customers[p.c].name}`);
}

const categories = await call('GET', '/finance/categories');
const cat = (k) => categories.find((c) => c.systemKey === k).id;
const month = today.slice(0, 8);
for (const e of [
  { kind: 'expense', description: 'Aluguel do mês', amount: 3200, status: 'paid', dueDate: `${month}05`, paidAt: `${month}05`, accountId: account, categoryId: cat('rent') },
  { kind: 'expense', description: 'Sabão e amaciante (fornecedor)', amount: 860.4, status: 'paid', dueDate: `${month}10`, paidAt: `${month}10`, accountId: account, categoryId: cat('supplies') },
  { kind: 'expense', description: 'Conta de energia', amount: 1240.75, status: 'pending', dueDate: `${month}28`, categoryId: cat('other_expense') },
  { kind: 'income', description: 'Contrato mensal — Hotel Mar Azul', amount: 2800, status: 'pending', dueDate: `${month}30`, categoryId: cat('services') },
]) {
  await call('POST', '/finance/entries', e);
}
console.log('ok');
