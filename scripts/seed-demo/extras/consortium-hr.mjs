// Acompanhamento do consórcio (grupos, parcelas, inadimplência, lances, comissões e estorno) e
// RH (folhas fechadas, rescisão e 13º) nas empresas de demonstração. Roda depois do setor de cada
// empresa: só completa o que falta, então pode rodar de novo. Nenhuma data de pagamento ou de
// acontecimento fica no futuro.
import { day, sleep, slugify, step } from '../lib.mjs';
import { applicantFor, pickers } from '../verticals/_banking.mjs';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
/** Mesmo dia, ou a próxima segunda se cair no fim de semana. */
const nextWorkday = (iso) => (weekday(iso) === 6 ? addDays(iso, 2) : weekday(iso) === 0 ? addDays(iso, 1) : iso);
/** Mesmo dia, ou a sexta anterior se cair no fim de semana. */
const prevWorkday = (iso) => (weekday(iso) === 6 ? addDays(iso, -1) : weekday(iso) === 0 ? addDays(iso, -2) : iso);
const minDate = (a, b) => (a < b ? a : b);
const round2 = (n) => Math.round(n * 100) / 100;
const brl = (n) => `R$ ${n.toFixed(2)}`;

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seedExtras(ctx) {
  if (ctx.tenant.name === 'fake-consorcio') return seedConsortium(ctx);
  if (ctx.tenant.name === 'fake-rh') return seedHr(ctx);
}

// ---- Consórcio --------------------------------------------------------------------------------

const OPEN = ['active', 'contemplated'];
const COMMISSION = 'Comissão de consórcio';
/** Cota vendida só para mostrar o estorno: ativa, comissão recebida e cancelada dentro do prazo. */
const CLAWBACK = { who: 'c1', plan: 'Auto 100 mil', income: 30000, dueDay: 15, reason: 'Empresa desistiu no 1º mês (troca de frota adiada); comissão estornada pela administradora' };
const GROUP_NOTES = [
  'Assembleias mensais; lance embutido limitado a 30% do crédito.',
  'Lance fixo de 25% para até 5 cotas por assembleia.',
  'Grupo em andamento; administradora divulga o resultado no mesmo dia, às 15h.',
  'Lance livre com recursos próprios ou embutido de até 25%.',
];

async function seedConsortium(ctx) {
  const { log } = ctx;
  const roles = await step(log, 'consórcio: cotas acompanhadas', () => planRoles(ctx));
  if (!roles) return;
  await step(log, 'consórcio: grupos (participantes e prazo)', () => seedGroups(ctx, roles));
  await step(log, 'consórcio: assembleias dos meses anteriores', () => seedPastAssemblies(ctx, roles));
  await step(log, 'consórcio: parcelas e inadimplência', () => seedInstallments(ctx, roles));
  await step(log, 'consórcio: lances e contemplação na assembleia de hoje', () => seedBidRound(ctx, roles));
  await step(log, 'consórcio: próximas assembleias e lances registrados', () => seedNextAssemblies(ctx, roles));
  await step(log, 'consórcio: tabela de comissões', () => seedCommissionTable(ctx));
  await step(log, 'consórcio: vendedores das cotas', () => assignSellers(ctx));
  await step(log, 'consórcio: comissões recebidas', () => payCommissions(ctx));
  await step(log, 'consórcio: estorno de comissão (cota cancelada no prazo)', () => seedClawback(ctx));
}

/**
 * Papéis de cada cota no acompanhamento, escolhidos pelo estado atual:
 * - winner/loser: ativas cujo grupo ainda não teve assembleia neste mês (dão lance na de hoje);
 * - next: outra ativa, com lance registrado para a próxima assembleia;
 * - late: cotas com parcelas em atraso (uma ativa e uma ou duas contempladas, nunca as que dão lance).
 */
