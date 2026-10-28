// Especialidades da clínica de estética (só fake-estetica): liga todas e cria produtos com lote,
// registro dos profissionais no conselho, aplicações de toxina e preenchedor com mapa facial, um
// clareamento em andamento, uma cirurgia com pré-operatório, orçamento aprovado e data marcada,
// micropigmentação com retoque na agenda, sessões de laser, um caso de tricologia, termos aceitos
// com assinatura e fotos de antes e depois. As fotos são ilustrações desenhadas aqui (PNG gerado
// em código), nunca fotos de pessoas.
//
// Pode rodar de novo: produtos e lotes vão pelo nome, e cada paciente só recebe as fichas se ainda
// não tiver as daquela especialidade (o prontuário é só inclusão: repetir duplicaria registros).
import { deflateSync } from 'node:zlib';
import { day, step, workday } from '../lib.mjs';

const ALL = ['harmonization', 'whitening', 'plastic_surgery', 'micropigmentation', 'laser', 'trichology'];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type}[], users: object[] }} ctx */
export default async function seedAestheticsSpecialties({ api, rng, log, tenant, customers }) {
  if (tenant.name !== 'fake-estetica') return;
  const people = customers.filter((c) => c.type === 'person');
  if (people.length < 10) return log('  ✗ especialidades: poucos pacientes cadastrados');
  // Os 7 primeiros já têm pacotes (verticals/aesthetics.mjs): as especialidades usam os seguintes.
  const patient = (i) => people[(8 + i) % people.length];

  const on = await step(log, 'especialidades ligadas', async () => {
    const current = await api.get('/modules/aesthetics/settings');
    await api.put('/modules/aesthetics/settings', { ...current, specialties: ALL });
    return true;
  });
  if (!on) return;
  const pros = await step(log, 'registro dos profissionais no conselho', () => ensurePros(api, log));
  if (!pros) return;
  const lots = await step(log, 'produtos com lote e validade', () => ensureProducts(api, log));
  if (!lots) return;

  const ctx = await createContext(api, rng, pros, lots);
  await step(log, 'harmonização facial (toxina e preenchedor)', () => harmonization(ctx, log, patient));
  await step(log, 'clareamento dental em andamento', () => whitening(ctx, log, patient(3)));
  await step(log, 'cirurgia plástica (pré-operatório, orçamento e cirurgia marcada)', () => surgery(ctx, log, patient(4), patient(5)));
  await step(log, 'micropigmentação com retoque', () => micropigmentation(ctx, log, patient(6)));
  await step(log, 'depilação a laser', () => laser(ctx, log, patient(7)));
  await step(log, 'tricologia', () => trichology(ctx, log, patient(8)));
}

// ---- Profissionais e conselho ------------------------------------------------------------------

const workdays = (start, end) => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start, end }));

async function ensurePros(api, log) {
  const resources = await api.get('/scheduling/resources');
  // O seed da estética pode ter usado o nome do usuário ligado: acha também pela cor.
  const find = (name, color) => resources.find((r) => r.kind === 'professional' && (r.name === name || (color && r.color === color)));
  const pros = {
    helena: find('Dra. Helena Vasconcelos', '#7c3aed'),
    livia: find('Dra. Lívia Martins', '#0891b2'),
    tatiane: find('Tatiane Freitas', '#db2777'),
    aline: find('Aline Costa', '#ea580c'),
    rafael: find('Dr. Rafael Moreira', '#1d4ed8'),
  };
  for (const key of ['helena', 'livia', 'tatiane', 'aline']) if (!pros[key]) throw new Error(`profissional "${key}" não encontrado (rode o seed da estética antes)`);
  if (!pros.rafael) {
    const { id } = await api.post('/scheduling/resources', { name: 'Dr. Rafael Moreira', kind: 'professional', color: '#1d4ed8', active: true });
    await api.put(`/scheduling/resources/${id}/hours`, { hours: workdays('07:00', '19:00') });
    pros.rafael = (await api.get('/scheduling/resources')).find((r) => r.id === id);
    log('    Dr. Rafael Moreira (cirurgião plástico) cadastrado');
  }
  const credentials = [
    ['helena', { council: 'CRM', number: '132457', uf: 'SP', rqe: '48211', specialty: 'Dermatologia' }],
    ['livia', { council: 'CRO', number: '98765', uf: 'SP', specialty: 'Harmonização orofacial e dentística' }],
    ['rafael', { council: 'CRM', number: '145678', uf: 'SP', rqe: '52341', specialty: 'Cirurgia plástica' }],
    ['tatiane', { council: 'CRBM', number: '40213', uf: 'SP', specialty: 'Biomedicina estética' }],
  ];
  for (const [key, body] of credentials) await api.put(`/aesthetics/credentials/${pros[key].id}`, body);
  log(`    ${credentials.length} registros (CRM, CRO, CRBM)`);
  return pros;
}

// ---- Produtos e lotes ----------------------------------------------------------------------------

