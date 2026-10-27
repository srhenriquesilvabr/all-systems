// Escritório de contabilidade: carteira de empresas, catálogo de obrigações, obrigações do mês
// anterior e do atual em situações variadas e honorários do mês.
import { DISTRICTS, STREETS, day, slugify, step } from '../lib.mjs';

/** Perfil fiscal das empresas que o core já cadastra (nomes da lista COMPANIES). */
const CORE_COMPANY_PROFILE = {
  'Mercado Bom Preço': { taxRegime: 'simples', cnae: '4712-1/00', hasEmployees: true, monthlyFee: 1250 },
  'Construtora Horizonte': { taxRegime: 'presumido', cnae: '4120-4/00', hasEmployees: true, monthlyFee: 3200 },
  'Clínica Vida Plena': { taxRegime: 'presumido', cnae: '8630-5/03', hasEmployees: true, monthlyFee: 2100 },
  'Tech Soluções': { taxRegime: 'simples', cnae: '6204-0/00', hasEmployees: false, monthlyFee: 950 },
  'Restaurante Sabor da Terra': { taxRegime: 'simples', cnae: '5611-2/01', hasEmployees: true, monthlyFee: 1100 },
  'Academia Corpo em Forma': { taxRegime: 'simples', cnae: '9313-1/00', hasEmployees: true, monthlyFee: 980 },
  'Papelaria Central': { taxRegime: 'simples', cnae: '4761-0/03', hasEmployees: true, monthlyFee: 790 },
  'Transportadora Rápida': { taxRegime: 'real', cnae: '4930-2/02', hasEmployees: true, monthlyFee: 4200 },
};

/** Empresas a mais na carteira, para cobrir todos os regimes. */
const EXTRA_COMPANIES = [
  { name: 'Padaria Pão Dourado Ltda.', taxRegime: 'simples', cnae: '1091-1/02', hasEmployees: true, monthlyFee: 890, feeDueDay: 10, notes: 'Anexo I (revenda) e II (fabricação própria). 7 funcionários.' },
  { name: 'Marcos Reis Instalações Elétricas (MEI)', taxRegime: 'mei', cnae: '4321-5/00', hasEmployees: false, monthlyFee: 159, feeDueDay: 5, notes: 'MEI: acompanhar o limite de faturamento anual.' },
  { name: 'Alfa Engenharia e Projetos Ltda.', taxRegime: 'presumido', cnae: '7112-0/00', hasEmployees: true, monthlyFee: 2400, feeDueDay: 10, notes: 'Presunção de 32%. Parte das notas com ISS retido pelo tomador.' },
  { name: 'Distribuidora Litoral Alimentos Ltda.', taxRegime: 'real', cnae: '4639-7/01', hasEmployees: true, monthlyFee: 4800, feeDueDay: 15, notes: 'Lucro Real trimestral, 38 funcionários, ICMS-ST em parte do mix.' },
  { name: 'Clínica Odontológica Sorriso Pleno Ltda.', taxRegime: 'presumido', cnae: '8630-5/04', hasEmployees: true, monthlyFee: 1950, feeDueDay: 10, notes: null },
  { name: 'Nexa Software e Consultoria Ltda.', taxRegime: 'simples', cnae: '6201-5/01', hasEmployees: false, monthlyFee: 980, feeDueDay: 10, notes: 'Fator R acompanhado todo mês (pró-labore ajustado para o Anexo III).' },
];

/** Obrigações estaduais que o catálogo padrão não traz. */
const EXTRA_TYPES = [
  { code: 'EFDICMS', name: 'EFD ICMS/IPI (SPED Fiscal)', regimes: ['presumido', 'real'], requiresEmployees: false, frequency: 'monthly', dueDay: 20, active: true },
  { code: 'DESTDA', name: 'DeSTDA — ICMS ST e DIFAL (Simples)', regimes: ['simples'], requiresEmployees: false, frequency: 'monthly', dueDay: 28, active: true },
];

