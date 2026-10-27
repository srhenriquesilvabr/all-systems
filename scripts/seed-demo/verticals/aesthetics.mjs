// Clínica de estética (fake-estetica): procedimentos, profissionais, pacotes de sessões em vários
// estágios (em uso, concluído, cancelado), agenda de 5 semanas + 10 dias e prontuário.
import { at, createRng, day, step } from '../lib.mjs';
import {
  PAY_METHODS,
  applyAppointments,
  brDate,
  createPlanner,
  describeStats,
  doneByCustomer,
  durationOf,
  enableOnlineBooking,
  ensureRecords,
  ensureResources,
  ensureServices,
  ensureTimeOff,
  hours,
  statusAt,
  weighted,
} from './_scheduling-beauty-group.mjs';

// Os 9 primeiros já vêm com o módulo; os injetáveis e o laser de área grande completam o cardápio.
const SERVICES = [
  { name: 'Avaliação estética', category: 'Avaliação', durationMin: 30, price: 50 },
  { name: 'Limpeza de pele', category: 'Facial', durationMin: 90, price: 180 },
  { name: 'Peeling químico', category: 'Facial', durationMin: 60, price: 250 },
  { name: 'Microagulhamento', category: 'Facial', durationMin: 60, price: 350 },
  { name: 'Drenagem linfática', category: 'Corporal', durationMin: 60, price: 140 },
  { name: 'Massagem modeladora', category: 'Corporal', durationMin: 60, price: 140 },
  { name: 'Radiofrequência', category: 'Corporal', durationMin: 45, price: 200 },
  { name: 'Criolipólise', category: 'Corporal', durationMin: 60, price: 600 },
  { name: 'Depilação a laser (área pequena)', category: 'Depilação', durationMin: 30, price: 150 },
  { name: 'Depilação a laser (pernas inteiras)', category: 'Depilação', durationMin: 60, bufferMin: 15, price: 450 },
  { name: 'Hidrafacial', category: 'Facial', durationMin: 60, price: 320 },
  { name: 'Toxina botulínica', category: 'Injetáveis', durationMin: 45, bufferMin: 15, price: 1200, online: false, description: 'Terço superior (testa, glabela e pés de galinha). Retorno em 15 dias incluso.' },
  { name: 'Preenchimento labial', category: 'Injetáveis', durationMin: 60, bufferMin: 15, price: 1500, online: false, description: 'Ácido hialurônico, 1 ml.' },
  { name: 'Bioestimulador de colágeno', category: 'Injetáveis', durationMin: 60, bufferMin: 15, price: 1800, online: false },
];

const PROS = [
  {
    key: 'helena',
    name: 'Dra. Helena Vasconcelos',
    color: '#7c3aed',
    linkRoles: ['aesthetics.professional'],
    services: ['Avaliação estética', 'Toxina botulínica', 'Preenchimento labial', 'Bioestimulador de colágeno', 'Peeling químico', 'Microagulhamento'],
    hours: hours([1, 3, 5], ['09:00', '13:00'], ['14:00', '19:00']),
  },
  {
    key: 'livia',
    name: 'Dra. Lívia Martins',
    color: '#0891b2',
    linkRoles: ['aesthetics.professional'],
    services: ['Avaliação estética', 'Toxina botulínica', 'Preenchimento labial', 'Microagulhamento', 'Peeling químico', 'Hidrafacial'],
    hours: hours([2, 4], ['10:00', '14:00'], ['15:00', '20:00']).concat(hours([6], ['09:00', '14:00'])),
  },
  {
    key: 'tatiane',
    name: 'Tatiane Freitas',
    color: '#db2777',
    services: ['Avaliação estética', 'Limpeza de pele', 'Hidrafacial', 'Peeling químico', 'Drenagem linfática'],
    hours: hours([1, 2, 3, 4, 5], ['09:00', '13:00'], ['14:00', '18:00']),
  },
  {
    key: 'monica',
    name: 'Mônica Ribeiro',
    color: '#16a34a',
    services: ['Drenagem linfática', 'Massagem modeladora', 'Radiofrequência', 'Criolipólise'],
    hours: hours([1, 2, 3, 4, 5], ['10:00', '14:00'], ['15:00', '19:00']).concat(hours([6], ['09:00', '13:00'])),
  },
  {
    key: 'aline',
    name: 'Aline Costa',
    color: '#ea580c',
    services: ['Avaliação estética', 'Depilação a laser (área pequena)', 'Depilação a laser (pernas inteiras)'],
    hours: hours([2, 3, 4, 5], ['09:00', '13:00'], ['14:00', '18:00']).concat(hours([6], ['09:00', '14:00'])),
  },
];

/**
 * Pacotes por paciente (índice em ctx.customers pessoas), com as sessões na agenda: dias passados
 * viram sessões usadas; futuros ficam reservados. O de massagem é cancelado antes de começar.
 */
