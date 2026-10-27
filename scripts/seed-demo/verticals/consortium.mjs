// Corretora de consórcio: planos sincronizados das administradoras (simuladas), cotas vendidas
// para a carteira em vários status e assembleias com contemplação por sorteio e por lance.
import { day, sleep, step, workday } from '../lib.mjs';
import { applicantFor, ensureConnections, pickers } from './_banking.mjs';

const ADMINS = [
  { name: 'Bandeirante Consórcios (simulação)', products: ['consortium'] },
  { name: 'Rota Consórcios (simulação)', products: ['consortium'] },
];

/**
 * Vendas na ordem do número da cota: `admin` indexa as administradoras ativas; `outcome` é o desfecho da adesão
 * (approved = ativa; pending = fica em análise; cancelled = cancelada pela corretora; rejected = recusada).
 */
const SALES = [
  { who: 'p0', plan: 'Auto 60 mil', admin: 0, outcome: 'approved', dueDay: 10, income: 6500 },
  { who: 'p1', plan: 'Imóvel 250 mil', admin: 1, outcome: 'approved', dueDay: 5, income: 11000 },
  { who: 'p2', plan: 'Auto 100 mil', admin: 0, outcome: 'approved', dueDay: 15, income: 9000 },
  { who: 'p3', plan: 'Imóvel 500 mil', admin: 1, outcome: 'approved', dueDay: 20, income: 22000 },
  { who: 'c0', plan: 'Pesados 300 mil', admin: 0, outcome: 'approved', dueDay: 10, income: 85000 },
  { who: 'p4', plan: 'Serviços 20 mil', admin: 1, outcome: 'approved', dueDay: 25, income: 4800 },
  { who: 'p5', plan: 'Auto 60 mil', admin: 1, outcome: 'approved', dueDay: 10, income: 7200 },
  { who: 'p6', plan: 'Imóvel 250 mil', admin: 0, outcome: 'pending', dueDay: 15, income: 12500 },
  { who: 'p7', plan: 'Auto 100 mil', admin: 1, outcome: 'cancelled', dueDay: 10, income: 8000, reason: 'Cliente desistiu antes de pagar a primeira parcela' },
  { who: 'c1', plan: 'Auto 60 mil', admin: 0, outcome: 'rejected', dueDay: 5, income: 30000 },
];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log } = ctx;
  await step(log, 'administradoras de consórcio (simulação)', () => ensureConnections(api, log, ADMINS, { product: 'consortium', min: 2 }));
  const plans = await step(log, 'planos (sincronizados das administradoras)', () => syncPlans(ctx));
  if (!plans?.length) return;
  const quotas = await step(log, 'cotas vendidas', () => sellQuotas(ctx, plans));
  if (!quotas) return;
  await step(log, 'assembleias e contemplações', () => seedAssemblies(ctx));
}

async function syncPlans({ api, log }) {
  let plans = await api.get('/consortium/plans');
  if (plans.length >= 10) {
    log(`    já tem ${plans.length} planos`);
    return plans;
  }
  plans = await api.post('/consortium/plans/sync');
  log(`    ${plans.length} planos de ${new Set(plans.map((p) => p.institution)).size} administradoras`);
  return plans;
}

async function sellQuotas(ctx, plans) {
  const { api, rng, log } = ctx;
  const who = pickers(ctx.customers);
  const institutions = [...new Set(plans.map((p) => p.connectionId))];
  const planFor = (s) => {
    const same = plans.filter((p) => p.name === s.plan);
    return same.find((p) => p.connectionId === institutions[s.admin % institutions.length]) ?? same[0] ?? plans[0];
  };

  const quotas = (await api.get('/consortium/quotas')).sort((a, b) => a.number - b.number);
  for (const s of SALES.slice(quotas.length)) {
    const customer = who(s.who);
    quotas.push(await api.post('/consortium/quotas', { customerId: customer.id, planId: planFor(s).id, dueDay: s.dueDay, applicant: await applicantFor(api, rng, customer, s.income) }));
  }
  log(`    ${quotas.length} cotas na carteira`);

  // Desfecho das adesões ainda em análise. A cota só fica ativa quando o evento da proposta é processado (fila assíncrona).
  const waiting = [];
  for (const [i, s] of SALES.entries()) {
    const q = quotas[i];
    if (!q || q.status !== 'proposal' || s.outcome === 'pending') continue;
    const [p] = await api.get('/banking/proposals', { sourceType: 'consortium_quota', sourceId: q.id });
    if (s.outcome === 'cancelled') {
      await api.post(`/consortium/quotas/${q.id}/cancel`, { reason: s.reason });
      if (p && ['submitted', 'under_review', 'approved'].includes(p.status)) await api.post(`/banking/proposals/${p.id}/status`, { status: 'cancelled', message: s.reason });
      continue;
    }
    if (s.outcome === 'rejected') {
      // A administradora simulada sempre aceita; a proposta cancelada faz a cota cair em "Adesão recusada".
      if (p && ['submitted', 'under_review', 'approved'].includes(p.status)) await api.post(`/banking/proposals/${p.id}/status`, { status: 'cancelled', message: 'Documentação do CNPJ reprovada pela administradora' });
    } else if (p && ['submitted', 'under_review'].includes(p.status)) {
      await api.post(`/banking/proposals/${p.id}/refresh`);
    }
    waiting.push(q.id);
  }
  if (waiting.length) await waitProcessed(api, log, waiting);
  return quotas;
}

