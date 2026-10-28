// Fluxos novos de venda nas empresas de demonstração:
// - Caixas do PDV (padaria, pet shop e lavanderia): caixas cadastrados, uma sessão fechada por dia
//   útil da semana passada em cada caixa (troco inicial, vendas, sangria/suprimento e fechamento
//   conferido com quebra e sobra, tudo nos horários do dia) e a sessão de hoje aberta com vendas.
// - Vendedor/corretor e motivos de perda (revenda, imobiliária e consórcio): equipe de vendas,
//   negociações em aberto distribuídas entre os vendedores, vendas e perdas do mês por vendedor
//   (com motivos padronizados), para o "resumo do mês por vendedor" ter conteúdo.
//
// As sessões da semana passada são lançadas como caixa de outro dia (abertura, vendas, movimentos e
// fechamento com o horário em que aconteceram). Pode rodar de novo: o que já existe é pulado — a
// sessão de um caixa num dia é achada pela data da abertura, e as sessões de hoje (inclusive as
// fechadas de uma versão anterior deste seed, que lançava tudo hoje) contam como o "hoje".
import { at, day, slugify, step } from '../lib.mjs';
import { applicantFor, pickers } from '../verticals/_banking.mjs';

/**
 * Caixas por empresa: uma sessão por dia útil da semana passada em cada caixa e a de hoje aberta no
 * primeiro. `hours` é o horário de cada caixa (abre, fecha); `float`, o troco inicial de cada um.
 * `diffs` é a diferença de dinheiro em cada fechamento, em sequência (negativa = quebra, positiva = sobra);
 * `expense` é uma sangria sem conta (dinheiro que sai da gaveta para uma despesa do dia);
 * `maxPrice` limita o que se vende no balcão (sem bolo inteiro nem saco de ração de 15 kg em todo cupom).
 */
const PDV = {
  'fake-padaria': {
    registers: ['Caixa 1 — Balcão', 'Caixa 2 — Café'],
    float: [150, 100],
    hours: [
      [6, 20],
      [7, 14],
    ],
    diffs: [0, -2.35, 0, 0.5, -5, 0, 0, 1, 0, -0.8],
    expense: { amount: 18, reason: 'Compra de gelo e guardanapos no mercado' },
    maxPrice: 40,
  },
  'fake-petshop': {
    registers: ['Caixa da loja'],
    float: [100],
    hours: [[9, 19]],
    diffs: [0, -3.2, 0, 2, 0],
    expense: { amount: 25, reason: 'Pagamento do motoboy (entrega de ração)' },
    maxPrice: 160,
  },
  'fake-lavanderia': {
    registers: ['Balcão'],
    float: [80],
    hours: [[8, 18]],
    diffs: [0, 0, -1.5, 0, 3],
    expense: { amount: 12, reason: 'Compra de sacos plásticos para embalagem' },
    maxPrice: 60,
  },
};

/**
 * Produtos de balcão criados só se a empresa não tiver o que vender (a padaria e o pet shop já
 * ganham catálogo no seed do setor; a lavanderia vende só serviços pela ordem de serviço).
 */
const FALLBACK_PRODUCTS = {
  'fake-lavanderia': [
    { name: 'Sacola de tecido para roupa', category: 'Acessórios', unit: 'un', price: 24.9, cost: 9.5, trackStock: true, minStock: 5, buy: 30 },
    { name: 'Cabide de madeira (kit com 5)', category: 'Acessórios', unit: 'pct', price: 29.9, cost: 12, trackStock: true, minStock: 4, buy: 20 },
    { name: 'Capa protetora para terno', category: 'Acessórios', unit: 'un', price: 14.9, cost: 4.2, trackStock: true, minStock: 10, buy: 40 },
    { name: 'Tira-manchas 500 ml', category: 'Produtos de limpeza', unit: 'un', price: 32.9, cost: 15, trackStock: true, minStock: 6, buy: 24 },
    { name: 'Amaciante concentrado 1 L', category: 'Produtos de limpeza', unit: 'un', price: 27.9, cost: 11.5, trackStock: true, minStock: 6, buy: 24 },
    { name: 'Sabão de coco em barra', category: 'Produtos de limpeza', unit: 'un', price: 6.9, cost: 2.4, trackStock: true, minStock: 12, buy: 48 },
    { name: 'Saquinho perfumado para gaveta', category: 'Acessórios', unit: 'un', price: 9.9, cost: 3.1, trackStock: true, minStock: 10, buy: 40 },
  ],
  'fake-padaria': [
    { name: 'Pão francês', category: 'Pães', unit: 'kg', price: 18.9, cost: 6.2, trackStock: false },
    { name: 'Café expresso', category: 'Cafeteria', unit: 'un', price: 6.5, cost: 1.4, trackStock: false },
    { name: 'Pão de queijo', category: 'Salgados', unit: 'kg', price: 54.9, cost: 18, trackStock: false },
    { name: 'Sonho', category: 'Doces', unit: 'un', price: 7.5, cost: 2.2, trackStock: false },
  ],
  'fake-petshop': [
    { name: 'Petisco bifinho 65 g', category: 'Petiscos', unit: 'un', price: 9.9, cost: 4.5, trackStock: true, minStock: 10, buy: 40 },
    { name: 'Tapete higiênico (30 un)', category: 'Higiene', unit: 'pct', price: 79.9, cost: 42, trackStock: true, minStock: 4, buy: 15 },
    { name: 'Brinquedo mordedor', category: 'Acessórios', unit: 'un', price: 24.9, cost: 9, trackStock: true, minStock: 5, buy: 20 },
    { name: 'Shampoo neutro para cães 500 ml', category: 'Higiene', unit: 'un', price: 34.9, cost: 14, trackStock: true, minStock: 5, buy: 18 },
  ],
};