const PACKAGES = [
  {
    who: 0, service: 'Drenagem linfática', pro: 'monica', totalSessions: 10, price: 1200, installments: 3, firstDueOn: -28, expiresOn: 150,
    notes: 'Pós-operatório de abdominoplastia: 2 sessões por semana no primeiro mês.', sessions: [-28, -24, -21, -17, -14, -10, -7, -3, 2, 5],
  },
  { who: 1, service: 'Depilação a laser (pernas inteiras)', pro: 'aline', totalSessions: 6, price: 2200, installments: 4, firstDueOn: 5, expiresOn: 365, notes: 'Intervalo de 30 a 45 dias entre sessões.', sessions: [-33, 12] },
  { who: 2, service: 'Limpeza de pele', pro: 'tatiane', totalSessions: 4, price: 600, installments: 2, firstDueOn: 3, expiresOn: 240, sessions: [-30, -2] },
  { who: 3, service: 'Peeling químico', pro: 'helena', totalSessions: 3, price: 650, installments: 1, firstDueOn: 2, expiresOn: 120, notes: 'Protocolo para melasma.', sessions: [-28, -14, -1] },
  { who: 4, service: 'Radiofrequência', pro: 'monica', totalSessions: 8, price: 1280, installments: 2, firstDueOn: 7, expiresOn: 180, sessions: [-21, -14, -7, 3] },
  { who: 5, service: 'Massagem modeladora', pro: 'monica', totalSessions: 10, price: 1100, installments: 2, firstDueOn: 10, expiresOn: 180, sessions: [], cancel: 'Cliente desistiu antes da primeira sessão; valor não foi cobrado.' },
  { who: 6, service: 'Microagulhamento', pro: 'livia', totalSessions: 3, price: 900, installments: 3, firstDueOn: 4, expiresOn: 180, notes: 'Cicatrizes de acne.', sessions: [4] },
];

const COMBOS = [
  [8, ['Avaliação estética']],
  [8, ['Limpeza de pele']],
  [6, ['Toxina botulínica']],
  [3, ['Preenchimento labial']],
  [2, ['Bioestimulador de colágeno']],
  [5, ['Hidrafacial']],
  [6, ['Depilação a laser (área pequena)']],
  [3, ['Criolipólise']],
  [4, ['Drenagem linfática']],
  [3, ['Peeling químico']],
  [3, ['Massagem modeladora']],
];
const CANCEL_REASONS = ['Paciente pediu para remarcar', 'Imprevisto no trabalho', 'Paciente gripada, sem condição de fazer o procedimento'];

/** Parâmetros típicos de cada procedimento, para a evolução no prontuário. */
const PROCEDURE_NOTES = {
  'Drenagem linfática': { area: 'Abdome e membros inferiores', parameters: 'Manobras de Leduc, pressão leve, 60 min.', reaction: 'Sem intercorrências', guidance: 'Beber bastante água e manter a cinta compressiva.' },
  'Depilação a laser (pernas inteiras)': { area: 'Pernas inteiras', parameters: 'Laser de diodo 808 nm, 18 J/cm², ponteira resfriada.', reaction: 'Eritema perifolicular leve', guidance: 'Filtro solar FPS 50 e evitar sol por 7 dias.' },
  'Depilação a laser (área pequena)': { area: 'Axilas', parameters: 'Laser de diodo 808 nm, 16 J/cm².', reaction: 'Eritema leve', guidance: 'Não usar desodorante com álcool por 24 h.' },
  'Limpeza de pele': { area: 'Face', parameters: 'Higienização, esfoliação enzimática, vapor de ozônio, extração e máscara calmante.', reaction: 'Leve vermelhidão na zona T', guidance: 'Evitar maquiagem por 24 h.' },
  'Peeling químico': { area: 'Face', parameters: 'Ácido mandélico 30%, 3 camadas, neutralizado após 4 min.', reaction: 'Ardor leve, eritema', guidance: 'Não usar ácidos por 7 dias; filtro solar a cada 3 h.' },
  Radiofrequência: { area: 'Abdome e flancos', parameters: 'Radiofrequência monopolar, 40 °C por 15 min por área.', reaction: 'Calor local tolerável', guidance: 'Manter atividade física e hidratação.' },
  Microagulhamento: { area: 'Face (malar e mento)', parameters: 'Caneta elétrica 1,5 mm + drug delivery de vitamina C.', reaction: 'Eritema e pontos de sangramento esperados', guidance: 'Não lavar o rosto por 12 h; filtro solar.' },
  'Toxina botulínica': { area: 'Terço superior', parameters: 'Toxina botulínica tipo A, 50 U: frontal 10 U, glabela 20 U, periorbicular 20 U.', reaction: 'Pápulas nos pontos, regrediram em 20 min', guidance: 'Não deitar por 4 h e não massagear. Retorno em 15 dias.' },
  'Preenchimento labial': { area: 'Lábios', parameters: 'Ácido hialurônico 1 ml com lidocaína, cânula 25G.', reaction: 'Edema leve', guidance: 'Compressa fria e evitar beijo e canudo por 24 h.' },
  'Bioestimulador de colágeno': { area: 'Face e pescoço', parameters: 'Ácido poli-L-láctico, 1 frasco diluído em 8 ml.', reaction: 'Edema leve', guidance: 'Massagem 5x ao dia por 5 dias (regra 5-5-5).' },
  Hidrafacial: { area: 'Face', parameters: 'Hidrodermoabrasão + sérum de ácido hialurônico.', reaction: 'Sem reação', guidance: 'Hidratação e filtro solar.' },
  Criolipólise: { area: 'Abdome inferior', parameters: 'Aplicador curvo, -10 °C por 50 min.', reaction: 'Área enrijecida e avermelhada, normalizou após massagem', guidance: 'Drenagem linfática em 7 dias.' },
  'Massagem modeladora': { area: 'Abdome, flancos e glúteos', parameters: 'Manobras vigorosas com creme termoativo.', reaction: 'Sem intercorrências', guidance: 'Hidratação.' },
  'Avaliação estética': { area: 'Face e corpo', parameters: 'Avaliação, fotos e plano de tratamento.', reaction: '—', guidance: 'Proposta de pacote enviada pelo WhatsApp.' },
};