const PRODUCTS = [
  {
    name: 'Toxina botulínica tipo A 100 U', brand: 'Botox (Allergan)', kind: 'toxin', unit: 'U', unitsPerPackage: 100, anvisaRegistration: '1004300120024',
    lots: [{ lot: 'C8123A3', exp: 240, qty: 600 }, { lot: 'C7710B1', exp: -20, qty: 200 }],
    stock: { name: 'Botox 100 U (frasco)', price: 1450, cost: 980, qty: 6 },
  },
  { name: 'Toxina botulínica tipo A 300 U', brand: 'Dysport (Galderma)', kind: 'toxin', unit: 'U', unitsPerPackage: 300, anvisaRegistration: '1290000150012', lots: [{ lot: 'R95231', exp: 200, qty: 900 }] },
  { name: 'Ácido hialurônico Voluma 1 ml', brand: 'Juvéderm (Allergan)', kind: 'filler', unit: 'ml', unitsPerPackage: 1, anvisaRegistration: '1004300150098', lots: [{ lot: 'VB30A27', exp: 420, qty: 10 }] },
  { name: 'Ácido hialurônico Kysse 1 ml', brand: 'Restylane (Galderma)', kind: 'filler', unit: 'ml', unitsPerPackage: 1, anvisaRegistration: '1290000170041', lots: [{ lot: '21974-1', exp: 380, qty: 8 }] },
  { name: 'Ácido poli-L-láctico', brand: 'Sculptra (Galderma)', kind: 'biostimulator', unit: 'ml', unitsPerPackage: 8, anvisaRegistration: '1290000130077', lots: [{ lot: 'SC0457', exp: 500, qty: 40 }] },
  { name: 'Fio PDO espiculado 19G', brand: 'I-Thread', kind: 'thread', unit: 'fio', unitsPerPackage: 20, lots: [{ lot: 'IT2407-55', exp: 700, qty: 60 }] },
  { name: 'Pigmento Marrom Café', brand: 'Mag Color', kind: 'pigment', unit: 'ml', lots: [{ lot: 'MC2405', exp: 600, qty: 15 }] },
  { name: 'Pigmento Castanho Médio', brand: 'Mag Color', kind: 'pigment', unit: 'ml', lots: [{ lot: 'MC2411', exp: 640, qty: 15 }] },
  { name: 'Pigmento Rosé Natural', brand: 'Electric Ink', kind: 'pigment', unit: 'ml', lots: [{ lot: 'EI-RN-0925', exp: 560, qty: 10 }] },
  { name: 'Gel clareador peróxido de hidrogênio 35%', brand: 'Whiteness HP (FGM)', kind: 'whitening_gel', unit: 'g', lots: [{ lot: '061024', exp: 300, qty: 30 }] },
  { name: 'Gel clareador peróxido de carbamida 16%', brand: 'Whiteness Perfect (FGM)', kind: 'whitening_gel', unit: 'g', lots: [{ lot: '220924', exp: 330, qty: 60 }] },
  { name: 'Prótese mamária redonda texturizada', brand: 'Silimed', kind: 'implant', unit: 'un', anvisaRegistration: '10345160088', lots: [{ lot: 'SM-24-118733', exp: 1500, qty: 4 }] },
  { name: 'Minoxidil 0,5% injetável', brand: 'Farmácia de manipulação', kind: 'hair_drug', unit: 'ml', lots: [{ lot: 'MX241018', exp: 120, qty: 30 }] },
];

/** Cadastra o que falta (produto pelo nome, lote pelo número) e devolve { "Produto": idDoLoteVálido }. */
async function ensureProducts(api, log) {
  let products = await api.get('/aesthetics/products');
  let created = 0;
  let newLots = 0;
  for (const p of PRODUCTS) {
    let found = products.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (!found) {
      let salesProductId = null;
      if (p.stock) salesProductId = await ensureStockProduct(api, p.stock);
      found = await api.post('/aesthetics/products', { name: p.name, brand: p.brand, kind: p.kind, unit: p.unit, unitsPerPackage: p.unitsPerPackage ?? null, anvisaRegistration: p.anvisaRegistration ?? null, salesProductId, active: true });
      created++;
    }
    for (const l of p.lots) {
      if (found.lots.some((x) => x.lot === l.lot)) continue;
      found = await api.post('/aesthetics/lots', { productId: found.id, lot: l.lot, expiresOn: day(l.exp), receivedOn: day(Math.min(-30, l.exp - 400)), quantity: l.qty });
      newLots++;
    }
  }
  products = await api.get('/aesthetics/products');
  log(`    ${created} produto(s) e ${newLots} lote(s) novos (um lote de toxina já vencido, para o alerta)`);
  const out = {};
  for (const p of products) {
    const valid = p.lots.filter((l) => !l.expired).sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0];
    if (valid) out[p.name] = { lotId: valid.id, product: p };
  }
  return out;
}

/** Frasco de toxina no estoque do PDV: cada aplicação dá baixa proporcional. */
async function ensureStockProduct(api, s) {
  const existing = (await api.get('/sales/products', { q: s.name })).find((x) => x.name === s.name);
  if (existing) return existing.id;
  const product = await api.post('/sales/products', { name: s.name, category: 'Injetáveis', unit: 'un', price: s.price, cost: s.cost, trackStock: true, minStock: 2, active: true });
  await api.post('/sales/stock-moves', { productId: product.id, kind: 'purchase', quantity: s.qty, unitCost: s.cost, reason: 'NF 18.452 — distribuidora' });
  return product.id;
}

// ---- Contexto comum -------------------------------------------------------------------------------

