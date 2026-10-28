import { AuditService, companyLogoUrl, CoreConfig, FilesService, ModuleSettingsService, OutboxService, TenancyService, TenantDb, type UploadedFile } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { CONSENT_VERSION, consentText, salaryLabel, type ConsentRecord, type publicApplicationInput } from '../contracts';
import { recApplications, recCandidates, recEvents, recJobs } from '../db/schema';
import { RECRUITING, type RecruitingSettings } from '../manifest';
import { AnalysisService } from './analysis.service';
import { indeedFeed } from './indeed';
import { RecruitingService, answersFor } from './recruiting.service';
import { APPLICATION_SUBMITTED, boardJob, hiringCompanyName, isPdf, jobsUrl, jobUrl, MAX_RESUME_BYTES, normalizePhone, RESUME_OWNER, type JobRow } from './shared';
import { customers } from '@all/core/schema';

/** Limites de candidatura pela página pública (por empresa). */
const MAX_PER_IP_HOUR = 5;
const MAX_PER_EMAIL_DAY = 5;
/** Formulário enviado antes disto (desde que abriu) é de robô. */
const MIN_FILL_MS = 3000;

type Tenant = NonNullable<Awaited<ReturnType<TenancyService['tenantBySlug']>>>;
type PublicApplication = z.infer<typeof publicApplicationInput>;

/**
 * Página pública de vagas (/vagas/<slug>), candidatura sem login e feed do Indeed. Só funciona com o
 * módulo ativo e a página ligada nas configurações.
 */
