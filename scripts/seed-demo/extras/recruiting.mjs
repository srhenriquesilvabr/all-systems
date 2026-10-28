// Head hunter na consultoria de RH de demonstração (fake-rh): vagas de três empresas-clientes,
// candidatos com currículos em PDF gerados aqui (nomes e e-mails fictícios, @example.com) e
// candidaturas espalhadas pelas etapas, com nota no modo estimativa (sem IA). Só completa o que
// falta: vaga existente (mesmo título e contratante) e candidato existente (mesmo e-mail) são
// reaproveitados, e candidatura repetida é pulada.
//
// O módulo precisa estar ativo na empresa. Não há rota de API para ativar módulos; ative pelo CLI:
//   pnpm --filter @all/api cli module:enable --tenant <id da fake-rh> --module recruiting
import { personName, slugify, step } from '../lib.mjs';

/** Vagas: duas por empresa-cliente. `pause` = pausada depois de receber candidaturas. */
const JOBS = [
  {
    title: 'Analista financeiro pleno',
    area: 'Financeiro',
    description: 'Atuação no contas a pagar e a receber, conciliações e apoio ao fechamento mensal de uma indústria de médio porte.',
    requirements: ['Excel avançado', 'Conciliação bancária', 'Formação em Ciências Contábeis ou Administração'],
    niceToHave: ['Power BI', 'SAP'],
    benefits: ['Vale-refeição', 'Plano de saúde', 'PLR'],
    salary: [5500, 7000],
    workModel: 'hybrid',
    city: 'São Paulo',
    contractType: 'clt',
    positions: 1,
    questions: [{ id: 'hibrido', label: 'Tem disponibilidade para ir ao escritório em São Paulo três vezes por semana?', kind: 'yes_no', required: true }],
    skills: ['Fechamento mensal', 'Contas a pagar e a receber', 'Fluxo de caixa', 'Relatórios gerenciais'],
  },
  {
    title: 'Assistente de departamento pessoal',
    area: 'Recursos Humanos',
    description: 'Rotinas de departamento pessoal para cerca de 300 colaboradores: admissões, férias, rescisões e apoio à folha.',
    requirements: ['Rotinas de departamento pessoal', 'Admissão e rescisão', 'eSocial'],
    niceToHave: ['Folha de pagamento', 'Excel intermediário'],
    benefits: ['Vale-transporte', 'Vale-refeição'],
    salary: [2800, 3400],
    workModel: 'onsite',
    city: 'São Paulo',
    contractType: 'clt',
    positions: 2,
    questions: [],
    skills: ['Controle de ponto', 'Benefícios', 'Atendimento a colaboradores', 'Arquivo de documentos'],
  },
  {
    title: 'Desenvolvedor backend Node.js',
    area: 'Tecnologia',
    description: 'Desenvolvimento de APIs para a plataforma de pedidos, em time ágil, com revisão de código e testes automatizados.',
    requirements: ['Node.js', 'TypeScript', 'PostgreSQL', 'APIs REST'],
    niceToHave: ['NestJS', 'Docker', 'AWS'],
    benefits: ['Horário flexível', 'Auxílio home office'],
    salary: [9000, 13000],
    workModel: 'remote',
    city: null,
    contractType: 'pj',
    positions: 1,
    questions: [{ id: 'projeto', label: 'Conte rapidamente um projeto com Node.js de que você se orgulha.', kind: 'text', required: false }],
    skills: ['Testes automatizados', 'Git', 'Filas e mensageria', 'Code review'],
  },
  {
    title: 'Vendedor externo B2B',
    area: 'Comercial',
    description: 'Prospecção e visitas a clientes empresariais na região de Campinas, com metas mensais e comissão.',
    requirements: ['Vendas B2B', 'CNH categoria B', 'Carteira de clientes'],
    niceToHave: ['CRM', 'Inglês básico'],
    benefits: ['Comissão', 'Ajuda de custo para combustível'],
    salary: [3000, 4500],
    workModel: 'onsite',
    city: 'Campinas',
    contractType: 'clt',
    positions: 2,
    questions: [{ id: 'veiculo', label: 'Possui veículo próprio?', kind: 'yes_no', required: true }],
    skills: ['Negociação', 'Pós-venda', 'Prospecção ativa', 'Metas de vendas'],
    pause: true,
  },
  {
    title: 'Técnico de segurança do trabalho',
    area: 'Operações',
    description: 'Acompanhamento das frentes de trabalho, treinamentos e inspeções de segurança em fábrica metalúrgica.',
    requirements: ['Curso técnico em segurança do trabalho', 'Registro no MTE', 'NR-10 e NR-35'],
    niceToHave: ['Indústria metalúrgica', 'CIPA'],
    benefits: ['Refeitório no local', 'Plano odontológico'],
    salary: [4200, 5200],
    workModel: 'onsite',
    city: 'Sorocaba',
    contractType: 'clt',
    positions: 1,
    questions: [],
    skills: ['Inspeções de campo', 'Treinamentos de integração', 'Investigação de acidentes', 'PPRA e PCMSO'],
  },
  {
    title: 'Estágio em marketing',
    area: 'Marketing',
    description: 'Apoio na produção de conteúdo para redes sociais, campanhas e relatórios de desempenho.',
    requirements: ['Cursando Marketing, Publicidade ou Comunicação', 'Redes sociais', 'Canva'],
    niceToHave: ['Google Analytics', 'Inglês intermediário'],
    benefits: ['Bolsa-auxílio', 'Vale-transporte'],
    salary: [1600, 1600],
    workModel: 'hybrid',
    city: 'São Paulo',
    contractType: 'internship',
    positions: 1,
    questions: [],
    skills: ['Calendário editorial', 'Fotografia de produto', 'Copywriting', 'Métricas de engajamento'],
  },
];