async function planRoles({ api, log }) {
  const today = day(0);
  const month = today.slice(0, 7);
  const quotas = (await api.get('/consortium/quotas')).sort((a, b) => a.number - b.number);
  const open = quotas.filter((q) => OPEN.includes(q.status) && q.groupCode && q.quotaNumber);
  if (open.length < 3) throw new Error(`só ${open.length} cotas ativas com grupo; rode o seed do consórcio antes`);
  const assemblies = await api.get('/consortium/assemblies');
  const heldThisMonth = (g) => assemblies.some((a) => a.groupCode === g && a.status === 'held' && a.heldOn.startsWith(month));

  const active = open.filter((q) => q.status === 'active');
  const contemplated = open.filter((q) => q.status === 'contemplated');
  const candidates = active.filter((q) => !heldThisMonth(q.groupCode));
  const [winner, loser] = candidates;
  const rest = active.filter((q) => q !== winner && q !== loser);
  const next = rest[0] ?? null;
  const late = new Map();
  if (rest[1]) late.set(rest[1].id, 2);
  if (contemplated[0]) late.set(contemplated[0].id, 1);
  if (contemplated.length > 2) late.set(contemplated.at(-1).id, 1);

  // Grupos acompanhados: os que já têm lances desta carteira (rodada anterior) ou os das cotas escolhidas agora.
  const bidGroups = [...new Set(assemblies.filter((a) => a.ourBids.length).map((a) => a.groupCode))];
  const tracked = bidGroups.length ? bidGroups : [...new Set([winner, loser, next].filter(Boolean).map((q) => q.groupCode))];

  /** Números das nossas cotas no grupo (qualquer status), para os sorteados de fora não caírem nelas. */
  const numbers = (g) => new Set(quotas.filter((q) => q.groupCode === g && q.quotaNumber).map((q) => q.quotaNumber));
  log(`    ${open.length} cotas abertas; grupos acompanhados: ${tracked.join(', ') || '—'}`);
  return { today, month, quotas, open, active, contemplated, winner, loser, next, late, tracked, numbers };
}

/** Número de cota de outro consorciado no grupo (fora da carteira). */
function otherNumber(rng, taken) {
  for (;;) {
    const n = String(rng.int(1, 400)).padStart(3, '0');
    if (!taken.has(n)) return taken.add(n), n;
  }
}

/** Dia do mês das assembleias: o de hoje (até 28), para a de hoje cair no mesmo ritmo mensal. */
const assemblyDay = (today) => String(Math.min(28, Number(today.slice(8)))).padStart(2, '0');

async function seedGroups({ api, rng, log }, roles) {
  const groups = await api.get('/consortium/groups');
  const byCode = new Map(roles.open.map((q) => [q.groupCode, q]));
  let saved = 0;
  for (const [i, g] of groups.entries()) {
    const q = byCode.get(g.groupCode);
    if (!q || g.members != null) continue;
    await api.put('/consortium/groups', {
      planId: g.plan?.id ?? q.plan.id,
      groupCode: g.groupCode,
      members: rng.int(9, 32) * 100,
      monthsRemaining: Math.max(6, q.plan.termMonths - rng.int(4, 24)),
      notes: GROUP_NOTES[i % GROUP_NOTES.length],
    });
    saved++;
  }
  log(`    ${saved} grupos completados (${groups.length} cadastrados)`);
}

/** Assembleias mensais dos 3 meses anteriores nos grupos acompanhados, com sorteio e lances de outros consorciados. */
async function seedPastAssemblies({ api, rng, log }, roles) {
  const assemblies = await api.get('/consortium/assemblies');
  const dd = assemblyDay(roles.today);
  let created = 0;
  for (const group of roles.tracked) {
    const taken = roles.numbers(group);
    for (const k of [3, 2, 1]) {
      const m = shiftMonth(roles.month, -k);
      if (assemblies.some((a) => a.groupCode === group && a.heldOn.startsWith(m))) continue;
      const top = rng.int(380, 560) / 10;
      const bids = [{ quotaNumber: otherNumber(rng, taken), percent: top }];
      if (rng.chance(0.6)) bids.push({ quotaNumber: otherNumber(rng, taken), percent: round2(top - rng.int(15, 60) / 10) });
      await api.post('/consortium/assemblies', { groupCode: group, heldOn: nextWorkday(`${m}-${dd}`), drawn: [otherNumber(rng, taken)], bids, notes: null });
      created++;
    }
  }
  log(`    ${created} assembleias lançadas`);
}