const SALE_METHODS = ['cash', 'cash', 'pix', 'pix', 'pix', 'debit_card', 'credit_card'];
/** Formas conferidas no fechamento (fiado não passa pela gaveta nem pela maquininha). */
const COUNTED = ['pix', 'debit_card', 'credit_card', 'other'];

/** Equipe de vendas: o papel do setor e quem convidar se houver menos de dois vendedores. */
const SELLING = {
  'fake-veiculos': { role: 'vehicles.seller', label: 'vendedores', invite: ['Ricardo Menezes', 'Aline Duarte'] },
  'fake-imobiliaria': { role: 'real_estate.broker', label: 'corretores', invite: ['Cláudia Ferraz', 'Marcelo Antunes'] },
  'fake-consorcio': { role: 'consortium.seller', label: 'consultores', invite: ['Tatiane Brito', 'Eduardo Pacheco'] },
};

const CLOSED_DEAL = ['closed', 'lost'];

// ---- Revenda de veículos ------------------------------------------------------------------------

/** Entram no estoque para serem vendidos à vista neste mês, cada um por um vendedor. */
const VEHICLE_WON = [
  {
    vehicle: { kind: 'car', brand: 'Fiat', model: 'Pulse', version: '1.0 Turbo Audace', yearManufacture: 2023, yearModel: 2024, plate: 'SPA4C18', color: 'Vermelho', km: 21400, fuel: 'flex', transmission: 'cvt', fipePrice: 103900, cost: 92000, price: 106900, notes: 'Revisado, dois jogos de chave.' },
    buyer: 'p1',
    seller: 0,
    body: { price: 106900, discount: 1900, paymentType: 'cash', notes: 'Pagamento por TED. Tanque cheio de brinde.' },
  },
  {
    vehicle: { kind: 'car', brand: 'Volkswagen', model: 'Polo', version: '1.0 TSI Highline', yearManufacture: 2022, yearModel: 2023, plate: 'RXM7B52', color: 'Cinza', km: 33800, fuel: 'flex', transmission: 'automatic', fipePrice: 98500, cost: 87000, price: 99900, notes: null },
    buyer: 'c1',
    seller: 1,
    body: { price: 99900, discount: 2400, paymentType: 'cash', notes: 'Compra pelo CNPJ para o representante comercial.' },
  },
  {
    vehicle: { kind: 'motorcycle', brand: 'Honda', model: 'PCX 160', version: 'DLX', yearManufacture: 2023, yearModel: 2024, plate: 'TBK3F09', color: 'Preta', km: 6900, fuel: 'gasoline', transmission: 'cvt', fipePrice: 19800, cost: 17000, price: 20490, notes: null },
    buyer: 'p3',
    seller: 0,
    body: { price: 20490, discount: 490, paymentType: 'cash' },
  },
];

/** Perdidas neste mês em veículos do estoque que o seed do setor não negocia (voltam a ficar disponíveis). */
const VEHICLE_LOST = [
  { plate: 'RJH6F71', buyer: 'p2', seller: 1, body: { price: 104900, discount: 0, paymentType: 'cash' }, reasonKey: 'price', reason: 'Achou caro: pediu R$ 97 mil e a loja segurou em R$ 102 mil' },
  {
    plate: 'SBV8C33',
    buyer: 'p4',
    seller: 0,
    body: { price: 109900, discount: 2000, paymentType: 'cash', tradeIn: { brand: 'Honda', model: 'CB 500X', yearModel: 2019, plate: 'FTR2C33', km: 38000, value: 32000 } },
    reasonKey: 'trade_rejected',
    reason: 'Cliente queria R$ 38 mil na CB 500X; avaliação da loja ficou em R$ 32 mil',
  },
  { plate: 'TDC2B45', buyer: 'p6', seller: 1, body: { price: 19490, discount: 0, paymentType: 'cash' }, reasonKey: 'no_contact', reason: null },
  { plate: 'RMQ5E10', buyer: 'p7', seller: 2, body: { price: 15900, discount: 0, paymentType: 'cash' }, reasonKey: 'other', reason: 'Cliente foi transferido de cidade e adiou a compra' },
];

// ---- Imobiliária --------------------------------------------------------------------------------

