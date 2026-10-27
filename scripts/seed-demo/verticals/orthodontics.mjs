// Clínica ortodôntica (fake-ortodontia): procedimentos, ortodontistas, tratamentos em fases
// diferentes (recém-instalado, meio, reta final, concluído, cancelado), manutenções mensais na
// agenda, avaliações de novos pacientes e prontuário (anamnese, avaliação e manutenções).
import { at, createRng, day, step } from '../lib.mjs';
import {
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
} from './_scheduling-beauty-group.mjs';

// Os 7 primeiros já vêm com o módulo. Categoria "Manutenção" sai a R$ 0 para quem está em tratamento.
const SERVICES = [
  { name: 'Avaliação ortodôntica', category: 'Avaliação', durationMin: 40, price: 100 },
  { name: 'Documentação ortodôntica', category: 'Avaliação', durationMin: 30, price: 250 },
  { name: 'Instalação de aparelho', category: 'Tratamento', durationMin: 90, price: 500 },
  { name: 'Manutenção mensal', category: 'Manutenção', durationMin: 30, price: 180 },
  { name: 'Colagem de bráquete', category: 'Tratamento', durationMin: 20, price: 60 },
  { name: 'Remoção de aparelho', category: 'Tratamento', durationMin: 60, price: 300 },
  { name: 'Contenção', category: 'Tratamento', durationMin: 30, price: 250 },
  { name: 'Troca de alinhadores', category: 'Manutenção', durationMin: 20, price: 150, description: 'Entrega das próximas placas e checagem dos attachments.' },
  { name: 'Escaneamento intraoral', category: 'Avaliação', durationMin: 30, price: 150, description: 'Escaneamento digital para planejamento e alinhadores.' },
  { name: 'Consulta de urgência', category: 'Tratamento', durationMin: 30, bufferMin: 10, price: 120, online: false, description: 'Fio machucando, bráquete solto ou aparelho quebrado.' },
  { name: 'Controle de contenção', category: 'Pós-tratamento', durationMin: 20, price: 90 },
];

const ORTHO = ['Avaliação ortodôntica', 'Instalação de aparelho', 'Manutenção mensal', 'Colagem de bráquete', 'Remoção de aparelho', 'Contenção', 'Controle de contenção', 'Consulta de urgência'];
const PROS = [
  {
    key: 'fernanda',
    name: 'Dra. Fernanda Lacerda',
    color: '#0ea5e9',
    linkRoles: ['orthodontics.dentist'],
    services: ORTHO,
    hours: hours([1, 3, 5], ['08:00', '12:00'], ['13:30', '18:00']),
  },
  {
    key: 'marcelo',
    name: 'Dr. Marcelo Tavares',
    color: '#4f46e5',
    linkRoles: ['orthodontics.dentist'],
    services: ORTHO,
    hours: hours([2, 4], ['09:00', '12:00'], ['14:00', '19:00']).concat(hours([6], ['08:00', '12:00'])),
  },
  {
    key: 'paula',
    name: 'Dra. Paula Nogueira',
    color: '#c026d3',
    services: ['Avaliação ortodôntica', 'Troca de alinhadores', 'Manutenção mensal', 'Instalação de aparelho', 'Contenção', 'Controle de contenção', 'Escaneamento intraoral'],
    hours: hours([1, 2, 3, 4], ['13:00', '20:00']),
  },
  {
    key: 'andre',
    name: 'Dr. André Siqueira',
    color: '#65a30d',
    services: ['Consulta de urgência', 'Colagem de bráquete', 'Avaliação ortodôntica', 'Manutenção mensal', 'Controle de contenção'],
    hours: hours([1, 2, 3, 4, 5], ['08:00', '12:00'], ['13:00', '17:00']),
  },
  {
    key: 'renata',
    name: 'Renata Gomes (documentação)',
    color: '#f59e0b',
    services: ['Documentação ortodôntica', 'Escaneamento intraoral'],
    hours: hours([1, 2, 3, 4, 5], ['08:00', '12:00'], ['13:00', '18:00']),
  },
];

const monthsAgo = (m) => -Math.round(m * 30.44);

/**
 * Tratamentos (índice em ctx.customers pessoas) e a agenda de cada paciente. `visits`: [dia, serviços,
 * status passado, pagamento]. Os dois últimos pacientes ainda estão em avaliação, sem tratamento.
 */
