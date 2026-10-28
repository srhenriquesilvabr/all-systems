// Captação e integrações do consórcio na corretora de demonstração (fake-consorcio): três
// administradoras do catálogo (uma no modo manual, sem API), ~30 leads de origens variadas
// espalhados pelo funil (alguns viram proposta e venda), duas indicações e cinco consultas de
// crédito simuladas com a autorização registrada. Só completa o que falta: rodar de novo não duplica.
//
// A consulta de crédito é um módulo contratável. Não há rota de API para ativar módulos; ative pelo CLI:
//   pnpm --filter @all/api cli module:enable --tenant <id da fake-consorcio> --module integration.credit_bureau
// Sem ele, as consultas são puladas (o resto roda).
import { day, personName, sleep, slugify, step } from '../lib.mjs';

/** Administradoras do catálogo (contracts/catalog.ts do módulo bancário). */
const CONNECTIONS = [
  {
    name: 'Embracon',
    catalogKey: 'embracon',
    mode: 'manual',
    products: ['consortium'],
    manualPlans: [
      { name: 'Imóvel 300 mil', assetType: 'real_estate', creditValue: 300000, termMonths: 200, adminFeePercent: 17, reserveFundPercent: 2, insurancePercent: 0.03 },
      { name: 'Auto 90 mil', assetType: 'vehicle', creditValue: 90000, termMonths: 72, adminFeePercent: 16, reserveFundPercent: 2, insurancePercent: 0.03 },
      { name: 'Serviços 30 mil', assetType: 'services', creditValue: 30000, termMonths: 40, adminFeePercent: 19, reserveFundPercent: 2, insurancePercent: 0 },
    ],
  },
  { name: 'Porto Consórcio (simulação)', catalogKey: 'porto', mode: 'simulated', products: ['consortium'] },
  { name: 'Itaú Consórcio (simulação)', catalogKey: 'itau', mode: 'simulated', products: ['consortium'] },
];

/** Quantos leads de cada origem (30 no total). */
const TARGET = { simulator: 4, meta: 6, google: 5, import: 5, manual: 8, referral: 2 };
const CAMPAIGNS = { import: 'Feira de imóveis — out', manual: 'Balcão e telefone' };
const CITIES = [
  ['São Paulo', 'SP'],
  ['Santo André', 'SP'],
  ['Guarulhos', 'SP'],
  ['Osasco', 'SP'],
  ['Campinas', 'SP'],
];
const WISHES = [
  { assetType: 'vehicle', creditValue: 60000, termMonths: 60 },
  { assetType: 'vehicle', creditValue: 100000, termMonths: 80 },
  { assetType: 'real_estate', creditValue: 250000, termMonths: 180 },
  { assetType: 'real_estate', creditValue: 500000, termMonths: 200 },
  { assetType: 'services', creditValue: 20000, termMonths: 40 },
];
/** Etapa de cada lead novo, na ordem do número (o resto fica "novo"). */
const FUNNEL = [
  'contacting', 'simulation_sent', 'contacting', 'lost', 'proposal', 'simulation_sent', 'contacting', 'won', 'lost', 'proposal',
  'contacting', 'simulation_sent', 'won_manual', 'contacting', 'lost', 'simulation_sent', 'contacting', 'lost', 'contacting', 'won',
];
const LOST_REASONS = ['Parcela não cabe no orçamento', 'Fechou com outra empresa', 'Não atende / contato inválido', 'Prefere financiamento'];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: object[] }} ctx */
export default async function seedConsortiumLeads(ctx) {
  if (ctx.tenant.name !== 'fake-consorcio') return;
  const { api, log } = ctx;
  try {
    await api.get('/consortium/leads');
  } catch (err) {
    if (err.status === 403 || err.status === 404) return log('  - captação: rotas de leads indisponíveis (API sem a versão nova do consórcio?)');
    throw err;
  }
  await step(log, 'bancos: administradoras do catálogo (uma manual)', () => seedConnections(ctx));
  const team = await api.get('/users/team');
  await step(log, 'captação: configurações (simulador, rodízio, indicação)', () => seedSettings(ctx, team));
  const referrers = await step(log, 'captação: links de indicação', () => seedReferrers(ctx, team));
  await step(log, 'captação: leads de origens variadas', () => seedLeads(ctx, referrers ?? []));
  const leads = (await api.get('/consortium/leads')).sort((a, b) => a.number - b.number);
  const bureau = await creditBureauActive(ctx);
  if (bureau) await step(log, 'consulta de crédito: 5 consultas simuladas com autorização', () => seedCreditQueries(ctx, leads));
  // De novo: a lista agora traz a decisão de crédito de cada lead.
  const current = (await api.get('/consortium/leads')).sort((a, b) => a.number - b.number);
  await step(log, 'captação: leads pelo funil (retornos, WhatsApp, propostas e vendas)', () => seedFunnel(ctx, current, team));
}

