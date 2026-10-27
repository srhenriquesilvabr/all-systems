// Salão de beleza (fake-salao): serviços, profissionais com expediente, comissões e agenda de
// 5 semanas para trás e 10 dias para frente, com pagamentos dos atendimentos concluídos.
import { at, createRng, day, step } from '../lib.mjs';
import {
  PAY_METHODS,
  applyAppointments,
  createPlanner,
  describeStats,
  durationOf,
  enableOnlineBooking,
  ensureResources,
  ensureServices,
  ensureTimeOff,
  hours,
  statusAt,
  weekdayOf,
  weighted,
} from './_scheduling-beauty-group.mjs';

// Os 9 primeiros já vêm com o módulo; os demais completam o cardápio de um salão de bairro nobre.
const SERVICES = [
  { name: 'Corte feminino', category: 'Cabelo', durationMin: 60, price: 90 },
  { name: 'Corte masculino', category: 'Cabelo', durationMin: 30, price: 45 },
  { name: 'Escova', category: 'Cabelo', durationMin: 45, price: 60 },
  { name: 'Coloração', category: 'Cabelo', durationMin: 120, price: 180 },
  { name: 'Hidratação', category: 'Cabelo', durationMin: 45, price: 80 },
  { name: 'Barba', category: 'Barbearia', durationMin: 30, price: 35 },
  { name: 'Manicure', category: 'Unhas', durationMin: 45, price: 35 },
  { name: 'Pedicure', category: 'Unhas', durationMin: 45, price: 40 },
  { name: 'Design de sobrancelha', category: 'Estética', durationMin: 30, price: 40 },
  { name: 'Progressiva', category: 'Cabelo', durationMin: 180, bufferMin: 15, price: 350, description: 'Alisamento sem formol. Valor para cabelo até o ombro.' },
  { name: 'Mechas / luzes', category: 'Cabelo', durationMin: 180, bufferMin: 15, price: 420, description: 'Inclui tonalização. Cabelos longos podem ter acréscimo.' },
  { name: 'Penteado', category: 'Cabelo', durationMin: 60, price: 130 },
  { name: 'Unha em gel', category: 'Unhas', durationMin: 90, price: 120, online: false, description: 'Alongamento ou banho de gel. Marcar pelo WhatsApp.' },
  { name: 'Sobrancelha com henna', category: 'Estética', durationMin: 45, price: 55 },
  { name: 'Maquiagem social', category: 'Maquiagem', durationMin: 60, price: 150 },
];

const HAIR = ['Corte feminino', 'Escova', 'Hidratação', 'Penteado'];
const PROS = [
  {
    key: 'carla',
    name: 'Carla Mendes',
    color: '#e11d48',
    linkRoles: ['beauty.professional'],
    services: [...HAIR, 'Coloração', 'Progressiva', 'Mechas / luzes'],
    hours: hours([2, 3, 4, 5], ['09:00', '13:00'], ['14:00', '19:00']).concat(hours([6], ['08:00', '17:00'])),
    commission: { defaultRate: 40, services: { Coloração: 45, 'Mechas / luzes': 45, Progressiva: 45 } },
  },
  {
    key: 'rafael',
    name: 'Rafael Duarte',
    color: '#2563eb',
    linkRoles: ['beauty.professional'],
    services: ['Corte masculino', 'Barba', 'Corte feminino', 'Escova'],
    hours: hours([2, 3, 4, 5], ['10:00', '14:00'], ['15:00', '20:00']).concat(hours([6], ['09:00', '18:00'])),
    commission: { defaultRate: 50, services: {} },
  },
  {
    key: 'juliana',
    name: 'Juliana Prado',
    color: '#9333ea',
    services: ['Coloração', 'Mechas / luzes', 'Progressiva', 'Hidratação', 'Escova'],
    hours: hours([3, 4, 5], ['09:00', '13:00'], ['14:00', '19:00']).concat(hours([6], ['08:00', '16:00'])),
    commission: { defaultRate: 40, services: { Coloração: 50, 'Mechas / luzes': 50 } },
  },
  {
    key: 'simone',
    name: 'Simone Alves',
    color: '#059669',
    services: ['Manicure', 'Pedicure', 'Unha em gel'],
    hours: hours([2, 3, 4, 5], ['09:00', '12:30'], ['13:30', '19:00']).concat(hours([6], ['08:00', '16:00'])),
    commission: { defaultRate: 50, services: { 'Unha em gel': 55 } },
  },
  {
    key: 'patricia',
    name: 'Patrícia Rocha',
    color: '#d97706',
    services: ['Manicure', 'Pedicure', 'Design de sobrancelha', 'Sobrancelha com henna'],
    hours: hours([2, 3, 4, 5, 6], ['10:00', '14:00'], ['15:00', '19:00']),
    commission: { defaultRate: 50, services: { 'Design de sobrancelha': 40, 'Sobrancelha com henna': 40 } },
  },
  {
    key: 'bianca',
    name: 'Bianca Lopes',
    color: '#db2777',
    services: ['Maquiagem social', 'Penteado', 'Design de sobrancelha', 'Escova'],
    hours: hours([4, 5], ['13:00', '20:00']).concat(hours([6], ['08:00', '18:00'])),
    commission: { defaultRate: 45, services: { 'Maquiagem social': 50 } },
  },
];

