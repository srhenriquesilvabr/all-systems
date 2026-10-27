// Escritório de advocacia: processos com número CNJ, andamentos, prazos, honorários e audiências na agenda.
import { at, day, step, workday } from '../lib.mjs';

/** Número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) com o dígito verificador MOD 97-10 correto. */
function cnj(n, year, j, tr, origin) {
  const nn = String(n).padStart(7, '0');
  const trs = String(tr).padStart(2, '0');
  const oo = String(origin).padStart(4, '0');
  const dd = String(98n - (BigInt(`${nn}${year}${j}${trs}${oo}00`) % 97n)).padStart(2, '0');
  return `${nn}-${dd}.${year}.${j}.${trs}.${oo}`;
}

const wd = (n) => day(workday(n));

/**
 * Casos do escritório. `client` aponta para os clientes do core (pessoa ou empresa, pelo índice).
 * `cnj`: [ano, segmento, tribunal, origem]. Andamentos e prazos em dias a partir de hoje.
 */
const CASES = [
  {
    client: ['person', 0],
    title: 'Reclamação trabalhista — horas extras e verbas rescisórias',
    area: 'labor',
    role: 'plaintiff',
    cnj: [2025, 5, 2, 61],
    court: '61ª Vara do Trabalho de São Paulo (TRT-2)',
    opposingParty: 'Transportadora Via Expressa Ltda.',
    claimValue: 87450.32,
    status: 'active',
    notes: 'Cliente trabalhou 6 anos como motorista, jornada média de 11h/dia sem controle de ponto. Duas testemunhas (ex-colegas) confirmadas.',
    updates: [
      [-210, 'Petição inicial distribuída por sorteio à 61ª Vara do Trabalho.'],
      [-150, 'Audiência inicial: conciliação recusada pela reclamada. Prazo de 15 dias para contestação.'],
      [-128, 'Juntada de contestação e cartões de ponto pela reclamada.'],
      [-104, 'Réplica protocolada, impugnando os cartões de ponto (horários britânicos).'],
      [-45, 'Designada perícia contábil para apuração das horas extras.'],
      [-6, 'Laudo pericial juntado aos autos: apurou R$ 64.120,00 em horas extras e reflexos.'],
    ],
    deadlines: [
      ['Manifestação sobre o laudo pericial', 3, 3],
      ['Réplica à contestação', -104, 3, 'done'],
      ['Audiência de instrução — confirmar testemunhas e preparar perguntas', 34, 7],
    ],
    fees: [{ kind: 'success', successPercent: 30, description: '30% sobre o valor obtido (contrato de êxito)' }],
    agenda: [{ n: 35, hh: 14, mm: 0, service: 'Audiência', notes: 'Audiência de instrução e julgamento — Fórum Ruy Barbosa, sala 12.' }],
  },
  {
    client: ['person', 1],
    title: 'Divórcio litigioso com partilha de bens',
    area: 'family',
    role: 'plaintiff',
    cnj: [2026, 8, 26, 11],
    court: '2ª Vara da Família e Sucessões — Foro Regional XI (Pinheiros)',
    opposingParty: 'Ricardo Albuquerque Menezes',
    claimValue: 640000,
    status: 'active',
    notes: 'Segredo de justiça. Partilha de apartamento em Perdizes e de um veículo. Guarda compartilhada já acordada informalmente.',
    updates: [
      [-120, 'Ação distribuída com pedido de alimentos provisórios.'],
      [-112, 'Deferidos alimentos provisórios de 30% dos rendimentos líquidos do réu.'],
      [-60, 'Réu citado. Juntada de contestação com reconvenção quanto à partilha do veículo.'],
      [-14, 'Intimação para réplica e especificação de provas.'],
    ],
    deadlines: [
      ['Réplica à contestação e à reconvenção', -2, 5],
      ['Juntar matrícula atualizada e laudo de avaliação do imóvel', 12, 3],
    ],
    fees: [{ kind: 'fixed', amount: 18000, installments: 6, firstDueOn: -20, description: 'Contrato de honorários — divórcio e partilha' }],
    agenda: [{ n: 9, hh: 10, mm: 0, service: 'Audiência', status: 'confirmed', notes: 'Sessão de conciliação no CEJUSC Pinheiros (virtual, link enviado à cliente).' }],
  },
  {
    client: ['person', 2],
    title: 'Inexigibilidade de débito c/c danos morais — negativação indevida',
    area: 'consumer',
    role: 'plaintiff',
    cnj: [2024, 8, 26, 100],
    court: '3ª Vara Cível — Foro Central Cível (João Mendes)',
    opposingParty: 'Banco Meridional S.A.',
    claimValue: 25000,
    status: 'won',
    notes: 'Negativação por contrato de cartão não reconhecido. Sentença de procedência confirmada no TJSP.',
    updates: [
      [-540, 'Ação distribuída com pedido de tutela para retirada do nome dos cadastros de inadimplentes.'],
      [-530, 'Tutela de urgência deferida. Banco intimado a excluir a negativação em 5 dias.'],
      [-300, 'Sentença: procedência, inexigibilidade do débito e danos morais de R$ 12.000,00.'],
      [-180, 'Acórdão do TJSP negou provimento à apelação do banco.'],
      [-75, 'Trânsito em julgado certificado.'],
      [-20, 'Banco depositou R$ 14.380,00 (condenação corrigida). Requerido o levantamento.'],
    ],
    deadlines: [
      ['Contrarrazões à apelação do banco', -270, 5, 'done'],
      ['Conferir o mandado de levantamento e repassar o valor à cliente', 5, 2],
    ],
    fees: [{ kind: 'success', successPercent: 20, description: '20% sobre o proveito econômico', success: { obtainedAmount: 14380, dueOn: 10 } }],
    agenda: [{ n: -12, hh: 16, mm: 0, service: 'Reunião com cliente', status: 'done', notes: 'Explicar o trânsito em julgado e o prazo do levantamento.' }],
  },
  {
    client: ['company', 0],
    title: 'Defesa em execução fiscal — IRPJ/CSLL 2019',
    area: 'tax',
    role: 'defendant',
    cnj: [2023, 4, 3, 6182],
    court: '10ª Vara de Execuções Fiscais Federais de São Paulo',
    opposingParty: 'União Federal — Fazenda Nacional',
    claimValue: 248300.55,
    status: 'suspended',
    notes: 'Exceção de pré-executividade parcialmente acolhida (prescrição de parte do débito). Saldo incluído em transação com a PGFN em 60 parcelas.',
    updates: [
      [-760, 'Citação da empresa na execução fiscal.'],
      [-740, 'Apresentada exceção de pré-executividade alegando prescrição parcial.'],
      [-500, 'Exceção parcialmente acolhida: excluídas as competências de jan a mar/2019.'],
      [-200, 'Adesão à transação tributária (PGFN) comunicada nos autos.'],
      [-190, 'Execução suspensa enquanto durar o parcelamento da transação.'],
    ],
    deadlines: [['Comprovar nos autos o pagamento das parcelas da transação', 8, 3]],
    fees: [{ kind: 'monthly', amount: 2800, installments: 12, firstDueOn: -20, description: 'Acompanhamento mensal do contencioso tributário' }],
  },
  {
    client: ['person', 3],
    title: 'Aposentadoria especial — reconhecimento de tempo insalubre',
    area: 'social_security',
    role: 'plaintiff',
    cnj: [2026, 4, 3, 6301],
    court: 'Juizado Especial Federal Cível de São Paulo',
    opposingParty: 'INSS — Instituto Nacional do Seguro Social',
    claimValue: 71200,
    status: 'active',
    notes: 'Exposição a ruído acima de 85 dB em metalúrgica (1998–2021). Pedido administrativo negado pelo INSS.',
    updates: [
      [-95, 'Ação distribuída no JEF com cópia do processo administrativo.'],
      [-70, 'Determinada emenda à inicial para juntada de PPP completo.'],
      [-55, 'Emenda à inicial protocolada.'],
      [-21, 'INSS apresentou contestação padrão. Designada perícia técnica.'],
    ],
    deadlines: [
      ['Emenda à inicial — juntar PPP e LTCAT', -56, 3, 'done'],
      ['Juntar PPP atualizado da última empregadora', 2, 2],
      ['Perícia técnica no local de trabalho — acompanhar assistente técnico', 20, 5],
    ],
    fees: [
      { kind: 'fixed', amount: 1500, installments: 1, firstDueOn: 3, description: 'Honorários iniciais' },
      { kind: 'success', successPercent: 30, description: '30% dos atrasados recebidos' },
    ],
    agenda: [{ n: -97, hh: 15, mm: 0, service: 'Consulta inicial', status: 'done', paid: true, notes: 'Análise do CNIS e dos PPPs.' }],
  },
  {
    client: ['person', 4],
    title: 'Defesa criminal — homicídio culposo na direção de veículo (art. 302 do CTB)',
    area: 'criminal',
    role: 'defendant',
    cnj: [2025, 8, 26, 50],
    court: '15ª Vara Criminal — Foro Central Criminal da Barra Funda',
    opposingParty: 'Ministério Público do Estado de São Paulo',
    claimValue: null,
    status: 'active',
    notes: 'Acidente em cruzamento sem sinalização. Laudo da perícia de trânsito favorável à defesa quanto à velocidade.',
    updates: [
      [-260, 'Denúncia recebida.'],
      [-230, 'Resposta à acusação apresentada, com rol de 3 testemunhas.'],
      [-160, 'Rejeitado o pedido de absolvição sumária. Designada audiência de instrução.'],
      [-30, 'Juntado laudo complementar da perícia de trânsito.'],
    ],
    deadlines: [
      ['Resposta à acusação', -231, 5, 'done'],
      ['Requerer oitiva do perito em audiência', 4, 2],
      ['Audiência de instrução — preparar o cliente para o interrogatório', 15, 5],
    ],
    fees: [{ kind: 'fixed', amount: 25000, installments: 5, firstDueOn: 10, description: 'Defesa em 1ª instância' }],
    agenda: [{ n: 16, hh: 13, mm: 30, service: 'Audiência', notes: 'Audiência de instrução e julgamento — sala 4, 2º andar.' }],
  },
  {
    client: ['company', 1],
    title: 'Consultoria societária — acordo de sócios e alteração contratual',
    area: 'business',
    role: 'advisory',
    cnj: null,
    court: null,
    opposingParty: null,
    claimValue: null,
    status: 'active',
    notes: 'Entrada de novo sócio investidor (20%). Cláusulas de drag along, tag along e vesting.',
    updates: [
      [-40, 'Reunião de levantamento com os sócios e o investidor.'],
      [-25, 'Due diligence societária concluída, sem pendências relevantes.'],
      [-9, 'Minuta do acordo de sócios enviada para revisão do cliente.'],
    ],
    deadlines: [
      ['Entregar versão final do acordo de sócios', 6, 2],
      ['Protocolar alteração contratual na JUCESP', 25, 5],
    ],
    fees: [{ kind: 'monthly', amount: 3500, installments: 6, firstDueOn: 5, description: 'Assessoria societária mensal' }],
    agenda: [{ n: 3, hh: 10, mm: 0, service: 'Reunião com cliente', status: 'confirmed', notes: 'Revisão da minuta do acordo de sócios com os três sócios.' }],
  },
  {
    client: ['person', 5],
    title: 'Ação de cobrança de cotas condominiais',
    area: 'civil',
    role: 'defendant',
    cnj: [2025, 8, 26, 704],
    court: '2ª Vara Cível — Foro Regional XV (Butantã)',
    opposingParty: 'Condomínio Edifício Jardim Europa',
    claimValue: 18950.4,
    status: 'settled',
    notes: 'Acordo homologado: R$ 14.200,00 em 10 parcelas, sem multa.',
    updates: [
      [-200, 'Citação recebida.'],
      [-185, 'Contestação apresentada, impugnando juros e multa acima da convenção.'],
      [-90, 'Audiência de conciliação: proposta de acordo em 10 parcelas.'],
      [-70, 'Acordo homologado por sentença.'],
    ],
    deadlines: [
      ['Contestação', -186, 5, 'done'],
      ['Conferir o pagamento da 4ª parcela do acordo', 12, 3],
    ],
    fees: [{ kind: 'fixed', amount: 4500, installments: 3, firstDueOn: 15, description: 'Defesa e acordo' }],
  },
  {
    client: ['person', 6],
    title: 'Inventário judicial e partilha de bens',
    area: 'family',
    role: 'plaintiff',
    cnj: [2026, 8, 26, 1],
    court: '1ª Vara da Família e Sucessões — Foro Regional I (Santana)',
    opposingParty: null,
    claimValue: 1250000,
    status: 'active',
    notes: 'Três herdeiros de acordo; um imóvel em Santana, aplicações financeiras e um terreno em Atibaia.',
    updates: [
      [-80, 'Abertura do inventário; cliente nomeada inventariante.'],
      [-62, 'Primeiras declarações apresentadas.'],
      [-18, 'Fazenda Estadual intimada para cálculo do ITCMD.'],
    ],
    deadlines: [
      ['Recolher o ITCMD e juntar a guia paga', -4, 5],
      ['Últimas declarações e esboço de partilha', 28, 7],
    ],
    fees: [{ kind: 'fixed', amount: 30000, installments: 10, firstDueOn: 8, description: 'Inventário — 10 parcelas' }],
  },
];