/**
 * Calendário de parcelas desde ~4 meses atrás (5 nas contempladas) e pagamentos registrados.
 * Cotas marcadas como "late" ficam com as últimas parcelas vencidas em aberto (inadimplência).
 * Cota que já tem parcela paga fica como está.
 */
async function seedInstallments({ api, rng, log }, roles) {
  const { today, month } = roles;
  let regenerated = 0;
  let paid = 0;
  for (const q of roles.open) {
    let data = await api.get(`/consortium/quotas/${q.id}/installments`);
    if (data.paidCount > 0) continue;
    const back = q.status === 'contemplated' ? 5 : 4;
    const firstDueOn = `${shiftMonth(month, -back)}-${String(q.dueDay).padStart(2, '0')}`;
    if (!data.generated || data.items[0]?.dueOn > firstDueOn) {
      data = await api.post(`/consortium/quotas/${q.id}/installments`, { firstDueOn });
      regenerated++;
    }
    const due = data.items.filter((i) => i.dueOn < today && !i.paidOn);
    const open = roles.late.get(q.id) ?? 0;
    for (const i of due.slice(0, Math.max(0, due.length - open))) {
      // Em geral pago perto do vencimento; às vezes uns dias depois (sempre até hoje).
      const shift = rng.chance(0.15) ? rng.int(3, 9) : rng.int(-4, 0);
      await api.post(`/consortium/installments/${i.id}/pay`, {
        paidOn: minDate(addDays(i.dueOn, shift), today),
        notes: shift > 0 ? 'Pago com atraso; comprovante enviado pelo cliente' : rng.chance(0.15) ? 'Boleto da administradora pago via app do banco' : null,
      });
      paid++;
    }
  }
  const late = await api.get('/consortium/installments/late');
  log(`    ${regenerated} calendários refeitos, ${paid} parcelas pagas; ${late.length} cotas na inadimplência`);
}

/**
 * Assembleia de hoje nos grupos de duas cotas ativas: lance enviado à administradora e resultado
 * lançado (uma contemplada por lance, a outra perde). Agendar exige data de hoje em diante.
 */
async function seedBidRound({ api, rng, log }, roles) {
  const all = await api.get('/consortium/assemblies');
  if (all.some((a) => a.ourBids.some((b) => b.status === 'won'))) return log('    já tem lance vencedor lançado');
  const { today } = roles;
  let done = 0;
  for (const [q, won] of [
    [roles.winner, true],
    [roles.loser, false],
  ]) {
    if (!q) continue;
    let a = all.find((x) => x.groupCode === q.groupCode && x.status === 'scheduled' && x.heldOn <= today);
    if (!a) {
      if (all.some((x) => x.groupCode === q.groupCode && x.heldOn === today)) continue;
      a = await api.post('/consortium/assemblies/schedule', { groupCode: q.groupCode, heldOn: today, notes: 'Resultado divulgado pela administradora às 15h.' });
    }
    const percent = won ? 41.5 : 25;
    if (!(await api.get(`/consortium/quotas/${q.id}/bids`)).some((b) => b.assembly.id === a.id)) {
      const bid = await api.post(`/consortium/quotas/${q.id}/bids`, {
        assemblyId: a.id,
        type: won ? 'free' : 'embedded',
        percent,
        notes: won ? 'Lance livre com recursos próprios do cliente' : 'Lance embutido: sai do próprio crédito',
      });
      await api.patch(`/consortium/bids/${bid.id}`, { status: 'sent' });
    }
    const taken = roles.numbers(q.groupCode);
    const bids = won
      ? [{ quotaNumber: q.quotaNumber, percent }, { quotaNumber: otherNumber(rng, taken), percent: 39.2 }]
      : [{ quotaNumber: otherNumber(rng, taken), percent: 38.7 }, { quotaNumber: otherNumber(rng, taken), percent: 33.1 }];
    await api.post(`/consortium/assemblies/${a.id}/results`, { drawn: [otherNumber(rng, taken)], bids, notes: won ? `Cota ${q.quotaNumber} contemplada com lance de ${percent}%.` : 'Lance da carteira abaixo do menor vencedor.' });
    done++;
    log(`    grupo ${q.groupCode}: cota ${q.quotaNumber} ${won ? 'contemplada por lance' : 'com lance perdedor'}`);
  }
  if (!done) log('    nenhuma cota ativa disponível para a assembleia de hoje');
}

