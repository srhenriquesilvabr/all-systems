// Clínica veterinária: pets dos tutores, veterinários com expediente, agenda (histórico, hoje
// e próximos dias), prontuário (consultas, exames e procedimentos) e carteira de vacinação com
// reforços vencidos e a vencer.
import { at, day, step } from '../lib.mjs';

const WEEKDAYS = [1, 2, 3, 4, 5];
const CLINIC_HOURS = WEEKDAYS.flatMap((weekday) => [
  { weekday, start: '08:00', end: '12:00' },
  { weekday, start: '13:00', end: '19:00' },
]).concat([{ weekday: 6, start: '08:00', end: '13:00' }]);
const SURGERY_HOURS = CLINIC_HOURS.filter((h) => h.weekday !== 6);
const DERM_HOURS = [2, 4].flatMap((weekday) => [
  { weekday, start: '09:00', end: '12:00' },
  { weekday, start: '13:00', end: '18:00' },
]).concat([{ weekday: 6, start: '08:00', end: '13:00' }]);
const AFTERNOON_HOURS = WEEKDAYS.map((weekday) => ({ weekday, start: '13:00', end: '19:00' })).concat([{ weekday: 6, start: '08:00', end: '13:00' }]);

/** Equipe da agenda. A área define os serviços que cada um faz. */
const TEAM = [
  { name: 'Dra. Ana Beatriz Lima', area: 'clinic', color: '#2d4bff', hours: CLINIC_HOURS },
  { name: 'Dr. Henrique Souza', area: 'surgery', color: '#e8590c', hours: SURGERY_HOURS },
  { name: 'Dra. Mariana Costa', area: 'derm', color: '#d6336c', hours: DERM_HOURS },
  { name: 'Dr. Thiago Ribeiro', area: 'clinic', color: '#0ca678', hours: AFTERNOON_HOURS },
  { name: 'Enfermagem — vacinas e coletas', area: 'nurse', color: '#7048e8', hours: CLINIC_HOURS },
];
const AREA_SERVICES = {
  clinic: (s) => ['Consultas', 'Vacinas', 'Exames', 'Procedimentos'].includes(s.category) && s.name !== 'Consulta dermatológica',
  surgery: (s) => ['Consulta clínica', 'Retorno', 'Coleta para exames'].includes(s.name) || s.category === 'Cirurgias',
  derm: (s) => ['Consulta dermatológica', 'Consulta clínica', 'Retorno'].includes(s.name),
  nurse: (s) => s.category === 'Vacinas' || ['Coleta para exames', 'Microchipagem'].includes(s.name),
};

/** Tabela do módulo (criada ao ativar) e alguns serviços a mais. Preço em reais. */
const SERVICES = [
  { name: 'Consulta clínica', category: 'Consultas', durationMin: 30, price: 150 },
  { name: 'Retorno', category: 'Consultas', durationMin: 20, price: 80 },
  { name: 'Vacina V10', category: 'Vacinas', durationMin: 15, price: 90 },
  { name: 'Vacina antirrábica', category: 'Vacinas', durationMin: 15, price: 70 },
  { name: 'Vacina V4 felina', category: 'Vacinas', durationMin: 15, price: 110 },
  { name: 'Coleta para exames', category: 'Exames', durationMin: 15, price: 40 },
  { name: 'Microchipagem', category: 'Procedimentos', durationMin: 15, price: 80 },
  { name: 'Castração', category: 'Cirurgias', durationMin: 120, price: 600 },
  { name: 'Consulta dermatológica', category: 'Consultas', durationMin: 40, price: 220, description: 'Atendimento com especialista em dermatologia.' },
  { name: 'Ultrassonografia abdominal', category: 'Exames', durationMin: 40, price: 250, online: false },
  { name: 'Profilaxia dentária (tártaro)', category: 'Cirurgias', durationMin: 90, bufferMin: 15, price: 480, online: false, description: 'Com anestesia geral; exige exames pré-operatórios.' },
  { name: 'Vacina gripe canina', category: 'Vacinas', durationMin: 15, price: 95 },
];