const CITIES = [
  ['São Paulo', 'SP'],
  ['Guarulhos', 'SP'],
  ['Osasco', 'SP'],
  ['Santo André', 'SP'],
  ['Campinas', 'SP'],
  ['Sorocaba', 'SP'],
  ['Jundiaí', 'SP'],
];
const SCHOOLS = ['Faculdade Exemplo', 'Universidade Fictícia de São Paulo', 'Centro Universitário Demonstração', 'Escola Técnica Modelo'];
const EMPLOYERS = ['Empresa Exemplo Ltda', 'Comércio Fictício SA', 'Indústria Modelo Ltda', 'Serviços Demonstração ME', 'Grupo Ilustrativo SA'];
const REJECT_REASONS = [
  'Pretensão salarial acima da faixa da vaga',
  'Não tem a experiência exigida em requisitos obrigatórios',
  'Sem disponibilidade para o modelo de trabalho',
  'Desistiu do processo após a entrevista',
  'Perfil técnico abaixo do esperado no teste',
];
const NOTES = ['Boa comunicação na entrevista; pediu retorno até sexta.', 'Referências conferidas com o último empregador.', 'Gestor gostou do perfil; avaliar proposta.', 'Disponível para começar em 15 dias.'];

/** Etapa final de cada candidatura nova (pesos somam 100). */
const OUTCOMES = [
  ['triagem', 34],
  ['entrevista-rh', 20],
  ['entrevista-gestor', 12],
  ['proposta', 8],
  ['contratado', 4],
  ['reprovado', 22],
];

/** @param {{ api, rng, log, tenant: {id,name}, customers: {id,name,type}[], users: unknown[] }} ctx */
export default async function seedRecruiting(ctx) {
  if (ctx.tenant.name !== 'fake-rh') return;
  const { api, log } = ctx;
  try {
    await api.get('/recruiting/status');
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      log(`  - head hunter: módulo não ativo. Ative com: pnpm --filter @all/api cli module:enable --tenant ${ctx.tenant.id} --module recruiting`);
      return;
    }
    throw err;
  }
  const jobs = await step(log, 'head hunter: vagas das empresas-clientes', () => seedJobs(ctx));
  if (!jobs?.length) return;
  await step(log, 'head hunter: candidatos, currículos e candidaturas pelo funil', () => seedApplications(ctx, jobs));
  await step(log, 'head hunter: vagas pausadas', () => pauseJobs(ctx, jobs));
}