const CITY = { city: 'São Paulo', state: 'SP' };

/** Imóveis novos para as vendas e perdas do mês; o título identifica o imóvel. `owner` indexa a carteira. */
const RE_PROPERTIES = [
  {
    key: 'tatuape', owner: 'p4', purpose: 'sale', type: 'apartment', title: 'Apartamento 2 dormitórios com sacada — Tatuapé',
    street: 'Rua Tuiuti', number: '2150', complement: 'Apto 112', district: 'Tatuapé', zip: '03307-005',
    areaM2: 64, bedrooms: 2, suites: 1, bathrooms: 2, parking: 1, salePrice: 540000, condoFee: 720, iptuYearly: 1400,
    description: 'Andar alto, sacada com vista livre, a 600 m do metrô Carrão. Lazer com piscina.',
  },
  {
    key: 'lapa', owner: 'p7', purpose: 'sale', type: 'house', title: 'Casa 3 dormitórios com edícula — Lapa',
    street: 'Rua Guaicurus', number: '1320', district: 'Lapa', zip: '05033-002',
    areaM2: 180, landM2: 250, bedrooms: 3, suites: 1, bathrooms: 3, parking: 2, salePrice: 960000, iptuYearly: 3900,
    description: 'Casa térrea com edícula e quintal, perto do Mercado da Lapa e da estação de trem.',
  },
  {
    key: 'santana', owner: 'c1', purpose: 'sale', type: 'apartment', title: 'Cobertura duplex com terraço — Santana',
    street: 'Rua Voluntários da Pátria', number: '3400', complement: 'Cobertura 201', district: 'Santana', zip: '02401-000',
    areaM2: 160, bedrooms: 3, suites: 2, bathrooms: 4, parking: 3, salePrice: 1380000, condoFee: 2100, iptuYearly: 5200,
    description: 'Terraço com piscina e churrasqueira, vista para a Serra da Cantareira.',
  },
  {
    key: 'vclementino', owner: 'p6', purpose: 'sale', type: 'apartment', title: 'Apartamento 1 dormitório perto do metrô — Vila Clementino',
    street: 'Rua Napoleão de Barros', number: '737', complement: 'Apto 45', district: 'Vila Clementino', zip: '04024-002',
    areaM2: 41, bedrooms: 1, suites: 0, bathrooms: 1, parking: 1, salePrice: 575000, condoFee: 690, iptuYearly: 1300,
    description: 'A 400 m do metrô Santa Cruz, ótimo para quem trabalha na região dos hospitais.',
  },
  {
    key: 'ipiranga', owner: 'p5', purpose: 'sale', type: 'house', title: 'Sobrado 2 dormitórios — Ipiranga',
    street: 'Rua Bom Pastor', number: '1880', district: 'Ipiranga', zip: '04203-001',
    areaM2: 110, landM2: 125, bedrooms: 2, suites: 0, bathrooms: 2, parking: 1, salePrice: 690000, iptuYearly: 2100,
    description: 'Sobrado geminado, rua tranquila, a 10 minutos do Museu do Ipiranga.',
  },
  {
    key: 'liberdade', owner: 'p3', purpose: 'sale', type: 'apartment', title: 'Kitnet reformada a 200 m do metrô — Liberdade',
    street: 'Rua Galvão Bueno', number: '590', complement: 'Apto 707', district: 'Liberdade', zip: '01506-000',
    areaM2: 28, bedrooms: 1, suites: 0, bathrooms: 1, parking: 0, salePrice: 295000, condoFee: 480, iptuYearly: 600,
    description: 'Reformada, ideal para renda com locação para estudantes.',
  },
];

/** Propostas à vista: as `won` fecham neste mês; as demais são perdidas com motivo padronizado. */
const RE_DEALS = [
  { property: 'tatuape', buyer: 'p1', broker: 0, body: { price: 525000, paymentType: 'cash', commissionPercent: 6, notes: 'Escritura agendada no 9º Tabelionato.' }, won: true },
  { property: 'lapa', buyer: 'p2', broker: 1, body: { price: 930000, paymentType: 'cash', commissionPercent: 5, notes: 'Comprador vendeu apartamento para pagar à vista.' }, won: true },
  { property: 'santana', buyer: 'p0', broker: 1, body: { price: 1250000, paymentType: 'cash', commissionPercent: 5 }, reasonKey: 'price', reason: 'Proprietário não aceitou baixar de R$ 1,33 mi' },
  { property: 'vclementino', buyer: 'p4', broker: 0, body: { price: 550000, paymentType: 'cash', commissionPercent: 6 }, reasonKey: 'bought_other', reason: 'Fechou outro apartamento na mesma rua com outra imobiliária' },
  { property: 'ipiranga', buyer: 'p7', broker: 2, body: { price: 670000, paymentType: 'cash', commissionPercent: 6 }, reasonKey: 'documentation', reason: 'Matrícula com construção não averbada: comprador não quis esperar a regularização' },
  { property: 'liberdade', buyer: 'p5', broker: 0, body: { price: 285000, paymentType: 'cash', commissionPercent: 6 }, reasonKey: 'no_contact', reason: null },
];