const PETS = [
  { name: 'Bela', species: 'dog', breed: 'Beagle', sex: 'female', birthDate: '2019-08-12', weightKg: 12.4, coat: 'Curta, tricolor', size: 'medium', neutered: true, microchip: '985141003310045' },
  { name: 'Toby', species: 'dog', breed: 'Dachshund', sex: 'male', birthDate: '2018-03-27', weightKg: 8.1, coat: 'Curta', size: 'small', neutered: true, notes: 'Predisposição a problemas de coluna. Evitar escadas.' },
  { name: 'Mia', species: 'cat', breed: 'Siamês', sex: 'female', birthDate: '2021-01-09', weightKg: 3.9, coat: 'Curta', size: 'small', neutered: true },
  { name: 'Rex', species: 'dog', breed: 'Pastor Alemão', sex: 'male', birthDate: '2017-11-30', weightKg: 34, coat: 'Dupla', size: 'large', microchip: '985141003327718' },
  { name: 'Lola', species: 'dog', breed: 'Pug', sex: 'female', birthDate: '2020-05-17', weightKg: 8.7, coat: 'Curta', size: 'small', neutered: true, notes: 'Braquicefálica: cuidado com sedação e calor.' },
  { name: 'Oliver', species: 'cat', breed: 'SRD', sex: 'male', birthDate: '2019-02-02', weightKg: 5.2, coat: 'Curta, rajada', size: 'small', neutered: true },
  { name: 'Kiwi', species: 'bird', breed: 'Calopsita', sex: 'male', birthDate: '2022-09-01', weightKg: 0.09, notes: 'Vem na gaiola de transporte. Atender em sala fechada.' },
  { name: 'Pandora', species: 'dog', breed: 'Border Collie', sex: 'female', birthDate: '2022-04-21', weightKg: 17.5, coat: 'Longa', size: 'medium', neutered: true },
  { name: 'Fred', species: 'dog', breed: 'Shih Tzu', sex: 'male', birthDate: day(-125), weightKg: 3.2, coat: 'Longa', size: 'small', notes: 'Filhote em protocolo vacinal.' },
  { name: 'Nala', species: 'cat', breed: 'Ragdoll', sex: 'female', birthDate: '2024-03-15', weightKg: 4.6, coat: 'Semilonga', size: 'medium', neutered: true },
  { name: 'Bento', species: 'dog', breed: 'SRD', sex: 'male', birthDate: '2013-02-15', weightKg: 16.2, coat: 'Curta', size: 'medium', neutered: true, notes: 'Idoso, cardiopata em investigação. Alérgico a dipirona.' },
];

/** Atendimentos passados: [pet, serviços, dia, status (padrão concluído), motivo]. */
const PAST = [
  ['Fred', ['Consulta clínica', 'Vacina V10'], -27],
  ['Kiwi', ['Retorno'], -24, 'cancelled', 'Tutor sem transporte no dia'],
  ['Rex', ['Retorno'], -22, 'no_show'],
  ['Pandora', ['Vacina antirrábica'], -19, 'no_show'],
  ['Mia', ['Vacina V4 felina'], -20],
  ['Bela', ['Consulta dermatológica'], -18],
  ['Bento', ['Consulta clínica'], -16],
  ['Nala', ['Consulta clínica', 'Coleta para exames'], -15],
  ['Bento', ['Ultrassonografia abdominal'], -14],
  ['Oliver', ['Consulta clínica', 'Coleta para exames'], -13],
  ['Kiwi', ['Consulta clínica'], -11],
  ['Lola', ['Consulta clínica'], -10],
  ['Rex', ['Consulta clínica', 'Vacina V10'], -8],
  ['Oliver', ['Retorno'], -8],
  ['Nala', ['Castração'], -8],
  ['Mia', ['Consulta clínica'], -6],
  ['Pandora', ['Consulta clínica', 'Coleta para exames'], -5],
  ['Toby', ['Consulta clínica'], -4],
  ['Bela', ['Consulta clínica'], -3],
  ['Lola', ['Profilaxia dentária (tártaro)'], -2],
  ['Toby', ['Retorno'], -1, 'cancelled', 'Tutor remarcou por compromisso de trabalho'],
];

