// Imobiliária: imóveis em São Paulo (venda e locação), propostas de compra com financiamento
// habitacional pelas instituições simuladas e visitas na agenda.
import { at, step, workday } from '../lib.mjs';
import { connectionFor, ensureConnections, ensureCredit, pickers } from './_banking.mjs';

const BANKS = [
  { name: 'Banco Habitar (simulação)', products: ['real_estate_financing'], realEstateYearlyRate: 10.49, tacFee: 0 },
  { name: 'Crédito Lar Financeira (simulação)', products: ['real_estate_financing'], realEstateYearlyRate: 11.99, tacFee: 0 },
];

const CITY = { city: 'São Paulo', state: 'SP' };

/** Imóveis de demonstração; o título identifica o imóvel (rodar de novo não duplica). `owner` indexa a carteira. */
const PROPERTIES = [
  {
    key: 'vmariana', owner: 'p0', purpose: 'sale', type: 'apartment', title: 'Apartamento 3 dormitórios com varanda gourmet — Vila Mariana',
    street: 'Rua Joaquim Távora', number: '1240', complement: 'Apto 82', district: 'Vila Mariana', zip: '04015-012',
    areaM2: 98, bedrooms: 3, suites: 1, bathrooms: 2, parking: 2, salePrice: 890000, condoFee: 1350, iptuYearly: 3200,
    description: 'Andar alto, sol da manhã, varanda gourmet com churrasqueira. 600 m do metrô Santa Cruz. Lazer completo.',
  },
  {
    key: 'pinheiros', owner: 'p1', purpose: 'sale', type: 'apartment', title: 'Apartamento 2 dormitórios perto do metrô Fradique Coutinho — Pinheiros',
    street: 'Rua Fradique Coutinho', number: '860', complement: 'Apto 54', district: 'Pinheiros', zip: '05416-001',
    areaM2: 68, bedrooms: 2, suites: 1, bathrooms: 2, parking: 1, salePrice: 750000, condoFee: 980, iptuYearly: 2100,
    description: 'Prédio novo, planta inteligente, a 300 m do metrô. Aceita financiamento e FGTS.',
  },
  {
    key: 'altopinheiros', owner: 'p2', purpose: 'sale', type: 'house', title: 'Casa térrea com 4 suítes e piscina — Alto de Pinheiros',
    street: 'Av. Arruda Botelho', number: '512', district: 'Alto de Pinheiros', zip: '05466-000',
    areaM2: 320, landM2: 500, bedrooms: 4, suites: 4, bathrooms: 5, parking: 4, salePrice: 2400000, iptuYearly: 9800,
    description: 'Rua arborizada e tranquila. Piscina, jardim, edícula e escritório.',
  },
  {
    key: 'belavista', owner: 'p3', purpose: 'rent', type: 'apartment', title: 'Studio mobiliado a duas quadras da Av. Paulista — Bela Vista',
    street: 'Rua Treze de Maio', number: '1500', complement: 'Apto 1203', district: 'Bela Vista', zip: '01327-000',
    areaM2: 32, bedrooms: 1, suites: 0, bathrooms: 1, parking: 0, rentPrice: 2800, condoFee: 650, iptuYearly: 900, status: 'rented', financeable: false,
    description: 'Mobiliado e equipado. Locação com seguro-fiança.',
  },
  {
    key: 'itaim', owner: 'p0', purpose: 'both', type: 'apartment', title: 'Apartamento 1 dormitório com lazer completo — Itaim Bibi',
    street: 'Rua Joaquim Floriano', number: '415', complement: 'Apto 1704', district: 'Itaim Bibi', zip: '04534-011',
    areaM2: 45, bedrooms: 1, suites: 1, bathrooms: 1, parking: 1, salePrice: 680000, rentPrice: 4500, condoFee: 1100, iptuYearly: 1900,
    description: 'Ideal para investidor: alta procura de locação na região. Piscina, academia e coworking.',
  },
  {
    key: 'morumbi', owner: 'p1', purpose: 'sale', type: 'condo_house', title: 'Casa em condomínio fechado com 3 suítes — Morumbi',
    street: 'Rua Itapaiúna', number: '2100', complement: 'Casa 14', district: 'Morumbi', zip: '05707-001',
    areaM2: 280, landM2: 400, bedrooms: 3, suites: 3, bathrooms: 4, parking: 3, salePrice: 1850000, condoFee: 1800, iptuYearly: 6200,
    description: 'Condomínio com segurança 24 h, quadra e área verde.',
  },
  {
    key: 'paulista', owner: 'c0', purpose: 'rent', type: 'office', title: 'Sala comercial de 42 m² na Av. Paulista',
    street: 'Av. Paulista', number: '1842', complement: 'Conjunto 154', district: 'Bela Vista', zip: '01310-200',
    areaM2: 42, bedrooms: 0, suites: 0, bathrooms: 1, parking: 1, rentPrice: 6500, condoFee: 1450, iptuYearly: 3100, financeable: false,
    description: 'Prédio corporativo com recepção e ar-condicionado central. Pronta para uso.',
  },
  {
    key: 'augusta', owner: 'c1', purpose: 'both', type: 'commercial', title: 'Ponto comercial de esquina na Rua Augusta',
    street: 'Rua Augusta', number: '2380', district: 'Jardins', zip: '01412-100',
    areaM2: 140, bedrooms: 0, suites: 0, bathrooms: 2, parking: 0, salePrice: 1200000, rentPrice: 9000, iptuYearly: 7800,
    description: 'Esquina de grande movimento, pé-direito duplo e mezanino.',
  },
  {
    key: 'moema', owner: 'p2', purpose: 'sale', type: 'apartment', title: 'Apartamento 3 suítes perto do Parque Ibirapuera — Moema',
    street: 'Alameda dos Arapanés', number: '620', complement: 'Apto 91', district: 'Moema', zip: '04524-001',
    areaM2: 120, bedrooms: 3, suites: 3, bathrooms: 4, parking: 2, salePrice: 1350000, condoFee: 1900, iptuYearly: 4600,
    description: 'Reformado, cozinha planejada, a 5 minutos do Ibirapuera.',
  },
  {
    key: 'saude', owner: 'c0', purpose: 'sale', type: 'land', title: 'Terreno de 300 m² para construção — Saúde',
    street: 'Rua Carneiro da Cunha', number: '780', district: 'Saúde', zip: '04144-000',
    landM2: 300, bedrooms: 0, suites: 0, bathrooms: 0, parking: 0, salePrice: 980000, iptuYearly: 3500, financeable: false,
    description: 'Plano, 10 x 30 m, zoneamento misto. Inventário em andamento: não aceita financiamento.',
  },
  {
    key: 'perdizes', owner: 'p3', purpose: 'rent', type: 'apartment', title: 'Apartamento 2 dormitórios reformado — Perdizes',
    street: 'Rua Cardoso de Almeida', number: '1120', complement: 'Apto 63', district: 'Perdizes', zip: '05013-001',
    areaM2: 74, bedrooms: 2, suites: 1, bathrooms: 2, parking: 1, rentPrice: 3900, condoFee: 1050, iptuYearly: 1800, status: 'rented',
    description: 'Reformado em 2025, armários planejados. Próximo à PUC.',
  },
  {
    key: 'vmadalena', owner: 'p1', purpose: 'sale', type: 'house', title: 'Sobrado 3 dormitórios com quintal — Vila Madalena',
    street: 'Rua Harmonia', number: '455', district: 'Vila Madalena', zip: '05435-000',
    areaM2: 170, landM2: 200, bedrooms: 3, suites: 1, bathrooms: 3, parking: 2, salePrice: 1600000, iptuYearly: 4200,
    description: 'Sobrado com quintal e churrasqueira, rua residencial perto do metrô Vila Madalena.',
  },
];