/** Próxima assembleia (mês que vem) dos grupos acompanhados e lances já registrados para ela. */
async function seedNextAssemblies({ api, log }, roles) {
  const { today } = roles;
  const nextOn = nextWorkday(`${shiftMonth(roles.month, 1)}-${assemblyDay(today)}`);
  let scheduled = (await api.get('/consortium/assemblies', { status: 'scheduled' })).filter((a) => a.heldOn > today);
  let created = 0;
  for (const group of roles.tracked) {
    if (scheduled.some((a) => a.groupCode === group)) continue;
    scheduled.push(await api.post('/consortium/assemblies/schedule', { groupCode: group, heldOn: nextOn, notes: null }));
    created++;
  }
  if (scheduled.some((a) => a.ourBids.length)) return log(`    ${created} assembleias agendadas; lances já registrados`);

  // A cota que perdeu hoje repete com lance maior; outra ativa entra no lance fixo do grupo.
  const quotas = await api.get('/consortium/quotas', { status: 'active' });
  const plan = [
    [roles.loser, { type: 'free', percent: 34, notes: 'Cliente vai repetir o lance, agora com recursos próprios' }, 'registered'],
    [roles.next, { type: 'fixed', percent: 25, notes: 'Lance fixo de 25% (regra do grupo)' }, 'sent'],
  ];
  let bids = 0;
  for (const [role, body, status] of plan) {
    const q = role && quotas.find((x) => x.id === role.id);
    const a = q && scheduled.find((x) => x.groupCode === q.groupCode);
    if (!a) continue;
    const bid = await api.post(`/consortium/quotas/${q.id}/bids`, { assemblyId: a.id, ...body });
    if (status === 'sent') await api.patch(`/consortium/bids/${bid.id}`, { status });
    bids++;
  }
  log(`    ${created} assembleias agendadas para ${nextOn}, ${bids} lances registrados`);
}

/** Percentual por administradora e um plano com percentual próprio (mostra a hierarquia plano > administradora > padrão). */
async function seedCommissionTable({ api, log }) {
  const table = await api.get('/consortium/commissions');
  const untouched = table.institutions.every((i) => i.percent == null && i.plans.every((p) => p.percent == null));
  if (!untouched) return log('    já configurada');
  const [a, b] = table.institutions;
  if (a) await api.put(`/consortium/commissions/institutions/${a.connectionId}`, { percent: 2.5 });
  if (b) await api.put(`/consortium/commissions/institutions/${b.connectionId}`, { percent: 3 });
  const big = table.institutions.flatMap((i) => i.plans).find((p) => p.name.startsWith('Imóvel 500'));
  if (big) await api.put(`/consortium/commissions/plans/${big.id}`, { percent: 1.8 });
  log(`    ${[a, b].filter(Boolean).length} administradoras e ${big ? 1 : 0} plano com percentual próprio (padrão ${table.defaultPercent}%)`);
}

/** Membros ativos que vendem: primeiro consultores, depois gestores, depois quem mais houver (sem o dono). */
async function sellersOf(api) {
  const members = await api.get('/users');
  const owner = members.find((m) => m.roles.some((r) => r.key === 'core.owner')) ?? null;
  const others = members.filter((m) => m !== owner && m.status === 'active');
  const has = (m, key) => m.roles.some((r) => r.key === key);
  const sellers = [...others.filter((m) => has(m, 'consortium.seller')), ...others.filter((m) => !has(m, 'consortium.seller') && has(m, 'consortium.manager')), ...others.filter((m) => !has(m, 'consortium.seller') && !has(m, 'consortium.manager'))];
  return { owner, sellers: sellers.slice(0, 2) };
}