// ---- Consórcio ----------------------------------------------------------------------------------

/**
 * Cotas vendidas neste mês por consultor. Cliente + plano não se repetem com as do seed do setor
 * (é por eles que a rodada seguinte reconhece a cota). `outcome`: approved = adesão aceita (fica ativa
 * quando a fila processar), pending = em análise, cancelled = cancelada pela corretora, rejected = recusada.
 */
const QUOTAS = [
  { who: 'p2', plan: 'Serviços 20 mil', seller: 0, outcome: 'approved', dueDay: 15, income: 5200 },
  { who: 'p3', plan: 'Auto 60 mil', seller: 1, outcome: 'approved', dueDay: 10, income: 7800 },
  { who: 'p5', plan: 'Imóvel 250 mil', seller: 0, outcome: 'pending', dueDay: 20, income: 12000 },
  { who: 'p0', plan: 'Auto 100 mil', seller: 1, outcome: 'cancelled', dueDay: 10, income: 9500, reason: 'Cliente desistiu: preferiu financiar o carro com a concessionária' },
  { who: 'p4', plan: 'Auto 60 mil', seller: 2, outcome: 'rejected', dueDay: 5, income: 4800, message: 'Restrição cadastral no CPF apontada pela administradora' },
];
/** Cotas que o seed do setor vende (ele as reconhece pela ordem): as novas só entram depois delas. */
const SECTOR_QUOTAS = 10;

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { log, tenant } = ctx;
  const pdv = PDV[tenant.name];
  if (pdv) {
    await step(log, 'produtos do balcão', () => ensureCounterProducts(ctx));
    await step(log, 'caixas do PDV (abertura, sangria/suprimento e fechamento)', () => seedRegisters(ctx, pdv));
    return;
  }
  const selling = SELLING[tenant.name];
  if (!selling) return;
  const sellers = await step(log, `equipe de vendas (${selling.label})`, () => ensureSellers(ctx, selling));
  if (!sellers?.length) return;
  if (tenant.name === 'fake-veiculos') {
    await step(log, 'negociações em aberto com vendedor', () => assignOpen(ctx, sellers, { list: '/vehicles/deals', field: 'sellerId', patch: (d) => [`/vehicles/deals/${d.id}/seller`, 'sellerId'] }));
    await step(log, 'vendas e perdas do mês por vendedor', () => seedVehicleMonth(ctx, sellers));
  } else if (tenant.name === 'fake-imobiliaria') {
    await step(log, 'propostas em aberto com corretor', () => assignOpen(ctx, sellers, { list: '/real-estate/deals', field: 'brokerId', patch: (d) => [`/real-estate/deals/${d.id}/broker`, 'brokerId'] }));
    await step(log, 'vendas e perdas do mês por corretor', () => seedRealEstateMonth(ctx, sellers));
  } else if (tenant.name === 'fake-consorcio') {
    await step(log, 'cotas em andamento com consultor', () => assignQuotas(ctx, sellers));
    await step(log, 'cotas do mês por consultor', () => seedQuotasMonth(ctx, sellers));
  }
}

// ---- Caixas do PDV ------------------------------------------------------------------------------

/** Garante algo para vender no balcão: só cria o catálogo de reserva se não houver produto ativo. */
async function ensureCounterProducts({ api, log, tenant }) {
  const products = await api.get('/sales/products', { limit: 500 });
  const active = products.filter((p) => p.active);
  if (active.length >= 3) return log(`    ${active.length} produtos ativos`);
  const wanted = FALLBACK_PRODUCTS[tenant.name] ?? [];
  let created = 0;
  for (const { buy, ...p } of wanted) {
    let row = products.find((x) => x.name === p.name);
    if (!row) {
      row = await api.post('/sales/products', { active: true, ...p });
      created++;
    }
    // Entrada inicial de estoque, só para quem ainda não tem movimento.
    if (row.trackStock && buy && !(await api.get(`/sales/products/${row.id}/moves`)).length) {
      await api.post('/sales/stock-moves', { productId: row.id, kind: 'purchase', quantity: buy, unitCost: p.cost, reason: 'Compra inicial — Distribuidora Central' });
    }
  }
  log(`    ${created} produtos criados`);
}