/** Hoje: [pet, serviços, a partir de (min desde 0h), etapas]. */
const TODAY = [
  ['Rex', ['Consulta clínica'], 480, ['arrived', 'in_service', 'done', 'pay']],
  ['Mia', ['Vacina V4 felina'], 510, ['arrived', 'in_service', 'done']],
  ['Lola', ['Consulta clínica'], 540, ['arrived', 'in_service']],
  ['Bento', ['Coleta para exames'], 570, ['arrived']],
  ['Pandora', ['Consulta clínica'], 600, ['confirmed']],
  ['Kiwi', ['Retorno'], 840, []],
  ['Toby', ['Consulta clínica'], 900, []],
];

/** Próximos dias: [pet, serviços, dia, status]. */
const FUTURE = [
  ['Fred', ['Vacina V10'], 1, 'confirmed'],
  ['Pandora', ['Retorno'], 2, 'confirmed'],
  ['Nala', ['Retorno'], 2],
  ['Rex', ['Vacina antirrábica'], 3],
  ['Oliver', ['Retorno'], 3],
  ['Bela', ['Retorno'], 4],
  ['Mia', ['Consulta clínica'], 5, 'cancelled', 'Tutora vai viajar, remarca na volta'],
  ['Bento', ['Consulta clínica'], 6],
  ['Lola', ['Consulta dermatológica'], 7],
  ['Toby', ['Retorno'], 8],
  ['Kiwi', ['Consulta clínica'], 9],
];