/** Distribui as cotas em andamento entre dois vendedores e o dono (quem vendeu fica no resumo por vendedor). */
async function assignSellers({ api, log }) {
  const { owner, sellers } = await sellersOf(api);
  if (!sellers.length) return log('    sem outros membros ativos na equipe');
  const quotas = (await api.get('/consortium/quotas')).sort((a, b) => a.number - b.number);
  if (quotas.some((q) => q.sellerId && q.sellerId !== owner?.user.id)) return log('    cotas já distribuídas');
  const rotation = [sellers[0], sellers[1] ?? sellers[0], owner].filter(Boolean);
  let changed = 0;
  for (const [i, q] of quotas.filter((x) => ['proposal', ...OPEN].includes(x.status)).entries()) {
    const s = rotation[i % rotation.length];
    if (q.sellerId === s.user.id) continue;
    await api.patch(`/consortium/quotas/${q.id}/seller`, { sellerId: s.user.id });
    changed++;
  }
  log(`    ${changed} cotas com vendedor (${rotation.map((m) => m.user.name).join(', ')})`);
}

const bankAccount = async (api) => {
  const accounts = await api.get('/finance/accounts');
  const bank = accounts.find((a) => a.type === 'bank' && a.active !== false) ?? accounts.find((a) => a.active !== false) ?? accounts[0];
  if (!bank) throw new Error('nenhuma conta no financeiro');
  return bank;
};

/** Comissões a receber (lançadas na ativação): a administradora já pagou as mais antigas; as 2 mais recentes ficam em aberto. */
async function payCommissions({ api, rng, log }) {
  if ((await api.get('/finance/entries', { kind: 'income', status: 'paid', q: COMMISSION, limit: 1 })).total > 0) return log('    já tem comissões recebidas');
  const pending = (await api.get('/finance/entries', { kind: 'income', status: 'pending', q: COMMISSION, limit: 200 })).items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const bank = await bankAccount(api);
  const today = day(0);
  const toPay = pending.slice(0, Math.max(0, pending.length - 2));
  for (const e of toPay) {
    await api.post(`/finance/entries/${e.id}/pay`, { paidAt: minDate(addDays(e.dueDate, rng.int(5, 20)), today), accountId: bank.id, paymentMethod: 'pix' });
  }
  log(`    ${toPay.length} comissões recebidas, ${pending.length - toPay.length} a receber`);
}

/**
 * Estorno: cota nova vendida e aceita, comissão recebida e cancelamento dentro do prazo de estorno
 * (contado da ativação). O sistema lança a despesa de estorno a acertar no financeiro.
 */
async function seedClawback({ api, rng, log, customers }) {
  const customer = pickers(customers)(CLAWBACK.who);
  if (!customer) return log('    sem cliente para a cota');
  let q = (await api.get('/consortium/quotas', { customerId: customer.id })).find((x) => x.plan.name === CLAWBACK.plan && x.status !== 'rejected');
  if (q?.status === 'cancelled') return log(`    já registrado (cota nº ${q.number}${q.commissionReversed ? ', comissão estornada' : ''})`);
  if (!q) {
    const plans = await api.get('/consortium/plans');
    const plan = plans.find((p) => p.name === CLAWBACK.plan) ?? plans.find((p) => p.assetType === 'vehicle');
    if (!plan) return log('    nenhum plano de veículo em oferta');
    const { sellers } = await sellersOf(api);
    q = await api.post('/consortium/quotas', {
      customerId: customer.id,
      planId: plan.id,
      dueDay: CLAWBACK.dueDay,
      sellerId: sellers[0]?.user.id ?? null,
      applicant: await applicantFor(api, rng, customer, CLAWBACK.income),
    });
  }
  if (q.status === 'proposal') {
    const [p] = await api.get('/banking/proposals', { sourceType: 'consortium_quota', sourceId: q.id });
    if (p && ['submitted', 'under_review'].includes(p.status)) await api.post(`/banking/proposals/${p.id}/refresh`);
    // A ativação vem pela fila de eventos (em produção, a cada minuto).
    for (let i = 0; i < 30 && q.status === 'proposal'; i++) {
      await sleep(5000);
      q = await api.get(`/consortium/quotas/${q.id}`);
    }
  }
  if (q.status === 'proposal') return log(`    cota nº ${q.number} ainda em análise: rode o seed de novo em alguns minutos`);
  if (q.status !== 'active') return log(`    cota nº ${q.number} ficou como ${q.status}; nada a estornar`);

  const entry = (await api.get('/finance/entries', { kind: 'income', q: COMMISSION, limit: 200 })).items.find((e) => e.sourceId === q.id);
  if (entry?.status === 'pending') await api.post(`/finance/entries/${entry.id}/pay`, { paidAt: day(0), accountId: (await bankAccount(api)).id, paymentMethod: 'pix' });
  q = await api.post(`/consortium/quotas/${q.id}/cancel`, { reason: CLAWBACK.reason });
  log(`    cota nº ${q.number} cancelada; comissão de ${brl(q.commission)} ${q.commissionReversed ? 'estornada (despesa a acertar no financeiro)' : 'fora do prazo de estorno'}`);
}

