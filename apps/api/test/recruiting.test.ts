import { configureHttp, MailService, OutboxRelay, ScheduledJobs, TenancyService, type MailMessage } from '@all/core';
import { AnthropicHttp, GupyHttp, type AnthropicRequest, heuristicScore, indeedFeed, pdfText } from '@all/recruiting';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { testEnv } from './env';
import { auth, PASSWORD, tokenFromMail, uniqueEmail } from './helpers';

// Head hunter: vagas, página pública com candidatura, nota de aderência (IA falsa e estimativa),
// funil, contratação, LGPD, Gupy (HTTP falso e simulado) e feed do Indeed. Nenhuma chamada externa real.

/** PDF mínimo com uma linha de texto por item (Helvetica, WinAnsi), como o gerado pelo seed. */
function simplePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = Buffer.from(`BT /F1 11 Tf 50 800 Td 14 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join('\n')}\nET`, 'latin1');
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let pos = parts[0]!.length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    parts.push(b);
    pos += b.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}

const CV_GOOD = simplePdf([
  'Joana Candidata Teste',
  'Analista financeira com 6 anos de experiência em empresas de médio porte.',
  'Excel avançado com tabelas dinâmicas, PROCV e macros; relatórios gerenciais no Power BI.',
  'Conciliação bancária diária, contas a pagar e a receber, fechamento mensal.',
  'Formação em Ciências Contábeis; inglês intermediário.',
]);
const CV_WEAK = simplePdf(['Pedro Candidato Teste', 'Atendente de loja há dois anos, vendas e caixa.', 'Ensino médio completo.']);

interface Harness {
  app: INestApplication;
  tenancy: TenancyService;
  relay: OutboxRelay;
  jobs: ScheduledJobs;
  mails: MailMessage[];
  anthropic: { calls: { apiKey: string; betas: string[]; body: any }[]; respond: (body: any) => { status: number; body: any } };
  gupy: { calls: { method: string; url: string; token: string; body: any }[]; respond: (method: string, url: string) => { status: number; body: any } };
  http: () => ReturnType<typeof request>;
}

const aiReply = (score: number) => ({
  status: 200,
  body: {
    id: 'msg_teste',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ score, strengths: ['Excel avançado com macros'], gaps: ['Sem SAP'], summary: 'Atende aos obrigatórios.' }) }],
    usage: { input_tokens: 3000, output_tokens: 500 },
  },
});

