// Agenda além do básico: salas/equipamentos reservados junto com o profissional (estética e
// ortodontia), horários com repetição (séries semanais, quinzenais e mensais) e as manhãs do
// salão preenchidas de hoje até os próximos dias úteis. Pode rodar de novo: salas e vínculos
// existentes são mantidos, séries são reconhecidas pela observação e os horários só entram em
// espaços livres (profissional, sala, bloqueio e expediente conferidos antes de marcar).
import { DISTRICTS, STREETS, at, createRng, day, slugify, step } from '../lib.mjs';
import { PAY_METHODS, round2, weighted } from '../verticals/_scheduling-beauty-group.mjs';

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: object[] }} ctx */
export default async function seedAgenda(ctx) {
  if (ctx.tenant.name === 'fake-estetica') return aesthetics(ctx);
  if (ctx.tenant.name === 'fake-salao') return salon(ctx);
  if (ctx.tenant.name === 'fake-ortodontia') return orthodontics(ctx);
}

// ---- Horário de Brasília (UTC−3 fixo, igual ao servidor) ---------------------------------------

const OFFSET_MS = 3 * 3_600_000;
/** Instante ISO → data e minuto do dia em Brasília. */
const local = (iso) => {
  const d = new Date(Date.parse(iso) - OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const pad = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' + minutos do dia → ISO com fuso de Brasília. */
const atDate = (date, min) => `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00-03:00`;
const weekdayOfDate = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const nextDate = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const daysFromToday = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${day(0)}T00:00:00Z`)) / 86_400_000);

const RELEASED = new Set(['cancelled', 'no_show']);

/** Intervalos do expediente do profissional na data, recortados em [from, to). */
function windowsOn(resource, date, from = 0, to = 24 * 60) {
  const wd = weekdayOfDate(date);
  return resource.hours
    .filter((h) => h.weekday === wd)
    .map((h) => [Math.max(toMin(h.start), from), Math.min(toMin(h.end), to)])
    .filter(([a, b]) => a < b)
    .sort((x, y) => x[0] - y[0]);
}
const inWindow = (resource, date, a, b) => windowsOn(resource, date).some(([x, y]) => x <= a && b <= y);

/** Datas de uma repetição, como o servidor calcula (mês sem o dia fica de fora). */
function seriesDates(start, frequency, count) {
  const [y, m, d] = start.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const dt = frequency === 'monthly' ? new Date(Date.UTC(y, m - 1 + i, d)) : new Date(Date.UTC(y, m - 1, d + i * (frequency === 'weekly' ? 7 : 14)));
    if (frequency === 'monthly' && dt.getUTCDate() !== d) continue;
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

// ---- Quadro de ocupação: profissional, sala e cliente por dia ---------------------------------

/**
 * Espelho local da agenda para planejar sem esbarrar nas regras do servidor (sobreposição do
 * profissional e da sala, bloqueios) e sem marcar o mesmo cliente duas vezes no dia.
 */
function createBoard() {
  const busy = new Map();
  const clients = new Set();
  const key = (id, date) => `${id}|${date}`;
  const board = {
    add(id, date, a, b) {
      const k = key(id, date);
      if (!busy.has(k)) busy.set(k, []);
      busy.get(k).push([a, b]);
    },
    free: (id, date, a, b) => !(busy.get(key(id, date)) ?? []).some(([x, y]) => x < b && y > a),
    clientFree: (customerId, date) => !clients.has(key(customerId, date)),
    addClient: (customerId, date) => clients.add(key(customerId, date)),
    /**
     * Atendimento que ocupa a agenda. Os antigos, sem sala, ocupam "de mentira" a primeira sala
     * livre que serve (`roomFor`), para os novos não caírem na mesma sala na mesma hora.
     */
    addAppointment(a, roomFor) {
      if (RELEASED.has(a.status)) return;
      const s = local(a.startsAt);
      const e = local(a.endsAt);
      const end = e.date === s.date ? e.min : 24 * 60;
      board.add(a.resourceId, s.date, s.min, end);
      board.addClient(a.customer.id, s.date);
      const room = a.roomId ?? roomFor?.(a, s.date, s.min, end) ?? null;
      if (room) board.add(room, s.date, s.min, end);
    },
    /** Bloqueio (folga, curso, congresso), dia a dia. */
    addTimeOff(t) {
      const s = local(t.startsAt);
      const e = local(t.endsAt);
      for (let d = s.date; d <= e.date; d = nextDate(d)) {
        const a = d === s.date ? s.min : 0;
        const b = d === e.date ? e.min : 24 * 60;
        if (a < b) board.add(t.resourceId, d, a, b);
      }
    },
  };
  return board;
}

/** Salas que servem para todos os serviços (serviço sem sala ligada = qualquer sala), como o servidor. */
function eligibleRooms(rooms, services) {
  const roomIds = new Set(rooms.map((r) => r.id));
  return rooms.filter((r) =>
    services.every((s) => {
      const linked = s.resourceIds.filter((id) => roomIds.has(id));
      return !linked.length || linked.includes(r.id);
    }),
  );
}

/** Carrega a agenda (de 120 dias atrás a 200 à frente), bloqueios, profissionais, salas e serviços. */
async function loadAgenda(api) {
  const [resources, services, appointments, timeOff] = await Promise.all([
    api.get('/scheduling/resources'),
    api.get('/scheduling/services'),
    api.get('/scheduling/appointments', { from: at(-120, 0), to: at(200, 0) }),
    api.get('/scheduling/time-off', { from: at(-1, 0), to: at(200, 0) }),
  ]);
  const pros = resources.filter((r) => r.kind === 'professional' && r.active);
  const rooms = resources.filter((r) => r.kind === 'room' && r.active);
  const byId = new Map(services.map((s) => [s.id, s]));
  const byName = new Map(services.map((s) => [s.name, s]));

  const board = createBoard();
  for (const t of timeOff) board.addTimeOff(t);
  const roomFor = (a, date, start, end) => {
    const svc = a.services.map((s) => byId.get(s.serviceId)).filter(Boolean);
    if (!svc.some((s) => s.requiresRoom)) return null;
    return eligibleRooms(rooms, svc).find((r) => board.free(r.id, date, start, end))?.id ?? null;
  };
  // Primeiro os que já têm sala de verdade; depois os antigos, que recebem uma sala "de mentira".
  const sorted = [...appointments].sort((x, y) => (x.roomId ? 0 : 1) - (y.roomId ? 0 : 1) || Date.parse(x.startsAt) - Date.parse(y.startsAt));
  for (const a of sorted) board.addAppointment(a, roomFor);
  return { pros, rooms, services: byName, appointments, board };
}

/**
 * Primeiro horário (passos de 15 min) a partir de `prefer` em que o profissional está livre no
 * expediente e, se `rooms` vier, alguma dessas salas também.
 */
function findSlot(board, { pro, date, dur, from = 0, to = 24 * 60, prefer = 0, rooms = null, notBefore = 0 }) {
  const starts = [];
  for (const [a, b] of windowsOn(pro, date, from, to)) for (let s = a; s + dur <= b; s += 15) if (s >= notBefore) starts.push(s);
  const ordered = [...starts.filter((s) => s >= prefer), ...starts.filter((s) => s < prefer)];
  for (const s of ordered) {
    if (!board.free(pro.id, date, s, s + dur)) continue;
    if (!rooms) return { start: s, roomId: null };
    const room = rooms.find((r) => board.free(r.id, date, s, s + dur));
    if (room) return { start: s, roomId: room.id };
  }
  return null;
}

const durationOf = (services) => services.reduce((s, x) => s + x.durationMin + (x.bufferMin ?? 0), 0);

/** Agora, em minutos do dia de Brasília (para hoje: o que já passou e o que vem). */
const nowMin = () => local(new Date().toISOString()).min;

/** Hoje e os próximos `count` dias em que algum profissional atende. */
function openDays(pros, count) {
  const out = [0];
  for (let n = 1; out.length <= count && n < 30; n++) if (pros.some((p) => windowsOn(p, day(n)).length)) out.push(n);
  return out;
}

/** Status pelo relógio: terminou → `past`; em andamento → em atendimento; depois → `future`. */
function statusAt(date, start, dur, past, future) {
  const s = Date.parse(atDate(date, start));
  const e = s + dur * 60_000;
  const now = Date.now();
  if (e <= now) return past;
  if (s <= now) return past === 'done' ? 'in_service' : future;
  return future;
}

const PATHS = {
  scheduled: [],
  confirmed: ['confirmed'],
  in_service: ['confirmed', 'arrived', 'in_service'],
  done: ['confirmed', 'done'],
  no_show: ['no_show'],
};

/**
 * Marca os horários um a um, leva cada um até o status pedido (pelas transições permitidas) e
 * registra o pagamento dos concluídos. Um conflito (409) ou recusa (400) pula só aquele horário.
 * Item: { customerId, resourceId, roomId?, serviceIds, date, start, status, notes?, pay?: { method } }
 */
async function book(api, items) {
  const stats = { created: 0, refused: 0, paid: 0, status: {}, errors: [] };
  if (!items.length) return stats;
  const accounts = await api.get('/scheduling/payment-accounts');
  const cash = accounts.find((a) => a.type === 'cash') ?? accounts[0];
  const bank = accounts.find((a) => a.type === 'bank') ?? cash;
  for (const item of items) {
    try {
      let a = await api.post('/scheduling/appointments', {
        customerId: item.customerId,
        resourceId: item.resourceId,
        roomId: item.roomId ?? null,
        serviceIds: item.serviceIds,
        startsAt: atDate(item.date, item.start),
        notes: item.notes ?? null,
      });
      stats.created++;
      for (const status of PATHS[item.status] ?? []) a = await api.post(`/scheduling/appointments/${a.id}/status`, { status, reason: null });
      if (item.pay && a.status === 'done' && cash) {
        const amount = round2(a.total - a.paidAmount);
        if (amount > 0) {
          a = await api.post(`/scheduling/appointments/${a.id}/payments`, { amount, method: item.pay.method, accountId: (item.pay.method === 'cash' ? cash : bank).id, paidAt: item.date });
          stats.paid++;
        }
      }
      stats.status[a.status] = (stats.status[a.status] ?? 0) + 1;
    } catch (err) {
      if (![400, 409, 422].includes(err.status)) throw err;
      stats.refused++;
      if (stats.errors.length < 3) stats.errors.push(err.message);
    }
  }
  return stats;
}

const describe = (s) =>
  `${s.created} criados, ${s.paid} pagos${s.refused ? `, ${s.refused} recusados (${s.errors.join(' | ')})` : ''}` +
  (Object.keys(s.status).length ? ` — ${Object.entries(s.status).map(([k, v]) => `${k}: ${v}`).join(', ')}` : '');

/**
 * Melhor combinação (profissional, dia de início, horário) para uma série: a que cabe em mais
 * datas, com o profissional livre e, se precisar, uma sala livre. A primeira data precisa caber.
 * Devolve também a sala livre em mais datas (a série reserva sempre a mesma).
 */
function planSeries(board, { pros, startDays, times, dur, frequency, count, rooms: roomList = null }) {
  // Sem sala cadastrada que sirva: planeja só pelo profissional.
  const rooms = roomList?.length ? roomList : null;
  let best = null;
  for (const pro of pros) {
    for (const n of startDays) {
      for (const t of times) {
        const dates = seriesDates(day(n), frequency, count);
        const fits = (d) => inWindow(pro, d, t, t + dur) && board.free(pro.id, d, t, t + dur);
        if (!fits(dates[0])) continue;
        let ok = 0;
        const roomScore = new Map();
        for (const d of dates) {
          if (!fits(d)) continue;
          if (rooms) {
            const free = rooms.filter((r) => board.free(r.id, d, t, t + dur));
            if (!free.length) continue;
            for (const r of free) roomScore.set(r.id, (roomScore.get(r.id) ?? 0) + 1);
          }
          ok++;
        }
        if (!best || ok > best.fits) {
          const roomId = rooms ? [...roomScore.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null : null;
          best = { pro, date: day(n), start: t, fits: ok, total: dates.length, roomId };
        }
      }
    }
  }
  return best;
}

/** Cria a série pela API; "nenhuma data coube" (409) vira resultado vazio em vez de erro. */
async function createSeries(api, board, body) {
  try {
    const r = await api.post('/scheduling/appointments/series', body);
    for (const a of r.created) board.addAppointment(a);
    return r;
  } catch (err) {
    if (err.status !== 409 && err.status !== 400) throw err;
    return { created: [], skipped: [], error: err.message };
  }
}

const seriesSummary = (r) =>
  r.error
    ? `nenhuma data coube (${r.error})`
    : `${r.created.length} horários${r.skipped.length ? `, ${r.skipped.length} datas puladas (${[...new Set(r.skipped.map((s) => s.reason))].join('; ')})` : ''}`;

// ---- Salas e equipamentos ----------------------------------------------------------------------

/** Expediente das salas (só informativo: a agenda confere o do profissional). */
const ROOM_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '08:00', end: '20:00' })).concat([{ weekday: 6, start: '08:00', end: '18:00' }]);

/**
 * Salas/equipamentos por nome, ligados aos serviços que servem; liga os que faltarem numa sala
 * existente (sem tirar vínculos) e marca esses serviços como "precisa de sala".
 */
async function ensureRooms(api, log, defs) {
  const services = new Map((await api.get('/scheduling/services')).map((s) => [s.name, s]));
  const existing = await api.get('/scheduling/resources');
  let created = 0;
  let linked = 0;
  for (const d of defs) {
    const serviceIds = d.services.map((n) => services.get(n)?.id).filter(Boolean);
    const found = existing.find((r) => r.kind === 'room' && r.name === d.name);
    if (!found) {
      const { id } = await api.post('/scheduling/resources', { name: d.name, kind: 'room', color: d.color, active: true, serviceIds });
      await api.put(`/scheduling/resources/${id}/hours`, { hours: ROOM_HOURS });
      created++;
      continue;
    }
    const missing = serviceIds.filter((id) => !found.serviceIds.includes(id));
    if (missing.length) {
      await api.patch(`/scheduling/resources/${found.id}`, { name: found.name, kind: 'room', color: found.color, active: found.active, serviceIds: [...found.serviceIds, ...missing] });
      linked++;
    }
  }
  // "Precisa de sala": sem escolher, a agenda reserva a primeira livre entre as ligadas ao serviço.
  let flagged = 0;
  for (const name of new Set(defs.filter((d) => d.required !== false).flatMap((d) => d.services))) {
    const s = services.get(name);
    if (!s || s.requiresRoom) continue;
    // Sem resourceIds: os vínculos (profissionais e salas) ficam como estão.
    await api.patch(`/scheduling/services/${s.id}`, {
      name: s.name,
      category: s.category,
      durationMin: s.durationMin,
      bufferMin: s.bufferMin,
      price: s.price,
      online: s.online,
      active: s.active,
      description: s.description,
      requiresRoom: true,
    });
    flagged++;
  }
  log(`    salas/equipamentos: ${created} criados, ${linked} com vínculos completados, ${flagged} serviços passaram a exigir sala`);
}

// ---- Clínica de estética -----------------------------------------------------------------------

const FACIAL = ['Limpeza de pele', 'Hidrafacial', 'Peeling químico', 'Microagulhamento'];
const BODY = ['Drenagem linfática', 'Massagem modeladora', 'Radiofrequência'];
const LASER = ['Depilação a laser (área pequena)', 'Depilação a laser (pernas inteiras)'];
// Avaliação e injetáveis são feitos no consultório da médica: não reservam sala.
const AES_ROOMS = [
  { name: 'Sala 1', color: '#64748b', services: [...FACIAL, ...BODY] },
  { name: 'Sala 2', color: '#0f766e', services: [...FACIAL, ...BODY] },
  { name: 'Sala de laser', color: '#b45309', services: LASER },
  { name: 'Equipamento de criolipólise', color: '#1d4ed8', services: ['Criolipólise'] },
];
const AES_DEMANDS = [...LASER.map((n) => [n]), ...FACIAL.map((n) => [n]), ...BODY.map((n) => [n]), ['Criolipólise']];
const AES_PACKAGE_NOTE = 'Pacote semanal de drenagem: 6 sessões no mesmo dia e horário.';

async function aesthetics(ctx) {
  const { api, log, tenant } = ctx;
  const rng = createRng(`${tenant.name}:agenda`);
  const people = ctx.customers.filter((c) => c.type === 'person');
  if (!people.length) return log('  ✗ agenda: sem clientes');

  await step(log, 'salas e equipamentos', () => ensureRooms(api, log, AES_ROOMS));
  const agenda = await step(log, 'agenda atual', async () => loadAgenda(api));
  if (!agenda) return;
  const { pros, rooms, services, appointments, board } = agenda;

  // Pacote de 6 drenagens vendido hoje e marcado de uma vez, toda semana no mesmo horário:
  // cada sessão da série reserva uma sessão do pacote (sai a R$ 0 na agenda).
  await step(log, 'pacote de drenagem com horário semanal', async () => {
    const drainage = services.get('Drenagem linfática');
    if (!drainage) return log('    sem o procedimento Drenagem linfática');
    const packages = await api.get('/aesthetics/packages');
    let pkg = packages.find((p) => p.notes === AES_PACKAGE_NOTE);
    if (!pkg) {
      const taken = new Set(packages.filter((p) => p.service.id === drainage.id).map((p) => p.customer.id));
      const customer = [...people].reverse().find((c) => !taken.has(c.id));
      if (!customer) return log('    todos os clientes já têm pacote de drenagem');
      pkg = await api.post('/aesthetics/packages', {
        customerId: customer.id,
        serviceId: drainage.id,
        totalSessions: 6,
        price: 780,
        installments: 2,
        firstDueOn: day(0),
        expiresOn: day(120),
        notes: AES_PACKAGE_NOTE,
      });
    }
    if (appointments.some((a) => a.seriesId && a.customer.id === pkg.customer.id)) return log(`    série de ${pkg.customer.name} já existe`);
    const plan = planSeries(board, {
      pros: pros.filter((p) => p.serviceIds.includes(drainage.id)),
      startDays: [1, 2, 3, 4, 5, 6, 7],
      times: [16, 17, 15, 18, 10, 11].map((h) => h * 60),
      dur: durationOf([drainage]),
      frequency: 'weekly',
      count: 6,
      rooms: eligibleRooms(rooms, [drainage]),
    });
    if (!plan) return log('    nenhum horário semanal livre para a drenagem');
    const r = await createSeries(api, board, {
      customerId: pkg.customer.id,
      resourceId: plan.pro.id,
      roomId: plan.roomId,
      serviceIds: [drainage.id],
      startsAt: atDate(plan.date, plan.start),
      notes: 'Pós-operatório: drenagem toda semana no mesmo horário.',
      recurrence: { frequency: 'weekly', count: 6 },
    });
    log(`    ${pkg.customer.name} com ${plan.pro.name}: ${seriesSummary(r)}`);
  });

  // Próximos dias: procedimentos que exigem sala, cada um com a sala reservada, sem sobrepor.
  await step(log, 'atendimentos com sala nos próximos dias', async () => {
    const packages = await api.get('/aesthetics/packages', { status: 'active' });
    const packaged = new Set(packages.map((p) => `${p.customer.id}|${p.service.id}`));
    const items = [];
    for (const n of openDays(pros, 4)) {
      const date = day(n);
      const notBefore = n === 0 ? nowMin() + 30 : 0;
      for (const names of rng.shuffle(AES_DEMANDS).slice(0, rng.int(3, 5))) {
        const svc = names.map((x) => services.get(x));
        if (svc.some((s) => !s)) continue;
        const dur = durationOf(svc);
        const candidates = eligibleRooms(rooms, svc);
        if (!candidates.length) continue;
        const prefer = rng.pick([9, 10, 11, 14, 15, 16, 17]) * 60;
        for (const pro of rng.shuffle(pros.filter((p) => svc.every((s) => p.serviceIds.includes(s.id))))) {
          const slot = findSlot(board, { pro, date, dur, prefer, rooms: candidates, notBefore });
          if (!slot) continue;
          const customer = rng.shuffle(people).find((c) => board.clientFree(c.id, date) && !svc.some((s) => packaged.has(`${c.id}|${s.id}`)));
          if (!customer) break;
          board.add(pro.id, date, slot.start, slot.start + dur);
          board.add(slot.roomId, date, slot.start, slot.start + dur);
          board.addClient(customer.id, date);
          items.push({
            customerId: customer.id,
            resourceId: pro.id,
            roomId: slot.roomId,
            serviceIds: svc.map((s) => s.id),
            date,
            start: slot.start,
            status: n <= 1 && rng.chance(0.6) ? 'confirmed' : 'scheduled',
          });
          break;
        }
      }
    }
    log(`    atendimentos com sala: ${describe(await book(api, items))}`);
  });
}

// ---- Clínica ortodôntica -----------------------------------------------------------------------

const CHAIR = [
  'Avaliação ortodôntica',
  'Instalação de aparelho',
  'Manutenção mensal',
  'Colagem de bráquete',
  'Remoção de aparelho',
  'Contenção',
  'Controle de contenção',
  'Consulta de urgência',
  'Troca de alinhadores',
];
// Cada ortodontista atende numa cadeira; o scanner é um só e fica na sala de documentação.
const ORTHO_ROOMS = [
  { name: 'Consultório 1', color: '#0369a1', services: CHAIR },
  { name: 'Consultório 2', color: '#4338ca', services: CHAIR },
  { name: 'Consultório 3', color: '#7e22ce', services: CHAIR },
  { name: 'Scanner intraoral', color: '#ca8a04', services: ['Escaneamento intraoral'] },
];
const ORTHO_DEMANDS = [
  { names: ['Manutenção mensal'], who: 'treatment' },
  { names: ['Manutenção mensal'], who: 'treatment' },
  { names: ['Troca de alinhadores'], who: 'treatment' },
  { names: ['Consulta de urgência'], who: 'treatment', notes: 'Fio do aparelho machucando a bochecha.' },
  { names: ['Avaliação ortodôntica'], who: 'new' },
  { names: ['Escaneamento intraoral'], who: 'new' },
  { names: ['Controle de contenção'], who: 'any' },
];
const ORTHO_SERIES_NOTE = 'Manutenção mensal fixa (série mensal).';

async function orthodontics(ctx) {
  const { api, log, tenant } = ctx;
  const rng = createRng(`${tenant.name}:agenda`);
  const people = ctx.customers.filter((c) => c.type === 'person');
  if (!people.length) return log('  ✗ agenda: sem pacientes');

  await step(log, 'consultórios e scanner', () => ensureRooms(api, log, ORTHO_ROOMS));
  const agenda = await step(log, 'agenda atual', async () => loadAgenda(api));
  if (!agenda) return;
  const { pros, rooms, services, appointments, board } = agenda;
  const treatments = (await step(log, 'tratamentos', () => api.get('/orthodontics/treatments'))) ?? [];
  const inTreatment = new Set(treatments.filter((t) => t.status === 'active').map((t) => t.customer.id));
  const everTreated = new Set(treatments.map((t) => t.customer.id));

  // Manutenção todo mês no mesmo dia, para um paciente em tratamento (sai a R$ 0: está na mensalidade).
  await step(log, 'manutenção mensal com repetição', async () => {
    if (appointments.some((a) => a.seriesId && a.notes === ORTHO_SERIES_NOTE)) return log('    série mensal já existe');
    const maintenance = services.get('Manutenção mensal');
    if (!maintenance) return log('    sem o procedimento Manutenção mensal');
    const patient = people.find((c) => inTreatment.has(c.id) && !appointments.some((a) => a.seriesId && a.customer.id === c.id));
    if (!patient) return log('    nenhum paciente em tratamento disponível');
    // Começa depois da próxima visita já marcada (com folga de 3 semanas).
    const last = appointments
      .filter((a) => a.customer.id === patient.id && !RELEASED.has(a.status))
      .map((a) => daysFromToday(local(a.startsAt).date))
      .reduce((m, n) => Math.max(m, n), 0);
    const first = Math.max(21, last + 21);
    const plan = planSeries(board, {
      pros: pros.filter((p) => p.serviceIds.includes(maintenance.id)),
      startDays: Array.from({ length: 14 }, (_, i) => first + i),
      times: [9, 10, 14, 15, 16, 8].map((h) => h * 60),
      dur: durationOf([maintenance]),
      frequency: 'monthly',
      count: 6,
      rooms: eligibleRooms(rooms, [maintenance]),
    });
    if (!plan) return log('    nenhum horário mensal livre');
    const r = await createSeries(api, board, {
      customerId: patient.id,
      resourceId: plan.pro.id,
      roomId: plan.roomId,
      serviceIds: [maintenance.id],
      startsAt: atDate(plan.date, plan.start),
      notes: ORTHO_SERIES_NOTE,
      recurrence: { frequency: 'monthly', count: 6 },
    });
    log(`    ${patient.name} com ${plan.pro.name}: ${seriesSummary(r)}`);
  });

  await step(log, 'atendimentos com consultório nos próximos dias', async () => {
    const pools = {
      treatment: people.filter((c) => inTreatment.has(c.id)),
      new: people.filter((c) => !everTreated.has(c.id)),
      any: people,
    };
    const items = [];
    for (const n of openDays(pros, 4)) {
      const date = day(n);
      const notBefore = n === 0 ? nowMin() + 30 : 0;
      for (const demand of rng.shuffle(ORTHO_DEMANDS).slice(0, rng.int(3, 4))) {
        const svc = demand.names.map((x) => services.get(x));
        if (svc.some((s) => !s)) continue;
        const dur = durationOf(svc);
        const candidates = eligibleRooms(rooms, svc);
        if (!candidates.length) continue;
        const pool = pools[demand.who].length ? pools[demand.who] : people;
        const prefer = rng.pick([8, 9, 10, 11, 14, 15, 16, 17]) * 60;
        for (const pro of rng.shuffle(pros.filter((p) => svc.every((s) => p.serviceIds.includes(s.id))))) {
          const slot = findSlot(board, { pro, date, dur, prefer, rooms: candidates, notBefore });
          if (!slot) continue;
          const customer = rng.shuffle(pool).find((c) => board.clientFree(c.id, date));
          if (!customer) break;
          board.add(pro.id, date, slot.start, slot.start + dur);
          board.add(slot.roomId, date, slot.start, slot.start + dur);
          board.addClient(customer.id, date);
          items.push({
            customerId: customer.id,
            resourceId: pro.id,
            roomId: slot.roomId,
            serviceIds: svc.map((s) => s.id),
            date,
            start: slot.start,
            status: n <= 1 && rng.chance(0.6) ? 'confirmed' : 'scheduled',
            notes: demand.notes ?? null,
          });
          break;
        }
      }
    }
    log(`    atendimentos com consultório: ${describe(await book(api, items))}`);
  });
}

// ---- Salão de beleza ---------------------------------------------------------------------------

/** Clientes a mais do salão: a agenda da manhã cheia precisa de mais gente que os 8 do seed comum. */
const SALON_CLIENTS = [
  'Adriana Moraes Lima', 'Cláudia Ferraz Rocha', 'Débora Sampaio Dias', 'Elaine Cardoso Gomes', 'Fabiana Queiroz Martins',
  'Gisele Andrade Costa', 'Ingrid Fontes Ribeiro', 'Jéssica Monteiro Silva', 'Kátia Rezende Souza', 'Lúcia Pacheco Almeida',
  'Marcos Vidal Teixeira', 'Sérgio Toledo Barbosa', 'Tânia Brandão Lima', 'Viviane Prates Santos',
];
const MIN_SALON_PEOPLE = 22;

// Combinações rápidas, que cabem numa manhã, com o peso de cada uma.
const MORNING_COMBOS = [
  [10, ['Escova']],
  [8, ['Corte feminino']],
  [5, ['Corte feminino', 'Escova']],
  [5, ['Hidratação', 'Escova']],
  [3, ['Coloração']],
  [7, ['Corte masculino']],
  [6, ['Corte masculino', 'Barba']],
  [4, ['Barba']],
  [12, ['Manicure']],
  [10, ['Manicure', 'Pedicure']],
  [6, ['Pedicure']],
  [3, ['Unha em gel']],
  [6, ['Design de sobrancelha']],
  [3, ['Sobrancelha com henna']],
  [3, ['Maquiagem social']],
  [2, ['Penteado']],
];
const SALON_NOTES = ['Prefere água morna.', 'Pediu para avisar se vagar horário mais cedo.', 'Vai a um evento à noite.', 'Quer manter o comprimento, só pontas.'];
const SALON_SERIES = [
  { mark: 'Cliente fixa: escova toda semana no mesmo horário.', names: ['Escova'], frequency: 'weekly', count: 8, weekdays: [5, 6, 4], times: [9 * 60, 9 * 60 + 30, 10 * 60] },
  { mark: 'Mão e pé a cada 15 dias, horário fixo.', names: ['Manicure', 'Pedicure'], frequency: 'biweekly', count: 6, weekdays: [4, 3, 2], times: [9 * 60, 10 * 60, 9 * 60 + 30] },
];

async function salon(ctx) {
  const { api, log, tenant } = ctx;
  const rng = createRng(`${tenant.name}:agenda`);

  const people = await step(log, 'clientes da agenda', async () => {
    const list = (await api.get('/customers', { limit: 100 })).items;
    const persons = list.filter((c) => c.type === 'person');
    const names = new Set(list.map((c) => c.name));
    let created = 0;
    for (const name of SALON_CLIENTS) {
      if (persons.length >= MIN_SALON_PEOPLE) break;
      if (names.has(name)) continue;
      const c = await api
        .post('/customers', {
          type: 'person',
          name,
          document: rng.cpf(),
          email: `${slugify(name)}@example.com`,
          phone: rng.phone(),
          birthDate: `${rng.int(1965, 2002)}-${pad(rng.int(1, 12))}-${pad(rng.int(1, 28))}`,
          address: { zip: `0${rng.int(1000, 5999)}${rng.int(100, 999)}`, street: rng.pick(STREETS), number: String(rng.int(10, 2500)), district: rng.pick(DISTRICTS), city: 'São Paulo', state: 'SP' },
          notes: null,
        })
        .catch((err) => (err.status === 409 ? null : Promise.reject(err)));
      if (!c) continue;
      persons.push(c);
      created++;
    }
    log(`    ${created} clientes criados, ${persons.length} pessoas no total`);
    return persons;
  });
  if (!people?.length) return;

  const agenda = await step(log, 'agenda atual', async () => loadAgenda(api));
  if (!agenda) return;
  const { pros, services, appointments, board } = agenda;

  // Clientes com horário fixo: a série inteira marcada de uma vez.
  await step(log, 'horários com repetição', async () => {
    const used = new Set(appointments.filter((a) => a.seriesId).map((a) => a.customer.id));
    for (const [i, def] of SALON_SERIES.entries()) {
      if (appointments.some((a) => a.seriesId && a.notes === def.mark)) {
        log(`    ${def.names.join(' + ')}: série já existe`);
        continue;
      }
      const svc = def.names.map((x) => services.get(x));
      if (svc.some((s) => !s)) continue;
      const customer = people.slice(2 + i * 3).concat(people).find((c) => !used.has(c.id));
      if (!customer) continue;
      // Próximas ocorrências dos dias da semana preferidos (a partir de amanhã).
      const startDays = def.weekdays.flatMap((wd) => {
        for (let n = 1; n <= 7; n++) if (weekdayOfDate(day(n)) === wd) return [n];
        return [];
      });
      const plan = planSeries(board, {
        pros: pros.filter((p) => svc.every((s) => p.serviceIds.includes(s.id))),
        startDays,
        times: def.times,
        dur: durationOf(svc),
        frequency: def.frequency,
        count: def.count,
      });
      if (!plan) {
        log(`    ${def.names.join(' + ')}: nenhum horário livre`);
        continue;
      }
      const r = await createSeries(api, board, {
        customerId: customer.id,
        resourceId: plan.pro.id,
        serviceIds: svc.map((s) => s.id),
        startsAt: atDate(plan.date, plan.start),
        notes: def.mark,
        recurrence: { frequency: def.frequency, count: def.count },
      });
      used.add(customer.id);
      log(`    ${def.names.join(' + ')} (${def.frequency}) para ${customer.name} com ${plan.pro.name}: ${seriesSummary(r)}`);
    }
  });

  // Manhãs (9h–12h) de hoje e dos próximos dias úteis: cada profissional com a agenda cheia.
  // Hoje, o que já passou fica concluído (e quase sempre pago); o que está rolando, em atendimento.
  await step(log, 'manhãs cheias no salão', async () => {
    const combos = MORNING_COMBOS.map(([w, names]) => [w, names.map((n) => services.get(n))]).filter(([, svc]) => svc.every(Boolean));
    const items = [];
    for (const n of openDays(pros, 4)) {
      const date = day(n);
      for (const pro of pros) {
        for (const [from, to] of windowsOn(pro, date, 9 * 60, 12 * 60)) {
          let cursor = from;
          while (cursor < to) {
            const fitting = combos.filter(([, svc]) => {
              const dur = durationOf(svc);
              return cursor + dur <= to && svc.every((s) => pro.serviceIds.includes(s.id)) && board.free(pro.id, date, cursor, cursor + dur);
            });
            const customer = fitting.length ? rng.shuffle(people).find((c) => board.clientFree(c.id, date)) : null;
            if (!fitting.length || !customer) {
              cursor += 15;
              continue;
            }
            const svc = weighted(rng, fitting);
            const dur = durationOf(svc);
            board.add(pro.id, date, cursor, cursor + dur);
            board.addClient(customer.id, date);
            const status = n === 0 ? statusAt(date, cursor, dur, rng.chance(0.05) ? 'no_show' : 'done', 'confirmed') : n === 1 && rng.chance(0.7) ? 'confirmed' : 'scheduled';
            items.push({
              customerId: customer.id,
              resourceId: pro.id,
              serviceIds: svc.map((s) => s.id),
              date,
              start: cursor,
              status,
              notes: rng.chance(0.12) ? rng.pick(SALON_NOTES) : null,
              // Um ou outro concluído fica em aberto, para aparecer em "a receber".
              pay: status === 'done' && rng.chance(0.9) ? { method: weighted(rng, PAY_METHODS) } : null,
            });
            // De vez em quando sobra um intervalo de 15 min entre um cliente e outro.
            cursor += dur + (rng.chance(0.2) ? 15 : 0);
          }
        }
      }
    }
    log(`    manhãs: ${describe(await book(api, items))}`);
  });
}