async function createContext(api, rng, pros, lots) {
  const [templates, services, resources] = await Promise.all([api.get('/aesthetics/consent-templates'), api.get('/scheduling/services'), api.get('/scheduling/resources')]);
  const lot = (name) => {
    const l = lots[name];
    if (!l) throw new Error(`lote de "${name}" não encontrado`);
    return l.lotId;
  };
  const ctx = {
    api,
    rng,
    pros,
    lot,
    rooms: resources.filter((r) => r.kind === 'room' && r.active),
    service: (name) => services.find((s) => s.name === name),
    patientData: (customerId) => api.get(`/aesthetics/patients/${customerId}`),
    record: (body) => api.post('/aesthetics/records', body),
    async consent(customer, specialty, templateKey, procedure, professional, n, caseId = null) {
      const template = templates.find((t) => t.key === templateKey);
      if (!template) throw new Error(`termo ${templateKey} não encontrado`);
      return api.post('/aesthetics/consents', {
        customerId: customer.id,
        templateId: template.id,
        specialty,
        procedure,
        professionalId: professional.id,
        caseId,
        signedBy: customer.name,
        signature: `data:image/png;base64,${signaturePng(rng).toString('base64')}`,
        occurredOn: day(n),
      });
    },
    photo(customer, specialty, { region, angle = 'Frontal', phase, n, caseId = null, image }) {
      const q = new URLSearchParams({ customerId: customer.id, specialty, region, angle, phase, occurredOn: day(n), ...(caseId ? { caseId } : {}) });
      return api.upload(`/aesthetics/photos?${q}`, 'file', image, `${specialty}-${phase.toLowerCase()}.png`, 'image/png');
    },
    /** Retorno/retoque na agenda: primeiro horário livre a partir do dia `n` (até uma semana depois). */
    async book(customer, serviceName, professional, n) {
      const service = ctx.service(serviceName);
      if (!service) return null;
      for (let i = workday(Math.max(n, 1)); i < n + 10; i = workday(i + 1)) {
        const [slots] = await api.get('/scheduling/availability', { date: day(i), serviceIds: service.id, resourceId: professional.id });
        const time = slots?.slots.find((s) => s >= '10:00') ?? slots?.slots[0];
        if (!time) continue;
        return api.post('/scheduling/appointments', {
          customerId: customer.id,
          resourceId: professional.id,
          serviceIds: [service.id],
          startsAt: `${day(i)}T${time}:00-03:00`,
          notes: 'Retorno/retoque marcado pela ficha da especialidade',
        });
      }
      return null;
    },
  };
  return ctx;
}

const has = (data, formKey) => data.entries.some((e) => e.formKey === formKey);
const caseOf = (data, title) => data.cases.find((c) => c.title === title);

// ---- Harmonização --------------------------------------------------------------------------------

/** Pontos típicos da toxina no terço superior (U por ponto) no desenho de 200 × 250 do mapa facial. */
const TOXIN_UPPER = [
  ['Frontal', 72, 52, 2], ['Frontal', 86, 48, 2], ['Frontal', 100, 46, 2], ['Frontal', 114, 48, 2], ['Frontal', 128, 52, 2],
  ['Glabela', 100, 80, 8], ['Sobrancelha direita', 84, 79, 4], ['Sobrancelha esquerda', 116, 79, 4], ['Sobrancelha direita', 72, 77, 2], ['Sobrancelha esquerda', 128, 77, 2],
  ['Periorbicular direito (pés de galinha)', 46, 94, 4], ['Periorbicular direito (pés de galinha)', 44, 101, 4], ['Periorbicular direito (pés de galinha)', 46, 108, 4],
  ['Periorbicular esquerdo (pés de galinha)', 154, 94, 4], ['Periorbicular esquerdo (pés de galinha)', 156, 101, 4], ['Periorbicular esquerdo (pés de galinha)', 154, 108, 4],
];
const LIPS = [
  ['Lábio superior', 92, 163, 0.25], ['Lábio superior', 108, 163, 0.25], ['Lábio inferior', 94, 179, 0.2], ['Lábio inferior', 106, 179, 0.2], ['Comissura labial direita', 81, 172, 0.05], ['Comissura labial esquerda', 119, 172, 0.05],
];
const points = (list, lotId) => list.map(([region, x, y, amount]) => ({ region, x, y, lotId, amount, unit: '' }));