async function seedRegisters(ctx, cfg) {
  const { api, rng, log, customers } = ctx;
  const days = lastWeekWorkdays();
  const sessions = await api.get('/sales/registers/sessions', { from: day(days[0]), to: day(0), limit: 500 });

  // Caixas pelo nome (rodar de novo não duplica: o nome é único na empresa).
  let overview = await api.get('/sales/registers');
  for (const name of cfg.registers) if (!overview.registers.some((r) => r.name === name)) await api.post('/sales/registers', { name });
  overview = await api.get('/sales/registers');
  const registers = cfg.registers.map((n) => overview.registers.find((r) => r.name === n)).filter((r) => r?.active);
  if (!registers.length) throw new Error('nenhum caixa ativo');
  if (!overview.cashAccountId) throw new Error('sem conta "Caixa" no financeiro');
  // Sangria vai para o banco (depósito) e o suprimento vem dele: é transferência, não receita nem despesa.
  const bank = overview.accounts.find((a) => a.type === 'bank' && a.id !== overview.cashAccountId) ?? null;

  const counter = await counterProducts(api, cfg);
  const people = customers.filter((c) => c.type !== 'company');
  const done = { sessions: 0, kept: 0, skipped: 0, sales: 0, cancelled: 0, moves: 0, diffs: [] };

  // Semana passada: um caixa por dia útil em cada caixa, retomando de onde uma rodada interrompida
  // parou (sessão do dia ainda aberta). `k` numera as sessões do plano (quebra/sobra, despesa).
  let k = 0;
  for (const d of days) {
    for (const [ri, register] of registers.entries()) {
      const plan = { d, k: k++, open: cfg.hours[ri % cfg.hours.length][0], close: cfg.hours[ri % cfg.hours.length][1] };
      let session = sessions.find((s) => s.register.id === register.id && spDay(s.openedAt) === day(d));
      if (session?.status === 'closed') {
        done.kept++;
        continue;
      }
      if (!session) {
        // Abertura com o horário daquele dia. Se o horário cruzar outra sessão do caixa (uma aberta
        // há mais de uma semana, por exemplo), o dia é pulado.
        session = await api
          .post('/sales/registers/sessions', { registerId: register.id, openingFloat: cfg.float[ri % cfg.float.length], openedAt: at(d, plan.open) })
          .catch((err) => (err.status === 409 ? null : Promise.reject(err)));
        if (!session) {
          done.skipped++;
          continue;
        }
      }
      session = await api.get(`/sales/registers/sessions/${session.id}`);
      const fresh = !session.sales.length && !session.moves.length;

      if (fresh && bank && plan.k % 2 === 0) {
        await api.post(`/sales/registers/sessions/${session.id}/moves`, {
          kind: 'deposit',
          amount: 50,
          reason: 'Troco em moedas trazido do banco',
          accountId: bank.id,
          occurredAt: at(d, plan.open, 10),
        });
        done.moves++;
      }
      if (!session.sales.length) {
        const sold = await sellInSession(api, rng, counter, people, register, saleTimes(rng, plan, rng.int(4, 7)));
        done.sales += sold.length;
        // Uma venda cancelada no caixa (não entra no esperado do fechamento).
        if (plan.k === 1 && sold[1]) {
          await api.post(`/sales/${sold[1].id}/cancel`, { reason: 'Produto registrado em duplicidade' });
          done.cancelled++;
        }
      }
      session = await api.get(`/sales/registers/sessions/${session.id}`);
      if (!session.moves.some((m) => m.kind === 'withdrawal')) {
        done.moves += await withdrawals(api, session, cfg, bank, plan);
        session = await api.get(`/sales/registers/sessions/${session.id}`);
      }

      // Fechamento no fim do expediente: dinheiro contado com a diferença do plano; Pix e cartões
      // conferem com o esperado. A quebra/sobra entra no financeiro naquele dia.
      const diff = cfg.diffs[plan.k % cfg.diffs.length];
      const counted = { cash: cents(session.expectedCash + diff) };
      for (const t of session.totals) if (COUNTED.includes(t.method) && t.expected > 0) counted[t.method] = t.expected;
      const notes = diff < 0 ? 'Quebra: troco dado a mais em uma venda em dinheiro.' : diff > 0 ? 'Sobra: cliente deixou o troco.' : null;
      const result = await api.post(`/sales/registers/sessions/${session.id}/close`, { counted, notes, closedAt: at(d, plan.close) });
      done.sessions++;
      if (result.cashDifference) done.diffs.push(result.cashDifference);
    }
  }

  // Hoje: as sessões que já existem (inclusive as fechadas de uma rodada antiga) contam como o dia;
  // sem nenhuma, abre a do primeiro caixa. A aberta no primeiro caixa recebe algumas vendas.
  const todays = sessions.filter((s) => spDay(s.openedAt) === day(0));
  overview = await api.get('/sales/registers');
  let openNow = overview.registers.find((r) => r.id === registers[0].id)?.openSession ?? null;
  if (!openNow && !todays.length) openNow = await api.post('/sales/registers/sessions', { registerId: registers[0].id, openingFloat: cfg.float[0] });
  if (openNow) {
    const today = await api.get(`/sales/registers/sessions/${openNow.id}`);
    if (!today.sales.length) done.sales += (await sellInSession(api, rng, counter, people, today.register, Array.from({ length: rng.int(3, 5) }, () => null))).length;
  }

  const diffs = done.diffs.map((d) => (d > 0 ? `sobra de R$ ${brl(d)}` : `quebra de R$ ${brl(-d)}`)).join(', ');
  log(
    `    semana passada: ${done.sessions} sessões fechadas agora${diffs ? ` (${diffs})` : ''}, ${done.kept} já existiam${done.skipped ? `, ${done.skipped} dias pulados (horário ocupado)` : ''}; ` +
      `hoje: ${Math.max(todays.length, openNow ? 1 : 0)} sessão(ões); ${done.sales} vendas (${done.cancelled} cancelada), ${done.moves} sangrias/suprimentos`,
  );
}