const TREATMENTS = [
  {
    who: 0, appliance: 'fixed_metal', startedMonthsAgo: 21, expectedMonths: 24, entryFee: 900, monthlyFee: 220, dueDay: 10, pro: 'fernanda',
    notes: 'Classe II divisão 1, sem extrações. Elásticos de classe II desde o 12º mês.',
    visits: [[-63, ['Manutenção mensal']], [-40, ['Manutenção mensal'], 'cancelled'], [-35, ['Manutenção mensal']], [-7, ['Manutenção mensal']], [3, ['Manutenção mensal']]],
  },
  {
    who: 1, appliance: 'self_ligating', startedMonthsAgo: 11, expectedMonths: 24, entryFee: 1200, monthlyFee: 280, dueDay: 5, pro: 'marcelo',
    notes: 'Apinhamento severo inferior; extração dos dentes 34 e 44 antes da instalação.',
    visits: [[-56, ['Manutenção mensal']], [-28, ['Manutenção mensal']], [-18, ['Colagem de bráquete'], 'done', { method: 'pix' }, 'andre'], [6, ['Manutenção mensal']]],
  },
  {
    who: 2, appliance: 'aligners', startedMonthsAgo: 4, expectedMonths: 18, entryFee: 3500, monthlyFee: 450, dueDay: 15, pro: 'paula',
    notes: '32 placas superiores e 28 inferiores; troca a cada 14 dias, retorno a cada 6 semanas.',
    visits: [[-84, ['Troca de alinhadores']], [-42, ['Troca de alinhadores']], [9, ['Troca de alinhadores']]],
  },
  {
    who: 3, appliance: 'fixed_aesthetic', startedMonthsAgo: 1, expectedMonths: 24, entryFee: 0, monthlyFee: 260, dueDay: 20, pro: 'fernanda',
    notes: 'Bráquetes de safira no arco superior e metálicos no inferior. Instalação cobrada na agenda.',
    visits: [
      [-37, ['Documentação ortodôntica'], 'done', { method: 'pix' }, 'renata'],
      [-30, ['Instalação de aparelho'], 'done', { method: 'credit_card' }],
      [-2, ['Manutenção mensal']],
      [26, ['Manutenção mensal']],
    ],
  },
  {
    who: 4, appliance: 'fixed_metal', startedMonthsAgo: 25, expectedMonths: 22, entryFee: 800, monthlyFee: 200, dueDay: 10, pro: 'marcelo',
    notes: 'Mordida aberta anterior. Prorrogado em 3 meses para finalização.', extend: 3, finish: true,
    visits: [[-63, ['Manutenção mensal']], [-35, ['Manutenção mensal']], [-6, ['Remoção de aparelho', 'Contenção'], 'done', { method: 'pix', amount: 300 }], [13, ['Controle de contenção']]],
  },
  {
    who: 5, appliance: 'removable', startedMonthsAgo: 7, expectedMonths: 12, entryFee: 400, monthlyFee: 150, dueDay: 25, pro: 'andre',
    notes: 'Aparelho móvel expansor (paciente de 9 anos; responsável: a mãe).', cancel: 'Família mudou de cidade; tratamento continuará em outra clínica.',
    visits: [[-60, ['Manutenção mensal']], [-32, ['Manutenção mensal'], 'no_show']],
  },
];

const PROSPECTS = [
  { who: 6, visits: [[-12, ['Avaliação ortodôntica'], 'done', { method: 'pix' }, 'fernanda'], [4, ['Escaneamento intraoral'], 'done', null, 'renata']] },
  { who: 7, visits: [[-20, ['Avaliação ortodôntica'], 'no_show', null, 'paula'], [-4, ['Avaliação ortodôntica'], 'done', null, 'paula'], [7, ['Documentação ortodôntica'], 'done', null, 'renata']] },
];

