import { FilesService, ModuleSettingsService, OutboxHandlers, ScheduledJobs, TenantDb, type OutboxEvent } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { contractTypeLabel, workModelLabel, type AnalysisResult } from '../contracts';
import { recAnalyses, recApplications, recCandidates, recEvents, recJobs } from '../db/schema';
import { RECRUITING, type RecruitingSettings } from '../manifest';
import { AnthropicError, AnthropicHttp, anthropicConfig, buildAnalysisRequest, parseAnalysisResponse, type AnalysisOutput } from './anthropic';
import { heuristicScore } from './heuristic';
import { pdfText } from './pdf-text';
import { APPLICATION_SUBMITTED, isPdf, readAll, RESUME_OWNER, type ApplicationSubmitted } from './shared';

/** Tentativas da IA antes de ficar com a estimativa por palavras-chave. */
const MAX_AI_ATTEMPTS = 3;
/** Por execução do job: no Workers o cron tem tempo, mas cada análise leva alguns segundos. */
const BATCH = 8;
const BUDGET_MS = 45_000;
/** Análise "em andamento" há mais que isto travou (o isolate morreu no meio): volta para a fila. */
const STUCK_MS = 10 * 60_000;
// Com o prazo do lote (BUDGET_MS), uma execução nunca passa de ~2 min (o cron do Workers e o lock aguentam bem mais).
const AI_TIMEOUT_MS = 60_000;

type AnalysisRow = typeof recAnalyses.$inferSelect;

/**
 * Nota de aderência das candidaturas.
 *
 * A candidatura publica `recruiting.application.submitted` no outbox, sem esperar a análise. O
 * handler calcula na hora a estimativa sem IA (rápida, local). Com IA, a análise fica pendente e é
 * feita pelo job `recruiting.analyses` (a cada minuto): a chamada à Anthropic leva de segundos a
 * minutos, e o handler roda dentro da transação do relay do outbox, que o banco derruba depois de
 * 20 s ociosa (migration 0019). No job, nenhuma transação fica aberta durante a chamada.
 */