// Combinações que a recepção marca no dia a dia, com o peso de cada uma.
const COMBOS = [
  [10, ['Corte feminino']],
  [8, ['Corte feminino', 'Escova']],
  [8, ['Escova']],
  [6, ['Coloração']],
  [5, ['Coloração', 'Escova']],
  [5, ['Hidratação', 'Escova']],
  [3, ['Progressiva']],
  [3, ['Mechas / luzes']],
  [7, ['Corte masculino']],
  [6, ['Corte masculino', 'Barba']],
  [12, ['Manicure']],
  [10, ['Manicure', 'Pedicure']],
  [4, ['Unha em gel']],
  [6, ['Design de sobrancelha']],
  [3, ['Sobrancelha com henna']],
  [3, ['Maquiagem social']],
  [2, ['Penteado']],
];

const NOTES = [
  'Cliente prefere lavar com água morna.',
  'Fórmula da última coloração: 7.1 + 6.0, ox 20 vol.',
  'Alergia a esmalte com formaldeído: usar linha hipoalergênica.',
  'Vai a um casamento no sábado.',
  'Quer manter o comprimento, só pontas.',
  'Pediu para avisar se vagar horário mais cedo.',
];
const CANCEL_REASONS = ['Cliente pediu para remarcar', 'Imprevisto no trabalho', 'Cliente doente', 'Chuva forte, não conseguiu vir'];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log, tenant } = ctx;
  // Semente própria: o plano sai igual mesmo que o seed comum consuma o rng de outro jeito.
  const rng = createRng(`${tenant.name}:beauty`);
  const people = ctx.customers.filter((c) => c.type === 'person');

  const services = await step(log, 'serviços do salão', () => ensureServices(api, log, SERVICES));
  if (!services) return;
  const pros = await step(log, 'profissionais e expediente', () => ensureResources(api, log, PROS, { servicesByName: services, users: ctx.users }));
  if (!pros) return;

  await step(log, 'comissões', async () => {
    const rules = await api.get('/beauty/commission-rules');
    let set = 0;
    for (const def of PROS) {
      const r = pros[def.key];
      const current = rules.find((x) => x.resourceId === r.id);
      if (current && (current.defaultRate > 0 || current.services.length)) continue;
      await api.put(`/beauty/commission-rules/${r.id}`, {
        defaultRate: def.commission.defaultRate,
        services: Object.entries(def.commission.services).map(([name, rate]) => ({ serviceId: services.get(name).id, rate })),
      });
      set++;
    }
    log(`    regras de comissão: ${set} definidas`);
  });

  await step(log, 'agendamento online', () => enableOnlineBooking(api, log));

  // Juliana faz um curso de colorimetria na semana que vem (dia inteiro bloqueado).
  const planner = createPlanner();
  let courseDay = 7;
  while (!planner.works(pros.juliana, courseDay)) courseDay++;
  planner.block(pros.juliana, courseDay);
  await step(log, 'bloqueios de agenda', () =>
    ensureTimeOff(api, log, [{ resource: pros.juliana, startsAt: at(courseDay, 8), endsAt: at(courseDay, 20), reason: 'Curso de colorimetria' }]),
  );

  await step(log, 'atendimentos', async () => {
    // Dia a dia: só preenche os dias ainda vazios (uma rodada interrompida é completada sem sobrepor).
    const existing = await api.get('/scheduling/appointments', { from: at(-36, 0), to: at(11, 23, 59) });
    const filled = new Set(existing.map((a) => new Date(a.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })));

    const plan = [];
    const list = Object.values(pros);
    for (let n = -35; n <= 10; n++) {
      if (filled.has(day(n))) continue;
      // Movimento maior no fim de semana; agenda futura vai rareando.
      const sat = weekdayOf(n) === 6;
      const target = n <= 0 ? rng.int(2, 4) + (sat ? 2 : 0) : n <= 4 ? rng.int(2, 4) : rng.int(0, 2);
      for (const customer of rng.shuffle(people).slice(0, target)) {
        const combo = weighted(rng, COMBOS);
        const svc = combo.map((name) => services.get(name));
        const dur = durationOf(svc);
        const prefer = rng.pick([9, 10, 11, 14, 15, 16, 17]) * 60;
        for (const r of rng.shuffle(list.filter((x) => svc.every((s) => x.serviceIds.includes(s.id))))) {
          const slot = planner.take(r, n, dur, prefer, customer.id);
          if (!slot) continue;
          const past = rng.chance(0.06) ? 'no_show' : rng.chance(0.06) ? 'cancelled' : 'done';
          const future = rng.chance(0.05) ? 'cancelled' : n <= 2 && rng.chance(0.6) ? 'confirmed' : 'scheduled';
          const status = statusAt(slot.startsAt, dur, past, future);
          plan.push({
            customerId: customer.id,
            resourceId: r.id,
            serviceIds: svc.map((s) => s.id),
            startsAt: slot.startsAt,
            status,
            reason: rng.pick(CANCEL_REASONS),
            notes: rng.chance(0.15) ? rng.pick(NOTES) : null,
            // Alguns concluídos ficam em aberto para aparecer em "a receber".
            pay: status === 'done' && rng.chance(0.9) ? { method: weighted(rng, PAY_METHODS) } : null,
          });
          break;
        }
      }
    }
    const { results, stats } = await applyAppointments(api, plan);
    log(`    atendimentos: ${describeStats(stats)}`);

    const report = await api.get('/beauty/commissions', { from: day(-30), to: day(0) });
    const total = report.professionals.reduce((s, p) => s + p.commission, 0);
    log(`    comissões dos últimos 30 dias: R$ ${total.toFixed(2)} em ${report.professionals.length} profissionais`);
    return results;
  });
}