async function seedConnections({ api, log }) {
  const list = await api.get('/banking/connections');
  let created = 0;
  for (const c of CONNECTIONS) {
    if (list.some((x) => x.catalogKey === c.catalogKey || x.name === c.name)) continue;
    await api.post('/banking/connections', { active: true, adapter: 'generic_rest', vehicleMonthlyRate: 1.99, realEstateYearlyRate: 11.5, tacFee: 0, manualPlans: [], ...c });
    created++;
  }
  if (created) {
    const plans = await api.post('/consortium/plans/sync');
    log(`    ${created} conexões criadas; ${plans.length} planos sincronizados`);
  } else log('    conexões do catálogo já cadastradas');
}

async function seedSettings({ api }, team) {
  const current = await api.get('/modules/consortium/settings');
  const sellers = team.slice(0, 4).map((u) => u.id);
  if (current.leadRoundRobin && current.referralReward) return;
  await api.put('/modules/consortium/settings', {
    ...current,
    publicSimulator: true,
    leadRoundRobin: sellers.length > 0,
    leadSellerIds: sellers,
    referralReward: 'R$ 200 por cota ativa',
    referralRewardAmount: 200,
    privacyEmail: current.privacyEmail || 'privacidade@example.com',
  });
}

async function seedReferrers({ api, log, customers }, team) {
  const existing = await api.get('/consortium/referrers');
  const person = customers.find((c) => c.type !== 'company') ?? customers[0];
  const seller = team[1] ?? team[0];
  if (person && !existing.some((r) => r.customerId === person.id)) await api.post('/consortium/referrers', { kind: 'customer', customerId: person.id });
  if (seller && !existing.some((r) => r.userId === seller.id)) await api.post('/consortium/referrers', { kind: 'seller', userId: seller.id });
  const list = await api.get('/consortium/referrers');
  log(`    ${list.length} links (${list.map((r) => r.name).join(', ')})`);
  return list;
}