const DONE_NOTES = {
  DAS: 'Guia emitida e enviada ao cliente por e-mail.',
  FGTS: 'Guia do FGTS Digital enviada ao cliente.',
  DCTFWEB: 'Transmitida; DARF enviado ao cliente.',
  ESOCIAL: 'Eventos periódicos fechados sem pendências.',
};

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, rng, log } = ctx;
  const today = day(0);

  await step(log, 'contábil: catálogo de obrigações', async () => {
    const types = await api.get('/accounting/obligation-types');
    if (!types.length) log('    atenção: catálogo padrão vazio (o módulo cria ao ser ativado)');
    let created = 0;
    for (const t of EXTRA_TYPES) {
      if (types.some((x) => x.code === t.code)) continue;
      await api.post('/accounting/obligation-types', t);
      created++;
    }
    log(`    ${types.length + created} obrigações no catálogo (${created} novas)`);
  });

  await step(log, 'contábil: carteira de empresas', async () => {
    const team = await api.get('/users/team');
    const idOf = new Map(team.map((t) => [t.name, t.id]));
    const staff = ctx.users.filter((u) => u.roleKeys.some((k) => k.startsWith('accounting.'))).map((u) => idOf.get(u.name)).filter(Boolean);
    const responsibles = staff.length ? staff : team.map((t) => t.id);

    // Empresas da carteira: as do core e as extras (criadas como clientes se ainda não existirem).
    const extraNames = new Set(EXTRA_COMPANIES.map((e) => e.name));
    const companies = ctx.customers.filter((c) => c.type === 'company' && !extraNames.has(c.name)).map((c) => ({ customer: c, profile: { feeDueDay: 10, notes: null, ...(CORE_COMPANY_PROFILE[c.name] ?? { taxRegime: 'simples', cnae: null, hasEmployees: true, monthlyFee: 1000 }) } }));
    let newCustomers = 0;
    for (const extra of EXTRA_COMPANIES) {
      const found = (await api.get('/customers', { q: extra.name, limit: 5 })).items.find((c) => c.name === extra.name);
      const customer =
        found ??
        (await api.post('/customers', {
          type: 'company',
          name: extra.name,
          document: rng.cnpj(),
          email: `financeiro@${slugify(extra.name).replace(/\./g, '')}.example.com`,
          phone: rng.phone(),
          address: { zip: `0${rng.int(1000, 5999)}${rng.int(100, 999)}`, street: rng.pick(STREETS), number: String(rng.int(10, 2500)), district: rng.pick(DISTRICTS), city: 'São Paulo', state: 'SP' },
          notes: 'Cliente do escritório contábil.',
        }));
      if (!found) newCustomers++;
      companies.push({ customer, profile: extra });
    }

    const inPortfolio = new Set((await api.get('/accounting/clients')).map((c) => c.customer.id));
    let added = 0;
    for (const [i, { customer, profile }] of companies.entries()) {
      if (inPortfolio.has(customer.id)) continue;
      await api.post('/accounting/clients', {
        customerId: customer.id,
        taxRegime: profile.taxRegime,
        cnae: profile.cnae,
        hasEmployees: profile.hasEmployees,
        monthlyFee: profile.monthlyFee,
        feeDueDay: profile.feeDueDay,
        responsibleUserId: responsibles[i % responsibles.length] ?? null,
        active: true,
        notes: profile.notes,
      });
      added++;
    }
    log(`    ${added} empresas na carteira (${inPortfolio.size} já estavam; ${newCustomers} clientes-empresa criados)`);
  });

  await step(log, 'contábil: gerar obrigações e honorários do mês', async () => {
    const r = await api.post('/accounting/generate');
    log(`    ${r.obligations} obrigações e ${r.fees} honorários gerados agora`);
  });

  await step(log, 'contábil: baixa das obrigações', async () => {
    const all = await api.get('/accounting/obligations');
    if (all.some((o) => o.status !== 'pending')) {
      log(`    já tem obrigações baixadas (${all.filter((o) => o.status !== 'pending').length})`);
      return;
    }
    // Duas empresas ficam com entregas atrasadas, para aparecerem em destaque na carteira.
    const clientIds = [...new Set(all.map((o) => o.client.id))];
    const lateClients = new Set([clientIds[1], clientIds[4]].filter(Boolean));
    const lateLeft = new Map();
    let waivedReinf = false;
    const count = { done: 0, waived: 0, late: 0, open: 0 };

    for (const o of all) {
      const overdue = o.dueOn < today;
      let status = 'pending';
      let notes = null;
      if (overdue) {
        const left = lateLeft.get(o.client.id) ?? 0;
        if (o.type.code === 'REINF' && !waivedReinf) {
          status = 'waived';
          notes = 'Sem movimento: nenhum serviço tomado com retenção no período.';
          waivedReinf = true;
        } else if (lateClients.has(o.client.id) && left < 2) {
          lateLeft.set(o.client.id, left + 1);
          notes = 'Aguardando documentos do cliente (extratos e notas de entrada).';
        } else {
          status = 'done';
          notes = DONE_NOTES[o.type.code] ?? 'Entregue. Recibo arquivado na pasta do cliente.';
        }
      } else if (rng.chance(o.dueOn.slice(0, 7) === today.slice(0, 7) ? 0.5 : 0.15)) {
        // Parte do que vence logo já foi adiantada.
        status = 'done';
        notes = DONE_NOTES[o.type.code] ?? 'Entregue antes do prazo.';
      }
      if (status === 'pending') {
        count[overdue ? 'late' : 'open']++;
        if (notes) await api.post(`/accounting/obligations/${o.id}/status`, { status, notes });
        continue;
      }
      await api.post(`/accounting/obligations/${o.id}/status`, { status, notes });
      count[status]++;
    }
    log(`    ${all.length} obrigações: ${count.done} entregues, ${count.waived} dispensadas, ${count.late} atrasadas, ${count.open} a fazer`);
  });
}
