// Peças comuns da agenda para salão, estética e ortodontia: serviços, profissionais com
// expediente, distribuição de horários sem sobreposição e avanço de status pelos endpoints reais.
import { at, day } from '../lib.mjs';

/** Dia da semana (0 = domingo) de day(n), no fuso de Brasília. */
export const weekdayOf = (n) => new Date(`${day(n)}T12:00:00-03:00`).getUTCDay();

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Expediente igual em vários dias da semana: hours([2,3,4,5], ['09:00','13:00'], ['14:00','19:00']). */
export function hours(weekdays, ...windows) {
  return weekdays.flatMap((weekday) => windows.map(([start, end]) => ({ weekday, start, end })));
}

/** Escolha ponderada: [[peso, valor], ...]. */
export function weighted(rng, list) {
  const total = list.reduce((s, [w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [w, v] of list) if ((r -= w) < 0) return v;
  return list[list.length - 1][1];
}

export const round2 = (v) => Math.round(v * 100) / 100;

const localDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
/** Instante ISO → 'YYYY-MM-DD' em Brasília. */
export const localDate = (iso) => localDateFmt.format(new Date(iso));
/** Instante ISO → 'DD/MM/AAAA' em Brasília. */
export const brDate = (iso) => localDate(iso).split('-').reverse().join('/');

/** Serviços da agenda por nome: cria só os que faltam (os do módulo já vêm ao ativar o setor). */
export async function ensureServices(api, log, defs) {
  const existing = await api.get('/scheduling/services');
  const byName = new Map(existing.map((s) => [s.name, s]));
  let created = 0;
  for (const d of defs) {
    if (byName.has(d.name)) continue;
    const body = { bufferMin: 0, online: true, active: true, category: null, description: null, ...d };
    const { id } = await api.post('/scheduling/services', body);
    byName.set(d.name, { ...body, id, resourceIds: [] });
    created++;
  }
  log(`    serviços: ${created} criados, ${byName.size} no total`);
  return byName;
}

/**
 * Profissionais por nome (ou usuário vinculado). Os marcados com `linkRoles` usam o nome de um
 * usuário convidado com aquele papel, para "minha agenda" funcionar com quem entrar.
 */
export async function ensureResources(api, log, defs, { servicesByName, users }) {
  const existing = await api.get('/scheduling/resources');
  let userIdByMembership = new Map();
  try {
    const members = await api.get('/users');
    userIdByMembership = new Map(members.map((m) => [m.membershipId, m.user.id]));
  } catch {
    // Sem permissão para listar a equipe: segue sem vínculo de usuário.
  }
  const taken = new Set();
  const out = {};
  let created = 0;
  for (const d of defs) {
    const user = d.linkRoles
      ? users.find((u) => !taken.has(u.membershipId) && u.roleKeys.some((k) => d.linkRoles.includes(k)) && userIdByMembership.has(u.membershipId))
      : null;
    if (user) taken.add(user.membershipId);
    const userId = user ? userIdByMembership.get(user.membershipId) : null;
    const name = user ? user.name : d.name;
    const found = existing.find((r) => (userId && r.userId === userId) || r.name === name);
    if (found) {
      out[d.key] = found;
      continue;
    }
    const serviceIds = d.services.map((n) => {
      const s = servicesByName.get(n);
      if (!s) throw new Error(`serviço "${n}" não encontrado para ${name}`);
      return s.id;
    });
    const { id } = await api.post('/scheduling/resources', { name, kind: d.kind ?? 'professional', userId, color: d.color, active: true, serviceIds });
    await api.put(`/scheduling/resources/${id}/hours`, { hours: d.hours });
    out[d.key] = { id, name, kind: d.kind ?? 'professional', userId, color: d.color, active: true, serviceIds, hours: d.hours };
    created++;
  }
  log(`    profissionais: ${created} criados, ${Object.keys(out).length} no seed (${Object.values(out).filter((r) => r.userId).length} ligados a usuários)`);
  return out;
}

/** Bloqueios (folga, curso, congresso): cria se o profissional ainda não tem nenhum no período. */
export async function ensureTimeOff(api, log, blocks) {
  const from = at(-60, 0);
  const to = at(60, 0);
  const existing = await api.get('/scheduling/time-off', { from, to });
  let created = 0;
  for (const b of blocks) {
    if (existing.some((t) => t.resourceId === b.resource.id)) continue;
    await api.post(`/scheduling/resources/${b.resource.id}/time-off`, { startsAt: b.startsAt, endsAt: b.endsAt, reason: b.reason });
    created++;
  }
  log(`    bloqueios: ${created} criados`);
}

/** Liga o agendamento online (página pública /agendar/<slug>) se ainda estiver desligado. */
export async function enableOnlineBooking(api, log) {
  const current = await api.get('/modules/shared.scheduling/settings');
  if (current.onlineBooking) return log('    agendamento online já ligado');
  await api.put('/modules/shared.scheduling/settings', { ...current, onlineBooking: true });
  log('    agendamento online ligado');
}

/**
 * Distribui horários sem sobreposição dentro do expediente de cada profissional (passos de 15 min),
 * e evita o mesmo cliente duas vezes no mesmo dia.
 */
export function createPlanner() {
  const busy = new Map();
  const customerDays = new Set();
  const windowsOf = (resource, n) =>
    resource.hours
      .filter((h) => h.weekday === weekdayOf(n))
      .map((h) => ({ start: toMin(h.start), end: toMin(h.end) }))
      .sort((a, b) => a.start - b.start);

  return {
    works: (resource, n) => windowsOf(resource, n).length > 0,
    /** Dia inteiro ocupado (bloqueio). */
    block(resource, n) {
      busy.set(`${resource.id}|${n}`, [[0, 24 * 60]]);
    },
    customerFree: (customerId, n) => !customerDays.has(`${customerId}|${n}`),
    /** Primeiro horário livre a partir de `prefer` (minutos do dia); volta ao início do dia se preciso. */
    take(resource, n, durationMin, prefer = 0, customerId = null) {
      if (customerId && customerDays.has(`${customerId}|${n}`)) return null;
      const key = `${resource.id}|${n}`;
      const list = busy.get(key) ?? [];
      const starts = windowsOf(resource, n).flatMap((w) => {
        const out = [];
        for (let s = w.start; s + durationMin <= w.end; s += 15) out.push(s);
        return out;
      });
      const ordered = [...starts.filter((s) => s >= prefer), ...starts.filter((s) => s < prefer)];
      for (const s of ordered) {
        if (list.some(([a, b]) => a < s + durationMin && b > s)) continue;
        list.push([s, s + durationMin]);
        busy.set(key, list);
        if (customerId) customerDays.add(`${customerId}|${n}`);
        return { n, startsAt: at(n, Math.floor(s / 60), s % 60) };
      }
      return null;
    },
    /**
     * Horário perto do dia `n`: procura para trás em datas passadas e para frente nas futuras,
     * até achar um dia em que o profissional atende e há espaço.
     */
    near(resource, n, durationMin, prefer, customerId) {
      const dir = n < 0 ? -1 : 1;
      for (let i = 0; i < 10; i++) {
        const d = n + dir * i;
        if (n < 0 && d >= 0) break;
        const slot = this.take(resource, d, durationMin, prefer, customerId);
        if (slot) return slot;
      }
      throw new Error(`sem horário para ${resource.name} perto do dia ${day(n)}`);
    },
  };
}

/** Duração ocupada na agenda (serviço + intervalo), como o servidor calcula. */
export const durationOf = (services) => services.reduce((s, x) => s + x.durationMin + (x.bufferMin ?? 0), 0);

/**
 * Status certo para o momento em que o seed roda: atendimento que já terminou fica com o
 * status "passado"; em andamento vira "em atendimento"; o resto fica com o status "futuro".
 */
export function statusAt(startsAt, durationMin, past, future) {
  const start = Date.parse(startsAt);
  const end = start + durationMin * 60_000;
  const now = Date.now();
  if (end <= now) return past;
  if (start <= now) return past === 'done' ? 'in_service' : future;
  return future;
}

const PATHS = {
  scheduled: [],
  confirmed: ['confirmed'],
  arrived: ['confirmed', 'arrived'],
  in_service: ['confirmed', 'arrived', 'in_service'],
  done: ['confirmed', 'done'],
  no_show: ['no_show'],
  cancelled: ['cancelled'],
};

/**
 * Cria os atendimentos do plano (pula os que já existem: mesmo profissional e horário), leva cada
 * um até o status pedido e registra o pagamento dos concluídos.
 * Item: { customerId, resourceId, serviceIds, startsAt, status, reason?, notes?, pay?: { method, amount? } }
 */
export async function applyAppointments(api, plan) {
  if (!plan.length) return { results: [], stats: { created: 0, existing: 0, conflicts: 0, paid: 0, status: {} } };
  const times = plan.map((p) => Date.parse(p.startsAt));
  const existing = await api.get('/scheduling/appointments', {
    from: new Date(Math.min(...times) - 86_400_000).toISOString(),
    to: new Date(Math.max(...times) + 86_400_000).toISOString(),
  });
  const keyOf = (resourceId, startsAt) => `${resourceId}|${Date.parse(startsAt)}`;
  const byKey = new Map(existing.map((a) => [keyOf(a.resourceId, a.startsAt), a]));
  const accounts = await api.get('/scheduling/payment-accounts');
  const cash = accounts.find((a) => a.type === 'cash') ?? accounts[0];
  const bank = accounts.find((a) => a.type === 'bank') ?? cash;

  const stats = { created: 0, existing: 0, conflicts: 0, paid: 0, status: {} };
  const results = [];
  for (const item of plan) {
    let a = byKey.get(keyOf(item.resourceId, item.startsAt));
    if (a) stats.existing++;
    else {
      try {
        a = await api.post('/scheduling/appointments', {
          customerId: item.customerId,
          resourceId: item.resourceId,
          startsAt: item.startsAt,
          serviceIds: item.serviceIds,
          notes: item.notes ?? null,
        });
        stats.created++;
      } catch (err) {
        // Horário já ocupado por algo criado fora deste plano: segue com o resto.
        if (err.status === 409) {
          stats.conflicts++;
          continue;
        }
        throw err;
      }
    }

    const steps = PATHS[item.status] ?? [];
    const idx = steps.indexOf(a.status);
    const remaining = a.status === 'scheduled' ? steps : idx >= 0 ? steps.slice(idx + 1) : [];
    for (const status of remaining) {
      a = await api.post(`/scheduling/appointments/${a.id}/status`, { status, reason: status === 'cancelled' ? item.reason ?? 'Cliente pediu para desmarcar' : null });
    }

    if (item.pay && a.status === 'done') {
      const outstanding = round2(a.total - a.paidAmount);
      const amount = round2(Math.min(item.pay.amount ?? outstanding, outstanding));
      if (amount > 0) {
        a = await api.post(`/scheduling/appointments/${a.id}/payments`, {
          amount,
          method: item.pay.method,
          accountId: (item.pay.method === 'cash' ? cash : bank).id,
          paidAt: localDate(a.startsAt),
        });
        stats.paid++;
      }
    }
    stats.status[a.status] = (stats.status[a.status] ?? 0) + 1;
    results.push({ item, appointment: a });
  }
  return { results, stats };
}

export const PAY_METHODS = [
  [40, 'pix'],
  [30, 'credit_card'],
  [18, 'debit_card'],
  [12, 'cash'],
];

/** Resumo legível das contagens por status. */
export const describeStats = (s) =>
  `${s.created} criados, ${s.existing} já existiam${s.conflicts ? `, ${s.conflicts} conflitos pulados` : ''}, ${s.paid} pagamentos — ` +
  Object.entries(s.status)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

/** Prontuário: grava os registros do paciente só se ele ainda não tiver nenhum. */
export async function ensureRecords(api, customerId, entries) {
  const existing = await api.get('/medical-records', { subjectType: 'customer', subjectId: customerId });
  if (existing.length) return 0;
  for (const e of entries) {
    await api.post('/medical-records', { subjectType: 'customer', subjectId: customerId, formKey: e.formKey, data: e.data, notes: e.notes ?? null, appointmentId: e.appointmentId ?? null });
  }
  return entries.length;
}

/** Atendimentos concluídos por cliente (para ligar evoluções do prontuário a eles). */
export async function doneByCustomer(api, fromDay, toDay) {
  const list = await api.get('/scheduling/appointments', { from: at(fromDay, 0), to: at(toDay, 23, 59) });
  const map = new Map();
  for (const a of list.filter((x) => x.status === 'done')) {
    if (!map.has(a.customer.id)) map.set(a.customer.id, []);
    map.get(a.customer.id).push(a);
  }
  return map;
}