async function seedJobs({ api, log }) {
  const companies = (await api.get('/recruiting/companies')).slice(0, 3);
  if (!companies.length) log('    sem clientes do tipo empresa: as vagas ficam como da própria consultoria');
  const existing = await api.get('/recruiting/jobs');
  const out = [];
  for (const [i, def] of JOBS.entries()) {
    const company = companies.length ? companies[Math.floor(i / 2) % companies.length] : null;
    let job = existing.find((j) => j.title === def.title && (j.customerId ?? null) === (company?.id ?? null));
    if (!job) {
      const created = await api.post('/recruiting/jobs', {
        customerId: company?.id ?? null,
        title: def.title,
        area: def.area,
        description: def.description,
        requirements: def.requirements,
        niceToHave: def.niceToHave,
        salaryMin: def.salary[0],
        salaryMax: def.salary[1],
        showSalary: i % 2 === 0,
        benefits: def.benefits,
        workModel: def.workModel,
        city: def.city,
        state: def.city ? 'SP' : null,
        contractType: def.contractType,
        positions: def.positions,
        questions: def.questions,
      });
      job = { id: created.id, status: 'draft' };
    }
    if (job.status === 'draft') await api.post(`/recruiting/jobs/${job.id}/status`, { status: 'open' });
    out.push({ ...def, id: job.id, company: company?.name ?? null });
  }
  log(`    ${out.length} vagas (${companies.map((c) => c.name).join(', ') || 'própria empresa'})`);
  return out;
}

async function seedApplications(ctx, jobs) {
  const { api, rng, log } = ctx;
  const used = new Set();
  let created = 0;
  let skipped = 0;
  let hiredOne = false;
  // 36 candidatos, 4 deles em duas vagas: 40 candidaturas.
  for (let i = 0; i < 36; i++) {
    const name = personName(rng, used);
    const email = `${slugify(name)}.${i + 1}@example.com`;
    const [city, state] = rng.pick(CITIES);
    const main = jobs[i % jobs.length];
    const fit = rng.next();
    const targets = i < 4 ? [main, jobs[(i + 3) % jobs.length]] : [main];

    let candidate = (await api.get('/recruiting/candidates', { q: email, limit: 1 })).items.find((c) => c.email === email);
    if (!candidate) {
      // Sem LinkedIn: um endereço inventado poderia ser o perfil de alguém de verdade.
      candidate = await api.post('/recruiting/candidates', { name, email, phone: rng.phone(), city, state });
      const pdf = resumePdf({ name, city, state, job: main, fit, rng });
      await api.upload(`/recruiting/candidates/${candidate.id}/resume`, 'file', pdf, `curriculo-${slugify(name)}.pdf`, 'application/pdf');
    }

    for (const job of targets) {
      let app;
      try {
        app = await api.post('/recruiting/applications', {
          candidateId: candidate.id,
          jobId: job.id,
          analysis: 'heuristic',
          salaryExpectation: Math.round((job.salary[0] + rng.next() * (job.salary[1] - job.salary[0]) * 1.3) / 100) * 100,
          answers: job.questions.map((q) => ({ questionId: q.id, answer: q.kind === 'yes_no' ? (rng.chance(0.75) ? 'Sim' : 'Não') : 'Criei uma API de pedidos com filas e testes automatizados.' })),
        });
      } catch (err) {
        if (err.status === 409) {
          skipped++;
          continue;
        }
        throw err;
      }
      created++;
      // Quem tem o currículo mais aderente tende a ir mais longe no funil.
      const outcome = pickOutcome(rng, job === main ? fit : fit / 2);
      await walk(api, rng, app.id, outcome, { hire: outcome === 'contratado' && !hiredOne });
      if (outcome === 'contratado') hiredOne = true;
    }
  }
  log(`    ${created} candidaturas novas${skipped ? `, ${skipped} já existiam` : ''}`);
}