async function harmonization(ctx, log, patient) {
  const { pros } = ctx;
  let done = 0;
  // 1) Toxina no terço superior há 40 dias, com retorno feito.
  const ana = patient(0);
  if (!has(await ctx.patientData(ana.id), 'aesthetics.harmonization')) {
    await ctx.consent(ana, 'harmonization', 'harmonization.toxin', 'Toxina botulínica no terço superior', pros.helena, -40);
    await ctx.photo(ana, 'harmonization', { region: 'Terço superior', phase: 'Antes', n: -40, image: facePng({ wrinkles: 3 }) });
    await ctx.record({
      specialty: 'harmonization',
      formKey: 'aesthetics.harmonization',
      customerId: ana.id,
      professionalId: pros.helena.id,
      occurredOn: day(-40),
      data: {
        procedure: 'Toxina botulínica',
        points: points(TOXIN_UPPER, ctx.lot('Toxina botulínica tipo A 100 U')),
        technique: 'Agulha',
        dilution: '100 U em 2,5 ml de soro fisiológico 0,9%',
        anesthesia: 'Gelo local',
        reaction: 'Pápulas nos pontos, regrediram em 20 min',
        guidance: 'Não deitar por 4 h, não massagear e evitar atividade física no dia.',
        returnOn: day(-25),
      },
    });
    await ctx.photo(ana, 'harmonization', { region: 'Terço superior', phase: 'Depois', n: -25, image: facePng({ wrinkles: 0 }) });
    done++;
  }
  // 2) Preenchimento labial com intercorrência leve (equimose).
  const bia = patient(1);
  if (!has(await ctx.patientData(bia.id), 'aesthetics.harmonization')) {
    await ctx.consent(bia, 'harmonization', 'harmonization.filler', 'Preenchimento labial com ácido hialurônico', pros.livia, -20);
    await ctx.photo(bia, 'harmonization', { region: 'Lábios', phase: 'Antes', n: -20, image: lipsPng({ full: false }) });
    await ctx.record({
      specialty: 'harmonization',
      formKey: 'aesthetics.harmonization',
      customerId: bia.id,
      professionalId: pros.livia.id,
      occurredOn: day(-20),
      data: {
        procedure: 'Preenchimento (ácido hialurônico)',
        points: points(LIPS, ctx.lot('Ácido hialurônico Kysse 1 ml')),
        technique: 'Agulha e cânula',
        anesthesia: 'Anestésico tópico + lidocaína do produto',
        reaction: 'Edema leve esperado',
        guidance: 'Compressa fria, evitar beijo, canudo e calor por 24 h.',
        returnOn: day(-5),
      },
    });
    await ctx.record({
      specialty: 'harmonization',
      formKey: 'aesthetics.complication',
      customerId: bia.id,
      professionalId: pros.livia.id,
      occurredOn: day(-18),
      data: { kind: 'Equimose / hematoma', severity: 'Leve', description: 'Pequena equimose no lábio inferior à esquerda, sem dor.', conduct: 'Compressa fria e pomada de arnica; reavaliar no retorno.', resolved: true },
    });
    await ctx.photo(bia, 'harmonization', { region: 'Lábios', phase: 'Depois', n: -5, image: lipsPng({ full: true }) });
    done++;
  }
  // 3) Toxina há 5 dias: retoque marcado na agenda para daqui a ~10 dias.
  const carla = patient(2);
  if (!has(await ctx.patientData(carla.id), 'aesthetics.harmonization')) {
    await ctx.consent(carla, 'harmonization', 'harmonization.toxin', 'Toxina botulínica: glabela e pés de galinha', pros.helena, -5);
    await ctx.record({
      specialty: 'harmonization',
      formKey: 'aesthetics.harmonization',
      customerId: carla.id,
      professionalId: pros.helena.id,
      occurredOn: day(-5),
      data: {
        procedure: 'Toxina botulínica',
        points: points(TOXIN_UPPER.slice(5), ctx.lot('Toxina botulínica tipo A 100 U')),
        technique: 'Agulha',
        dilution: '100 U em 2,5 ml de soro fisiológico 0,9%',
        guidance: 'Retorno em 15 dias para avaliar e retocar, se preciso.',
        returnOn: day(10),
      },
    });
    const appt = await ctx.book(carla, 'Retorno de injetáveis (retoque)', pros.helena, 10);
    log(`    retoque da toxina ${appt ? `marcado em ${appt.startsAt.slice(0, 10).split('-').reverse().join('/')}` : 'sem horário livre'}`);
    done++;
  }
  log(`    ${done} paciente(s) com aplicação nova`);
}

// ---- Clareamento ---------------------------------------------------------------------------------

async function whitening(ctx, log, customer) {
  const { pros } = ctx;
  const title = 'Clareamento combinado (consultório + caseiro)';
  const data = await ctx.patientData(customer.id);
  if (caseOf(data, title)) return log('    já existe');
  const c = await ctx.api.post('/aesthetics/cases', { customerId: customer.id, specialty: 'whitening', title, professionalId: pros.livia.id, plannedSessions: 3, startedOn: day(-14), notes: 'Objetivo: B1. Restaurações anteriores serão trocadas depois do clareamento.' });
  await ctx.consent(customer, 'whitening', 'whitening.default', title, pros.livia, -14, c.id);
  await ctx.photo(customer, 'whitening', { region: 'Sorriso', phase: 'Antes', n: -14, caseId: c.id, image: smilePng({ shade: 0 }) });
  const sessions = [
    { n: -14, type: 'Consultório', session: 1, shadeBefore: 'A3', shadeAfter: 'A2', gel: 'Gel clareador peróxido de hidrogênio 35%', concentration: 'Peróxido de hidrogênio 35%', exposure: '3 × 15 min', sensitivity: 'Leve', tray: 'Moldagem feita' },
    { n: -7, type: 'Combinado', session: 2, shadeBefore: 'A2', shadeAfter: 'B2', gel: 'Gel clareador peróxido de carbamida 16%', concentration: 'Peróxido de carbamida 16% (caseiro, 2 h por dia)', exposure: '14 dias de uso caseiro', sensitivity: 'Moderada', tray: 'Moldeira entregue' },
  ];
  for (const s of sessions) {
    await ctx.record({
      specialty: 'whitening',
      formKey: 'aesthetics.whitening',
      customerId: customer.id,
      caseId: c.id,
      professionalId: pros.livia.id,
      occurredOn: day(s.n),
      data: { type: s.type, session: s.session, shadeBefore: s.shadeBefore, shadeAfter: s.shadeAfter, lotId: ctx.lot(s.gel), concentration: s.concentration, exposure: s.exposure, barrier: s.type === 'Consultório', sensitivity: s.sensitivity, tray: s.tray, guidance: 'Dieta branca durante o tratamento; dessensibilizante se houver sensibilidade.' },
    });
  }
  await ctx.photo(customer, 'whitening', { region: 'Sorriso', phase: 'Durante', n: -7, caseId: c.id, image: smilePng({ shade: 1 }) });
  log('    2 de 3 sessões (A3 → B2)');
}

// ---- Cirurgia plástica ---------------------------------------------------------------------------

