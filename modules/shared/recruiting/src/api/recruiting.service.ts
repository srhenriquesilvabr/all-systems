import { addMonths, AuditService, CoreConfig, FilesService, localToday, ModuleSettingsService, OutboxService, ScheduledJobs, splitName, TeamService, TenantDb, type UploadedFile } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, max, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  applicationStatusLabel,
  type ApplicationAnswer,
  type ApplicationInput,
  type CandidateInput,
  type JobInput,
  type JobPatch,
  type JobQuestion,
  type JobStage,
  type JobStatus,
} from '../contracts';
import { recAnalyses, recApplications, recCandidates, recEvents, recJobs } from '../db/schema';
import { RECRUITING, type RecruitingSettings } from '../manifest';
import { AnalysisService } from './analysis.service';
import { linkedinPost } from './indeed';
import { JobSyncService } from './job-sync.service';
import {
  APPLICATION_SUBMITTED,
  boardJob,
  currentTenant,
  hiringCompanyName,
  indeedFeedUrl,
  jobsUrl,
  jobUrl,
  normalizePhone,
  readAll,
  RESUME_OWNER,
  type JobRow,
} from './shared';

type CandidateRow = typeof recCandidates.$inferSelect;
type ApplicationRow = typeof recApplications.$inferSelect;

const notFound = (what: string) => new NotFoundException({ code: 'NOT_FOUND', message: `${what} não encontrad${what.endsWith('a') ? 'a' : 'o'}` });

/** Respostas às perguntas da vaga: obrigatórias preenchidas, com o texto da pergunta guardado junto. */
export function answersFor(questions: JobQuestion[], raw: { questionId: string; answer: string }[], enforceRequired: boolean): ApplicationAnswer[] {
  const out: ApplicationAnswer[] = [];
  for (const q of questions) {
    const answer = (raw.find((a) => a.questionId === q.id)?.answer ?? '').trim();
    if (enforceRequired && q.required && !answer) throw new BadRequestException({ code: 'VALIDATION', message: `Responda: ${q.label}` });
    if (q.kind === 'yes_no' && answer && !['sim', 'não', 'nao'].includes(answer.toLowerCase())) {
      throw new BadRequestException({ code: 'VALIDATION', message: `Responda sim ou não: ${q.label}` });
    }
    if (answer) out.push({ questionId: q.id, question: q.label, answer });
  }
  return out;
}

/**
 * Head hunter (área logada): vagas, candidatos, candidaturas e o funil. Candidatos e currículos são
 * dado pessoal: leitura do cadastro, download do currículo, exportação e exclusão vão para a auditoria.
 */