function pickOutcome(rng, fit) {
  // Aderência alta desloca a sorte para as etapas finais; baixa, para triagem e reprovação.
  const weights = OUTCOMES.map(([stage, w]) => [stage, stage === 'triagem' || stage === 'reprovado' ? w * (1.4 - fit) : w * (0.6 + fit)]);
  let r = rng.next() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [stage, w] of weights) if ((r -= w) <= 0) return stage;
  return 'triagem';
}

/** Move pelas etapas até o destino (o histórico mostra o caminho), anota e reprova quando for o caso. */
async function walk(api, rng, appId, outcome, { hire }) {
  const path = ['entrevista-rh', 'entrevista-gestor', 'proposta', 'contratado'];
  if (outcome === 'triagem') return;
  if (outcome === 'reprovado') {
    const until = rng.int(0, 2);
    for (const stage of path.slice(0, until)) await api.post(`/recruiting/applications/${appId}/move`, { stageId: stage });
    await api.post(`/recruiting/applications/${appId}/reject`, { reason: rng.pick(REJECT_REASONS) });
    return;
  }
  for (const stage of path.slice(0, path.indexOf(outcome) + 1)) await api.post(`/recruiting/applications/${appId}/move`, { stageId: stage });
  if (outcome !== 'entrevista-rh' || rng.chance(0.5)) await api.post(`/recruiting/applications/${appId}/notes`, { text: rng.pick(NOTES) });
  // Um contratado vira pessoa da equipe (mostra o botão "Cadastrar na equipe" já usado).
  if (hire) await api.post(`/recruiting/applications/${appId}/hire`, {});
}

async function pauseJobs({ api }, jobs) {
  for (const job of jobs.filter((j) => j.pause)) await api.post(`/recruiting/jobs/${job.id}/status`, { status: 'paused' });
}

// ---- Currículo em PDF (texto simples, sem dados reais) ----------------------------------------

function resumePdf({ name, city, state, job, fit, rng }) {
  const required = job.requirements.filter(() => rng.next() < 0.25 + fit * 0.75);
  const desired = job.niceToHave.filter(() => rng.next() < fit);
  const years = rng.int(1, 12);
  const lines = [
    name,
    `${city}/${state} - e-mail e telefone no cadastro da candidatura`,
    '',
    'RESUMO',
    `Profissional da área de ${job.area.toLowerCase()} com ${years} ${years === 1 ? 'ano' : 'anos'} de experiência.`,
    '',
    'EXPERIÊNCIA',
    `${rng.pick(EMPLOYERS)} (${2026 - years} - atual)`,
    ...required.map((r) => `- ${r}`),
    ...rng.shuffle(job.skills).slice(0, 2).map((s) => `- ${s}`),
    `${rng.pick(EMPLOYERS)} (${2026 - years - rng.int(1, 4)} - ${2026 - years})`,
    ...rng.shuffle(job.skills).slice(0, 2).map((s) => `- ${s}`),
    '',
    'FORMAÇÃO',
    `${rng.pick(SCHOOLS)} - curso na área de ${job.area.toLowerCase()}`,
    '',
    'COMPETÊNCIAS',
    ...desired.map((d) => `- ${d}`),
    '- Pacote Office',
    '- Trabalho em equipe e organização',
    '',
    'Currículo fictício gerado para demonstração.',
  ];
  return simplePdf(lines);
}

/** PDF de uma página (Helvetica, WinAnsi), com uma linha de texto por item. */
function simplePdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = Buffer.from(`BT /F1 11 Tf 50 800 Td 15 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join('\n')}\nET`, 'latin1');
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    parts.push(b);
    pos += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}