/** Propostas de compra: `buyer` indexa a carteira, `credit` leva o financiamento ao desfecho, `end` fecha ou perde. */
const DEALS = [
  { property: 'vmariana', buyer: 'p4', label: 'Vila Mariana financiado (contratado) e vendido', body: { price: 870000, paymentType: 'financing', downPayment: 190000, fgtsAmount: 40000, commissionPercent: 6 }, credit: { bank: 0, outcome: 'contracted' }, end: 'close' },
  { property: 'moema', buyer: 'p5', label: 'Moema com crédito aprovado', body: { price: 1300000, paymentType: 'financing', downPayment: 300000, commissionPercent: 5, notes: 'Proprietário aceitou R$ 1,3 mi com assinatura em até 30 dias.' }, credit: { bank: 0, outcome: 'approved' } },
  { property: 'pinheiros', buyer: 'p6', label: 'Pinheiros com crédito em análise', body: { price: 735000, paymentType: 'financing', downPayment: 160000, fgtsAmount: 30000, commissionPercent: 6 }, credit: { bank: 1, outcome: 'pending' } },
  { property: 'morumbi', buyer: 'p7', label: 'Morumbi perdido por crédito recusado', body: { price: 1800000, paymentType: 'financing', downPayment: 400000, commissionPercent: 6 }, credit: { bank: 1, outcome: 'rejected' }, end: 'lose', reasonKey: 'financing_denied', reason: 'Financiamento recusado: parcela acima de 30% da renda; cliente vai juntar uma entrada maior' },
  { property: 'altopinheiros', buyer: 'p5', label: 'Alto de Pinheiros em negociação à vista', body: { price: 2250000, paymentType: 'cash', commissionPercent: 5, notes: 'Contraproposta do proprietário: R$ 2,32 mi. Comprador vende outro imóvel para pagar.' } },
  { property: 'vmadalena', buyer: 'p6', label: 'Vila Madalena vendido à vista', body: { price: 1550000, paymentType: 'cash', commissionPercent: 6 }, end: 'close' },
  { property: 'augusta', buyer: 'c0', label: 'Ponto na Augusta perdido', body: { price: 1100000, paymentType: 'cash', commissionPercent: 6 }, end: 'lose', reasonKey: 'gave_up', reason: 'Comprador desistiu após a vistoria (instalação elétrica precisa de reforma)' },
];