/** Consulta de cada pet no prontuário (formulário vet.consultation). */
const CASES = {
  Bela: { complaint: 'Coceira nas orelhas e balança muito a cabeça há 5 dias', history: 'Nadou na piscina no fim de semana. Sem histórico de otite.', temperature: 38.6, heartRate: 96, respiratoryRate: 22, exam: 'Conduto auditivo esquerdo eritematoso, com secreção acastanhada e odor.', diagnosis: 'Otite externa bilateral (suspeita de Malassezia).', treatment: 'Limpeza otológica na consulta. Otológico com antifúngico e corticoide, 2x ao dia por 14 dias. Evitar molhar as orelhas.', returnIn: 4 },
  Toby: { complaint: 'Dor ao subir escadas e não quer pular no sofá', history: 'Começou depois de brincadeira no parque, há 2 dias. Come e bebe normalmente.', temperature: 38.4, heartRate: 110, respiratoryRate: 26, exam: 'Dor à palpação de coluna toracolombar; reflexos preservados; deambula.', diagnosis: 'Suspeita de doença do disco intervertebral (grau I).', treatment: 'Repouso restrito por 14 dias. Anti-inflamatório por 5 dias e analgésico por 7 dias. Raio-X de coluna solicitado.', returnIn: 8 },
  Mia: { complaint: 'Vômitos esporádicos com bolas de pelo', temperature: 38.7, heartRate: 180, respiratoryRate: 28, exam: 'Bom estado geral; abdômen sem dor à palpação.', diagnosis: 'Tricobezoares.', treatment: 'Pasta de malte 3x por semana, escovação diária e ração com controle de bolas de pelo.' },
  Rex: { complaint: 'Check-up anual e vacinação', temperature: 38.5, heartRate: 88, respiratoryRate: 20, exam: 'Leve claudicação de membro pélvico direito após exercício.', diagnosis: 'Sem alterações clínicas relevantes. Suspeita de displasia coxofemoral leve.', treatment: 'Aplicada V10. Suplemento articular (condroitina e glucosamina) por 60 dias. Raio-X de quadril.' },
  Lola: { complaint: 'Respiração ruidosa e cansaço em dias quentes', history: 'Ronca muito à noite. Ganhou 1 kg nos últimos 6 meses.', temperature: 39.1, heartRate: 128, respiratoryRate: 34, exam: 'Narinas estenóticas; palato mole alongado; tártaro grau II.', diagnosis: 'Síndrome braquicefálica. Doença periodontal grau II.', treatment: 'Dieta light para perder peso. Evitar passeios em horários quentes. Profilaxia dentária agendada; avaliar rinoplastia.' },
  Oliver: { complaint: 'Urinando fora da caixa e com sangue na urina', history: 'Mudou de casa há 2 semanas. Bebe pouca água.', temperature: 38.9, heartRate: 190, respiratoryRate: 30, hydration: 'Desidratação leve', exam: 'Bexiga pequena e dolorosa à palpação.', diagnosis: 'Cistite idiopática felina (suspeita).', treatment: 'Urina coletada por cistocentese para urinálise. Analgésico por 5 dias. Fonte de água e ração úmida.', returnIn: 3 },
  Kiwi: { complaint: 'Arrancando as próprias penas', history: 'Fica sozinho a maior parte do dia. Dieta só de sementes.', exam: 'Rarefação de penas no peito e nas asas; sem ectoparasitas visíveis.', diagnosis: 'Arrancamento de penas de origem comportamental.', treatment: 'Enriquecimento ambiental, banho de sol diário, introduzir ração extrusada e reduzir girassol.', returnIn: 9 },
  Pandora: { complaint: 'Diarreia há 2 dias', history: 'Comeu algo no parque. Sem vômitos.', temperature: 39.0, heartRate: 100, respiratoryRate: 24, hydration: 'Desidratação leve', exam: 'Dor leve à palpação abdominal.', diagnosis: 'Gastroenterite (suspeita de giardíase).', treatment: 'Coproparasitológico solicitado. Probiótico por 7 dias e dieta leve (frango e arroz).', returnIn: 2 },
  Fred: { complaint: 'Primeira consulta do filhote e vacinação', temperature: 38.8, heartRate: 140, respiratoryRate: 28, exam: 'Filhote ativo, bom escore corporal.', diagnosis: 'Filhote saudável.', treatment: 'Aplicada a 2ª dose da V10. Vermífugo a cada 15 dias até os 6 meses. 3ª dose em 21 dias.' },
  Nala: { complaint: 'Avaliação pré-operatória para castração', temperature: 38.5, heartRate: 170, respiratoryRate: 26, exam: 'Sem alterações ao exame físico.', diagnosis: 'Apta para cirurgia eletiva.', treatment: 'Jejum de 8 h (alimento) e 2 h (água). Hemograma e bioquímico pré-cirúrgicos coletados.' },
  Bento: { complaint: 'Tosse à noite e cansaço nos passeios', history: 'Idoso, 13 anos. Tosse há 1 mês, pior ao deitar.', temperature: 38.3, heartRate: 132, respiratoryRate: 36, exam: 'Sopro sistólico grau III/VI em foco mitral.', diagnosis: 'Doença valvar mitral degenerativa (suspeita).', treatment: 'Encaminhado para ecocardiograma. Ultrassom abdominal feito. Iniciar pimobendan após o exame.', returnIn: 6 },
};