async function surgery(ctx, log, customer, second) {
  const { api, pros } = ctx;
  const title = 'Abdominoplastia com lipoaspiração de flancos';
  const data = await ctx.patientData(customer.id);
  if (!caseOf(data, title)) {
    const c = await api.post('/aesthetics/cases', { customerId: customer.id, specialty: 'plastic_surgery', title, professionalId: pros.rafael.id, startedOn: day(-30) });
    await ctx.record({
      specialty: 'plastic_surgery',
      formKey: 'aesthetics.surgery.evaluation',
      customerId: customer.id,
      caseId: c.id,
      professionalId: pros.rafael.id,
      occurredOn: day(-30),
      data: {
        complaint: 'Flacidez e excesso de pele no abdome depois de duas gestações; gordura localizada nos flancos.',
        procedure: title,
        history: 'Duas cesáreas (2018 e 2021). Sem doenças crônicas.',
        medications: 'Anticoncepcional oral (suspender 30 dias antes)',
        allergies: 'Dipirona',
        smoker: false,
        weight: 68,
        height: 1.65,
        plan: 'Abdominoplastia clássica com plicatura dos retos e lipoaspiração de flancos. Malha por 60 dias e drenagem linfática a partir do 7º dia.',
      },
    });
    await ctx.photo(customer, 'plastic_surgery', { region: 'Abdome', phase: 'Antes', n: -30, caseId: c.id, image: abdomenPng({ after: false }) });
    await ctx.photo(customer, 'plastic_surgery', { region: 'Abdome', angle: 'Perfil direito', phase: 'Antes', n: -30, caseId: c.id, image: abdomenPng({ after: false, profile: true }) });
    await api.put(`/aesthetics/cases/${c.id}/budget`, {
      items: [
        { kind: 'surgeon', description: 'Honorários do cirurgião e equipe cirúrgica', amount: 18000, billedBy: 'clinic' },
        { kind: 'anesthetist', description: 'Equipe de anestesia', amount: 3200, billedBy: 'third_party' },
        { kind: 'hospital', description: 'Hospital: sala cirúrgica e 1 diária', amount: 9500, billedBy: 'third_party' },
        { kind: 'materials', description: 'Malha compressiva, medicamentos e curativos', amount: 1800, billedBy: 'clinic' },
      ],
      validUntil: day(30),
    });
    await api.post(`/aesthetics/cases/${c.id}/budget/approve`, { installments: 6, approvedOn: day(-25), firstDueOn: day(-25) });
    await ctx.consent(customer, 'plastic_surgery', 'plastic_surgery.default', title, pros.rafael, -20, c.id);
    await ctx.record({
      specialty: 'plastic_surgery',
      formKey: 'aesthetics.surgery.preop',
      customerId: customer.id,
      caseId: c.id,
      professionalId: pros.rafael.id,
      occurredOn: day(-5),
      data: {
        exams: [
          { exam: 'Hemograma completo', date: day(-9), result: 'Hb 13,2 g/dL', ok: true },
          { exam: 'Coagulograma', date: day(-9), result: 'TP e TTPa normais', ok: true },
          { exam: 'Glicemia de jejum', date: day(-9), result: '88 mg/dL', ok: true },
          { exam: 'Eletrocardiograma', date: day(-8), result: 'Ritmo sinusal', ok: true },
          { exam: 'Beta-HCG', date: day(-9), result: 'Negativo', ok: true },
        ],
        asa: 'ASA I',
        cardioRisk: 'Baixo',
        cardioClearance: true,
        anesthetist: 'Dr. Paulo Teixeira (CRM-SP 110233)',
        anesthesiaType: 'Peridural',
        anesthesiaClearance: true,
        released: true,
      },
    });
    const service = ctx.service('Cirurgia plástica (centro cirúrgico)');
    let scheduled = null;
    for (let n = workday(9); n < 25 && !scheduled; n = workday(n + 1)) {
      try {
        scheduled = await api.post(`/aesthetics/cases/${c.id}/surgery`, {
          resourceId: pros.rafael.id,
          serviceId: service.id,
          startsAt: `${day(n)}T07:30:00-03:00`,
          location: 'Hospital Santa Catarina — centro cirúrgico 2',
          team: [
            { role: 'Anestesista', name: 'Dr. Paulo Teixeira' },
            { role: 'Cirurgiã auxiliar', name: 'Dra. Marina Lopes' },
            { role: 'Instrumentadora', name: 'Carla Nunes' },
          ],
        });
      } catch (err) {
        if (err.status !== 409 && err.status !== 400) throw err;
      }
    }
    log(`    ${title}: orçamento aprovado (6x), termo assinado, pré-operatório liberado, cirurgia ${scheduled ? `em ${scheduled.surgery.startsAt.slice(0, 10).split('-').reverse().join('/')}` : 'sem data livre'}`);
  }

  // Segunda paciente: avaliação feita, orçamento em rascunho (aparece em "Orçamentos de cirurgia").
  const title2 = 'Mamoplastia de aumento';
  if (!caseOf(await ctx.patientData(second.id), title2)) {
    const c = await api.post('/aesthetics/cases', { customerId: second.id, specialty: 'plastic_surgery', title: title2, professionalId: pros.rafael.id, startedOn: day(-3) });
    await ctx.record({
      specialty: 'plastic_surgery',
      formKey: 'aesthetics.surgery.evaluation',
      customerId: second.id,
      caseId: c.id,
      professionalId: pros.rafael.id,
      occurredOn: day(-3),
      data: { complaint: 'Deseja aumentar o volume das mamas; assimetria leve.', procedure: title2, smoker: false, weight: 57, height: 1.62, plan: 'Próteses redondas texturizadas de 300 ml, via inframamária, plano submuscular.' },
    });
    await api.put(`/aesthetics/cases/${c.id}/budget`, {
      items: [
        { kind: 'surgeon', description: 'Honorários do cirurgião', amount: 14000, billedBy: 'clinic' },
        { kind: 'anesthetist', description: 'Equipe de anestesia', amount: 2800, billedBy: 'third_party' },
        { kind: 'hospital', description: 'Hospital: sala cirúrgica e 1 diária', amount: 7000, billedBy: 'third_party' },
        { kind: 'implant', description: 'Par de próteses Silimed 300 ml', amount: 5200, billedBy: 'clinic' },
      ],
      validUntil: day(27),
    });
    log(`    ${title2}: avaliação e orçamento em rascunho`);
  }
}