@Injectable()
export class RecruitingService implements OnModuleInit {
  private readonly logger = new Logger('HeadHunter');

  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly outbox: OutboxService,
    private readonly team: TeamService,
    private readonly jobs: ScheduledJobs,
    private readonly analysis: AnalysisService,
    private readonly sync: JobSyncService,
    private readonly config: CoreConfig,
  ) {}

  onModuleInit() {
    this.files.protectOwner(RESUME_OWNER);
    // Fim do prazo de guarda (consentimento): candidatos sem processo em andamento são anonimizados.
    this.jobs.every('recruiting.retention', 6 * 60 * 60_000, () => this.applyRetention());
  }

  private settingsInTx(tx: Tx) {
    return this.settings.getInTx<RecruitingSettings>(tx, RECRUITING);
  }

  // ---- Situação do módulo ---------------------------------------------------------------------

  status() {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const settings = await this.settingsInTx(tx);
      const tenant = await currentTenant(tx, tenantId);
      return {
        aiAvailable: this.analysis.aiAvailable(),
        analysis: settings.analysis,
        aiModel: settings.aiModel,
        gupyMode: settings.gupyMode,
        publicPage: settings.publicPage,
        publicUrl: tenant.slug && settings.publicPage ? jobsUrl(this.config.adminUrl, tenant.slug) : null,
        indeedFeedUrl: tenant.slug && settings.publicPage ? indeedFeedUrl(this.config.adminUrl, tenant.slug) : null,
      };
    });
  }

  /** Empresas-clientes que podem contratar pela consultoria (clientes do tipo empresa). */
  companies() {
    return this.tdb.run((tx) =>
      tx
        .select({ id: customers.id, name: customers.name, document: customers.document })
        .from(customers)
        .where(and(eq(customers.type, 'company'), isNull(customers.anonymizedAt)))
        .orderBy(asc(customers.name)),
    );
  }

  // ---- Vagas ----------------------------------------------------------------------------------

  listJobs(q: { status?: JobStatus | 'active'; customerId?: string; q?: string }) {
    return this.tdb.run(async (tx) => {
      const filters: (SQL | undefined)[] = [
        q.status === 'active' ? inArray(recJobs.status, ['draft', 'open', 'paused']) : q.status ? eq(recJobs.status, q.status) : undefined,
        q.customerId ? eq(recJobs.customerId, q.customerId) : undefined,
        q.q ? or(ilike(recJobs.title, `%${q.q}%`), ilike(recJobs.area, `%${q.q}%`)) : undefined,
      ];
      const rows = await tx
        .select({ job: recJobs, company: customers.name })
        .from(recJobs)
        .leftJoin(customers, eq(customers.id, recJobs.customerId))
        .where(and(...filters))
        .orderBy(sql`case ${recJobs.status} when 'open' then 0 when 'paused' then 1 when 'draft' then 2 else 3 end`, desc(recJobs.createdAt));
      const ids = rows.map((r) => r.job.id);
      const counts = ids.length
        ? await tx
            .select({ jobId: recApplications.jobId, status: recApplications.status, n: count() })
            .from(recApplications)
            .where(inArray(recApplications.jobId, ids))
            .groupBy(recApplications.jobId, recApplications.status)
        : [];
      return rows.map(({ job, company }) => {
        const mine = counts.filter((c) => c.jobId === job.id);
        const by = (s: string) => mine.find((c) => c.status === s)?.n ?? 0;
        return {
          ...this.jobSummary(job, company),
          applications: { total: mine.reduce((a, c) => a + c.n, 0), active: by('active'), hired: by('hired'), rejected: by('rejected') },
        };
      });
    });
  }

  private jobSummary(job: JobRow, company: string | null) {
    return {
      id: job.id,
      title: job.title,
      area: job.area,
      status: job.status,
      customerId: job.customerId,
      company,
      confidential: job.confidential,
      workModel: job.workModel,
      city: job.city,
      state: job.state,
      contractType: job.contractType,
      positions: job.positions,
      publishGupy: job.publishGupy,
      gupySyncStatus: job.gupySyncStatus,
      openedAt: job.openedAt,
      createdAt: job.createdAt,
    };
  }

  getJob(id: string) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const job = await this.jobOrFail(tx, id);
      const company = await hiringCompanyName(tx, job.customerId);
      const tenant = await currentTenant(tx, tenantId);
      const settings = await this.settingsInTx(tx);
      const stageCounts = await tx
        .select({ stageId: recApplications.stageId, status: recApplications.status, n: count() })
        .from(recApplications)
        .where(eq(recApplications.jobId, id))
        .groupBy(recApplications.stageId, recApplications.status);
      const url = tenant.slug ? jobUrl(this.config.adminUrl, tenant.slug, job.id) : null;
      return {
        ...job,
        salaryMin: job.salaryMin == null ? null : Number(job.salaryMin),
        salaryMax: job.salaryMax == null ? null : Number(job.salaryMax),
        company,
        stageCounts,
        publication: {
          publicUrl: settings.publicPage && url && job.status === 'open' ? url : null,
          indeedFeedUrl: settings.publicPage && tenant.slug ? indeedFeedUrl(this.config.adminUrl, tenant.slug) : null,
          gupyMode: settings.gupyMode,
          linkedinText: url ? linkedinPost(boardJob(job, company, url)) : null,
        },
      };
    });
  }

  createJob(input: JobInput) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      await this.assertCompany(tx, input.customerId ?? null);
      const [job] = await tx
        .insert(recJobs)
        .values({ ...this.jobValues(input), tenantId, createdBy: userId, status: 'draft' })
        .returning();
      await this.audit.log(tx, { action: 'recruiting.job.created', entity: 'recruiting_job', entityId: job!.id });
      return { id: job!.id };
    });
  }

  updateJob(id: string, input: JobPatch) {
    return this.tdb.run(async (tx) => {
      const current = await this.jobOrFail(tx, id, true);
      if (input.customerId !== undefined) await this.assertCompany(tx, input.customerId ?? null);
      if (input.stages) await this.assertStagesKeepApplications(tx, id, input.stages);
      const [job] = await tx.update(recJobs).set(this.jobValues(input)).where(eq(recJobs.id, id)).returning();
      if (job!.publishGupy || current.publishGupy) await this.sync.queueInTx(tx, job!, await this.settingsInTx(tx));
      await this.audit.log(tx, { action: 'recruiting.job.updated', entity: 'recruiting_job', entityId: id, data: { fields: Object.keys(input) } });
      return { id };
    });
  }

  private jobValues<T extends JobPatch>(input: T) {
    const { salaryMin, salaryMax, ...rest } = input;
    return {
      ...rest,
      ...(salaryMin !== undefined ? { salaryMin: salaryMin == null ? null : salaryMin.toFixed(2) } : {}),
      ...(salaryMax !== undefined ? { salaryMax: salaryMax == null ? null : salaryMax.toFixed(2) } : {}),
    };
  }

  /** Abrir, pausar, encerrar ou voltar a rascunho (só se ninguém se candidatou). */
  setJobStatus(id: string, status: JobStatus) {
    return this.tdb.run(async (tx) => {
      const current = await this.jobOrFail(tx, id, true);
      if (current.status === status) return { id };
      if (status === 'draft') {
        const [{ n }] = (await tx.select({ n: count() }).from(recApplications).where(eq(recApplications.jobId, id))) as [{ n: number }];
        if (n > 0) throw new ConflictException({ code: 'HAS_APPLICATIONS', message: 'A vaga já tem candidaturas: pause ou encerre em vez de voltar a rascunho' });
      }
      const [job] = await tx
        .update(recJobs)
        .set({
          status,
          ...(status === 'open' && !current.openedAt ? { openedAt: new Date() } : {}),
          closedAt: status === 'closed' ? new Date() : null,
        })
        .where(eq(recJobs.id, id))
        .returning();
      await this.sync.queueInTx(tx, job!, await this.settingsInTx(tx));
      await this.audit.log(tx, { action: 'recruiting.job.status', entity: 'recruiting_job', entityId: id, data: { from: current.status, to: status } });
      return { id };
    });
  }

  /** "Tentar de novo" a publicação na Gupy. */
  resyncJob(id: string) {
    return this.tdb.run(async (tx) => {
      const job = await this.jobOrFail(tx, id);
      const settings = await this.settingsInTx(tx);
      if (settings.gupyMode === 'off') throw new BadRequestException({ code: 'GUPY_OFF', message: 'Ligue a integração com a Gupy nas configurações do Head hunter' });
      if (!job.publishGupy && !job.gupyJobId) throw new BadRequestException({ code: 'GUPY_NOT_SELECTED', message: 'Marque "Publicar na Gupy" na vaga' });
      if (job.status === 'draft' && !job.gupyJobId) throw new BadRequestException({ code: 'JOB_DRAFT', message: 'Abra a vaga para publicá-la na Gupy' });
      await this.sync.queueInTx(tx, job, settings);
      return { id };
    });
  }

  private async jobOrFail(tx: Tx, id: string, lock = false): Promise<JobRow> {
    const query = tx.select().from(recJobs).where(eq(recJobs.id, id));
    const [job] = lock ? await query.for('update') : await query;
    if (!job) throw notFound('Vaga');
    return job;
  }

  private async assertCompany(tx: Tx, customerId: string | null) {
    if (!customerId) return;
    const [c] = await tx.select({ type: customers.type, anonymizedAt: customers.anonymizedAt }).from(customers).where(eq(customers.id, customerId));
    if (!c || c.anonymizedAt) throw new BadRequestException({ code: 'VALIDATION', message: 'Empresa contratante não encontrada' });
    if (c.type !== 'company') throw new BadRequestException({ code: 'VALIDATION', message: 'A empresa contratante precisa ser um cliente do tipo empresa' });
  }

  /** Etapa removida não pode ter candidaturas nela. */
  private async assertStagesKeepApplications(tx: Tx, jobId: string, stages: JobStage[]) {
    const ids = stages.map((s) => s.id);
    const [orphan] = await tx
      .select({ stageId: recApplications.stageId, n: count() })
      .from(recApplications)
      .where(and(eq(recApplications.jobId, jobId), notInArray(recApplications.stageId, ids)))
      .groupBy(recApplications.stageId)
      .limit(1);
    if (orphan) {
      throw new ConflictException({ code: 'STAGE_IN_USE', message: `Há ${orphan.n} candidatura(s) numa etapa removida (${orphan.stageId}). Mova-as antes de remover a etapa.` });
    }
  }

  // ---- Funil da vaga --------------------------------------------------------------------------

  /** Candidaturas da vaga, das notas mais altas para as mais baixas (sem nota por último). */
  board(jobId: string) {
    return this.tdb.run(async (tx) => {
      const job = await this.jobOrFail(tx, jobId);
      const rows = await tx
        .select({
          id: recApplications.id,
          stageId: recApplications.stageId,
          status: recApplications.status,
          score: recApplications.score,
          scoreMethod: recApplications.scoreMethod,
          analysisStatus: recApplications.analysisStatus,
          rejectionReason: recApplications.rejectionReason,
          teamMemberId: recApplications.teamMemberId,
          source: recApplications.source,
          createdAt: recApplications.createdAt,
          stageChangedAt: recApplications.stageChangedAt,
          candidate: { id: recCandidates.id, name: recCandidates.name, city: recCandidates.city, state: recCandidates.state, anonymized: sql<boolean>`${recCandidates.anonymizedAt} is not null` },
        })
        .from(recApplications)
        .innerJoin(recCandidates, eq(recCandidates.id, recApplications.candidateId))
        .where(eq(recApplications.jobId, jobId))
        .orderBy(sql`${recApplications.score} desc nulls last`, asc(recApplications.createdAt));
      return { stages: job.stages, applications: rows };
    });
  }

  getApplication(id: string) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .select({ app: recApplications, candidate: recCandidates, job: { id: recJobs.id, title: recJobs.title, stages: recJobs.stages, status: recJobs.status, requirements: recJobs.requirements, niceToHave: recJobs.niceToHave, customerId: recJobs.customerId } })
        .from(recApplications)
        .innerJoin(recCandidates, eq(recCandidates.id, recApplications.candidateId))
        .innerJoin(recJobs, eq(recJobs.id, recApplications.jobId))
        .where(eq(recApplications.id, id));
      if (!row) throw notFound('Candidatura');
      const analyses = await tx.select().from(recAnalyses).where(eq(recAnalyses.applicationId, id)).orderBy(desc(recAnalyses.createdAt)).limit(10);
      const events = await tx.select().from(recEvents).where(eq(recEvents.applicationId, id)).orderBy(desc(recEvents.createdAt));
      const resume = row.app.resumeFileId ? (await this.files.listByOwners(tx, RESUME_OWNER, [row.candidate.id])).find((f) => f.id === row.app.resumeFileId) ?? null : null;
      const { consent, ipHash: _ip, ...app } = row.app;
      return {
        ...app,
        salaryExpectation: app.salaryExpectation == null ? null : Number(app.salaryExpectation),
        consent: consent ? { version: consent.version, acceptedAt: consent.acceptedAt, text: consent.text } : null,
        candidate: this.candidateDto(row.candidate),
        job: row.job,
        resume: resume && { id: resume.id, filename: resume.filename, mime: resume.mime, size: resume.size },
        analyses: analyses.map((a) => ({ ...a, costUsd: a.costUsd == null ? null : Number(a.costUsd) })),
        events,
      };
    });
  }

  /** Candidatura lançada pela equipe (indicação, currículo recebido por fora). */
  createApplication(input: ApplicationInput) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const job = await this.jobOrFail(tx, input.jobId);
      if (job.status === 'closed') throw new BadRequestException({ code: 'JOB_CLOSED', message: 'A vaga está encerrada' });
      const candidate = await this.candidateOrFail(tx, input.candidateId);
      if (candidate.anonymizedAt) throw new BadRequestException({ code: 'ANONYMIZED', message: 'Os dados deste candidato foram excluídos' });
      const [existing] = await tx
        .select({ id: recApplications.id })
        .from(recApplications)
        .where(and(eq(recApplications.jobId, job.id), eq(recApplications.candidateId, candidate.id)));
      if (existing) throw new ConflictException({ code: 'ALREADY_APPLIED', message: 'Este candidato já está nesta vaga', existing });
      const settings = await this.settingsInTx(tx);
      const [app] = await tx
        .insert(recApplications)
        .values({
          tenantId,
          jobId: job.id,
          candidateId: candidate.id,
          stageId: job.stages[0]!.id,
          salaryExpectation: input.salaryExpectation == null ? null : input.salaryExpectation.toFixed(2),
          answers: answersFor(job.questions, input.answers, false),
          resumeFileId: candidate.resumeFileId,
          source: 'manual',
        })
        .returning();
      await this.extendRetention(tx, candidate, settings);
      await tx.insert(recEvents).values({ tenantId, candidateId: candidate.id, applicationId: app!.id, kind: 'applied', text: `Incluído na vaga ${job.title} pela equipe`, userId });
      const analysisId = await this.analysis.requestInTx(tx, app!.id, input.analysis);
      await this.outbox.publish(tx, APPLICATION_SUBMITTED, { applicationId: app!.id, analysisId });
      return { id: app!.id };
    });
  }

  /** Arrasta para outra etapa. Etapa de contratação marca como contratado; reprovado volta a andar. */
  move(id: string, stageId: string) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const { app, job } = await this.appWithJob(tx, id);
      const stage = job.stages.find((s) => s.id === stageId);
      if (!stage) throw new BadRequestException({ code: 'VALIDATION', message: 'Etapa inexistente nesta vaga' });
      if (app.stageId === stageId && app.status !== 'rejected') return { id };
      const hired = stage.kind === 'hired';
      await tx
        .update(recApplications)
        .set({
          stageId,
          status: hired ? 'hired' : 'active',
          hiredAt: hired ? (app.hiredAt ?? new Date()) : null,
          rejectionReason: null,
          rejectedAt: null,
          stageChangedAt: new Date(),
        })
        .where(eq(recApplications.id, id));
      const from = job.stages.find((s) => s.id === app.stageId)?.name ?? app.stageId;
      const text = app.status === 'rejected' ? `Reaberto em ${stage.name}` : `${from} → ${stage.name}`;
      await tx.insert(recEvents).values({ tenantId, candidateId: app.candidateId, applicationId: id, kind: app.status === 'rejected' ? 'reopened' : 'stage', text, data: { from: app.stageId, to: stageId }, userId });
      return { id };
    });
  }

  reject(id: string, reason: string) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const { app } = await this.appWithJob(tx, id);
      if (app.status === 'hired' && app.teamMemberId) throw new BadRequestException({ code: 'ALREADY_HIRED', message: 'O candidato já foi contratado e está na equipe' });
      await tx.update(recApplications).set({ status: 'rejected', rejectionReason: reason, rejectedAt: new Date(), hiredAt: null }).where(eq(recApplications.id, id));
      await tx.insert(recEvents).values({ tenantId, candidateId: app.candidateId, applicationId: id, kind: 'rejected', text: reason, userId });
      await this.audit.log(tx, { action: 'recruiting.application.rejected', entity: 'recruiting_application', entityId: id });
      return { id };
    });
  }

  addNote(id: string, text: string) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const { app } = await this.appWithJob(tx, id);
      const [event] = await tx.insert(recEvents).values({ tenantId, candidateId: app.candidateId, applicationId: id, kind: 'note', text, userId }).returning();
      return event;
    });
  }

  reanalyze(id: string, requested: 'auto' | 'heuristic') {
    return this.tdb.run(async (tx) => {
      const { app } = await this.appWithJob(tx, id);
      if (app.analysisStatus === 'pending' || app.analysisStatus === 'running') {
        throw new ConflictException({ code: 'ANALYSIS_RUNNING', message: 'Já há uma análise em andamento para esta candidatura' });
      }
      const analysisId = await this.analysis.requestInTx(tx, id, requested);
      await this.outbox.publish(tx, APPLICATION_SUBMITTED, { applicationId: id, analysisId });
      return { analysisId };
    });
  }

  /**
   * Contratação: cria a pessoa da equipe (core.team) com os dados do candidato e copia o currículo.
   * Com o RH ativo, a tela segue para a admissão. Repetir devolve a mesma pessoa.
   */
  async hire(id: string, input: { startedOn?: string | null }) {
    const ctx = requestContext.require();
    const result = await this.tdb.run(async (tx) => {
      const { app, job } = await this.appWithJob(tx, id, true);
      if (app.teamMemberId) return { teamMemberId: app.teamMemberId, created: false, resumeFileId: null, employerCustomerId: job.customerId };
      if (app.status !== 'hired') throw new BadRequestException({ code: 'NOT_HIRED', message: 'Mova o candidato para a etapa de contratação antes' });
      const candidate = await this.candidateOrFail(tx, app.candidateId);
      if (candidate.anonymizedAt) throw new BadRequestException({ code: 'ANONYMIZED', message: 'Os dados deste candidato foram excluídos' });
      const { firstName, lastName } = splitName(candidate.name);
      const member = await this.team.saveInTx(tx, null, {
        firstName,
        lastName,
        email: candidate.email,
        phone: normalizePhone(candidate.phone),
        linkedinUrl: candidate.linkedinUrl,
        startedOn: input.startedOn ?? null,
        notes: `Contratado pela vaga "${job.title}" (Head hunter).`,
      });
      await tx.update(recApplications).set({ teamMemberId: member.id }).where(eq(recApplications.id, id));
      await tx.insert(recEvents).values({ tenantId: ctx.tenantId, candidateId: app.candidateId, applicationId: id, kind: 'hired', text: 'Cadastrado na equipe', data: { teamMemberId: member.id }, userId: ctx.userId });
      await this.audit.log(tx, { action: 'recruiting.application.hired', entity: 'recruiting_application', entityId: id, data: { teamMemberId: member.id } });
      return { teamMemberId: member.id, created: true, resumeFileId: app.resumeFileId, employerCustomerId: job.customerId };
    });
    // O currículo vai para o cadastro da pessoa (fora da transação: o core grava o arquivo por conta própria).
    if (result.created && result.resumeFileId) {
      try {
        const opened = await this.files.open(result.resumeFileId, RESUME_OWNER);
        const buffer = await readAll(opened.stream);
        await this.team.setResume(result.teamMemberId, { buffer, originalname: opened.file.filename, mimetype: opened.file.mime, size: buffer.length });
      } catch (err) {
        this.logger.warn(`Currículo não copiado para a pessoa ${result.teamMemberId}: ${err}`);
      }
    }
    // Empresa contratante da vaga: é o empregador sugerido na admissão (null = vaga da própria empresa).
    return { teamMemberId: result.teamMemberId, created: result.created, hrActive: !!ctx.modules?.has('hr'), employerCustomerId: result.employerCustomerId };
  }

  /** Download do currículo de uma candidatura, registrado na auditoria. */
  async openApplicationResume(id: string) {
    const app = await this.tdb.run(async (tx) => (await this.appWithJob(tx, id)).app);
    if (!app.resumeFileId) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Esta candidatura não tem currículo' });
    return this.openResume(app.resumeFileId, app.candidateId, { application: id });
  }

  async openCandidateResume(id: string) {
    const candidate = await this.tdb.run((tx) => this.candidateOrFail(tx, id));
    if (!candidate.resumeFileId) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Este candidato não tem currículo' });
    return this.openResume(candidate.resumeFileId, id, {});
  }

  private async openResume(fileId: string, candidateId: string, data: Record<string, string>) {
    const opened = await this.files.open(fileId, RESUME_OWNER);
    if (opened.ownerId !== candidateId) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Arquivo não encontrado' });
    await this.tdb.run((tx) => this.audit.log(tx, { action: 'recruiting.resume.downloaded', entity: 'recruiting_candidate', entityId: candidateId, data: { fileId, ...data } }));
    return opened;
  }

  private async appWithJob(tx: Tx, id: string, lock = false): Promise<{ app: ApplicationRow; job: JobRow }> {
    const query = tx.select({ app: recApplications, job: recJobs }).from(recApplications).innerJoin(recJobs, eq(recJobs.id, recApplications.jobId)).where(eq(recApplications.id, id));
    const [row] = lock ? await query.for('update', { of: recApplications }) : await query;
    if (!row) throw notFound('Candidatura');
    return row;
  }

  // ---- Banco de talentos ----------------------------------------------------------------------

  listCandidates(q: { q?: string; jobId?: string; limit: number; offset: number }) {
    return this.tdb.run(async (tx) => {
      const like = q.q ? `%${q.q}%` : null;
      const where = and(
        like ? or(ilike(recCandidates.name, like), ilike(recCandidates.email, like), ilike(recCandidates.city, like)) : undefined,
        q.jobId ? sql`exists (select 1 from rec_applications a where a.candidate_id = ${recCandidates.id} and a.job_id = ${q.jobId})` : undefined,
      );
      const stats = tx
        .select({
          candidateId: recApplications.candidateId,
          total: count().as('total'),
          active: sql<number>`count(*) filter (where ${recApplications.status} = 'active')`.mapWith(Number).as('active'),
          best: max(recApplications.score).as('best'),
          last: max(recApplications.createdAt).as('last'),
        })
        .from(recApplications)
        .groupBy(recApplications.candidateId)
        .as('stats');
      const [items, totals] = await Promise.all([
        tx
          .select({
            id: recCandidates.id,
            name: recCandidates.name,
            email: recCandidates.email,
            city: recCandidates.city,
            state: recCandidates.state,
            source: recCandidates.source,
            anonymizedAt: recCandidates.anonymizedAt,
            createdAt: recCandidates.createdAt,
            applications: sql<number>`coalesce(${stats.total}, 0)`.mapWith(Number),
            activeApplications: sql<number>`coalesce(${stats.active}, 0)`.mapWith(Number),
            bestScore: stats.best,
            lastApplicationAt: stats.last,
          })
          .from(recCandidates)
          .leftJoin(stats, eq(stats.candidateId, recCandidates.id))
          .where(where)
          .orderBy(sql`${recCandidates.anonymizedAt} is not null`, sql`${stats.last} desc nulls last`, asc(recCandidates.name))
          .limit(q.limit)
          .offset(q.offset),
        tx.select({ total: count() }).from(recCandidates).where(where),
      ]);
      return { items, total: totals[0]?.total ?? 0 };
    });
  }

  /** Ficha do candidato (dado pessoal: a leitura vai para a auditoria). */
  getCandidate(id: string) {
    return this.tdb.run(async (tx) => {
      const candidate = await this.candidateOrFail(tx, id);
      const applications = await tx
        .select({
          id: recApplications.id,
          jobId: recJobs.id,
          jobTitle: recJobs.title,
          jobStatus: recJobs.status,
          stages: recJobs.stages,
          company: customers.name,
          stageId: recApplications.stageId,
          status: recApplications.status,
          score: recApplications.score,
          scoreMethod: recApplications.scoreMethod,
          createdAt: recApplications.createdAt,
        })
        .from(recApplications)
        .innerJoin(recJobs, eq(recJobs.id, recApplications.jobId))
        .leftJoin(customers, eq(customers.id, recJobs.customerId))
        .where(eq(recApplications.candidateId, id))
        .orderBy(desc(recApplications.createdAt));
      const events = await tx.select().from(recEvents).where(eq(recEvents.candidateId, id)).orderBy(desc(recEvents.createdAt)).limit(200);
      const resume = candidate.resumeFileId ? (await this.files.listByOwners(tx, RESUME_OWNER, [id])).find((f) => f.id === candidate.resumeFileId) ?? null : null;
      await this.audit.log(tx, { action: 'recruiting.candidate.viewed', entity: 'recruiting_candidate', entityId: id });
      return {
        ...this.candidateDto(candidate),
        resume: resume && { id: resume.id, filename: resume.filename, mime: resume.mime, size: resume.size },
        applications: applications.map(({ stages, ...a }) => ({ ...a, stageName: stages.find((s) => s.id === a.stageId)?.name ?? a.stageId, statusLabel: applicationStatusLabel[a.status] })),
        events,
      };
    });
  }

  createCandidate(input: CandidateInput) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [existing] = await tx.select({ id: recCandidates.id, name: recCandidates.name }).from(recCandidates).where(eq(recCandidates.email, input.email));
      if (existing) throw new ConflictException({ code: 'DUPLICATE_EMAIL', message: `Este e-mail já é de ${existing.name}, no banco de talentos`, existing });
      const settings = await this.settingsInTx(tx);
      const [row] = await tx
        .insert(recCandidates)
        .values({ ...input, phone: normalizePhone(input.phone) ?? input.phone, tenantId, source: 'manual', retainUntil: addMonths(localToday(), settings.retentionMonths) })
        .returning();
      await tx.insert(recEvents).values({ tenantId, candidateId: row!.id, kind: 'edited', text: 'Cadastrado pela equipe', userId });
      await this.audit.log(tx, { action: 'recruiting.candidate.created', entity: 'recruiting_candidate', entityId: row!.id });
      return this.candidateDto(row!);
    });
  }

  updateCandidate(id: string, input: Partial<CandidateInput>) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const current = await this.candidateOrFail(tx, id);
      if (current.anonymizedAt) throw new BadRequestException({ code: 'ANONYMIZED', message: 'Os dados deste candidato foram excluídos' });
      if (input.email && input.email !== current.email) {
        const [taken] = await tx.select({ id: recCandidates.id, name: recCandidates.name }).from(recCandidates).where(and(eq(recCandidates.email, input.email), ne(recCandidates.id, id)));
        if (taken) throw new ConflictException({ code: 'DUPLICATE_EMAIL', message: `Este e-mail já é de ${taken.name}, no banco de talentos`, existing: taken });
      }
      const [row] = await tx
        .update(recCandidates)
        .set({ ...input, ...(input.phone !== undefined ? { phone: normalizePhone(input.phone) ?? input.phone } : {}) })
        .where(eq(recCandidates.id, id))
        .returning();
      await tx.insert(recEvents).values({ tenantId, candidateId: id, kind: 'edited', text: 'Dados alterados', data: { fields: Object.keys(input) }, userId });
      await this.audit.log(tx, { action: 'recruiting.candidate.updated', entity: 'recruiting_candidate', entityId: id, data: { fields: Object.keys(input) } });
      return this.candidateDto(row!);
    });
  }

  /** Currículo enviado pela equipe (PDF ou Word). Vale para as próximas candidaturas. */
  setCandidateResume(id: string, file: UploadedFile) {
    return this.tdb.run(async (tx) => {
      const candidate = await this.candidateOrFail(tx, id);
      if (candidate.anonymizedAt) throw new BadRequestException({ code: 'ANONYMIZED', message: 'Os dados deste candidato foram excluídos' });
      const saved = await this.files.saveResumeInTx(tx, file, { entity: RESUME_OWNER, id });
      await tx.update(recCandidates).set({ resumeFileId: saved.id }).where(eq(recCandidates.id, id));
      // Candidaturas em andamento sem currículo passam a usar este.
      await tx
        .update(recApplications)
        .set({ resumeFileId: saved.id })
        .where(and(eq(recApplications.candidateId, id), isNull(recApplications.resumeFileId)));
      await this.audit.log(tx, { action: 'recruiting.resume.uploaded', entity: 'recruiting_candidate', entityId: id, data: { fileId: saved.id } });
      return saved;
    });
  }

  /** Direito de acesso/portabilidade (LGPD art. 18): tudo o que há sobre o candidato. */
  exportCandidate(id: string) {
    return this.tdb.run(async (tx) => {
      const candidate = await this.candidateOrFail(tx, id);
      const applications = await tx
        .select({ app: recApplications, jobTitle: recJobs.title })
        .from(recApplications)
        .innerJoin(recJobs, eq(recJobs.id, recApplications.jobId))
        .where(eq(recApplications.candidateId, id));
      const appIds = applications.map((a) => a.app.id);
      const analyses = appIds.length ? await tx.select().from(recAnalyses).where(inArray(recAnalyses.applicationId, appIds)) : [];
      const events = await tx.select().from(recEvents).where(eq(recEvents.candidateId, id)).orderBy(asc(recEvents.createdAt));
      const files = await this.files.listByOwners(tx, RESUME_OWNER, [id]);
      await this.audit.log(tx, { action: 'recruiting.candidate.exported', entity: 'recruiting_candidate', entityId: id });
      return {
        exportedAt: new Date().toISOString(),
        candidate: this.candidateDto(candidate),
        applications: applications.map(({ app, jobTitle }) => {
          const { ipHash: _ip, ...rest } = app;
          return { ...rest, jobTitle };
        }),
        analyses: analyses.map((a) => ({ applicationId: a.applicationId, method: a.method, score: a.score, strengths: a.strengths, gaps: a.gaps, summary: a.summary, model: a.model, finishedAt: a.finishedAt })),
        events: events.map((e) => ({ kind: e.kind, text: e.text, createdAt: e.createdAt })),
        files: files.map((f) => ({ filename: f.filename, mime: f.mime, size: f.size, createdAt: f.createdAt })),
      };
    });
  }

  /**
   * Direito de eliminação: apaga os dados pessoais, os currículos, as respostas, as anotações e os
   * textos das análises. Ficam a candidatura (etapa, situação, nota) e as datas, sem identificar ninguém.
   */
  anonymize(id: string) {
    return this.tdb.run(async (tx) => {
      const candidate = await this.candidateOrFail(tx, id);
      if (candidate.anonymizedAt) return { id };
      await this.anonymizeInTx(tx, candidate, 'request');
      return { id };
    });
  }

  private async anonymizeInTx(tx: Tx, candidate: CandidateRow, reason: 'request' | 'retention') {
    const appIds = (await tx.select({ id: recApplications.id }).from(recApplications).where(eq(recApplications.candidateId, candidate.id))).map((a) => a.id);
    await tx
      .update(recCandidates)
      .set({ name: 'Candidato anonimizado', email: null, phone: null, linkedinUrl: null, city: null, state: null, notes: null, resumeFileId: null, retainUntil: null, anonymizedAt: new Date() })
      .where(eq(recCandidates.id, candidate.id));
    if (appIds.length) {
      await tx
        .update(recApplications)
        .set({
          answers: [],
          salaryExpectation: null,
          resumeFileId: null,
          ipHash: null,
          rejectionReason: null,
          // Fica a prova de que houve consentimento (versão e data), sem o IP.
          consent: sql`case when ${recApplications.consent} is null then null else jsonb_set(${recApplications.consent}, '{ip}', 'null'::jsonb) end`,
        })
        .where(inArray(recApplications.id, appIds));
      await tx.update(recAnalyses).set({ strengths: [], gaps: [], summary: null, error: null }).where(inArray(recAnalyses.applicationId, appIds));
    }
    await tx.delete(recEvents).where(and(eq(recEvents.candidateId, candidate.id), inArray(recEvents.kind, ['note', 'rejected', 'edited'])));
    for (const file of await this.files.listByOwners(tx, RESUME_OWNER, [candidate.id])) {
      await this.files.removeInTx(tx, file.id, { entity: RESUME_OWNER, id: candidate.id });
    }
    await this.audit.log(tx, { action: 'recruiting.candidate.anonymized', entity: 'recruiting_candidate', entityId: candidate.id, data: { reason }, ...(reason === 'retention' ? { userId: null } : {}) });
  }

  /** Job: anonimiza quem passou do prazo de guarda e não está em nenhum processo em andamento. */
  async applyRetention() {
    const today = localToday();
    for (const tenantId of await this.jobs.tenantsWithModule(RECRUITING)) {
      await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const due = await tx
            .select()
            .from(recCandidates)
            .where(
              and(
                isNull(recCandidates.anonymizedAt),
                lt(recCandidates.retainUntil, today),
                sql`not exists (select 1 from rec_applications a where a.candidate_id = ${recCandidates.id} and a.status = 'active')`,
              ),
            )
            .limit(200);
          for (const candidate of due) await this.anonymizeInTx(tx, candidate, 'retention');
        }),
      );
    }
  }

  /** Nova candidatura renova o prazo de guarda a partir de hoje. */
  async extendRetention(tx: Tx, candidate: Pick<CandidateRow, 'id' | 'retainUntil'>, settings: RecruitingSettings) {
    const until = addMonths(localToday(), settings.retentionMonths);
    if (!candidate.retainUntil || candidate.retainUntil < until) await tx.update(recCandidates).set({ retainUntil: until }).where(eq(recCandidates.id, candidate.id));
  }

  private async candidateOrFail(tx: Tx, id: string): Promise<CandidateRow> {
    const [row] = await tx.select().from(recCandidates).where(eq(recCandidates.id, id));
    if (!row) throw notFound('Candidato');
    return row;
  }

  private candidateDto(c: CandidateRow) {
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      linkedinUrl: c.linkedinUrl,
      city: c.city,
      state: c.state,
      notes: c.notes,
      source: c.source,
      retainUntil: c.retainUntil,
      anonymizedAt: c.anonymizedAt,
      createdAt: c.createdAt,
    };
  }
}