/** Dias úteis (segunda a sexta) da semana passada, como deslocamento em dias a partir de hoje. */
function lastWeekWorkdays() {
  const weekday = new Date(`${day(0)}T12:00:00-03:00`).getUTCDay();
  const monday = -(weekday === 0 ? 6 : weekday - 1) - 7;
  return [0, 1, 2, 3, 4].map((i) => monday + i);
}

/** Dia (YYYY-MM-DD) de um momento ISO no fuso de Brasília. */
const spDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

/** Horários das vendas do dia (em ordem), entre meia hora depois de abrir e meia hora antes de fechar. */
function saleTimes(rng, plan, n) {
  const first = plan.open * 60 + 30;
  const last = plan.close * 60 - 30;
  const minutes = Array.from({ length: n }, () => rng.int(first, last)).sort((a, b) => a - b);
  return minutes.map((m) => at(plan.d, Math.floor(m / 60), m % 60));
}

/**
 * Sangria para o banco no fim da tarde quando a gaveta enche e, em uma sessão, uma despesa paga com
 * o dinheiro do caixa no meio do dia (no financeiro, ambas na data do caixa).
 */
async function withdrawals(api, session, cfg, bank, plan) {
  let moves = 0;
  let available = session.expectedCash;
  if (plan.k === 2 && available >= cfg.expense.amount + 10) {
    await api.post(`/sales/registers/sessions/${session.id}/moves`, {
      kind: 'withdrawal',
      amount: cfg.expense.amount,
      reason: cfg.expense.reason,
      accountId: null,
      occurredAt: at(plan.d, Math.floor((plan.open + plan.close) / 2), 15),
    });
    available -= cfg.expense.amount;
    moves++;
  }
  // Deixa na gaveta o troco da abertura; o excedente (em dezenas) vai para o banco.
  const excess = Math.floor((available - session.openingFloat) / 10) * 10;
  if (excess >= 20) {
    await api.post(`/sales/registers/sessions/${session.id}/moves`, {
      kind: 'withdrawal',
      amount: excess,
      reason: bank ? 'Sangria para depósito no banco' : 'Sangria: dinheiro guardado no cofre',
      accountId: bank?.id ?? null,
      // Depois da última venda (meia hora antes de fechar), antes do fechamento.
      occurredAt: at(plan.d, plan.close - 1, 45),
    });
    moves++;
  }
  return moves;
}

/** O que se vende no balcão: ativos, dentro do teto de preço e com estoque (quando controlado). */
async function counterProducts(api, cfg) {
  const all = (await api.get('/sales/products', { limit: 500 })).filter((p) => p.active && p.price > 0 && (!p.trackStock || p.stock >= 5));
  const cheap = all.filter((p) => p.price <= cfg.maxPrice);
  const list = cheap.length >= 4 ? cheap : all;
  if (!list.length) throw new Error('nenhum produto com estoque para vender no caixa');
  // Estoque local, para não vender além do que há (a empresa pode recusar estoque negativo).
  return { list, stock: new Map(list.map((p) => [p.id, p.stock])) };
}

/**
 * Vendas no caixa, em sequência: as duas primeiras em dinheiro (com troco), as demais variadas.
 * `times` traz o horário de cada venda (null = agora); com horário, a venda entra na sessão do caixa
 * daquele horário.
 */
async function sellInSession(api, rng, counter, people, register, times) {
  const sold = [];
  for (let k = 0; k < times.length; k++) {
    const lines = new Map();
    for (let j = rng.int(1, 3); j > 0; j--) {
      const p = rng.pick(counter.list);
      const fractional = p.unit === 'kg' || p.unit === 'l';
      const q = fractional ? Math.round((0.15 + rng.next() * 0.85) * 1000) / 1000 : rng.int(1, p.price > 30 ? 1 : 3);
      const total = Math.round(((lines.get(p.id) ?? 0) + q) * 1000) / 1000;
      if (p.trackStock && total > counter.stock.get(p.id)) continue;
      lines.set(p.id, total);
    }
    if (!lines.size) continue;
    const items = [...lines].map(([productId, quantity]) => ({ productId, quantity }));
    const due = items.reduce((s, it) => s + Math.round(it.quantity * Math.round(counter.list.find((p) => p.id === it.productId).price * 100)), 0);

    let payments;
    const method = k < 2 ? 'cash' : rng.pick(SALE_METHODS);
    if (k === 3 && due >= 1000) {
      // Pagamento dividido: parte no Pix, o resto em dinheiro.
      const pix = Math.floor(due / 200) * 100;
      payments = [{ method: 'pix', amount: pix / 100 }, { method: 'cash', amount: (due - pix) / 100 }];
    } else if (method === 'cash') {
      // Dinheiro costuma vir arredondado para cima: o caixa devolve troco.
      const paid = Math.ceil(due / 500) * 500 + (rng.chance(0.3) ? 500 : 0);
      payments = [{ method, amount: paid / 100 }];
    } else {
      payments = [{ method, amount: due / 100 }];
    }
    const customerId = people.length && rng.chance(0.25) ? rng.pick(people).id : null;
    sold.push(await api.post('/sales', { customerId, items, discount: 0, payments, registerId: register.id, ...(times[k] ? { soldAt: times[k] } : {}) }));
    for (const it of items) if (counter.stock.has(it.productId)) counter.stock.set(it.productId, counter.stock.get(it.productId) - it.quantity);
  }
  return sold;
}