/** Exames (vet.exam), ligados ao atendimento do serviço indicado. */
const EXAMS = [
  ['Pandora', 'Coleta para exames', { type: 'Parasitológico', lab: 'VetAnálises Laboratório', result: 'Positivo para cistos de Giardia sp. Iniciado tratamento por 5 dias.' }],
  ['Oliver', 'Coleta para exames', { type: 'Urinálise', lab: 'VetAnálises Laboratório', result: 'Densidade 1,045; hematúria; cristais de estruvita raros; sem bactérias.' }],
  ['Nala', 'Coleta para exames', { type: 'Hemograma', lab: 'VetAnálises Laboratório', result: 'Hemograma e bioquímico (ureia, creatinina, ALT) dentro da normalidade.' }],
  ['Rex', 'Consulta clínica', { type: 'Raio-X', lab: 'Imagem na clínica', result: 'Displasia coxofemoral leve bilateral (grau B/C). Sem sinais de artrose.' }],
  ['Bento', 'Ultrassonografia abdominal', { type: 'Ultrassom', lab: 'Imagem na clínica', result: 'Fígado e baço sem alterações. Rins com leve perda de definição corticomedular, compatível com a idade.' }],
];

/** Procedimentos (vet.procedure). */
const PROCEDURES = [
  ['Nala', 'Castração', { procedure: 'Ovariossalpingo-histerectomia (castração)', anesthesia: 'MPA com dexmedetomidina e metadona; indução com propofol; manutenção com isoflurano', description: 'Acesso pela linha média, ligadura dos pedículos ovarianos e da cérvix. Sutura intradérmica.', complications: 'Nenhuma.', postOp: 'Roupa cirúrgica por 10 dias. Analgésico e anti-inflamatório por 3 dias. Retorno em 10 dias para ver a ferida.', consent: true }],
  ['Lola', 'Profilaxia dentária (tártaro)', { procedure: 'Profilaxia dentária (remoção de tártaro)', anesthesia: 'Anestesia geral inalatória (isoflurano), com intubação', description: 'Raspagem ultrassônica e polimento. Extraído 1 pré-molar com mobilidade.', complications: 'Nenhuma.', postOp: 'Ração úmida por 3 dias. Escovação diária a partir do 7º dia.', consent: true }],
];

/**
 * Carteira de vacinação: [vacina, dias até o próximo reforço]. A dose mais recente foi aplicada
 * um ano antes do reforço; negativos ficam vencidos e os próximos aparecem em "Vacinas a vencer".
 */