const RESOURCE_COLORS = ['#1e3a8a', '#7c2d12', '#065f46', '#6b21a8'];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type,phone,email}[], users: {membershipId,name,email,roleKeys:string[]}[] }} ctx */
export default async function seed(ctx) {
  const { api, log } = ctx;
  const team = await api.get('/legal/team');
  const idOf = new Map(team.map((t) => [t.name, t.id]));
  const withRole = (key) => ctx.users.filter((u) => u.roleKeys.includes(key)).map((u) => idOf.get(u.name)).filter(Boolean);
  const lawyers = withRole('legal.lawyer').length ? withRole('legal.lawyer') : team.map((t) => t.id);
  const assistants = withRole('legal.assistant').length ? withRole('legal.assistant') : lawyers;

  const persons = ctx.customers.filter((c) => c.type === 'person');
  const companies = ctx.customers.filter((c) => c.type === 'company');
  const clientOf = ([type, i]) => {
    const preferred = type === 'company' ? companies : persons;
    const list = preferred.length ? preferred : ctx.customers;
    return list[i % list.length];
  };
  const responsibleOf = (i) => lawyers[i % lawyers.length] ?? null;

  /** Processos já cadastrados por título (para rodar de novo sem duplicar). */
  const casesByTitle = async () => new Map((await api.get('/legal/cases', { limit: 500 })).map((c) => [c.title, c]));

  await step(log, 'jurídico: processos', async () => {
    const existing = await casesByTitle();
    let created = 0;
    for (const [i, c] of CASES.entries()) {
      if (existing.has(c.title)) continue;
      await api.post('/legal/cases', {
        customerId: clientOf(c.client).id,
        number: c.cnj ? cnj(ctx.rng.int(1000000, 9999999), ...c.cnj) : null,
        title: c.title,
        area: c.area,
        role: c.role,
        court: c.court,
        opposingParty: c.opposingParty,
        claimValue: c.claimValue,
        responsibleUserId: responsibleOf(i),
        status: c.status,
        notes: c.notes,
      });
      created++;
    }
    log(`    ${created} processos criados (${existing.size} já existiam)`);
  });

  const cases = await casesByTitle();
  const each = async (fn) => {
    for (const [i, spec] of CASES.entries()) {
      const c = cases.get(spec.title);
      if (c) await fn(spec, c, i);
    }
  };

  await step(log, 'jurídico: andamentos', async () => {
    let added = 0;
    await each(async (spec, c) => {
      if ((await api.get(`/legal/cases/${c.id}/updates`)).length) return;
      for (const [n, description] of spec.updates) {
        await api.post(`/legal/cases/${c.id}/updates`, { occurredOn: wd(n), description });
        added++;
      }
    });
    log(`    ${added} andamentos`);
  });

  await step(log, 'jurídico: prazos', async () => {
    let added = 0;
    let done = 0;
    await each(async (spec, c, i) => {
      if ((await api.get('/legal/deadlines', { caseId: c.id })).length) return;
      for (const [k, [title, n, alertDays, state]] of spec.deadlines.entries()) {
        const { id } = await api.post('/legal/deadlines', {
          caseId: c.id,
          title,
          dueOn: wd(n),
          alertDays,
          assignedUserId: k % 2 ? assistants[i % assistants.length] : responsibleOf(i),
          notes: n < 0 && state !== 'done' ? 'Atenção: prazo vencido, verificar com o responsável.' : null,
        });
        added++;
        if (state === 'done') {
          // Registra também o andamento "Prazo cumprido" (com a data de hoje: a API não aceita outra).
          await api.post(`/legal/deadlines/${id}/done`);
          done++;
        }
      }
    });
    log(`    ${added} prazos (${done} cumpridos)`);
  });

  await step(log, 'jurídico: honorários', async () => {
    let added = 0;
    let successes = 0;
    await each(async (spec, c) => {
      if ((await api.get(`/legal/cases/${c.id}/fees`)).length) return;
      for (const f of spec.fees) {
        const { id } = await api.post('/legal/fees', {
          caseId: c.id,
          kind: f.kind,
          description: f.description,
          amount: f.amount ?? null,
          installments: f.installments ?? 1,
          firstDueOn: f.firstDueOn !== undefined ? day(f.firstDueOn) : null,
          successPercent: f.successPercent ?? null,
        });
        added++;
        if (f.success) {
          await api.post(`/legal/fees/${id}/success`, { obtainedAmount: f.success.obtainedAmount, dueOn: day(f.success.dueOn) });
          successes++;
        }
      }
    });
    log(`    ${added} honorários (${successes} êxito registrado)`);
  });

  await step(log, 'jurídico: agenda (audiências e reuniões)', async () => {
    const from = at(-150, 0);
    const to = at(90, 0);
    const current = await api.get('/scheduling/appointments', { from, to });
    if (current.some((a) => a.subject?.type === 'legal_case')) {
      log(`    agenda já tem ${current.length} horários`);
      return;
    }

    // Um profissional na agenda para cada advogado(a), com expediente de segunda a sexta.
    let resources = await api.get('/scheduling/resources');
    for (const [i, userId] of lawyers.entries()) {
      if (resources.some((r) => r.userId === userId)) continue;
      const name = team.find((t) => t.id === userId)?.name ?? `Advogado(a) ${i + 1}`;
      const r = await api.post('/scheduling/resources', { name, kind: 'professional', userId, color: RESOURCE_COLORS[i % RESOURCE_COLORS.length], active: true });
      const id = r?.id;
      if (id) await api.put(`/scheduling/resources/${id}/hours`, { hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })) });
    }
    resources = await api.get('/scheduling/resources');
    if (!resources.length) throw new Error('nenhum profissional na agenda');
    const resourceOf = (userId, i) => resources.find((r) => r.userId === userId && r.active) ?? resources[i % resources.length];

    const services = await api.get('/scheduling/services');
    const serviceId = (name) => {
      const s = services.find((x) => x.name === name && x.active);
      if (!s) throw new Error(`serviço "${name}" não existe na agenda`);
      return s.id;
    };
    const accounts = await api.get('/scheduling/payment-accounts');
    const account = accounts.find((a) => a.type === 'bank') ?? accounts[0];

    let created = 0;
    const book = async ({ customerId, resource, n, hh, mm, service, status, paid, notes, subject }) => {
      const a = await api.post('/scheduling/appointments', { customerId, resourceId: resource.id, startsAt: at(workday(n), hh, mm), serviceIds: [serviceId(service)], notes, subject });
      created++;
      if (status && status !== 'scheduled') await api.post(`/scheduling/appointments/${a.id}/status`, { status });
      if (paid && a.total > 0 && account) {
        await api.post(`/scheduling/appointments/${a.id}/payments`, { amount: a.total, method: 'pix', accountId: account.id, paidAt: day(workday(n)) });
      }
    };

    for (const [i, spec] of CASES.entries()) {
      const c = cases.get(spec.title);
      if (!c || !spec.agenda) continue;
      for (const item of spec.agenda) {
        await book({ ...item, customerId: c.customer.id, resource: resourceOf(c.responsible?.id, i), subject: { type: 'legal_case', id: c.id, label: c.number ?? c.title } });
      }
    }
    // Primeira consulta de um possível cliente novo, ainda sem processo.
    const prospect = persons[7 % Math.max(persons.length, 1)] ?? ctx.customers[0];
    await book({ customerId: prospect.id, resource: resources[0], n: 2, hh: 17, mm: 0, service: 'Consulta inicial', notes: 'Dúvidas sobre rescisão de contrato de locação comercial.' });
    log(`    ${created} horários na agenda`);
  });
}