// ---- Micropigmentação ----------------------------------------------------------------------------

async function micropigmentation(ctx, log, customer) {
  const { pros } = ctx;
  if (has(await ctx.patientData(customer.id), 'aesthetics.micropigmentation')) return log('    já existe');
  await ctx.consent(customer, 'micropigmentation', 'micropigmentation.default', 'Micropigmentação de sobrancelhas (fio a fio)', pros.tatiane, -25);
  // Desenho aprovado pela cliente, fotografado antes de pigmentar.
  await ctx.photo(customer, 'micropigmentation', { region: 'Sobrancelhas', phase: 'Antes', n: -25, image: browsPng({ done: false }) });
  await ctx.record({
    specialty: 'micropigmentation',
    formKey: 'aesthetics.micropigmentation',
    customerId: customer.id,
    professionalId: pros.tatiane.id,
    occurredOn: day(-25),
    data: {
      area: 'Sobrancelhas',
      session: '1ª sessão',
      technique: 'Fio a fio (nanoblading)',
      pigments: [
        { lotId: ctx.lot('Pigmento Marrom Café'), color: 'Marrom café', amount: 0.2 },
        { lotId: ctx.lot('Pigmento Castanho Médio'), color: 'Castanho médio (mistura 2:1)', amount: 0.1 },
      ],
      needle: 'Nano 0,18 mm, 1RL',
      designApproved: true,
      anesthesia: 'Lidocaína tópica 4%',
      reaction: 'Eritema leve',
      guidance: 'Não molhar por 24 h, pomada cicatrizante 3x ao dia, sem sol e sem maquiagem por 7 dias.',
      retouchOn: day(5),
    },
  });
  await ctx.photo(customer, 'micropigmentation', { region: 'Sobrancelhas', phase: 'Depois', n: -2, image: browsPng({ done: true }) });
  const appt = await ctx.book(customer, 'Retoque de micropigmentação', pros.tatiane, 5);
  log(`    sobrancelhas fio a fio; retoque ${appt ? `marcado em ${appt.startsAt.slice(0, 10).split('-').reverse().join('/')}` : 'sem horário livre'}`);
}

// ---- Laser ---------------------------------------------------------------------------------------

async function laser(ctx, log, customer) {
  const { pros } = ctx;
  const title = 'Depilação a laser — axilas e pernas inteiras';
  if (caseOf(await ctx.patientData(customer.id), title)) return log('    já existe');
  const room = ctx.rooms.find((r) => /laser/i.test(r.name)) ?? ctx.rooms[0] ?? null;
  const c = await ctx.api.post('/aesthetics/cases', { customerId: customer.id, specialty: 'laser', title, professionalId: pros.aline.id, plannedSessions: 8, startedOn: day(-95) });
  await ctx.consent(customer, 'laser', 'laser.default', title, pros.aline, -95, c.id);
  await ctx.photo(customer, 'laser', { region: 'Pernas', phase: 'Antes', n: -95, caseId: c.id, image: legsPng({ hair: 1 }) });
  const sessions = [
    { n: -95, session: 1, fluence: [14, 16], reaction: 'Eritema perifolicular', next: -60 },
    { n: -60, session: 2, fluence: [16, 18], reaction: 'Eritema perifolicular', next: -28 },
    { n: -28, session: 3, fluence: [16, 20], reaction: 'Sem reação', next: 7 },
  ];
  for (const s of sessions) {
    await ctx.record({
      specialty: 'laser',
      formKey: 'aesthetics.laser',
      customerId: customer.id,
      caseId: c.id,
      professionalId: pros.aline.id,
      occurredOn: day(s.n),
      data: {
        phototype: 'III',
        device: room?.name ?? 'Laser de diodo 808 nm',
        roomId: room?.id ?? null,
        session: s.session,
        areas: [
          { area: 'Axilas', fluence: s.fluence[0], pulse: 30, spot: 12, shots: 140 + ctx.rng.int(0, 30) },
          { area: 'Pernas inteiras', fluence: s.fluence[1], pulse: 30, spot: 18, shots: 850 + ctx.rng.int(0, 120) },
        ],
        cooling: 'Ponteira resfriada (contato)',
        reaction: s.reaction,
        guidance: 'Filtro solar FPS 50, sem sol por 7 dias; não usar cera ou pinça entre as sessões.',
        nextSessionOn: day(s.next),
      },
    });
  }
  await ctx.photo(customer, 'laser', { region: 'Pernas', phase: 'Depois', n: -28, caseId: c.id, image: legsPng({ hair: 0.35 }) });
  log('    3 de 8 sessões com fluência, pulso e spot');
}