async function seedLeads(ctx, referrers) {
  const { api, rng, log } = ctx;
  const leads = await api.get('/consortium/leads');
  const count = (source) => leads.filter((l) => l.source === source).length;
  const used = new Set(leads.map((l) => l.name));
  const person = () => {
    const name = personName(rng, used);
    const [city, state] = rng.pick(CITIES);
    return { name, phone: rng.phone(), email: `${slugify(name)}@example.com`, city, state, ...rng.pick(WISHES) };
  };
  let created = 0;

  // Simulador público (máximo de 5 envios a cada 10 min por IP: ficam 4).
  const { tenant } = await api.get('/me');
  for (let i = count('simulator'); i < TARGET.simulator; i++) {
    const p = person();
    await api.post(`/public/consortium/${tenant.slug}/leads`, {
      ...p,
      consent: true,
      consentVersion: 'v1',
      utm: { utm_source: i % 2 ? 'google' : 'instagram', utm_medium: 'cpc', utm_campaign: i % 2 ? 'consorcio-auto' : 'consorcio-imovel' },
      startedAt: Date.now() - 60_000,
    });
    created++;
  }

  // Anúncios: canais simulados (o botão "Gerar lead de teste" passa pelo mesmo caminho do webhook).
  const channels = await api.get('/consortium/lead-channels');
  let meta = channels.find((c) => c.kind === 'meta');
  meta ??= await api.post('/consortium/lead-channels', { kind: 'meta', name: 'Instagram — consórcio imóvel', mode: 'simulated', pageId: `${100000000 + rng.int(1, 899999999)}`, assetType: 'real_estate' });
  let google = channels.find((c) => c.kind === 'google');
  google ??= await api.post('/consortium/lead-channels', { kind: 'google', name: 'Google Ads — consórcio auto', mode: 'simulated', webhookKey: `demo-${rng.int(100000, 999999)}`, assetType: 'vehicle' });
  for (let i = count('meta'); i < TARGET.meta; i++, created++) await api.post(`/consortium/lead-channels/${meta.id}/test`);
  for (let i = count('google'); i < TARGET.google; i++, created++) await api.post(`/consortium/lead-channels/${google.id}/test`);

  // Planilha (evento) e cadastro manual (balcão, telefone).
  for (const source of ['import', 'manual']) {
    for (let i = count(source); i < TARGET[source]; i++) {
      const p = person();
      await api.post('/consortium/leads', { ...p, source, campaign: CAMPAIGNS[source], contactBasis: i % 4 === 3 ? 'existing_customer' : 'requested_contact' });
      created++;
    }
  }

  // Indicações registradas pela equipe (uma de cada link).
  for (const [i, r] of referrers.slice(0, TARGET.referral).entries()) {
    if (leads.some((l) => l.referrer?.id === r.id)) continue;
    const p = person();
    await api.post('/consortium/leads', { ...p, referrerId: r.id, contactBasis: 'requested_contact', notes: `Indicado por ${r.name}${i ? '' : ' (cliente da carteira)'}` });
    created++;
  }
  log(`    ${created ? `${created} leads criados` : 'leads já cadastrados'}`);
}

async function creditBureauActive({ api, log, tenant }) {
  try {
    await api.get('/credit-bureau/status');
    return true;
  } catch (err) {
    if (err.status !== 403 && err.status !== 404) throw err;
    log(`  - consulta de crédito: módulo não ativo. Ative com: pnpm --filter @all/api cli module:enable --tenant ${tenant.id} --module integration.credit_bureau`);
    return false;
  }
}

/** Cinco consultas simuladas, cada uma com a autorização do cliente (data, forma e prova). */
async function seedCreditQueries({ api, rng, log }, leads) {
  const done = await api.get('/credit-bureau/queries', { sourceType: 'consortium_lead' });
  if (done.length >= 5) return log(`    já tem ${done.length} consultas`);
  // Na ordem dos leads: o 4º é reprovado (e sai do funil como perdido), o 2º fica aguardando decisão.
  const decisions = ['approved', 'pending', 'approved', 'rejected', 'approved'];
  const methods = ['signed_term', 'recorded_call', 'written_message', 'digital_acceptance', 'signed_term'];
  const targets = leads.filter((l) => !l.anonymized && !done.some((q) => q.sourceId === l.id)).slice(0, 5 - done.length);
  for (const [i, l] of targets.entries()) {
    const q = await api.post('/credit-bureau/queries', {
      document: rng.cpf(),
      subjectName: l.name,
      customerId: l.customerId,
      sourceType: 'consortium_lead',
      sourceId: l.id,
      purpose: 'consortium_sale',
      consent: { givenAt: day(-(i + 1)), method: methods[i], evidence: i % 2 ? 'Mensagem do cliente guardada no WhatsApp da empresa' : 'Termo de autorização assinado e arquivado', confirmed: true },
    });
    if (decisions[i] !== 'pending') await api.post(`/credit-bureau/queries/${q.id}/decision`, { decision: decisions[i], note: decisions[i] === 'rejected' ? 'Pendências recentes no birô (simulação)' : 'Score compatível com a parcela' });
  }
  log(`    ${targets.length} consultas`);
}