// ---- RH ---------------------------------------------------------------------------------------

/** Quem sai: está na base desde ~14 meses, com horas extras nas folhas fechadas (entram na média). */
const TERMINATE = 'Sebastião Ferreira Gomes';
/** Se ele não existir ou o quadro ficar pequeno: alguém contratado há ~1,5 ano só para a rescisão. */
const FALLBACK = { name: 'Tiago Henrique Bastos', position: 'Assistente comercial', department: 'Comercial', salary: 3100, dependents: 1, admitted: -545, born: 1991 };
const MIN_ACTIVE = 8;
const HR_SOURCES = new Set(['hr_payroll', 'hr_termination', 'hr_vacation']);

async function seedHr(ctx) {
  const { log } = ctx;
  await step(log, 'rh: folhas mensais anteriores fechadas', () => ensureClosedPayrolls(ctx));
  await step(log, 'rh: rescisão', () => seedTermination(ctx));
  await step(log, 'rh: 13º — 1ª parcela (aberta)', () => seedThirteenth(ctx));
  await step(log, 'rh: pagamentos vencidos da folha', () => settleHrEntries(ctx));
}

/** As duas folhas mensais anteriores existem e estão fechadas (a do mês atual fica aberta, como no seed do setor). */
async function ensureClosedPayrolls({ api, log }) {
  const month = day(0).slice(0, 7);
  const out = [];
  for (const competence of [shiftMonth(month, -2), shiftMonth(month, -1)]) {
    const found = (await api.get('/hr/payrolls', { employer: 'own' })).find((p) => p.competence === competence && p.type === 'monthly' && !p.employer);
    let payroll = found ?? (await api.post('/hr/payrolls', { competence }));
    if (payroll.status !== 'closed') payroll = await api.post(`/hr/payrolls/${payroll.id}/close`);
    out.push(`${competence} ${found?.status === 'closed' ? 'já fechada' : 'fechada agora'} (${payroll.totals.employees} colaboradores)`);
  }
  log(`    ${out.join('; ')}`);
}