const VACCINES = {
  Bela: [['V10 (polivalente canina)', -18], ['Antirrábica', 40]],
  Toby: [['V10 (polivalente canina)', 6], ['Antirrábica', 6], ['Gripe canina (tosse dos canis)', 120]],
  Mia: [['V4 (felina)', 345], ['Antirrábica', 25]],
  Rex: [['V10 (polivalente canina)', 357], ['Antirrábica', 3], ['Leishmaniose', 12]],
  Lola: [['V10 (polivalente canina)', 27], ['Antirrábica', 90]],
  Oliver: [['V5 (felina)', -4], ['FeLV', 11], ['Antirrábica', 200]],
  Pandora: [['V10 (polivalente canina)', 19], ['Antirrábica', -35], ['Giárdia', 150]],
  Nala: [['V4 (felina)', 75], ['Antirrábica', 75]],
  Bento: [['V10 (polivalente canina)', 2], ['Antirrábica', 220]],
};
const MANUFACTURER = {
  'V10 (polivalente canina)': 'Zoetis',
  Antirrábica: 'Boehringer Ingelheim',
  'Gripe canina (tosse dos canis)': 'MSD Saúde Animal',
  Leishmaniose: 'Ceva',
  Giárdia: 'Zoetis',
  'V4 (felina)': 'Zoetis',
  'V5 (felina)': 'MSD Saúde Animal',
  FeLV: 'Boehringer Ingelheim',
};
const PAY_METHODS = ['pix', 'pix', 'credit_card', 'credit_card', 'debit_card', 'cash'];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log } = ctx;

  await step(log, 'agenda online ligada', async () => {
    const current = await api.get('/modules/shared.scheduling/settings');
    if (current.onlineBooking) return log('    agendamento online já ligado');
    await api.put('/modules/shared.scheduling/settings', { ...current, onlineBooking: true });
  });

  await step(log, 'serviços da clínica', () => seedServices(ctx));
  await step(log, 'veterinários e expediente', () => seedResources(ctx));
  await step(log, 'folgas e bloqueios', () => seedTimeOff(ctx));
  const pets = (await step(log, 'pets', () => seedPets(ctx))) ?? [];
  await step(log, 'agenda: histórico e próximos dias', () => seedAgenda(ctx, pets));
  await step(log, 'agenda de hoje', () => seedToday(ctx, pets));
  await step(log, 'prontuários', () => seedRecords(ctx, pets));
  await step(log, 'carteiras de vacinação', () => seedVaccines(ctx, pets));
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
  // Quem tem o papel de veterinário vira profissional da agenda (ligado ao usuário).
  const members = await api.get('/users');
  const vets = members.filter((m) => m.roles.some((r) => r.key === 'vet.veterinarian'));
  const team = TEAM.map((t, i) => (vets[i] && t.area !== 'nurse' ? { ...t, name: vets[i].user.name, userId: vets[i].user.id } : t));

  let created = 0;
  for (const t of team) {
    if (existing.some((e) => e.name === t.name)) continue;
    const serviceIds = services.filter(AREA_SERVICES[t.area]).map((s) => s.id);
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
    [pick(2), nextWeekday(10, [2, 4]), '09:00', '18:00', 'Congresso de dermatologia veterinária'],
    [pick(1), nextWeekday(2, WEEKDAYS), '08:00', '10:00', 'Cirurgia ortopédica externa'],
    [pick(3), nextWeekday(5, WEEKDAYS), '13:00', '19:00', 'Folga'],
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

/** Pet pelo nome; se a empresa tiver outros pets, usa um deles na mesma posição. */
const petNamed = (pets, name) => pets.find((p) => p.name === name) ?? pets[PETS.findIndex((p) => p.name === name) % pets.length];

// ---- Agenda: atendimentos ----------------------------------------------------------------------

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

const serviceIdsOf = (services, names) => names.map((n) => services.find((s) => s.name === n && s.active)?.id).filter(Boolean);

async function seedAgenda(ctx, pets) {
  const { api, rng, log } = ctx;
  if (!pets.length) throw new Error('sem pets para agendar');
  const { services, appointments, planner } = await loadAgenda(api, -35, 16);
  const notToday = appointments.filter((a) => localDate(a.startsAt) !== day(0));
  if (notToday.length >= 20) return log(`    já tem ${notToday.length} atendimentos no período`);
  const accounts = await paymentAccounts(api);

  const counts = {};
  const tally = (s) => (counts[s] = (counts[s] ?? 0) + 1);
  // dir: para que lado procurar outro dia se o escolhido não tiver horário.
  const plan = [
    ...PAST.map(([pet, names, n, status = 'done', reason]) => ({ pet, names, n, status, reason, dir: -1 })),
    ...FUTURE.map(([pet, names, n, status = 'scheduled', reason]) => ({ pet, names, n, status, reason, dir: 1 })),
  ];
  for (const [k, { pet: petName, names, n, status: st, reason, dir }] of plan.entries()) {
    const pet = petNamed(pets, petName);
    const serviceIds = serviceIdsOf(services, names);
    if (!serviceIds.length) continue;
    const a = await bookNear(api, planner, { pet, serviceIds, n, fromMin: rng.pick([480, 540, 600, 780, 840, 900]), rot: k, dir });
    if (!a) continue;
    if (st === 'cancelled') await setStatus(api, a.id, 'cancelled', reason);
    else if (st !== 'scheduled') await setStatus(api, a.id, st);
    tally(st);
    if (st !== 'done') continue;
    // Cirurgia com sinal pago (parcial); o resto quase sempre pago no dia.
    if (names.includes('Castração')) await pay(api, a, accounts, 'pix', localDate(a.startsAt), Math.round(a.total * 50) / 100);
    else if (rng.chance(0.85)) await pay(api, a, accounts, rng.pick(PAY_METHODS), localDate(a.startsAt));
    else tally('a receber');
  }
  const label = { done: 'concluídos', no_show: 'faltas', cancelled: 'cancelados', confirmed: 'confirmados', scheduled: 'agendados', 'a receber': 'a receber' };
  log(`    ${Object.entries(counts).map(([s, c]) => `${c} ${label[s] ?? s}`).join(', ')}`);
}

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
  if (!resources.some((r) => r.hours.some((h) => h.weekday === wd))) return log('    clínica fechada hoje, pulado');
  const accounts = await paymentAccounts(api);

  let created = 0;
  for (const [i, [petName, names, fromMin, path]] of TODAY.entries()) {
    const serviceIds = serviceIdsOf(services, names);
    if (!serviceIds.length) continue;
    const a = await book(api, planner, { pet: petNamed(pets, petName), serviceIds, n: 0, fromMin, rot: i });
    if (!a) continue;
    for (const s of path) {
      if (s === 'pay') await pay(api, a, accounts, rng.pick(PAY_METHODS), day(0));
      else await setStatus(api, a.id, s);
    }
    created++;
  }
  log(`    ${created} atendimentos hoje`);
}