const COMPLAINTS = [
  'Gordura localizada e flacidez no abdome após cirurgia.',
  'Pelos encravados nas pernas; quer depilação definitiva.',
  'Cravos e oleosidade na zona T.',
  'Manchas de melasma nas maçãs do rosto.',
  'Flacidez abdominal após gestação.',
  'Celulite e retenção de líquido.',
  'Cicatrizes de acne no rosto.',
  'Rugas de expressão na testa.',
];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log, tenant } = ctx;
  const rng = createRng(`${tenant.name}:aesthetics`);
  const people = ctx.customers.filter((c) => c.type === 'person');
  const patient = (i) => people[i % people.length];

  const services = await step(log, 'procedimentos', () => ensureServices(api, log, SERVICES));
  if (!services) return;
  const pros = await step(log, 'profissionais e expediente', () => ensureResources(api, log, PROS, { servicesByName: services, users: ctx.users }));
  if (!pros) return;
  await step(log, 'agendamento online', () => enableOnlineBooking(api, log));

  // Dra. Helena vai a um congresso de dermatologia: dois dias corridos bloqueados.
  const planner = createPlanner();
  let congress = 8;
  while (!planner.works(pros.helena, congress)) congress++;
  planner.block(pros.helena, congress);
  planner.block(pros.helena, congress + 1);
  await step(log, 'bloqueios de agenda', () =>
    ensureTimeOff(api, log, [{ resource: pros.helena, startsAt: at(congress, 0), endsAt: at(congress + 2, 0), reason: 'Congresso Brasileiro de Dermatologia' }]),
  );

  // Pacotes antes da agenda: a sessão marcada para quem tem pacote sai a R$ 0 e reserva o saldo.
  await step(log, 'pacotes de sessões', async () => {
    let list = await api.get('/aesthetics/packages');
    if (list.length >= PACKAGES.length) return log(`    já tem ${list.length} pacotes`);
    let sold = 0;
    for (const p of PACKAGES) {
      const customer = patient(p.who);
      const serviceId = services.get(p.service).id;
      if (list.some((x) => x.customer.id === customer.id && x.service.id === serviceId)) continue;
      await api.post('/aesthetics/packages', {
        customerId: customer.id,
        serviceId,
        totalSessions: p.totalSessions,
        price: p.price,
        installments: p.installments,
        firstDueOn: day(p.firstDueOn),
        expiresOn: day(p.expiresOn),
        notes: p.notes ?? null,
      });
      sold++;
    }
    list = await api.get('/aesthetics/packages');
    let cancelled = 0;
    for (const p of PACKAGES.filter((x) => x.cancel)) {
      const pkg = list.find((x) => x.customer.id === patient(p.who).id && x.service.id === services.get(p.service).id && x.status === 'active');
      if (pkg && pkg.reservedSessions === 0) {
        await api.post(`/aesthetics/packages/${pkg.id}/cancel`, { reason: p.cancel });
        cancelled++;
      }
    }
    log(`    pacotes: ${sold} vendidos, ${cancelled} cancelado`);
  });

  await step(log, 'atendimentos', async () => {
    const existing = await api.get('/scheduling/appointments', { from: at(-36, 0), to: at(13, 23, 59) });
    if (existing.length >= 30) return log(`    já tem ${existing.length} atendimentos no período`);

    const plan = [];
    const push = (customer, resource, svc, slot, past, future, extra = {}) => {
      const status = statusAt(slot.startsAt, durationOf(svc), past, future);
      plan.push({
        customerId: customer.id,
        resourceId: resource.id,
        serviceIds: svc.map((s) => s.id),
        startsAt: slot.startsAt,
        status,
        reason: rng.pick(CANCEL_REASONS),
        pay: status === 'done' && extra.pay !== false && rng.chance(0.9) ? { method: weighted(rng, PAY_METHODS) } : null,
        notes: extra.notes ?? null,
      });
    };

    // Sessões dos pacotes, sempre com a mesma profissional e em horário parecido.
    const packaged = new Set();
    for (const p of PACKAGES) {
      const customer = patient(p.who);
      const svc = [services.get(p.service)];
      packaged.add(`${customer.id}|${svc[0].id}`);
      const prefer = rng.pick([10, 11, 15, 16]) * 60;
      for (const n of p.sessions) {
        const slot = planner.near(pros[p.pro], n, durationOf(svc), prefer, customer.id);
        push(customer, pros[p.pro], svc, slot, 'done', n <= 3 ? 'confirmed' : 'scheduled');
      }
    }

    // Movimento avulso do dia a dia (sem repetir procedimento que o paciente tem em pacote).
    const list = Object.values(pros);
    for (let n = -35; n <= 10; n++) {
      const target = n <= 0 ? rng.int(1, 3) : n <= 5 ? rng.int(1, 3) : rng.int(0, 2);
      for (const customer of rng.shuffle(people).slice(0, target)) {
        const combo = weighted(rng, COMBOS);
        const svc = combo.map((name) => services.get(name));
        if (svc.some((s) => packaged.has(`${customer.id}|${s.id}`))) continue;
        const dur = durationOf(svc);
        const prefer = rng.pick([9, 10, 11, 14, 15, 16, 17]) * 60;
        for (const r of rng.shuffle(list.filter((x) => svc.every((s) => x.serviceIds.includes(s.id))))) {
          const slot = planner.take(r, n, dur, prefer, customer.id);
          if (!slot) continue;
          const past = rng.chance(0.06) ? 'no_show' : rng.chance(0.05) ? 'cancelled' : 'done';
          const future = rng.chance(0.06) ? 'cancelled' : n <= 2 && rng.chance(0.6) ? 'confirmed' : 'scheduled';
          push(customer, r, svc, slot, past, future);
          break;
        }
      }
    }

    const { stats } = await applyAppointments(api, plan);
    log(`    atendimentos: ${describeStats(stats)}`);
  });

  await step(log, 'prontuário (anamnese e evoluções)', async () => {
    const done = await doneByCustomer(api, -40, 0);
    let created = 0;
    for (const [i, customer] of people.slice(0, 7).entries()) {
      const recent = (done.get(customer.id) ?? []).slice(-4);
      const entries = [
        {
          formKey: 'aesthetics.anamnesis',
          data: {
            complaint: COMPLAINTS[i % COMPLAINTS.length],
            previous: rng.pick(['Nenhum', 'Limpeza de pele há 1 ano', 'Toxina botulínica em 2024', 'Drenagem pós-operatória']),
            allergies: rng.pick(['Nega', 'Dipirona', 'Látex', 'Nega']),
            medications: rng.pick(['Anticoncepcional oral', 'Nenhum', 'Levotiroxina 50 mcg', 'Nenhum']),
            skinConditions: rng.pick(['Nega', 'Rosácea leve', 'Melasma', 'Acne grau II']),
            phototype: rng.pick(['II', 'III', 'III', 'IV', 'V']),
            pregnant: false,
            acids: rng.chance(0.4),
            sun: rng.chance(0.3),
            smoker: rng.chance(0.15),
            expectations: rng.pick(['Melhorar a autoestima para o casamento em março.', 'Resultado natural, sem aspecto artificial.', 'Reduzir medidas antes do verão.', 'Pele mais uniforme.']),
          },
          notes: 'Termo de consentimento assinado e fotos de antes registradas.',
        },
        ...recent.map((a) => {
          const name = a.services[0]?.name.replace(/ \(pacote.*\)$/, '') ?? 'Procedimento';
          const extra = PROCEDURE_NOTES[name] ?? { area: '', parameters: '', reaction: 'Sem intercorrências', guidance: '' };
          return { formKey: 'aesthetics.session', appointmentId: a.id, data: { procedure: name, ...extra }, notes: `Atendimento de ${brDate(a.startsAt)} com ${a.resourceName}.` };
        }),
      ];
      created += await ensureRecords(api, customer.id, entries);
    }
    log(`    prontuário: ${created} registros criados`);
  });
}