@Injectable()
export class PublicJobsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly files: FilesService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly analysis: AnalysisService,
    private readonly recruiting: RecruitingService,
    private readonly config: CoreConfig,
  ) {}

  list(slug: string) {
    return this.withTenant(slug, (tenant) =>
      this.tdb.run(async (tx) => {
        const rows = await tx
          .select({ job: recJobs, company: customers.name })
          .from(recJobs)
          .leftJoin(customers, eq(customers.id, recJobs.customerId))
          .where(eq(recJobs.status, 'open'))
          .orderBy(desc(recJobs.openedAt), asc(recJobs.title));
        return {
          company: this.brand(tenant),
          jobs: rows.map(({ job, company }) => ({
            id: job.id,
            title: job.title,
            area: job.area,
            hiringCompany: job.confidential ? null : company,
            workModel: job.workModel,
            city: job.city,
            state: job.state,
            contractType: job.contractType,
            salary: job.showSalary ? salaryLabel(num(job.salaryMin), num(job.salaryMax)) : null,
            openedAt: job.openedAt,
          })),
        };
      }),
    );
  }

  detail(slug: string, jobId: string) {
    return this.withTenant(slug, (tenant, settings) =>
      this.tdb.run(async (tx) => {
        const job = await this.openJob(tx, jobId);
        const company = job.confidential ? null : await hiringCompanyName(tx, job.customerId);
        return {
          company: this.brand(tenant),
          job: {
            id: job.id,
            title: job.title,
            area: job.area,
            description: job.description,
            requirements: job.requirements,
            niceToHave: job.niceToHave,
            benefits: job.benefits,
            hiringCompany: company,
            workModel: job.workModel,
            city: job.city,
            state: job.state,
            contractType: job.contractType,
            positions: job.positions,
            salary: job.showSalary ? salaryLabel(num(job.salaryMin), num(job.salaryMax)) : null,
            questions: job.questions,
            openedAt: job.openedAt,
          },
          consent: { version: CONSENT_VERSION, text: this.consent(tenant, settings, company) },
          maxResumeBytes: MAX_RESUME_BYTES,
        };
      }),
    );
  }

  /** Candidatura pela página pública: cria/atualiza o candidato, guarda o currículo e enfileira a análise. */
  apply(slug: string, jobId: string, input: PublicApplication, file: UploadedFile | undefined, ip: string | undefined) {
    // Robô (campo escondido preenchido ou envio instantâneo): responde como se tivesse dado certo.
    if (input.website || (input.startedAt && Date.now() - input.startedAt < MIN_FILL_MS)) return Promise.resolve({ ok: true });
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Anexe o currículo em PDF' });
    if (file.size > MAX_RESUME_BYTES) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'O currículo pode ter no máximo 5 MB' });
    if (!isPdf(file.buffer)) throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'Envie o currículo em PDF' });

    return this.withTenant(slug, (tenant, settings) =>
      this.tdb.run(async (tx) => {
        const { tenantId } = requestContext.requireTenant();
        const job = await this.openJob(tx, jobId, true);
        const company = job.confidential ? null : await hiringCompanyName(tx, job.customerId);
        if (input.consentVersion !== CONSENT_VERSION) {
          throw new BadRequestException({ code: 'CONSENT_OUTDATED', message: 'O texto de consentimento mudou. Recarregue a página e confira antes de enviar.' });
        }
        const answers = answersFor(job.questions, input.answers, true);
        const ipHash = ip ? createHash('sha256').update(`${tenantId}:${ip}`).digest('hex').slice(0, 32) : null;
        await this.checkLimits(tx, ipHash, input.email);

        const [existing] = await tx.select().from(recCandidates).where(eq(recCandidates.email, input.email)).for('update');
        if (existing) {
          const [already] = await tx
            .select({ id: recApplications.id })
            .from(recApplications)
            .where(and(eq(recApplications.jobId, job.id), eq(recApplications.candidateId, existing.id)));
          if (already) throw new ConflictException({ code: 'ALREADY_APPLIED', message: 'Você já se candidatou a esta vaga com este e-mail.' });
        }
        const data = {
          name: input.name,
          phone: normalizePhone(input.phone) ?? input.phone,
          linkedinUrl: input.linkedinUrl,
          city: input.city,
          state: input.state,
        };
        // O titular manda os dados mais recentes: atualizam o cadastro do banco de talentos.
        const candidate = existing
          ? (await tx.update(recCandidates).set(data).where(eq(recCandidates.id, existing.id)).returning())[0]!
          : (await tx.insert(recCandidates).values({ ...data, tenantId, email: input.email, source: 'public' }).returning())[0]!;

        const saved = await this.files.saveCheckedInTx(tx, { ...file, mimetype: 'application/pdf', originalname: safeName(file.originalname) }, { entity: RESUME_OWNER, id: candidate.id });
        await tx.update(recCandidates).set({ resumeFileId: saved.id }).where(eq(recCandidates.id, candidate.id));
        await this.recruiting.extendRetention(tx, candidate, settings);

        const consent: ConsentRecord = { version: CONSENT_VERSION, text: this.consent(tenant, settings, company), acceptedAt: new Date().toISOString(), ip: ip ?? null };
        const [app] = await tx
          .insert(recApplications)
          .values({
            tenantId,
            jobId: job.id,
            candidateId: candidate.id,
            stageId: job.stages[0]!.id,
            salaryExpectation: input.salaryExpectation == null ? null : input.salaryExpectation.toFixed(2),
            answers,
            resumeFileId: saved.id,
            source: 'public',
            consent,
            ipHash,
          })
          .returning();
        await tx.insert(recEvents).values({ tenantId, candidateId: candidate.id, applicationId: app!.id, kind: 'applied', text: `Candidatou-se à vaga ${job.title} pela página pública`, userId: null });
        const analysisId = await this.analysis.requestInTx(tx, app!.id, 'auto');
        await this.outbox.publish(tx, APPLICATION_SUBMITTED, { applicationId: app!.id, analysisId });
        await this.audit.log(tx, { action: 'recruiting.application.received', entity: 'recruiting_application', entityId: app!.id, userId: null });
        return { ok: true, jobTitle: job.title };
      }),
    );
  }

  /** Feed XML no formato do Indeed com as vagas abertas da empresa. */
  indeed(slug: string) {
    return this.withTenant(slug, (tenant) =>
      this.tdb.run(async (tx) => {
        const rows = await tx
          .select({ job: recJobs, company: customers.name })
          .from(recJobs)
          .leftJoin(customers, eq(customers.id, recJobs.customerId))
          .where(eq(recJobs.status, 'open'))
          .orderBy(desc(recJobs.openedAt));
        return indeedFeed({
          publisher: tenant.name,
          publisherUrl: jobsUrl(this.config.adminUrl, tenant.slug ?? slug),
          companyName: tenant.name,
          jobs: rows.map(({ job, company }) => ({
            ...boardJob(job, company, jobUrl(this.config.adminUrl, tenant.slug ?? slug, job.id)),
            openedAt: job.openedAt,
            updatedAt: job.updatedAt,
          })),
        });
      }),
    );
  }

  private consent(tenant: Tenant, settings: RecruitingSettings, hiringCompany: string | null) {
    return consentText({
      company: tenant.name,
      hiringCompany,
      retentionMonths: settings.retentionMonths,
      privacyEmail: settings.privacyEmail || null,
      // O texto fala de IA se ela pode ser usada (modo automático), mesmo antes de a chave existir.
      ai: settings.analysis === 'auto',
    });
  }

  /** Limite por IP (hora) e por e-mail (dia), contados nas candidaturas da empresa. */
  private async checkLimits(tx: Tx, ipHash: string | null, email: string) {
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);
    if (ipHash) {
      const [{ n }] = (await tx.select({ n: count() }).from(recApplications).where(and(eq(recApplications.ipHash, ipHash), gt(recApplications.createdAt, hourAgo)))) as [{ n: number }];
      if (n >= MAX_PER_IP_HOUR) throw tooMany();
    }
    const [{ n }] = (await tx
      .select({ n: count() })
      .from(recApplications)
      .innerJoin(recCandidates, eq(recCandidates.id, recApplications.candidateId))
      .where(and(eq(recCandidates.email, email), gt(recApplications.createdAt, dayAgo)))) as [{ n: number }];
    if (n >= MAX_PER_EMAIL_DAY) throw tooMany();
  }

  private async openJob(tx: Tx, jobId: string, lock = false): Promise<JobRow> {
    const query = tx.select().from(recJobs).where(and(eq(recJobs.id, jobId), eq(recJobs.status, 'open')));
    const [job] = lock ? await query.for('share') : await query;
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Esta vaga não está mais recebendo candidaturas' });
    return job;
  }

  private brand(tenant: Tenant) {
    return { name: tenant.name, logoUrl: companyLogoUrl(tenant), brandColor: tenant.brandColor };
  }

  /** Resolve a empresa pelo slug e roda no escopo dela, sem usuário logado. */
  private async withTenant<T>(slug: string, fn: (tenant: Tenant, settings: RecruitingSettings) => Promise<T>): Promise<T> {
    const ip = requestContext.get().ip;
    const tenant = await this.tenancy.tenantBySlug(slug);
    if (!tenant) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Empresa não encontrada' });
    return requestContext.run({ tenantId: tenant.id, modules: new Set([RECRUITING]), ip }, async () => {
      const settings = await this.tdb.run(async (tx) => {
        const res = await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from tenant_modules where tenant_id = ${tenant.id} and module_key = ${RECRUITING} and status = 'active') as ok`);
        return res.rows[0]?.ok ? this.settings.getInTx<RecruitingSettings>(tx, RECRUITING) : null;
      });
      if (!settings?.publicPage) throw new NotFoundException({ code: 'JOBS_DISABLED', message: 'Esta empresa não está publicando vagas aqui' });
      return fn(tenant, settings);
    });
  }
}

const num = (v: string | null) => (v == null ? null : Number(v));
const tooMany = () => new HttpException({ code: 'TOO_MANY_APPLICATIONS', message: 'Muitas candidaturas seguidas. Tente de novo mais tarde.' }, HttpStatus.TOO_MANY_REQUESTS);
/** Nome do arquivo sem caminho nem caracteres de controle. */
const safeName = (name: string) => (name.split(/[\\/]/).pop() ?? 'curriculo.pdf').replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'curriculo.pdf';