const ANAMNESIS = [
  { complaint: 'Dentes de cima muito para frente; vergonha de sorrir.', habits: 'Onicofagia', mouthBreathing: true },
  { complaint: 'Dentes de baixo tortos e sobrepostos.', habits: 'Nenhum' },
  { complaint: 'Quer alinhar os dentes sem aparelho aparente.', habits: 'Nenhum', previousOrtho: true },
  { complaint: 'Espaço entre os dentes da frente.', habits: 'Morde caneta' },
  { complaint: 'Dentes da frente não se tocam ao morder.', habits: 'Interposição lingual', mouthBreathing: true },
  { complaint: 'Arcada superior estreita (indicação do odontopediatra).', habits: 'Chupeta até os 5 anos' },
  { complaint: 'Dentes do siso empurrando os outros; apinhamento recente.', habits: 'Nenhum', previousOrtho: true },
  { complaint: 'Dor na articulação e desgaste dos dentes.', habits: 'Apertamento diurno' },
];
const EVALUATION = [
  { angle: 'Classe II divisão 1', overjet: 7, overbite: 4, crossbite: 'Ausente', openBite: false, crowding: 'Leve', midline: 'Coincidente', plan: 'Aparelho fixo metálico, elásticos de classe II, sem extrações. Previsão de 24 meses.' },
  { angle: 'Classe I', overjet: 3, overbite: 2, crossbite: 'Ausente', openBite: false, crowding: 'Severo', midline: 'Desviada 2 mm para a esquerda', plan: 'Extração de 34 e 44, aparelho autoligado. Previsão de 24 meses.' },
  { angle: 'Classe I', overjet: 2.5, overbite: 2, crossbite: 'Ausente', openBite: false, crowding: 'Moderado', midline: 'Coincidente', plan: 'Alinhadores transparentes, 32 placas superiores e 28 inferiores, com attachments.' },
  { angle: 'Classe I', overjet: 3, overbite: 3, crossbite: 'Ausente', openBite: false, crowding: 'Ausente', midline: 'Coincidente', plan: 'Fechamento de diastemas com aparelho fixo estético. Previsão de 24 meses.' },
  { angle: 'Classe III', overjet: 0, overbite: -2, crossbite: 'Anterior', openBite: true, crowding: 'Leve', midline: 'Coincidente', plan: 'Aparelho fixo com grade palatina e elásticos verticais. Previsão de 22 meses.' },
  { angle: 'Classe II divisão 2', overjet: 2, overbite: 5, crossbite: 'Posterior bilateral', openBite: false, crowding: 'Moderado', midline: 'Coincidente', plan: 'Expansor removível por 12 meses e reavaliação.' },
  { angle: 'Classe I', overjet: 3, overbite: 3, crossbite: 'Ausente', openBite: false, crowding: 'Moderado', midline: 'Coincidente', plan: 'Indicar extração dos sisos; alinhadores após escaneamento.' },
  { angle: 'Classe II divisão 1', overjet: 5, overbite: 4, crossbite: 'Posterior unilateral', openBite: false, crowding: 'Leve', midline: 'Desviada 1 mm para a direita', plan: 'Documentação completa e placa miorrelaxante antes do aparelho fixo.' },
];
const ARCHES = ['0.014 NiTi', '0.016 NiTi', '0.018 NiTi', '0.017 x 0.025 NiTi', '0.019 x 0.025 aço'];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log, tenant } = ctx;
  const rng = createRng(`${tenant.name}:orthodontics`);
  const people = ctx.customers.filter((c) => c.type === 'person');
  const patient = (i) => people[i % people.length];

  const services = await step(log, 'procedimentos', () => ensureServices(api, log, SERVICES));
  if (!services) return;
  const pros = await step(log, 'ortodontistas e expediente', () => ensureResources(api, log, PROS, { servicesByName: services, users: ctx.users }));
  if (!pros) return;
  await step(log, 'agendamento online', () => enableOnlineBooking(api, log));

  const planner = createPlanner();
  let congress = 8;
  while (!planner.works(pros.fernanda, congress)) congress++;
  planner.block(pros.fernanda, congress);
  await step(log, 'bloqueios de agenda', () =>
    ensureTimeOff(api, log, [{ resource: pros.fernanda, startsAt: at(congress, 7), endsAt: at(congress, 19), reason: 'Congresso de ortodontia (SPO)' }]),
  );

  // Todos começam ativos: as manutenções do histórico precisam do tratamento ativo para sair a R$ 0.
  await step(log, 'tratamentos', async () => {
    const list = await api.get('/orthodontics/treatments');
    if (list.length >= TREATMENTS.length) return log(`    já tem ${list.length} tratamentos`);
    let started = 0;
    for (const t of TREATMENTS) {
      const customer = patient(t.who);
      if (list.some((x) => x.customer.id === customer.id)) continue;
      await api.post('/orthodontics/treatments', {
        customerId: customer.id,
        appliance: t.appliance,
        startedOn: day(monthsAgo(t.startedMonthsAgo)),
        expectedMonths: t.expectedMonths,
        entryFee: t.entryFee,
        monthlyFee: t.monthlyFee,
        dueDay: t.dueDay,
        notes: t.notes,
      });
      started++;
    }
    log(`    tratamentos: ${started} iniciados`);
  });

  await step(log, 'atendimentos', async () => {
    const existing = await api.get('/scheduling/appointments', { from: at(-90, 0), to: at(30, 23, 59) });
    if (existing.length >= 20) return log(`    já tem ${existing.length} atendimentos no período`);

    const plan = [];
    for (const p of [...TREATMENTS, ...PROSPECTS]) {
      const customer = patient(p.who);
      const prefer = rng.pick([8, 9, 10, 14, 15, 16, 17]) * 60;
      for (const [n, names, past = 'done', pay = null, proKey = p.pro] of p.visits) {
        const svc = names.map((name) => services.get(name));
        const resource = pros[proKey];
        const slot = planner.near(resource, n, durationOf(svc), prefer, customer.id);
        // Futuro: confirmado nos próximos 3 dias, agendado depois.
        const status = statusAt(slot.startsAt, durationOf(svc), past, n <= 3 ? 'confirmed' : 'scheduled');
        plan.push({
          customerId: customer.id,
          resourceId: resource.id,
          serviceIds: svc.map((s) => s.id),
          startsAt: slot.startsAt,
          status,
          reason: 'Paciente avisou que estava doente; remarcar',
          pay,
          notes: names.includes('Consulta de urgência') || names.includes('Colagem de bráquete') ? 'Bráquete do 25 descolado ao comer pipoca.' : null,
        });
      }
    }
    const { stats } = await applyAppointments(api, plan);
    log(`    atendimentos: ${describeStats(stats)}`);
  });

  await step(log, 'tratamentos prorrogados, concluídos e cancelados', async () => {
    const list = await api.get('/orthodontics/treatments');
    const done = [];
    for (const t of TREATMENTS.filter((x) => x.extend || x.finish || x.cancel)) {
      let current = list.find((x) => x.customer.id === patient(t.who).id && x.status === 'active');
      if (!current) continue;
      if (t.extend && current.expectedMonths === t.expectedMonths) {
        current = await api.post(`/orthodontics/treatments/${current.id}/extend`, { months: t.extend });
        done.push('prorrogado');
      }
      if (t.finish) {
        await api.post(`/orthodontics/treatments/${current.id}/finish`, { cancelFutureInstallments: true });
        done.push('concluído');
      }
      if (t.cancel) {
        await api.post(`/orthodontics/treatments/${current.id}/cancel`, { reason: t.cancel });
        done.push('cancelado');
      }
    }
    log(`    ${done.length ? done.join(', ') : 'nada a mudar'}`);
  });

  await step(log, 'prontuário (anamnese, avaliação e manutenções)', async () => {
    const doneVisits = await doneByCustomer(api, -100, 0);
    let created = 0;
    for (const p of [...TREATMENTS, ...PROSPECTS]) {
      const customer = patient(p.who);
      const visits = doneVisits.get(customer.id) ?? [];
      // Prospecto que ainda não passou pela avaliação não tem prontuário.
      if (!p.appliance && !visits.length) continue;
      const a = ANAMNESIS[p.who % ANAMNESIS.length];
      const entries = [
        {
          formKey: 'ortho.anamnesis',
          data: {
            complaint: a.complaint,
            medicalHistory: rng.pick(['Sem alterações sistêmicas.', 'Asma controlada.', 'Rinite alérgica.', 'Hipotireoidismo em tratamento.']),
            medications: rng.pick(['Nenhum', 'Levotiroxina 50 mcg', 'Antialérgico quando necessário', 'Nenhum']),
            allergies: rng.pick(['Nega', 'Penicilina', 'Nega', 'Níquel']),
            mouthBreathing: !!a.mouthBreathing,
            bruxism: p.who === 7,
            habits: a.habits,
            previousOrtho: !!a.previousOrtho,
          },
          notes: 'Termo de consentimento do tratamento assinado.',
        },
        { formKey: 'ortho.evaluation', data: EVALUATION[p.who % EVALUATION.length], notes: 'Fotos extra e intraorais, panorâmica e telerradiografia solicitadas.' },
        ...visits
          .filter((v) => v.services.some((s) => /Manutenção|Troca de alinhadores|Remoção|Colagem/.test(s.name)))
          .map((v, i) => {
            const names = v.services.map((s) => s.name).join(', ');
            const aligners = /alinhadores/.test(names);
            return {
              formKey: 'ortho.maintenance',
              appointmentId: v.id,
              data: aligners
                ? { procedures: `Entrega das placas ${8 + i * 3} a ${10 + i * 3}; conferência de attachments.`, hygiene: 'Boa', next: 'Próxima troca em 6 semanas' }
                : /Remoção/.test(names)
                  ? { procedures: 'Remoção do aparelho, polimento e moldagem para contenção fixa 3x3 inferior e placa superior.', hygiene: 'Boa', next: 'Controle da contenção em 30 dias' }
                  : {
                      upperArch: ARCHES[Math.min(i + 2, ARCHES.length - 1)],
                      lowerArch: ARCHES[Math.min(i + 1, ARCHES.length - 1)],
                      elastics: p.who === 0 ? 'Classe II 3/16" médio, uso 22 h/dia' : '',
                      procedures: /Colagem/.test(names) ? 'Recolagem do bráquete do 25.' : 'Troca de arcos e ligaduras elásticas.',
                      hygiene: rng.pick(['Boa', 'Boa', 'Regular', 'Ruim']),
                      brokenBrackets: /Colagem/.test(names) ? 1 : 0,
                      next: 'Manutenção em 4 semanas',
                    },
              notes: `Atendimento de ${brDate(v.startsAt)} com ${v.resourceName}.`,
            };
          }),
      ];
      created += await ensureRecords(api, customer.id, entries);
    }
    log(`    prontuário: ${created} registros criados`);
  });
}