// ---- Prontuário --------------------------------------------------------------------------------

async function seedRecords({ api, rng, log }, pets) {
  const appointments = await api.get('/scheduling/appointments', { from: at(-60, 0), to: at(1, 0) });
  /** Atendimento concluído mais recente do pet com o serviço, para ligar o registro. */
  const appointmentOf = (pet, serviceName) =>
    appointments
      .filter((a) => a.subject?.id === pet.id && a.status === 'done' && a.services.some((s) => s.name === serviceName))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0]?.id ?? null;

  let entries = 0;
  let skipped = 0;
  for (const [name, c] of Object.entries(CASES)) {
    const pet = pets.find((p) => p.name === name);
    if (!pet) continue;
    if ((await api.get('/medical-records', { subjectType: 'pet', subjectId: pet.id })).length) {
      skipped++;
      continue;
    }
    const vitals = pet.species === 'bird' ? {} : { temperature: c.temperature, heartRate: c.heartRate, respiratoryRate: c.respiratoryRate, hydration: c.hydration ?? 'Normal', mucosa: 'Normocoradas' };
    const data = {
      complaint: c.complaint,
      history: c.history,
      weight: pet.weightKg ?? undefined,
      ...vitals,
      exam: c.exam,
      diagnosis: c.diagnosis,
      treatment: c.treatment,
      returnOn: c.returnIn ? day(c.returnIn) : undefined,
    };
    const entry = await api.post('/medical-records', {
      subjectType: 'pet',
      subjectId: pet.id,
      formKey: 'vet.consultation',
      data,
      notes: rng.chance(0.4) ? 'Tutor orientado e de acordo com a conduta.' : null,
      appointmentId: appointmentOf(pet, 'Consulta clínica') ?? appointmentOf(pet, 'Consulta dermatológica'),
    });
    entries++;

    // Retificação: o original fica guardado e a nova versão aparece no lugar.
    if (name === 'Toby') {
      await api.post(`/medical-records/${entry.id}/amend`, { data: { ...data, weight: 8.4 }, notes: null, reason: 'Peso conferido de novo na balança: 8,4 kg' });
      entries++;
    }
    for (const [, service, exam] of EXAMS.filter(([p]) => p === name)) {
      await api.post('/medical-records', { subjectType: 'pet', subjectId: pet.id, formKey: 'vet.exam', data: exam, appointmentId: appointmentOf(pet, service) });
      entries++;
    }
    for (const [, service, procedure] of PROCEDURES.filter(([p]) => p === name)) {
      await api.post('/medical-records', { subjectType: 'pet', subjectId: pet.id, formKey: 'vet.procedure', data: procedure, appointmentId: appointmentOf(pet, service) });
      entries++;
    }
  }
  log(`    ${entries} registros${skipped ? ` (${skipped} pets já tinham prontuário)` : ''}`);
}

