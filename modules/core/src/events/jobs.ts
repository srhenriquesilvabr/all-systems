import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db';

interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

/**
 * Jobs periódicos (ex.: lembretes de agendamento). Os módulos registram no onModuleInit;
 * só o processo worker (ou o Cron Trigger, no Cloudflare) os executa. Um advisory lock por job
 * evita que duas instâncias rodem o mesmo job ao mesmo tempo.
 */
@Injectable()
export class ScheduledJobs implements OnApplicationShutdown {
  private readonly logger = new Logger(ScheduledJobs.name);
  private readonly jobs: Job[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly tdb: TenantDb) {}

  every(name: string, intervalMs: number, run: () => Promise<void>) {
    if (this.jobs.some((j) => j.name === name)) throw new Error(`Job duplicado: ${name}`);
    this.jobs.push({ name, intervalMs, run });
  }

  start() {
    for (const job of this.jobs) {
      const tick = async () => {
        await this.runOnce(job.name).catch((err) => this.logger.error(`Job ${job.name} falhou: ${err}`));
        this.timers.set(job.name, setTimeout(tick, job.intervalMs));
      };
      tick();
    }
    this.logger.log(`Jobs agendados: ${this.jobs.map((j) => j.name).join(', ') || 'nenhum'}`);
  }

  /**
   * Para runtimes sem processo contínuo (Cron Trigger do Cloudflare, a cada `tickMs`): roda os jobs
   * cujo intervalo vence dentro deste tick. Ex.: com tick de 1 min, um job de 1 h roda no minuto 0.
   */
  async runDue(now: number, tickMs: number) {
    for (const job of this.jobs) {
      if (now % job.intervalMs >= tickMs) continue;
      await this.runOnce(job.name).catch((err) => this.logger.error(`Job ${job.name} falhou: ${err}`));
    }
  }

  /** Roda o job agora (também usado nos testes). Retorna false se outra instância já estava rodando. */
  async runOnce(name: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`Job desconhecido: ${name}`);
    return this.tdb.db.transaction(async (lockTx) => {
      // O job roda em outras conexões com esta ociosa segurando o lock: o limite de 20 s do
      // app_user (0019) a derrubaria no meio de um job longo; aqui o teto sobe só para ela.
      await lockTx.execute(sql`set local idle_in_transaction_session_timeout = '10min'`);
      const lock = await lockTx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${'job:' + name})) as ok`);
      if (!lock.rows[0]?.ok) return false;
      await job.run();
      return true;
    });
  }

  /** Tenants com o módulo ativo (consulta de plataforma, por função SECURITY DEFINER). */
  async tenantsWithModule(moduleKey: string): Promise<string[]> {
    const res = await this.tdb.db.execute<{ tenant_id: string }>(sql`select tenant_id from tenants_with_module(${moduleKey})`);
    return res.rows.map((r) => r.tenant_id);
  }

  onApplicationShutdown() {
    this.timers.forEach((t) => clearTimeout(t));
  }
}