describe('Head hunter (recrutamento)', () => {
  let t: Harness;
  const admin = new Client({ connectionString: testEnv.MIGRATION_DATABASE_URL });

  beforeAll(async () => {
    const mails: MailMessage[] = [];
    const anthropic: Harness['anthropic'] = { calls: [], respond: () => aiReply(88) };
    const gupy: Harness['gupy'] = { calls: [], respond: (method) => ({ status: method === 'POST' ? 201 : 200, body: { id: 4242 } }) };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
      .overrideProvider(MailService)
      .useValue({ send: async (m: MailMessage) => void mails.push(m), sendInBackground: (m: MailMessage) => void mails.push(m) })
      .overrideProvider(AnthropicHttp)
      .useValue({
        post: async (req: AnthropicRequest) => {
          anthropic.calls.push({ apiKey: req.apiKey, betas: req.betas, body: req.body });
          return anthropic.respond(req.body);
        },
      })
      .overrideProvider(GupyHttp)
      .useValue({
        request: async (method: string, url: string, token: string, body?: unknown) => {
          gupy.calls.push({ method, url, token, body });
          return gupy.respond(method, url);
        },
      })
      .compile();
    const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
    configureHttp(app);
    await app.init();
    t = { app, tenancy: app.get(TenancyService), relay: app.get(OutboxRelay), jobs: app.get(ScheduledJobs), mails, anthropic, gupy, http: () => request(app.getHttpServer()) };
    await admin.connect();
  });
  afterAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await admin.end();
    await t.app.close();
  });
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    t.anthropic.calls.length = 0;
    t.gupy.calls.length = 0;
    t.anthropic.respond = () => aiReply(88);
  });

  async function session() {
    const email = uniqueEmail('hh');
    const { tenantId } = await t.tenancy.createTenant({ name: `Consultoria ${email.slice(3, 9)}`, modules: ['recruiting'], owner: { email, name: 'Dona', password: PASSWORD } });
    const login = await t.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    const token = login.body.accessToken as string;
    const as = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => t.http()[method](`/api${path}`).set(auth(token));
    const slug = (await admin.query(`select slug from tenants where id = $1`, [tenantId])).rows[0].slug as string;
    return { tenantId, token, as, slug };
  }
  type Session = Awaited<ReturnType<typeof session>>;

  async function company(s: Session, name = 'Metalúrgica Cliente Ltda') {
    return (await s.as('post', '/customers').send({ type: 'company', name }).expect(201)).body.id as string;
  }

  const jobBody = (customerId: string | null) => ({
    customerId,
    title: 'Analista financeiro',
    area: 'Financeiro',
    description: 'Rotina de contas a pagar e receber.',
    requirements: ['Excel avançado', 'Conciliação bancária', 'Formação em Ciências Contábeis'],
    niceToHave: ['Power BI', 'SAP'],
    salaryMin: 4000,
    salaryMax: 5500,
    showSalary: true,
    benefits: ['Vale-refeição'],
    workModel: 'hybrid',
    city: 'São Paulo',
    state: 'sp',
    contractType: 'clt',
    positions: 2,
    questions: [{ id: 'viagens', label: 'Tem disponibilidade para viagens?', kind: 'yes_no', required: true }],
  });

  async function openJob(s: Session, customerId: string | null = null, extra: Record<string, unknown> = {}) {
    const { body } = await s.as('post', '/recruiting/jobs').send({ ...jobBody(customerId), ...extra }).expect(201);
    await s.as('post', `/recruiting/jobs/${body.id}/status`).send({ status: 'open' }).expect(200);
    return body.id as string;
  }

  function apply(s: Session, jobId: string, fields: Record<string, string> = {}, file: Buffer | null = CV_GOOD) {
    let req = t
      .http()
      .post(`/api/public/jobs/${s.slug}/${jobId}/apply`)
      .field('name', fields.name ?? 'Joana Candidata')
      .field('email', fields.email ?? uniqueEmail('cand'))
      .field('phone', fields.phone ?? '(11) 98888-7777')
      .field('city', fields.city ?? 'São Paulo')
      .field('state', 'SP')
      .field('salaryExpectation', '5.000,00')
      .field('answers', JSON.stringify([{ questionId: 'viagens', answer: 'Sim' }]))
      .field('consent', fields.consent ?? 'true')
      .field('consentVersion', 'v1');
    if (fields.website) req = req.field('website', fields.website);
    if (file) req = req.attach('resume', file, { filename: 'curriculo.pdf', contentType: 'application/pdf' });
    return req;
  }

  async function board(s: Session, jobId: string) {
    return (await s.as('get', `/recruiting/jobs/${jobId}/applications`).expect(200)).body as { stages: { id: string; kind: string }[]; applications: any[] };
  }

  it('aparece no catálogo, cria os papéis padrão e exige o módulo ativo', async () => {
    const s = await session();
    const catalog = (await s.as('get', '/modules/catalog').expect(200)).body as { key: string; layer: string }[];
    expect(catalog.find((m) => m.key === 'recruiting')).toMatchObject({ layer: 'shared' });
    const roles = (await s.as('get', '/access/roles').expect(200)).body as { key: string }[];
    expect(roles.map((r) => r.key)).toEqual(expect.arrayContaining(['recruiting.recruiter', 'recruiting.viewer']));

    const email = uniqueEmail('sem');
    await t.tenancy.createTenant({ name: 'Sem head hunter', modules: [], owner: { email, name: 'X', password: PASSWORD } });
    const other = await t.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    await t.http().get('/api/recruiting/jobs').set(auth(other.body.accessToken)).expect(403);
  });

  it('vaga: contratante precisa ser cliente empresa; etapas padrão; validações', async () => {
    const s = await session();
    const person = (await s.as('post', '/customers').send({ type: 'person', name: 'Pessoa Física' }).expect(201)).body.id;
    expect((await s.as('post', '/recruiting/jobs').send(jobBody(person)).expect(400)).body.message).toContain('tipo empresa');
    expect((await s.as('post', '/recruiting/jobs').send({ ...jobBody(null), salaryMin: 6000, salaryMax: 5000 }).expect(400)).body.code).toBe('VALIDATION');
    expect(
      (await s.as('post', '/recruiting/jobs').send({ ...jobBody(null), stages: [{ id: 'a', name: 'A', kind: 'hired' }, { id: 'b', name: 'B', kind: 'open' }] }).expect(400)).body.code,
    ).toBe('VALIDATION');

    const customerId = await company(s);
    const { body } = await s.as('post', '/recruiting/jobs').send(jobBody(customerId)).expect(201);
    const job = (await s.as('get', `/recruiting/jobs/${body.id}`).expect(200)).body;
    expect(job).toMatchObject({ status: 'draft', company: 'Metalúrgica Cliente Ltda', state: 'SP', salaryMin: 4000, positions: 2 });
    expect(job.stages.map((x: { name: string }) => x.name)).toEqual(['Triagem', 'Entrevista RH', 'Entrevista gestor', 'Proposta', 'Contratado']);
    expect((await s.as('get', '/recruiting/companies').expect(200)).body.map((c: { id: string }) => c.id)).toEqual([customerId]);

    // Rascunho não aparece na página pública.
    expect((await t.http().get(`/api/public/jobs/${s.slug}`).expect(200)).body.jobs).toEqual([]);
  });

  it('página pública: lista, detalhe com consentimento, candidatura e proteções', async () => {
    const s = await session();
    const customerId = await company(s, 'Indústria Confidencial SA');
    const jobId = await openJob(s, customerId, { confidential: true });

    const list = (await t.http().get(`/api/public/jobs/${s.slug}`).expect(200)).body;
    expect(list.company.name).toMatch(/^Consultoria/);
    expect(list.jobs).toEqual([expect.objectContaining({ id: jobId, title: 'Analista financeiro', hiringCompany: null, salary: expect.stringMatching(/^R\$\s4\.000 a R\$\s5\.500$/) })]);
    const detail = (await t.http().get(`/api/public/jobs/${s.slug}/${jobId}`).expect(200)).body;
    expect(detail.consent.version).toBe('v1');
    expect(detail.consent.text).toContain('12 meses');
    expect(detail.consent.text).toContain('inteligência artificial');
    expect(detail.consent.text).not.toContain('Indústria Confidencial');

    // Sem consentimento, sem PDF, sem resposta obrigatória: recusado.
    expect((await apply(s, jobId, { consent: 'false' }).expect(400)).body.code).toBe('VALIDATION');
    expect((await apply(s, jobId, {}, Buffer.from('não é pdf')).expect(400)).body.code).toBe('INVALID_FILE_TYPE');
    expect((await apply(s, jobId, {}, null).expect(400)).body.code).toBe('FILE_REQUIRED');

    // Robô (campo escondido preenchido): responde ok e não grava nada.
    await apply(s, jobId, { website: 'http://spam.example' }).expect(201);
    expect((await board(s, jobId)).applications).toHaveLength(0);

    const email = uniqueEmail('joana');
    expect((await apply(s, jobId, { email: email.toUpperCase() }).expect(201)).body).toMatchObject({ ok: true });
    expect((await apply(s, jobId, { email }).expect(409)).body.code).toBe('ALREADY_APPLIED');

    const { applications } = await board(s, jobId);
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({ stageId: 'triagem', status: 'active', source: 'public', analysisStatus: 'pending' });
    const app = (await s.as('get', `/recruiting/applications/${applications[0].id}`).expect(200)).body;
    expect(app.candidate).toMatchObject({ email, phone: '+5511988887777', city: 'São Paulo' });
    expect(app.salaryExpectation).toBe(5000);
    expect(app.answers).toEqual([{ questionId: 'viagens', question: 'Tem disponibilidade para viagens?', answer: 'Sim' }]);
    expect(app.consent.text).toBe(detail.consent.text);
    expect(app.resume).toMatchObject({ filename: 'curriculo.pdf', mime: 'application/pdf' });

    // O currículo não sai pelo download genérico.
    await s.as('get', `/files/${app.resume.id}`).expect(404);
    const pdf = await s.as('get', `/recruiting/applications/${app.id}/resume`).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('limite de candidaturas por IP', async () => {
    const s = await session();
    const jobId = await openJob(s);
    for (let i = 0; i < 5; i++) await apply(s, jobId).expect(201);
    expect((await apply(s, jobId).expect(429)).body.code).toBe('TOO_MANY_APPLICATIONS');
  });

  it('sem chave da Anthropic: estimativa por palavras-chave, calculada pelo outbox', async () => {
    const s = await session();
    const jobId = await openJob(s);
    await apply(s, jobId, { name: 'Joana Boa', email: uniqueEmail('boa') }).expect(201);
    await apply(s, jobId, { name: 'Pedro Fraco', email: uniqueEmail('fraco') }, CV_WEAK).expect(201);
    await t.relay.drain();

    const { applications } = await board(s, jobId);
    expect(applications.map((a) => a.candidate.name)).toEqual(['Joana Boa', 'Pedro Fraco']);
    expect(applications[0]).toMatchObject({ scoreMethod: 'heuristic', analysisStatus: 'done' });
    expect(applications[0].score).toBeGreaterThan(applications[1].score);
    expect(t.anthropic.calls).toHaveLength(0);
    const detail = (await s.as('get', `/recruiting/applications/${applications[0].id}`).expect(200)).body;
    expect(detail.analyses[0]).toMatchObject({ method: 'heuristic', status: 'done', model: null, costUsd: null });
    expect(detail.analyses[0].strengths).toEqual(expect.arrayContaining(['Excel avançado', 'Conciliação bancária']));
    expect(detail.analyses[0].summary).toContain('Estimativa sem IA');
  });

  it('com chave: a IA analisa no job (PDF como document, saída estruturada) e registra uso e custo', async () => {
    process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
    const s = await session();
    const jobId = await openJob(s);
    await apply(s, jobId).expect(201);
    await t.relay.drain();
    // O handler do outbox não chama a IA (a transação do relay não pode esperar).
    expect(t.anthropic.calls).toHaveLength(0);
    expect((await board(s, jobId)).applications[0].analysisStatus).toBe('pending');

    await t.jobs.runOnce('recruiting.analyses');
    const call = t.anthropic.calls.find((c) => JSON.stringify(c.body).includes('Analista financeiro'));
    expect(call).toBeDefined();
    expect(call).toMatchObject({ apiKey: 'chave-de-teste', betas: ['server-side-fallback-2026-07-01'] });
    expect(call!.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { format: { type: 'json_schema' } } });
    const content = call!.body.messages[0].content;
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(Buffer.from(content[0].source.data, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    // Minimização: nome e e-mail do candidato não vão no texto.
    expect(content[1].text).not.toContain('Joana');
    expect(content[1].text).toContain('Tem disponibilidade para viagens?');

    const app = (await board(s, jobId)).applications[0];
    expect(app).toMatchObject({ score: 88, scoreMethod: 'ai', analysisStatus: 'done' });
    const detail = (await s.as('get', `/recruiting/applications/${app.id}`).expect(200)).body;
    expect(detail.analyses[0]).toMatchObject({ method: 'ai', model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 500, strengths: ['Excel avançado com macros'] });
    // 3000 × US$4/M + 500 × US$20/M = US$0,022 (Claude Opus 5.5)
    expect(detail.analyses[0].costUsd).toBeCloseTo(0.022, 6);
  });

  it('IA com erro definitivo cai na estimativa; erro passageiro tenta de novo', async () => {
    process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
    const s = await session();
    const jobId = await openJob(s);
    await apply(s, jobId).expect(201);
    await t.relay.drain();

    t.anthropic.respond = () => ({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } });
    await t.jobs.runOnce('recruiting.analyses');
    let app = (await board(s, jobId)).applications[0];
    expect(app.analysisStatus).toBe('pending');

    t.anthropic.respond = () => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'modelo inválido' } } });
    await t.jobs.runOnce('recruiting.analyses');
    app = (await board(s, jobId)).applications[0];
    expect(app).toMatchObject({ scoreMethod: 'heuristic', analysisStatus: 'done' });
    const detail = (await s.as('get', `/recruiting/applications/${app.id}`).expect(200)).body;
    expect(detail.analyses[0].error).toContain('modelo inválido');
    expect(detail.analyses[0].summary).toContain('A análise por IA falhou');

    // "Analisar de novo" só com a estimativa: não chama a IA.
    const calls = t.anthropic.calls.length;
    await s.as('post', `/recruiting/applications/${app.id}/analyze`).send({ analysis: 'heuristic' }).expect(202);
    await t.relay.drain();
    expect(t.anthropic.calls.length).toBe(calls);
    expect((await s.as('get', `/recruiting/applications/${app.id}`).expect(200)).body.analyses).toHaveLength(2);
  });

  it('funil: mover, reprovar com motivo, reabrir, anotar e contratar criando a pessoa da equipe', async () => {
    const s = await session();
    const jobId = await openJob(s);
    const email = uniqueEmail('contratada');
    await apply(s, jobId, { name: 'Carla Contratada Souza', email }).expect(201);
    const id = (await board(s, jobId)).applications[0].id;

    await s.as('post', `/recruiting/applications/${id}/move`).send({ stageId: 'nao-existe' }).expect(400);
    await s.as('post', `/recruiting/applications/${id}/move`).send({ stageId: 'entrevista-rh' }).expect(200);
    expect((await s.as('post', `/recruiting/applications/${id}/reject`).send({ reason: 'x' }).expect(400)).body.code).toBe('VALIDATION');
    await s.as('post', `/recruiting/applications/${id}/reject`).send({ reason: 'Pretensão acima da faixa' }).expect(200);
    let app = (await s.as('get', `/recruiting/applications/${id}`).expect(200)).body;
    expect(app).toMatchObject({ status: 'rejected', stageId: 'entrevista-rh', rejectionReason: 'Pretensão acima da faixa' });

    await s.as('post', `/recruiting/applications/${id}/move`).send({ stageId: 'proposta' }).expect(200);
    await s.as('post', `/recruiting/applications/${id}/notes`).send({ text: 'Aceitou a contraproposta' }).expect(201);
    expect((await s.as('post', `/recruiting/applications/${id}/hire`).send({}).expect(400)).body.code).toBe('NOT_HIRED');
    await s.as('post', `/recruiting/applications/${id}/move`).send({ stageId: 'contratado' }).expect(200);
    const hired = (await s.as('post', `/recruiting/applications/${id}/hire`).send({ startedOn: '2026-11-03' }).expect(200)).body;
    expect(hired).toMatchObject({ created: true, hrActive: false });
    // Repetir devolve a mesma pessoa.
    expect((await s.as('post', `/recruiting/applications/${id}/hire`).send({}).expect(200)).body).toMatchObject({ teamMemberId: hired.teamMemberId, created: false });

    const person = (await s.as('get', `/team/${hired.teamMemberId}`).expect(200)).body;
    expect(person).toMatchObject({ firstName: 'Carla', lastName: 'Contratada Souza', email, phone: '+5511988887777', startedOn: '2026-11-03' });
    expect(person.resume).toMatchObject({ mime: 'application/pdf' });

    app = (await s.as('get', `/recruiting/applications/${id}`).expect(200)).body;
    expect(app).toMatchObject({ status: 'hired', teamMemberId: hired.teamMemberId });
    expect(app.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['applied', 'stage', 'rejected', 'reopened', 'note', 'hired']));

    // Etapa com candidatura não pode sumir da vaga.
    const stages = (await s.as('get', `/recruiting/jobs/${jobId}`).expect(200)).body.stages.filter((x: { id: string }) => x.id !== 'contratado');
    expect((await s.as('patch', `/recruiting/jobs/${jobId}`).send({ stages: [...stages, { id: 'admitido', name: 'Admitido', kind: 'hired' }] }).expect(409)).body.code).toBe('STAGE_IN_USE');
  });

  it('banco de talentos: candidato único por e-mail, inclusão manual em vaga e permissões', async () => {
    const s = await session();
    const jobId = await openJob(s);
    const email = uniqueEmail('manual');
    const { body: cand } = await s.as('post', '/recruiting/candidates').send({ name: 'Marcos Indicado', email, phone: '11 97777-6666', linkedinUrl: 'linkedin.com/in/marcos' }).expect(201);
    expect(cand).toMatchObject({ phone: '+5511977776666', linkedinUrl: 'https://linkedin.com/in/marcos', source: 'manual' });
    expect((await s.as('post', '/recruiting/candidates').send({ name: 'Outro Nome', email: email.toUpperCase() }).expect(409)).body.code).toBe('DUPLICATE_EMAIL');
    await s.as('post', `/recruiting/candidates/${cand.id}/resume`).attach('file', CV_GOOD, { filename: 'marcos.pdf', contentType: 'application/pdf' }).expect(201);
    const { body: app } = await s.as('post', '/recruiting/applications').send({ candidateId: cand.id, jobId, analysis: 'heuristic' }).expect(201);
    expect((await s.as('post', '/recruiting/applications').send({ candidateId: cand.id, jobId }).expect(409)).body.code).toBe('ALREADY_APPLIED');
    await t.relay.drain();
    expect((await s.as('get', `/recruiting/applications/${app.id}`).expect(200)).body).toMatchObject({ source: 'manual', scoreMethod: 'heuristic', resume: { filename: 'marcos.pdf' } });

    // A mesma pessoa pela página pública: atualiza o cadastro, não duplica.
    const job2 = await openJob(s, null, { title: 'Assistente financeiro', questions: [] });
    await apply(s, job2, { name: 'Marcos Indicado Silva', email }).expect(201);
    const list = (await s.as('get', '/recruiting/candidates', ).query({ q: email }).expect(200)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: 'Marcos Indicado Silva', applications: 2 });

    // Visualizador vê, mas não move nem exclui.
    const roles = (await s.as('get', '/access/roles').expect(200)).body as { id: string; key: string }[];
    const viewerEmail = uniqueEmail('viewer');
    await s.as('post', '/users/invite').send({ email: viewerEmail, name: 'Visualizador', roleIds: [roles.find((r) => r.key === 'recruiting.viewer')!.id] }).expect(201);
    await t.http().post('/api/auth/set-password').send({ token: tokenFromMail(t.mails.findLast((m) => m.to === viewerEmail)), password: PASSWORD, name: 'Visualizador' }).expect(204);
    const viewer = (await t.http().post('/api/auth/login').send({ email: viewerEmail, password: PASSWORD }).expect(200)).body.accessToken;
    await t.http().get(`/api/recruiting/jobs/${jobId}/applications`).set(auth(viewer)).expect(200);
    await t.http().post(`/api/recruiting/applications/${app.id}/move`).set(auth(viewer)).send({ stageId: 'proposta' }).expect(403);
    await t.http().post(`/api/recruiting/candidates/${cand.id}/anonymize`).set(auth(viewer)).expect(403);
  });

  it('LGPD: exportar e excluir dados ficam na auditoria; o currículo some', async () => {
    const s = await session();
    const jobId = await openJob(s);
    const email = uniqueEmail('lgpd');
    await apply(s, jobId, { name: 'Lia Privacidade', email }).expect(201);
    const appId = (await board(s, jobId)).applications[0].id;
    const candidateId = (await s.as('get', `/recruiting/applications/${appId}`).expect(200)).body.candidate.id;
    await s.as('post', `/recruiting/applications/${appId}/notes`).send({ text: 'Mora perto do cliente' }).expect(201);
    await s.as('get', `/recruiting/applications/${appId}/resume`).expect(200);

    const exported = (await s.as('get', `/recruiting/candidates/${candidateId}/export`).expect(200)).body;
    expect(exported.candidate.email).toBe(email);
    expect(exported.applications[0].consent.version).toBe('v1');
    expect(exported.applications[0].ipHash).toBeUndefined();

    await s.as('post', `/recruiting/candidates/${candidateId}/anonymize`).expect(200);
    const cand = (await s.as('get', `/recruiting/candidates/${candidateId}`).expect(200)).body;
    expect(cand).toMatchObject({ name: 'Candidato anonimizado', email: null, phone: null, resume: null });
    expect(cand.events.some((e: { kind: string }) => e.kind === 'note')).toBe(false);
    await s.as('get', `/recruiting/applications/${appId}/resume`).expect(404);
    const app = (await s.as('get', `/recruiting/applications/${appId}`).expect(200)).body;
    expect(app.answers).toEqual([]);
    expect(app.consent.version).toBe('v1');
    const { rows } = await admin.query(`select count(*)::int as n from files where tenant_id = $1 and owner_entity = 'recruiting_resume'`, [s.tenantId]);
    expect(rows[0].n).toBe(0);
    // O mesmo e-mail pode se candidatar de novo (cadastro novo).
    await apply(s, jobId, { email }).expect(201);

    const audit = (await s.as('get', '/audit?limit=100').expect(200)).body.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['recruiting.resume.downloaded', 'recruiting.candidate.exported', 'recruiting.candidate.anonymized', 'recruiting.candidate.viewed']));
  });

  it('prazo de guarda vencido: o job anonimiza quem não está em processo', async () => {
    const s = await session();
    const jobId = await openJob(s);
    await apply(s, jobId, { name: 'Ativo Ainda' }).expect(201);
    await apply(s, jobId, { name: 'Reprovado Antigo' }).expect(201);
    const apps = (await board(s, jobId)).applications;
    const old = apps.find((a) => a.candidate.name === 'Reprovado Antigo')!;
    await s.as('post', `/recruiting/applications/${old.id}/reject`).send({ reason: 'Perfil diferente' }).expect(200);
    await admin.query(`update rec_candidates set retain_until = current_date - 1 where tenant_id = $1`, [s.tenantId]);
    await t.jobs.runOnce('recruiting.retention');
    const names = (await board(s, jobId)).applications.map((a) => a.candidate.name).sort();
    expect(names).toEqual(['Ativo Ainda', 'Candidato anonimizado']);
  });

  it('Gupy simulada e pela API (HTTP falso): publica, guarda o id e mostra o erro na vaga', async () => {
    const s = await session();
    await s.as('put', '/modules/recruiting/settings').send({ gupyMode: 'api', gupyToken: '' }).expect(400);
    await s.as('put', '/modules/recruiting/settings').send({ gupyMode: 'simulated' }).expect(204);
    const sim = await openJob(s, null, { publishGupy: true });
    await t.relay.drain();
    expect((await s.as('get', `/recruiting/jobs/${sim}`).expect(200)).body).toMatchObject({ gupySyncStatus: 'synced', gupyJobId: expect.stringMatching(/^simulado-/) });
    expect(t.gupy.calls).toHaveLength(0);

    await s.as('put', '/modules/recruiting/settings').send({ gupyMode: 'api', gupyToken: 'token-gupy', gupyDepartmentId: '10', gupyRoleId: '20' }).expect(204);
    expect((await s.as('get', '/modules/recruiting/settings').expect(200)).body.gupyToken).toBe('••••gupy');
    const { rows } = await admin.query(`select settings->>'gupyToken' as token from tenant_modules where tenant_id = $1 and module_key = 'recruiting'`, [s.tenantId]);
    expect(rows[0].token).toMatch(/^enc:v1:/);

    const jobId = await openJob(s, null, { publishGupy: true });
    await t.relay.drain();
    expect(t.gupy.calls.map((c) => `${c.method} ${c.url.replace(/^.*\/api\/v1/, '')}`)).toEqual(['POST /jobs', 'PATCH /jobs/4242']);
    expect(t.gupy.calls[0]).toMatchObject({ token: 'token-gupy', body: { name: 'Analista financeiro', type: 'vacancy_type_effective', departmentId: 10, roleId: 20, workplaceType: 'hybrid', numVacancies: 2 } });
    expect(t.gupy.calls[1]!.body).toEqual({ status: 'published' });
    expect((await s.as('get', `/recruiting/jobs/${jobId}`).expect(200)).body).toMatchObject({ gupySyncStatus: 'synced', gupyJobId: '4242', gupyError: null });

    // Erro de dados (4xx): fica na vaga, sem novas tentativas.
    t.gupy.calls.length = 0;
    t.gupy.respond = () => ({ status: 422, body: { message: 'roleId inválido' } });
    await s.as('post', `/recruiting/jobs/${jobId}/status`).send({ status: 'paused' }).expect(200);
    await t.relay.drain();
    const job = (await s.as('get', `/recruiting/jobs/${jobId}`).expect(200)).body;
    expect(job).toMatchObject({ gupySyncStatus: 'error' });
    expect(job.gupyError).toContain('roleId inválido');
    const { rows: pending } = await admin.query(`select count(*)::int as n from outbox_events where tenant_id = $1 and type = 'recruiting.job.sync' and processed_at is null`, [s.tenantId]);
    expect(pending[0].n).toBe(0);

    // Instabilidade (5xx): erro na vaga e o outbox tenta de novo.
    t.gupy.respond = () => ({ status: 503, body: {} });
    await s.as('post', `/recruiting/jobs/${jobId}/gupy/sync`).expect(202);
    await t.relay.drain();
    const { rows: retry } = await admin.query(`select attempts from outbox_events where tenant_id = $1 and type = 'recruiting.job.sync' and processed_at is null`, [s.tenantId]);
    expect(retry[0].attempts).toBe(1);
    t.gupy.respond = (method) => ({ status: method === 'POST' ? 201 : 200, body: { id: 4242 } });
  });

  it('feed do Indeed: só vagas abertas, com link para a página pública; texto para o LinkedIn', async () => {
    const s = await session();
    const customerId = await company(s, 'Cliente Visível & Cia');
    const open = await openJob(s, customerId);
    await s.as('post', '/recruiting/jobs').send({ ...jobBody(null), title: 'Vaga em rascunho' }).expect(201);
    const res = await t.http().get(`/api/public/jobs/${s.slug}/feeds/indeed.xml`).expect(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text).toMatch(/^<\?xml version="1.0" encoding="utf-8"\?>\n<source>/);
    expect(res.text).toContain('<title><![CDATA[Analista financeiro]]></title>');
    expect(res.text).toContain(`<url><![CDATA[http://admin.test/vagas/${s.slug}/${open}]]></url>`);
    expect(res.text).toContain('<company><![CDATA[Cliente Visível & Cia]]></company>');
    expect(res.text).toContain('<jobtype><![CDATA[fulltime]]></jobtype>');
    expect(res.text).not.toContain('Vaga em rascunho');

    const job = (await s.as('get', `/recruiting/jobs/${open}`).expect(200)).body;
    expect(job.publication.publicUrl).toBe(`http://admin.test/vagas/${s.slug}/${open}`);
    expect(job.publication.linkedinText).toContain(`Candidate-se: http://admin.test/vagas/${s.slug}/${open}`);

    // Página desligada: some a lista e o feed.
    await s.as('put', '/modules/recruiting/settings').send({ publicPage: false }).expect(204);
    await t.http().get(`/api/public/jobs/${s.slug}/feeds/indeed.xml`).expect(404);
    await t.http().get(`/api/public/jobs/${s.slug}`).expect(404);
  });

  it('funções puras: texto do PDF, estimativa e XML escapado', () => {
    expect(pdfText(CV_GOOD)).toContain('Conciliação bancária diária');
    const est = heuristicScore({ title: 'Analista', requirements: ['Excel avançado', 'SAP'], niceToHave: [] }, pdfText(CV_GOOD));
    expect(est.strengths).toEqual(['Excel avançado']);
    expect(est.gaps).toEqual(['SAP']);
    const xml = indeedFeed({
      publisher: 'P',
      publisherUrl: 'http://x',
      companyName: 'C',
      jobs: [
        {
          id: '1',
          title: 'Vaga ]]> com CDATA',
          area: null,
          description: '',
          requirements: [],
          niceToHave: [],
          benefits: [],
          workModel: 'remote',
          city: null,
          state: null,
          contractType: 'pj',
          positions: 1,
          salaryMin: null,
          salaryMax: null,
          showSalary: false,
          status: 'open',
          hiringCompany: null,
          applyUrl: 'http://x/1',
          openedAt: null,
          updatedAt: new Date('2026-10-01T12:00:00Z'),
        },
      ],
    });
    expect(xml).toContain('<title><![CDATA[Vaga ]]]]><![CDATA[> com CDATA]]></title>');
    expect(xml).toContain('<remotetype><![CDATA[Fully remote]]></remotetype>');
  });
});