/** Visitas e outros horários na agenda: dia útil relativo a hoje, hora, imóvel, cliente e status final. */
const VISITS = [
  { day: -20, hh: 10, property: 'pinheiros', who: 'p6', service: 'Visita ao imóvel', status: 'done', notes: 'Gostou da planta; pediu simulação de financiamento.' },
  { day: -14, hh: 15, property: 'moema', who: 'p5', service: 'Visita ao imóvel', status: 'done', notes: 'Segunda visita, com a esposa.' },
  { day: -9, hh: 11, property: 'morumbi', who: 'p4', service: 'Visita ao imóvel', status: 'no_show' },
  { day: -6, hh: 16, property: 'itaim', who: 'p0', service: 'Avaliação de imóvel', status: 'done', notes: 'Avaliação para venda e locação.' },
  { day: -3, hh: 10, property: 'altopinheiros', who: 'p5', service: 'Visita ao imóvel', status: 'done' },
  { day: 1, hh: 10, property: 'itaim', who: 'p7', service: 'Visita ao imóvel', status: 'confirmed', notes: 'Investidor: quer saber o valor de locação da região.' },
  { day: 2, hh: 14, property: 'paulista', who: 'c1', service: 'Visita ao imóvel', status: 'scheduled', notes: 'Escritório de contabilidade procurando sala.' },
  { day: 3, hh: 17, property: 'moema', who: 'p5', service: 'Assinatura de contrato', status: 'scheduled' },
  { day: 4, hh: 11, property: 'saude', who: 'c1', service: 'Visita ao imóvel', status: 'scheduled' },
  { day: 5, hh: 15, property: 'vmariana', who: 'p2', service: 'Visita ao imóvel', status: 'cancelled', reason: 'Imóvel vendido antes da visita' },
];

const SERVICES = [
  { name: 'Visita ao imóvel', category: 'Atendimento', durationMin: 60 },
  { name: 'Avaliação de imóvel', category: 'Captação', durationMin: 90 },
  { name: 'Assinatura de contrato', category: 'Fechamento', durationMin: 60 },
];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log } = ctx;
  const who = pickers(ctx.customers);
  const banks = await step(log, 'bancos (simulação)', () => ensureConnections(api, log, BANKS));
  const props = await step(log, 'imóveis', () => seedProperties(ctx, who));
  if (!props) return;

  const deals = await api.get('/real-estate/deals');
  const connections = banks ?? (await api.get('/banking/connections'));
  for (const s of DEALS) {
    const property = props.get(s.property);
    await step(log, `proposta: ${s.label}`, () => runDeal(ctx, s, property, buyerFor(who, s.buyer, property), deals, connections));
  }
  await step(log, 'agenda de visitas', () => seedVisits(ctx, props, who));
}

async function seedProperties({ api, log }, who) {
  const existing = await api.get('/real-estate/properties');
  const byTitle = new Map(existing.map((p) => [p.title, p]));
  const result = new Map();
  let created = 0;
  for (const { key, owner, ...p } of PROPERTIES) {
    let row = byTitle.get(p.title);
    if (!row) {
      row = await api.post('/real-estate/properties', { status: 'available', financeable: true, ...CITY, ...p, ownerId: who(owner).id });
      created++;
    }
    result.set(key, row);
  }
  log(`    ${created ? `${created} imóveis cadastrados` : 'imóveis de demonstração já cadastrados'} (${existing.length + created} no total)`);
  return result;
}