/** Leva os leads novos pelo funil; proposta e venda viram cotas de verdade (adesão pela integração). */
async function seedFunnel(ctx, leads, team) {
  const { api, rng, log } = ctx;
  const fresh = leads.filter((l) => l.status === 'new' && !l.anonymized);
  if (leads.length - fresh.length >= FUNNEL.length / 2) return log('    funil já movimentado');
  const plans = await api.get('/consortium/plans');
  const planFor = (l, manual) => {
    const byType = plans.filter((p) => p.assetType === (l.assetType ?? 'vehicle'));
    const pool = manual ? byType.filter((p) => p.institution === 'Embracon') : byType.filter((p) => p.institution !== 'Embracon');
    return pool[0] ?? byType[0] ?? plans[0];
  };
  const waiting = [];
  let moved = 0;
  for (const [i, l] of fresh.entries()) {
    const target = FUNNEL[i];
    if (!target) break;
    if (!l.seller && team[0]) await api.post(`/consortium/leads/${l.id}/assign`, { sellerId: team[i % Math.min(team.length, 4)].id });
    if (l.phone) await api.post(`/consortium/leads/${l.id}/whatsapp`);
    if (target === 'contacting') {
      await api.post(`/consortium/leads/${l.id}/notes`, { text: rng.pick(['Pediu para retornar depois do almoço.', 'Quer comparar com o financiamento.', 'Vai conversar com a família.']) });
      await api.post(`/consortium/leads/${l.id}/tasks`, { title: 'Ligar de novo', dueAt: new Date(Date.now() + rng.int(-24, 72) * 3_600_000).toISOString() });
    } else if (target === 'simulation_sent') {
      await api.post(`/consortium/leads/${l.id}/status`, { status: 'simulation_sent' });
      await api.post(`/consortium/leads/${l.id}/tasks`, { title: 'Confirmar se recebeu a simulação', dueAt: new Date(Date.now() + rng.int(2, 48) * 3_600_000).toISOString() });
    } else if (target === 'lost') {
      const reason = l.credit?.decision === 'rejected' ? 'Crédito reprovado' : LOST_REASONS[moved % LOST_REASONS.length];
      await api.post(`/consortium/leads/${l.id}/status`, { status: 'lost', lostReason: reason });
    } else {
      // Proposta e venda: cliente a partir do lead e adesão ligada a ele.
      const manual = target === 'won_manual';
      const { customerId } = await api.post(`/consortium/leads/${l.id}/customer`);
      const plan = planFor(l, manual);
      const quota = await api.post('/consortium/quotas', {
        customerId,
        planId: plan.id,
        leadId: l.id,
        dueDay: 10,
        applicant: { name: l.name, document: rng.cpf(), monthlyIncome: Math.round((plan.installment * 4) / 100) * 100, email: l.email, phone: l.phone },
      });
      const [p] = await api.get('/banking/proposals', { sourceType: 'consortium_quota', sourceId: quota.id });
      if (target === 'won' && p && ['submitted', 'under_review'].includes(p.status)) {
        await api.post(`/banking/proposals/${p.id}/refresh`);
        waiting.push(quota.id);
      }
      if (manual && p && p.connection.mode === 'manual') {
        await api.post(`/banking/proposals/${p.id}/manual`, {
          status: 'approved',
          groupCode: 'E2041',
          quotaNumber: String(rng.int(100, 399)),
          externalId: `EMB-${rng.int(100000, 999999)}`,
          message: 'Adesão aprovada no portal do parceiro (registro manual)',
        });
        waiting.push(quota.id);
      }
    }
    moved++;
  }
  // A cota (e o lead) viram venda quando o evento da proposta é processado.
  for (let i = 0; i < 24 && waiting.length; i++) {
    const open = (await api.get('/consortium/quotas', { status: 'proposal' })).filter((q) => waiting.includes(q.id));
    if (!open.length) break;
    await sleep(5000);
  }
  log(`    ${moved} leads movimentados; ${waiting.length} vendas`);
}