// ---- Tricologia ----------------------------------------------------------------------------------

async function trichology(ctx, log, customer) {
  const { pros } = ctx;
  const title = 'Protocolo para eflúvio telógeno';
  if (caseOf(await ctx.patientData(customer.id), title)) return log('    já existe');
  const c = await ctx.api.post('/aesthetics/cases', { customerId: customer.id, specialty: 'trichology', title, professionalId: pros.helena.id, plannedSessions: 6, startedOn: day(-45) });
  await ctx.consent(customer, 'trichology', 'trichology.default', 'Intradermoterapia capilar', pros.helena, -45, c.id);
  const base = { specialty: 'trichology', customerId: customer.id, caseId: c.id, professionalId: pros.helena.id };
  await ctx.record({
    ...base,
    formKey: 'aesthetics.trichology.anamnesis',
    occurredOn: day(-45),
    data: { complaint: 'Queda intensa há 4 meses, fios no travesseiro e no ralo.', onset: 'Começou 3 meses depois de uma cirurgia', familyHistory: false, washing: 'Dia sim, dia não', chemicals: 'Coloração a cada 2 meses', conditions: 'Ferritina baixa (exame recente)', medications: 'Sulfato ferroso', stress: 'Alto', diet: 'Dieta restritiva nos últimos meses' },
  });
  await ctx.record({
    ...base,
    formKey: 'aesthetics.trichology.scope',
    occurredOn: day(-45),
    data: {
      regions: [
        { region: 'Vértex', density: 155, thickness: 'Fios finos e grossos misturados', findings: 'Hastes curtas de recrescimento' },
        { region: 'Frontal', density: 168, thickness: 'Normal', findings: 'Sem miniaturização' },
        { region: 'Temporal direita', density: 142, thickness: 'Normal', findings: 'Rarefação difusa' },
      ],
      scalp: 'Sensível',
      pullTest: 'Positivo',
    },
  });
  await ctx.record({
    ...base,
    formKey: 'aesthetics.trichology.diagnosis',
    occurredOn: day(-45),
    data: {
      diagnosis: 'Eflúvio telógeno',
      detail: 'Eflúvio agudo após estresse cirúrgico e deficiência de ferro; sem sinais de alopecia androgenética.',
      protocol: '6 sessões quinzenais de intradermoterapia (minoxidil 0,5%) + laser de baixa potência; reposição de ferro com o clínico.',
      sessions: 6,
      homeCare: 'Xampu suave, loção tópica à noite, alimentação com proteína e ferro.',
    },
  });
  await ctx.photo(customer, 'trichology', { region: 'Vértex', angle: 'Superior', phase: 'Antes', n: -45, caseId: c.id, image: scalpPng({ density: 0.45 }) });
  for (const [i, n] of [-30, -15].entries()) {
    await ctx.record({
      ...base,
      formKey: 'aesthetics.trichology.session',
      occurredOn: day(n),
      data: { session: i + 1, procedure: 'Intradermoterapia (MMP)', lotId: ctx.lot('Minoxidil 0,5% injetável'), amount: 2, response: i === 0 ? 'Sem melhora' : 'Melhora leve', guidance: 'Não lavar o cabelo no dia.' },
    });
  }
  await ctx.photo(customer, 'trichology', { region: 'Vértex', angle: 'Superior', phase: 'Retorno', n: -15, caseId: c.id, image: scalpPng({ density: 0.7 }) });
  log('    anamnese, tricoscopia, diagnóstico e 2 de 6 sessões');
}

// ---- Ilustrações em PNG (desenhadas aqui, sem fotos de pessoas) ----------------------------------

const W = 240;
const H = 300;
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

function canvas(bg = '#eef1f5', w = W, h = H) {
  const px = new Uint8Array(w * h * 3);
  const c = rgb(bg);
  for (let i = 0; i < w * h; i++) px.set(c, i * 3);
  return { w, h, px };
}
function dot(cv, x, y, color) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  cv.px.set(color, (y * cv.w + x) * 3);
}
function ellipse(cv, cx, cy, rx, ry, hex) {
  const color = rgb(hex);
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) dot(cv, x, y, color);
}
function rect(cv, x0, y0, w, h, hex) {
  const color = rgb(hex);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) dot(cv, x, y, color);
}
function line(cv, x0, y0, x1, y1, hex, width = 2) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  for (let i = 0; i <= steps; i++) ellipse(cv, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, width / 2, width / 2, hex);
}
/** Pontos espalhados (pelos, fios) dentro de uma elipse, com semente fixa: a mesma imagem toda vez. */
function scatter(cv, cx, cy, rx, ry, count, hex, size = 1.2, seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    ellipse(cv, cx + Math.cos(a) * r * rx, cy + Math.sin(a) * r * ry, size, size, hex);
  }
}

const SKIN = '#e9c3a5';
const SKIN_DARK = '#c99a7a';