@Injectable()
export class AnalysisService implements OnModuleInit {
  private readonly logger = new Logger('HeadHunter');

  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly files: FilesService,
    private readonly handlers: OutboxHandlers,
    private readonly jobs: ScheduledJobs,
    private readonly http: AnthropicHttp,
  ) {}

  onModuleInit() {
    this.handlers.on<ApplicationSubmitted>(APPLICATION_SUBMITTED, 'recruiting.analysis', (e) => this.onSubmitted(e));
    this.jobs.every('recruiting.analyses', 60_000, () => this.runPending());
  }

  /** A IA está disponível no servidor (chave configurada)? */
  aiAvailable() {
    return !!anthropicConfig().apiKey;
  }

  /** Pede uma análise nova (candidatura nova ou "analisar de novo"), na transação de quem chama. */
  async requestInTx(tx: Tx, applicationId: string, requested: 'auto' | 'heuristic') {
    const { tenantId } = requestContext.requireTenant();
    const [row] = await tx.insert(recAnalyses).values({ tenantId, applicationId, requested }).returning({ id: recAnalyses.id });
    await tx.update(recApplications).set({ analysisStatus: 'pending' }).where(eq(recApplications.id, applicationId));
    return row!.id;
  }

  // ---- Handler do outbox: estimativa na hora --------------------------------------------------

  private async onSubmitted(event: OutboxEvent<ApplicationSubmitted>) {
    const { analysisId } = event.payload;
    const state = await this.tdb.run(async (tx) => {
      const [analysis] = await tx.select().from(recAnalyses).where(eq(recAnalyses.id, analysisId));
      const settings = await this.settings.getInTx<RecruitingSettings>(tx, RECRUITING);
      return { analysis, settings };
    });
    if (!state.analysis || state.analysis.status !== 'pending') return;
    // Com IA, quem faz é o job (fora da transação do relay).
    if (this.usesAi(state.analysis, state.settings)) return;
    // Reserva antes de calcular: o job pode estar pegando a mesma análise (entrega repetida também).
    const [claimed] = await this.tdb.run((tx) =>
      tx
        .update(recAnalyses)
        .set({ status: 'running', startedAt: new Date(), attempts: sql`${recAnalyses.attempts} + 1` })
        .where(and(eq(recAnalyses.id, analysisId), eq(recAnalyses.status, 'pending')))
        .returning(),
    );
    if (claimed) await this.process(claimed, state.settings);
  }

  private usesAi(analysis: Pick<AnalysisRow, 'requested'>, settings: RecruitingSettings) {
    return analysis.requested === 'auto' && settings.analysis === 'auto' && this.aiAvailable();
  }

  // ---- Job: análises pela IA ------------------------------------------------------------------

  /** Processa as análises pendentes de todas as empresas com o módulo (também chamado nos testes). */
  async runPending() {
    const deadline = Date.now() + BUDGET_MS;
    for (const tenantId of await this.jobs.tenantsWithModule(RECRUITING)) {
      if (Date.now() >= deadline) return;
      await requestContext.run({ tenantId }, async () => {
        const { claimed, settings } = await this.tdb.run(async (tx) => ({ claimed: await this.claim(tx), settings: await this.settings.getInTx<RecruitingSettings>(tx, RECRUITING) }));
        for (const analysis of claimed) {
          // O que não couber no prazo volta para a fila na próxima execução.
          if (Date.now() >= deadline) {
            await this.tdb.run((tx) => tx.update(recAnalyses).set({ status: 'pending', attempts: sql`${recAnalyses.attempts} - 1` }).where(eq(recAnalyses.id, analysis.id)));
            continue;
          }
          await this.process(analysis, settings).catch((err) => this.logger.error(`Análise ${analysis.id} falhou: ${err}`));
        }
      });
    }
  }

  /** Reserva até BATCH análises pendentes (ou travadas) desta empresa, marcando como em andamento. */
  private async claim(tx: Tx): Promise<AnalysisRow[]> {
    const stuck = new Date(Date.now() - STUCK_MS);
    const ids = await tx
      .select({ id: recAnalyses.id })
      .from(recAnalyses)
      .where(or(eq(recAnalyses.status, 'pending'), and(eq(recAnalyses.status, 'running'), lt(recAnalyses.startedAt, stuck))))
      .orderBy(recAnalyses.createdAt)
      .limit(BATCH)
      .for('update', { skipLocked: true });
    if (!ids.length) return [];
    return tx
      .update(recAnalyses)
      .set({ status: 'running', startedAt: new Date(), attempts: sql`${recAnalyses.attempts} + 1` })
      .where(
        inArray(
          recAnalyses.id,
          ids.map((r) => r.id),
        ),
      )
      .returning();
  }

  // ---- Execução de uma análise ----------------------------------------------------------------

  private async process(analysis: AnalysisRow, settings: RecruitingSettings) {
    const ctx = await this.tdb.run(async (tx) => {
      const [row] = await tx
        .select({ app: recApplications, job: recJobs, candidate: { city: recCandidates.city, state: recCandidates.state } })
        .from(recApplications)
        .innerJoin(recJobs, eq(recJobs.id, recApplications.jobId))
        .innerJoin(recCandidates, eq(recCandidates.id, recApplications.candidateId))
        .where(eq(recApplications.id, analysis.applicationId));
      return row;
    });
    if (!ctx) {
      await this.tdb.run((tx) => tx.update(recAnalyses).set({ status: 'failed', error: 'Candidatura não encontrada', finishedAt: new Date() }).where(eq(recAnalyses.id, analysis.id)));
      return;
    }
    const resume = ctx.app.resumeFileId ? await this.readResume(ctx.app.resumeFileId) : null;
    const answers = ctx.app.answers.map((a) => ({ question: a.question, answer: a.answer }));

    let result: (AnalysisResult & Partial<AnalysisOutput>) | null = null;
    let method: 'ai' | 'heuristic' = 'heuristic';
    let error: string | null = null;

    if (this.usesAi(analysis, settings)) {
      try {
        result = await this.callAi(settings.aiModel, ctx.job, { city: [ctx.candidate.city, ctx.candidate.state].filter(Boolean).join('/') || null, salaryExpectation: ctx.app.salaryExpectation == null ? null : Number(ctx.app.salaryExpectation) }, answers, resume);
        method = 'ai';
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        const retry = err instanceof AnthropicError ? err.retryable : true;
        if (retry && analysis.attempts < MAX_AI_ATTEMPTS) {
          // Volta para a fila; o job tenta de novo no próximo minuto.
          await this.tdb.run((tx) => tx.update(recAnalyses).set({ status: 'pending', error }).where(eq(recAnalyses.id, analysis.id)));
          return;
        }
      }
    }

    if (!result) {
      const text = [resume && resume.mime === 'application/pdf' ? pdfText(resume.buffer) : '', ...answers.map((a) => `${a.question} ${a.answer}`), ctx.candidate.city ?? ''].join('\n');
      result = heuristicScore(ctx.job, text);
      if (error) result.summary = `A análise por IA falhou (${error.slice(0, 160)}). ${result.summary}`;
    }
    await this.save(analysis, method, result, error);
  }

  private async callAi(
    model: string,
    job: typeof recJobs.$inferSelect,
    candidate: { city: string | null; salaryExpectation: number | null },
    answers: { question: string; answer: string }[],
    resume: { buffer: Buffer; mime: string } | null,
  ): Promise<AnalysisOutput> {
    const { apiKey, baseURL } = anthropicConfig();
    const { body, betas } = buildAnalysisRequest({
      model,
      job: {
        title: job.title,
        area: job.area,
        description: job.description,
        requirements: job.requirements,
        niceToHave: job.niceToHave,
        workModel: workModelLabel[job.workModel],
        location: [job.city, job.state].filter(Boolean).join('/') || null,
        contractType: contractTypeLabel[job.contractType],
      },
      candidate,
      answers,
      resumePdf: resume && resume.mime === 'application/pdf' && isPdf(resume.buffer) ? resume.buffer : null,
    });
    let res: { status: number; body: any };
    try {
      res = await this.http.post({ apiKey, baseURL, betas, body, timeoutMs: AI_TIMEOUT_MS });
    } catch (err) {
      throw new AnthropicError(`Sem resposta da API da Anthropic: ${(err as Error).message}`, true);
    }
    return parseAnalysisResponse(model, res.status, res.body);
  }

  private async readResume(fileId: string) {
    try {
      const opened = await this.files.open(fileId, RESUME_OWNER);
      return { buffer: await readAll(opened.stream), mime: opened.file.mime };
    } catch (err) {
      this.logger.warn(`Currículo ${fileId} não pôde ser lido: ${err}`);
      return null;
    }
  }

  private async save(analysis: AnalysisRow, method: 'ai' | 'heuristic', r: AnalysisResult & Partial<AnalysisOutput>, error: string | null) {
    await this.tdb.run(async (tx) => {
      const { tenantId } = requestContext.requireTenant();
      await tx
        .update(recAnalyses)
        .set({
          status: 'done',
          method,
          score: r.score,
          strengths: r.strengths,
          gaps: r.gaps,
          summary: r.summary,
          model: method === 'ai' ? (r.model ?? null) : null,
          inputTokens: r.inputTokens ?? null,
          outputTokens: r.outputTokens ?? null,
          costUsd: r.costUsd == null ? null : r.costUsd.toFixed(6),
          error,
          finishedAt: new Date(),
        })
        .where(eq(recAnalyses.id, analysis.id));
      // Uma análise mais nova (pedida depois) prevalece: esta só fica no histórico. A comparação é
      // com o horário gravado no banco (microssegundos): o Date do JS (milissegundos) faria a própria
      // análise parecer "mais nova" que ela mesma.
      const [newer] = await tx
        .select({ id: recAnalyses.id })
        .from(recAnalyses)
        .where(
          and(
            eq(recAnalyses.applicationId, analysis.applicationId),
            ne(recAnalyses.id, analysis.id),
            gt(recAnalyses.createdAt, sql`(select ${recAnalyses.createdAt} from ${recAnalyses} where ${recAnalyses.id} = ${analysis.id})`),
          ),
        )
        .orderBy(desc(recAnalyses.createdAt))
        .limit(1);
      if (newer) return;
      const [app] = await tx
        .update(recApplications)
        .set({ score: r.score, scoreMethod: method, analysisStatus: 'done' })
        .where(eq(recApplications.id, analysis.applicationId))
        .returning({ candidateId: recApplications.candidateId });
      if (app) {
        await tx.insert(recEvents).values({
          tenantId,
          candidateId: app.candidateId,
          applicationId: analysis.applicationId,
          kind: 'analysis',
          text: method === 'ai' ? `Nota de aderência pela IA: ${r.score}` : `Estimativa sem IA: ${r.score}`,
          data: { analysisId: analysis.id, method, score: r.score },
          userId: null,
        });
      }
    });
  }
}