// ---- Vacinas -----------------------------------------------------------------------------------

async function seedVaccines({ api, rng, log }, pets) {
  const batch = () => `${rng.pick(['A', 'B', 'K', 'L', 'M'])}${rng.int(1000, 9999)}/${rng.int(25, 26)}`;
  const vaccinate = (pet, vaccine, dose, appliedOn, nextDueOn, notes) =>
    api.post('/vet/vaccinations', { petId: pet.id, vaccine, dose, batch: batch(), manufacturer: MANUFACTURER[vaccine] ?? null, appliedOn, nextDueOn, notes: notes ?? null });

  let doses = 0;
  let skipped = 0;
  for (const pet of pets) {
    const plan = VACCINES[pet.name];
    if (!plan && pet.name !== 'Fred') continue;
    if ((await api.get(`/vet/pets/${pet.id}/vaccinations`)).length) {
      skipped++;
      continue;
    }
    if (pet.name === 'Fred') {
      // Filhote: 1ª e 2ª dose dadas, a 3ª está atrasada (e marcada para amanhã).
      await vaccinate(pet, 'V10 (polivalente canina)', '1ª dose', day(-48), day(-27));
      await vaccinate(pet, 'V10 (polivalente canina)', '2ª dose', day(-27), day(-6), 'Sem reações.');
      doses += 2;
      continue;
    }
    for (const [i, [vaccine, due]] of plan.entries()) {
      // Histórico do ano anterior na primeira vacina, para a carteira ter mais de uma linha.
      if (i === 0) {
        await vaccinate(pet, vaccine, 'Reforço anual', day(due - 730), day(due - 365));
        doses++;
      }
      await vaccinate(pet, vaccine, 'Reforço anual', day(due - 365), day(due), rng.chance(0.25) ? rng.pick(['Sem reações.', 'Leve sonolência após a aplicação.', 'Dor local leve; compressa fria.']) : null);
      doses++;
    }
    // Lançamento errado anulado (com motivo), para mostrar que nada é apagado.
    if (pet.name === 'Lola') {
      const wrong = await vaccinate(pet, 'Antirrábica', 'Reforço anual', day(-9), day(356));
      await api.post(`/vet/vaccinations/${wrong.id}/void`, { reason: 'Lançada na ficha do pet errado' });
      doses++;
    }
  }
  const due = await api.get('/vet/vaccinations/due', { until: day(30) });
  log(`    ${doses} doses registradas${skipped ? ` (${skipped} pets já tinham carteira)` : ''}; ${due.length} reforços vencidos ou a vencer em 30 dias`);
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

/** Como book, mas se o dia não tem horário (domingo, especialista ausente) tenta os dias vizinhos. */
async function bookNear(api, planner, opts) {
  for (let i = 0; i < 6; i++) {
    const n = opts.n + i * opts.dir;
    if (opts.dir < 0 ? n >= 0 : n <= 0) break;
    const a = await book(api, planner, { ...opts, n });
    if (a) return a;
  }
  return null;
}

const setStatus = (api, id, status, reason) => api.post(`/scheduling/appointments/${id}/status`, { status, reason: reason ?? null });

async function paymentAccounts(api) {
  const accounts = await api.get('/scheduling/payment-accounts');
  const cash = accounts.find((a) => a.type === 'cash') ?? accounts[0];
  const bank = accounts.find((a) => a.type === 'bank') ?? cash;
  if (!cash) throw new Error('nenhuma conta no financeiro');
  return { cash, bank };
}

function pay(api, appointment, { cash, bank }, method, paidAt, amount = appointment.total) {
  if (!(amount > 0)) return null;
  return api.post(`/scheduling/appointments/${appointment.id}/payments`, { amount, method, accountId: method === 'cash' ? cash.id : bank.id, paidAt });
}