/** Dispensa sem justa causa com aviso indenizado, há ~12 dias (o prazo de pagamento do termo já passou). */
async function seedTermination({ api, rng, log }) {
  // Só os da própria empresa (na consultoria de RH a lista traz também os das empresas atendidas).
  const ownEmployees = async () => (await api.get('/hr/employees', { employer: 'own' })).filter((e) => !e.employer);
  let employees = await ownEmployees();
  for (const name of [TERMINATE, FALLBACK.name]) {
    const e = employees.find((x) => x.name === name);
    if (e?.status !== 'terminated') continue;
    const detail = await api.get(`/hr/employees/${e.id}`);
    if (detail.termination) return log(`    já registrada (${name}, ${detail.termination.terminationDate})`);
  }

  const activeCount = employees.filter((e) => e.status === 'active').length;
  let emp = employees.find((e) => e.name === TERMINATE && e.status === 'active');
  if (!emp || activeCount - 1 < MIN_ACTIVE) {
    emp = employees.find((e) => e.name === FALLBACK.name && e.status !== 'terminated');
    if (!emp) {
      const cpf = rng.cpf();
      await api.post('/hr/employees', {
        name: FALLBACK.name,
        cpf,
        birthDate: `${FALLBACK.born}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
        email: `${slugify(FALLBACK.name)}@example.com`,
        phone: rng.phone(),
        position: FALLBACK.position,
        department: FALLBACK.department,
        admissionDate: nextWorkday(day(FALLBACK.admitted)),
        salary: FALLBACK.salary,
        weeklyHours: 44,
        dependents: FALLBACK.dependents,
        status: 'active',
        terminationDate: null,
        pixKey: cpf,
        notes: null,
      });
      employees = await ownEmployees();
      emp = employees.find((e) => e.name === FALLBACK.name);
    }
  }

  const terminationDate = prevWorkday(day(-12));
  // Saldo do FGTS pelo extrato (as folhas registradas cobrem só os últimos meses): 8% ao mês + 13º e férias.
  const months = Math.max(1, Math.round((Date.parse(terminationDate) - Date.parse(emp.admissionDate)) / (30.44 * 86_400_000)));
  const fgtsBalance = round2(emp.salary * 0.08 * months * (13.33 / 12));
  const t = await api.post(`/hr/employees/${emp.id}/termination`, {
    type: 'without_cause',
    terminationDate,
    notice: 'indemnified',
    fgtsBalance,
    otherEarnings: 0,
    otherDeductions: 0,
    notes: 'Redução do quadro da área. Aviso prévio indenizado; guias do seguro-desemprego entregues na homologação.',
  });
  log(`    ${emp.name}: dispensa sem justa causa em ${terminationDate}, líquido ${brl(t.net)}, FGTS + multa ${brl(t.fgts.total)} (pagar até ${t.payBy})`);
}

/**
 * Folha da 1ª parcela do 13º do ano (competência 11, paga até 30/11), deixada aberta para a demonstração
 * mostrar o cálculo (avos e médias). A 2ª parcela só depois de fechar a 1ª, em dezembro.
 */
async function seedThirteenth({ api, log }) {
  const today = day(0);
  if (today.slice(5, 7) < '10') return log('    fora da época (a 1ª parcela é calculada a partir de outubro)');
  const year = Number(today.slice(0, 4));
  const found = (await api.get('/hr/payrolls', { employer: 'own' })).find((p) => p.type === 'thirteenth_1' && p.competence === `${year}-11` && !p.employer);
  const p = found ?? (await api.post('/hr/payrolls/thirteenth', { year, installment: 1 }));
  const t = p.totals;
  log(`    ${found ? 'já existe' : 'calculada'} (${p.status === 'closed' ? 'fechada' : 'aberta'}): ${t.employees} colaboradores, bruto ${brl(t.gross)}, líquido ${brl(t.net)}, FGTS ${brl(t.fgts)}`);
}

/** Salários, encargos, férias e rescisão já vencidos: pagos no vencimento (nada fica com data futura). */
async function settleHrEntries({ api, log }) {
  const today = day(0);
  const pending = [];
  for (let offset = 0; ; offset += 200) {
    const page = await api.get('/finance/entries', { kind: 'expense', status: 'pending', to: today, limit: 200, offset });
    pending.push(...page.items);
    if (!page.items.length || pending.length >= page.total) break;
  }
  const due = pending.filter((e) => HR_SOURCES.has(e.sourceType) && e.dueDate <= today);
  if (!due.length) return log('    nada vencido em aberto');
  const bank = await bankAccount(api);
  for (const e of due) await api.post(`/finance/entries/${e.id}/pay`, { paidAt: e.dueDate, accountId: bank.id, paymentMethod: 'pix' });
  log(`    ${due.length} lançamentos baixados (R$ ${round2(due.reduce((s, e) => s + e.amount, 0)).toFixed(2)})`);
}