function facePng({ wrinkles }) {
  const cv = canvas();
  ellipse(cv, 120, 70, 82, 52, '#5b4636'); // cabelo
  ellipse(cv, 120, 150, 78, 105, SKIN);
  ellipse(cv, 42, 150, 10, 20, SKIN_DARK);
  ellipse(cv, 198, 150, 10, 20, SKIN_DARK);
  line(cv, 76, 118, 106, 114, '#6b4f3a', 4);
  line(cv, 134, 114, 164, 118, '#6b4f3a', 4);
  ellipse(cv, 92, 134, 13, 6, '#ffffff');
  ellipse(cv, 148, 134, 13, 6, '#ffffff');
  ellipse(cv, 92, 134, 5, 5, '#3f3a36');
  ellipse(cv, 148, 134, 5, 5, '#3f3a36');
  line(cv, 120, 140, 114, 178, SKIN_DARK, 3);
  line(cv, 114, 178, 126, 178, SKIN_DARK, 3);
  ellipse(cv, 120, 206, 22, 7, '#c4737a');
  for (let i = 0; i < wrinkles; i++) line(cv, 88, 84 + i * 9, 152, 84 + i * 9, SKIN_DARK, 2);
  if (wrinkles) {
    line(cv, 114, 108, 116, 124, SKIN_DARK, 2);
    line(cv, 126, 108, 124, 124, SKIN_DARK, 2);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) line(cv, 120 + side * 64, 126 + i * 7, 120 + side * 74, 122 + i * 9, SKIN_DARK, 1.5);
  }
  return png(cv);
}

function lipsPng({ full }) {
  const cv = canvas('#f3e6dd');
  ellipse(cv, 120, 150, 110, 120, SKIN);
  const h = full ? 26 : 15;
  ellipse(cv, 120, 140 - h / 2, 62, h, '#c4737a');
  ellipse(cv, 120, 150 + h / 2, 58, h + 4, '#b9626b');
  line(cv, 58, 146, 182, 146, '#8f4a52', 2);
  return png(cv);
}

const TEETH = ['#e8d9a8', '#f1e8cc', '#fbf8ef'];
function smilePng({ shade }) {
  const cv = canvas('#f3e6dd');
  ellipse(cv, 120, 150, 110, 120, SKIN);
  ellipse(cv, 120, 150, 80, 40, '#b9626b');
  ellipse(cv, 120, 152, 70, 30, '#5c2a2e');
  for (let i = 0; i < 6; i++) rect(cv, 72 + i * 16, 130, 14, 22, TEETH[shade]);
  for (let i = 0; i < 5; i++) rect(cv, 80 + i * 16, 156, 14, 16, TEETH[shade]);
  return png(cv);
}

function abdomenPng({ after, profile = false }) {
  const cv = canvas('#e6ebf0');
  if (profile) {
    rect(cv, 90, 30, 60, 240, SKIN);
    ellipse(cv, 150, 190, after ? 8 : 28, after ? 40 : 55, SKIN);
  } else {
    rect(cv, 60, 30, 120, 240, SKIN);
    ellipse(cv, 60, 170, after ? 6 : 18, 50, SKIN);
    ellipse(cv, 180, 170, after ? 6 : 18, 50, SKIN);
    ellipse(cv, 120, 200, after ? 40 : 58, after ? 22 : 40, SKIN_DARK);
    ellipse(cv, 120, 200, after ? 38 : 56, after ? 20 : 38, SKIN);
    ellipse(cv, 120, 150, 3, 4, SKIN_DARK);
  }
  return png(cv);
}

function browsPng({ done }) {
  const cv = canvas('#f3e6dd');
  ellipse(cv, 120, 170, 115, 140, SKIN);
  for (const side of [-1, 1]) {
    const x0 = 120 + side * 18;
    const x1 = 120 + side * 92;
    if (done) for (let i = 0; i < 26; i++) line(cv, x0 + ((x1 - x0) * i) / 26, 122 - Math.sin((i / 26) * Math.PI) * 10 + 6, x0 + ((x1 - x0) * i) / 26 + side * 4, 116 - Math.sin((i / 26) * Math.PI) * 10, '#5a3e2b', 1.5);
    else line(cv, x0, 122, x1, 118, '#b08b6e', 3);
    ellipse(cv, 120 + side * 52, 160, 22, 9, '#ffffff');
    ellipse(cv, 120 + side * 52, 160, 7, 7, '#3f3a36');
  }
  if (!done) for (const side of [-1, 1]) line(cv, 120 + side * 18, 108, 120 + side * 92, 104, '#7a8fb0', 1); // desenho a lápis
  return png(cv);
}

function legsPng({ hair }) {
  const cv = canvas('#e6ebf0');
  rect(cv, 70, 20, 40, 270, SKIN);
  rect(cv, 130, 20, 40, 270, SKIN);
  scatter(cv, 90, 160, 18, 120, Math.round(260 * hair), '#4a3a30', 0.9, 11);
  scatter(cv, 150, 160, 18, 120, Math.round(260 * hair), '#4a3a30', 0.9, 23);
  return png(cv);
}

function scalpPng({ density }) {
  const cv = canvas('#e6ebf0');
  ellipse(cv, 120, 150, 100, 120, '#e3b9a0');
  scatter(cv, 120, 150, 98, 118, Math.round(2400 * density), '#2f2622', 1.1, 5);
  return png(cv);
}

/** Assinatura: traço contínuo, levemente diferente para cada termo. */
function signaturePng(rng) {
  const cv = canvas('#ffffff', 360, 110);
  const a = 8 + rng.int(0, 10);
  const f = 0.05 + rng.next() * 0.04;
  let px = 20;
  let py = 60;
  for (let x = 21; x < 330; x += 2) {
    const y = 60 + Math.sin(x * f) * a + Math.sin(x * f * 2.7) * (a / 2);
    line(cv, px, py, x, y, '#1f2a5a', 2);
    px = x;
    py = y;
  }
  line(cv, 30, 92, 320, 90, '#1f2a5a', 1.5);
  return png(cv);
}

// PNG mínimo (RGB 8 bits, sem dependências).
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png({ w, h, px }) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
