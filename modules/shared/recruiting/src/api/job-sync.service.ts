import { CoreConfig, ModuleSettingsService, OutboxHandlers, OutboxService, TenantDb, type OutboxEvent } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { recJobs } from '../db/schema';
import { RECRUITING, type RecruitingSettings } from '../manifest';
import { GupyApiAdapter, GupyHttp, gupyConfig, JobBoardError, SimulatedGupyAdapter, type JobBoardAdapter } from './gupy';
import { boardJob, currentTenant, hiringCompanyName, JOB_SYNC, jobUrl, type JobRow, type JobSync } from './shared';

/**
 * Publicação da vaga na Gupy, pelo outbox: salvar a vaga só enfileira; a chamada à Gupy roda depois
 * (com novas tentativas em erro de rede/5xx). O resultado (id externo, situação e erro) fica na vaga.
 */
@Injectable()
export class JobSyncService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly handlers: OutboxHandlers,
    private readonly outbox: OutboxService,
    private readonly http: GupyHttp,
    private readonly config: CoreConfig,
  ) {}

  onModuleInit() {
    this.handlers.on<JobSync>(JOB_SYNC, 'recruiting.gupy', (e) => this.sync(e));
  }

  /**
   * Enfileira a sincronização se a vaga deve estar (ou já esteve) na Gupy. Rascunho que nunca foi
   * enviado não sai daqui.
   */
  async queueInTx(tx: Tx, job: JobRow, settings: RecruitingSettings) {
    if (settings.gupyMode === 'off') return;
    if (!job.gupyJobId && (!job.publishGupy || job.status === 'draft')) return;
    await tx.update(recJobs).set({ gupySyncStatus: 'pending', gupyError: null }).where(eq(recJobs.id, job.id));
    await this.outbox.publish(tx, JOB_SYNC, { jobId: job.id });
  }

  private adapter(settings: RecruitingSettings): JobBoardAdapter | null {
    if (settings.gupyMode === 'simulated') return new SimulatedGupyAdapter();
    if (settings.gupyMode === 'api') return new GupyApiAdapter(this.http, gupyConfig().apiUrl);
    return null;
  }

  private async sync(event: OutboxEvent<JobSync>) {
    const { tenantId } = requestContext.requireTenant();
    const loaded = await this.tdb.run(async (tx) => {
      const [job] = await tx.select().from(recJobs).where(eq(recJobs.id, event.payload.jobId));
      if (!job) return null;
      const tenant = await currentTenant(tx, tenantId);
      return { job, tenant, company: await hiringCompanyName(tx, job.customerId), settings: await this.settings.getInTx<RecruitingSettings>(tx, RECRUITING) };
    });
    if (!loaded) return;
    const { job, tenant, company, settings } = loaded;
    const adapter = this.adapter(settings);
    if (!adapter) {
      await this.record(job.id, { gupySyncStatus: 'error', gupyError: 'Integração com a Gupy desligada nas configurações do Head hunter' });
      return;
    }
    // Vaga tirada da Gupy (desmarcada) é encerrada lá.
    const board = boardJob({ ...job, status: job.publishGupy ? job.status : 'closed' }, company, jobUrl(this.config.adminUrl, tenant.slug ?? '', job.id));
    try {
      const result = await adapter.sync(board, job.gupyJobId, {
        token: settings.gupyToken,
        departmentId: settings.gupyDepartmentId,
        roleId: settings.gupyRoleId,
        branchId: settings.gupyBranchId,
      });
      await this.record(job.id, { gupyJobId: result.externalId, gupySyncStatus: 'synced', gupyError: null, gupySyncedAt: new Date() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.record(job.id, { gupySyncStatus: 'error', gupyError: message.slice(0, 1000) });
      // Rede/limite/instabilidade: o outbox tenta de novo. Erro de dados: só corrigindo a vaga.
      if (!(err instanceof JobBoardError) || err.retryable) throw err;
    }
  }

  private record(jobId: string, values: Partial<typeof recJobs.$inferInsert>) {
    return this.tdb.run((tx) => tx.update(recJobs).set(values).where(eq(recJobs.id, jobId)));
  }
}