/** Espera a fila de eventos tirar as cotas de "em análise" (em produção roda a cada minuto). */
async function waitProcessed(api, log, ids) {
  for (let i = 0; i < 36; i++) {
    const open = (await api.get('/consortium/quotas', { status: 'proposal' })).filter((q) => ids.includes(q.id));
    if (!open.length) return log(`    ${ids.length} adesões processadas`);
    await sleep(5000);
  }
  log('    algumas adesões ainda em análise: rode o seed de novo em alguns minutos para lançar as assembleias');
}

async function seedAssemblies({ api, rng, log }) {
  const existing = await api.get('/consortium/assemblies');
  if (existing.length >= 5) return log(`    já tem ${existing.length} assembleias`);

  const quotas = (await api.get('/consortium/quotas'))
    .filter((q) => q.groupCode && q.quotaNumber && ['active', 'contemplated'].includes(q.status))
    .sort((a, b) => a.number - b.number);
  if (quotas.length < 3) throw new Error(`só ${quotas.length} cotas ativas com grupo; rode de novo depois que as adesões forem processadas`);

  // Assembleias mensais; a "próxima" fica anotada no resultado mais recente de cada grupo.
  const [d75, d45, d15] = [workday(-75), workday(-45), workday(-15)].map(day);
  const next = brDate(day(workday(15)));
  const plan = [
    { q: quotas[0], heldOn: d75, ours: 'draw' },
    { q: quotas[0], heldOn: d45 },
    { q: quotas[1], heldOn: d45, ours: 'bid', percent: 38 },
    { q: quotas[2], heldOn: d15, ours: 'draw' },
    { q: quotas[3] ?? quotas[1], heldOn: d15 },
    { q: quotas[4] ?? quotas[2], heldOn: d45 },
  ];
  const latest = new Map();
  for (const a of plan) if ((latest.get(a.q.groupCode) ?? '') < a.heldOn) latest.set(a.q.groupCode, a.heldOn);

  let created = 0;
  const done = new Set(existing.map((e) => `${e.groupCode}|${e.heldOn}`));
  for (const a of plan) {
    const group = a.q.groupCode;
    // Duas cotas podem cair no mesmo grupo: uma assembleia por grupo e data.
    if (done.has(`${group}|${a.heldOn}`)) continue;
    done.add(`${group}|${a.heldOn}`);
    const taken = new Set(quotas.filter((q) => q.groupCode === group).map((q) => q.quotaNumber));
    const other = () => {
      for (;;) {
        const n = String(rng.int(1, 400)).padStart(3, '0');
        if (!taken.has(n)) return taken.add(n), n;
      }
    };
    const drawn = [a.ours === 'draw' ? a.q.quotaNumber : other(), other()];
    const bids = a.ours === 'bid' ? [{ quotaNumber: a.q.quotaNumber, percent: a.percent }, { quotaNumber: other(), percent: 35 }] : [{ quotaNumber: other(), percent: rng.int(30, 55) }];
    const notes = latest.get(group) === a.heldOn ? `Próxima assembleia: ${next}.` : null;
    await api.post('/consortium/assemblies', { groupCode: group, heldOn: a.heldOn, drawn, bids, notes });
    created++;
  }
  log(`    ${created} assembleias lançadas`);
}

const brDate = (iso) => iso.split('-').reverse().join('/');