const cents = (v) => Math.round(v * 100) / 100;
const brl = (v) => v.toFixed(2).replace('.', ',');

// ---- Vendedores ---------------------------------------------------------------------------------

/** Membros ativos com o papel de vendas do setor; com menos de dois, convida mais dois (convite pendente, como no core). */
async function ensureSellers({ api, log, tenant }, { role, invite }) {
  const list = async () =>
    (await api.get('/users'))
      .filter((m) => m.status === 'active' && m.roles.some((r) => r.key === role))
      .map((m) => ({ id: m.user.id, name: m.user.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  let sellers = await list();
  let invited = 0;
  if (sellers.length < 2) {
    const r = (await api.get('/access/roles')).find((x) => x.key === role);
    if (!r) throw new Error(`papel ${role} não encontrado (módulo do setor ativo?)`);
    const slug = slugify(tenant.name);
    for (const name of invite) {
      const ok = await api
        .post('/users/invite', { email: `${slugify(name)}+${slug}@example.com`, name, roleIds: [r.id] })
        .catch((err) => (err.status === 409 ? null : Promise.reject(err)));
      if (ok) invited++;
    }
    sellers = await list();
  }
  log(`    ${invited ? `${invited} convidados; ` : ''}${sellers.map((s) => s.name).join(', ') || 'ninguém com o papel'}`);
  return sellers;
}

/** Negociações em aberto sem vendedor da equipe de vendas (o seed do setor abre tudo como o dono) são distribuídas. */
async function assignOpen({ api, log }, sellers, { list, field, patch }) {
  const ids = new Set(sellers.map((s) => s.id));
  const open = (await api.get(list)).filter((d) => !CLOSED_DEAL.includes(d.status) && !ids.has(d[field])).sort((a, b) => a.number - b.number);
  for (const [i, d] of open.entries()) {
    const [path, key] = patch(d);
    await api.patch(path, { [key]: sellers[i % sellers.length].id });
  }
  log(open.length ? `    ${open.length} distribuídas entre ${sellers.length}` : '    todas já têm alguém da equipe');
}

async function seedVehicleMonth({ api, log, customers }, sellers) {
  const who = pickers(customers);
  const seller = (i) => sellers[i % sellers.length].id;
  const deals = await api.get('/vehicles/deals');
  const stock = await api.get('/vehicles/stock');
  const byPlate = new Map(stock.filter((v) => v.plate).map((v) => [v.plate, v]));
  let won = 0;
  let lost = 0;

  for (const s of VEHICLE_WON) {
    let v = byPlate.get(s.vehicle.plate);
    if (!v) v = await api.post('/vehicles/stock', { status: 'available', ...s.vehicle });
    let deal = deals.find((d) => d.vehicle.id === v.id);
    if (deal && CLOSED_DEAL.includes(deal.status)) continue;
    if (!deal) {
      if (v.status !== 'available') continue;
      deal = await api.post('/vehicles/deals', { customerId: who(s.buyer).id, vehicleId: v.id, sellerId: seller(s.seller), ...s.body });
    }
    await api.post(`/vehicles/deals/${deal.id}/close`);
    won++;
  }

  for (const s of VEHICLE_LOST) {
    const v = byPlate.get(s.plate);
    if (!v) continue;
    const customer = who(s.buyer);
    let deal = deals.find((d) => d.vehicle.id === v.id);
    // Já perdida (rodada anterior) ou negociação de outra pessoa nesse veículo: não mexe.
    if (deal && (CLOSED_DEAL.includes(deal.status) || deal.customer.id !== customer.id)) continue;
    if (!deal) {
      if (v.status !== 'available') continue;
      deal = await api.post('/vehicles/deals', { customerId: customer.id, vehicleId: v.id, sellerId: seller(s.seller), ...s.body });
    }
    await api.post(`/vehicles/deals/${deal.id}/lose`, { reasonKey: s.reasonKey, reason: s.reason });
    lost++;
  }
  log(won || lost ? `    ${won} vendidas e ${lost} perdidas neste mês` : '    vendas e perdas do mês já lançadas');
}

async function seedRealEstateMonth({ api, log, customers }, brokers) {
  const who = pickers(customers);
  const broker = (i) => brokers[i % brokers.length].id;
  const res = await api.get('/real-estate/properties');
  const existing = res.items ?? res;
  const props = new Map();
  let createdProps = 0;
  for (const { key, owner, ...p } of RE_PROPERTIES) {
    let row = existing.find((x) => x.title === p.title);
    if (!row) {
      row = await api.post('/real-estate/properties', { status: 'available', financeable: true, ...CITY, ...p, ownerId: who(owner).id });
      createdProps++;
    }
    props.set(key, row);
  }

  const deals = await api.get('/real-estate/deals');
  let won = 0;
  let lost = 0;
  for (const s of RE_DEALS) {
    const property = props.get(s.property);
    const customer = buyerFor(who, s.buyer, property);
    let deal = deals.find((d) => d.property.id === property.id);
    if (deal && (CLOSED_DEAL.includes(deal.status) || deal.customer.id !== customer.id)) continue;
    if (!deal) {
      if (property.status !== 'available') continue;
      deal = await api.post('/real-estate/deals', { customerId: customer.id, propertyId: property.id, brokerId: broker(s.broker), ...s.body });
    }
    if (s.won) {
      await api.post(`/real-estate/deals/${deal.id}/close`);
      won++;
    } else {
      await api.post(`/real-estate/deals/${deal.id}/lose`, { reasonKey: s.reasonKey, reason: s.reason });
      lost++;
    }
  }
  log(`    ${createdProps} imóveis novos; ${won || lost ? `${won} vendidos e ${lost} perdidos neste mês` : 'vendas e perdas do mês já lançadas'}`);
}

/** O comprador não pode ser o proprietário: se coincidir, passa para a próxima pessoa. */
function buyerFor(who, key, property) {
  let c = who(key);
  for (let i = 1; c.id === property?.owner?.id && i < 10; i++) c = who(`${key[0]}${Number(key.slice(1)) + i}`);
  return c;
}

/** Cotas em andamento (em análise, ativas ou contempladas) sem consultor da equipe são distribuídas. */
async function assignQuotas({ api, log }, sellers) {
  const ids = new Set(sellers.map((s) => s.id));
  const quotas = (await api.get('/consortium/quotas'))
    .filter((q) => ['proposal', 'active', 'contemplated'].includes(q.status) && !ids.has(q.sellerId))
    .sort((a, b) => a.number - b.number);
  for (const [i, q] of quotas.entries()) await api.patch(`/consortium/quotas/${q.id}/seller`, { sellerId: sellers[i % sellers.length].id });
  log(quotas.length ? `    ${quotas.length} cotas distribuídas entre ${sellers.length}` : '    todas já têm consultor da equipe');
}

async function seedQuotasMonth({ api, rng, log, customers }, sellers) {
  const quotas = await api.get('/consortium/quotas');
  if (quotas.length < SECTOR_QUOTAS) return log(`    só ${quotas.length} cotas: rode de novo depois que o seed do consórcio vender as dele`);
  const plans = await api.get('/consortium/plans');
  const who = pickers(customers);
  const counts = {};
  for (const s of QUOTAS) {
    const customer = who(s.who);
    const plan = plans.find((p) => p.name === s.plan);
    if (!plan) continue;
    let q = quotas.find((x) => x.customer.id === customer.id && x.plan.name === s.plan);
    if (!q) {
      q = await api.post('/consortium/quotas', {
        customerId: customer.id,
        planId: plan.id,
        dueDay: s.dueDay,
        applicant: await applicantFor(api, rng, customer, s.income),
        sellerId: sellers[s.seller % sellers.length].id,
      });
    }
    // Desfecho da adesão (retoma se a rodada anterior parou antes dele).
    if (q.status === 'proposal' && s.outcome !== 'pending') {
      const [p] = await api.get('/banking/proposals', { sourceType: 'consortium_quota', sourceId: q.id });
      const inFlight = p && ['submitted', 'under_review', 'approved'].includes(p.status);
      if (s.outcome === 'approved' && p && ['submitted', 'under_review'].includes(p.status)) {
        await api.post(`/banking/proposals/${p.id}/refresh`);
      } else if (s.outcome === 'cancelled') {
        await api.post(`/consortium/quotas/${q.id}/cancel`, { reason: s.reason });
        if (inFlight) await api.post(`/banking/proposals/${p.id}/status`, { status: 'cancelled', message: s.reason });
      } else if (s.outcome === 'rejected' && inFlight) {
        // A administradora simulada sempre aceita; a proposta cancelada faz a cota cair em "Adesão recusada".
        await api.post(`/banking/proposals/${p.id}/status`, { status: 'cancelled', message: s.message });
      }
    }
    counts[s.outcome] = (counts[s.outcome] ?? 0) + 1;
  }
  log(`    ${Object.entries(counts).map(([o, n]) => `${n} ${o}`).join(', ') || 'nenhum plano correspondente'} (ativação pela fila de eventos)`);
}