/** O comprador não pode ser o proprietário: se coincidir, passa para a próxima pessoa. */
function buyerFor(who, key, property) {
  let c = who(key);
  for (let i = 1; c.id === property?.owner.id && i < 10; i++) c = who(`${key[0]}${Number(key.slice(1)) + i}`);
  return c;
}

async function runDeal({ api, rng, log }, s, property, customer, deals, connections) {
  if (!property) throw new Error(`imóvel ${s.property} não cadastrado`);
  let deal = deals.find((d) => d.property.id === property.id);
  if (!deal) {
    if (property.status !== 'available') throw new Error(`imóvel ${s.property} está ${property.status}`);
    deal = await api.post('/real-estate/deals', { customerId: customer.id, propertyId: property.id, ...s.body });
  }
  if (deal.status === 'closed' || deal.status === 'lost') return log(`    já encerrada (${deal.status})`);

  if (s.credit) {
    const p = await ensureCredit(api, rng, {
      sourceType: 'real_estate_deal',
      sourceId: deal.id,
      customer: deal.customer,
      connection: connectionFor(connections, 'real_estate_financing', BANKS[s.credit.bank].name),
      product: 'real_estate_financing',
      amount: deal.financedAmount,
      termMonths: 360,
      system: 'sac',
      outcome: s.credit.outcome,
      details: { property: deal.property.title, code: deal.property.code, address: deal.property.address, propertyValue: deal.price, downPayment: deal.downPayment, fgts: deal.fgtsAmount },
    });
    log(`    proposta em ${p.connection.name}: ${p.status}`);
  }
  if (s.end === 'close') await api.post(`/real-estate/deals/${deal.id}/close`);
  if (s.end === 'lose') await api.post(`/real-estate/deals/${deal.id}/lose`, { reasonKey: s.reasonKey, reason: s.reason });
}

async function seedVisits({ api, log, users }, props, who) {
  const range = { from: at(-60, 0), to: at(60, 0) };
  const existing = (await api.get('/scheduling/appointments', range)).filter((a) => a.subject?.type === 're_property');
  if (existing.length >= 6) return log(`    já tem ${existing.length} visitas na agenda`);

  // Serviços da agenda (o módulo cria ao ser ativado; recria se faltarem).
  const services = await api.get('/scheduling/services');
  for (const s of SERVICES) {
    if (!services.some((x) => x.name === s.name)) services.push(await api.post('/scheduling/services', { ...s, price: 0, online: s.name === 'Visita ao imóvel', active: true }));
  }
  const serviceId = (name) => services.find((x) => x.name === name).id;

  // Corretores na agenda: a equipe com papel da imobiliária (os convites ainda não aceitos não têm usuário, então sem vínculo).
  let resources = (await api.get('/scheduling/resources')).filter((r) => r.active && r.kind === 'professional');
  if (resources.length < 2) {
    const brokers = users.filter((u) => u.roleKeys.some((k) => k.startsWith('real_estate.')));
    const names = [...brokers, ...users].map((u) => u.name).filter((n, i, all) => all.indexOf(n) === i);
    const colors = ['#2d4bff', '#0f9d58', '#e8710a'];
    for (const name of [...names, 'Corretor de plantão'].slice(0, 2 - resources.length)) {
      if (resources.some((r) => r.name === name)) continue;
      const { id } = await api.post('/scheduling/resources', { name, kind: 'professional', color: colors[resources.length % colors.length], active: true });
      resources.push({ id, name });
    }
  }

  let created = 0;
  for (const [i, v] of VISITS.entries()) {
    const property = props.get(v.property);
    const startsAt = at(workday(v.day), v.hh);
    const resource = resources[i % resources.length];
    if (existing.some((a) => a.subject?.id === property.id && new Date(a.startsAt).getTime() === new Date(startsAt).getTime())) continue;
    const appt = await api.post('/scheduling/appointments', {
      customerId: who(v.who).id,
      resourceId: resource.id,
      startsAt,
      serviceIds: [serviceId(v.service)],
      notes: v.notes ?? null,
      subject: { type: 're_property', id: property.id, label: `Cód. ${property.code} — ${property.title}`.slice(0, 120) },
    });
    if (v.status !== 'scheduled') await api.post(`/scheduling/appointments/${appt.id}/status`, { status: v.status, reason: v.reason ?? null });
    created++;
  }
  log(`    ${created} horários marcados (${resources.map((r) => r.name).join(', ')})`);
}
