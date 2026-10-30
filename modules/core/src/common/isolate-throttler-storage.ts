import type { ThrottlerStorage } from '@nestjs/throttler';

type ThrottlerRecord = { hits: number; expiresAt: number; blockedUntil: number };

const SWEEP_EVERY_MS = 60_000;

/**
 * Contagem do limite de requisições em memória. Substitui o ThrottlerStorageService do
 * @nestjs/throttler, que amarra um timer à requisição que iniciou a aplicação (AsyncResource.bind):
 * no Cloudflare Workers, chamar aquela função a partir de outra requisição é erro, e toda requisição
 * da instância dava 500 (a aplicação costuma nascer no cron). Aqui não há timer: a limpeza dos
 * registros vencidos acontece durante as próprias chamadas.
 */
export class IsolateThrottlerStorage implements ThrottlerStorage {
  private readonly records = new Map<string, ThrottlerRecord>();
  private lastSweep = 0;

  async increment(key: string, ttl: number, limit: number, blockDuration: number) {
    const now = Date.now();
    this.sweep(now);

    let record = this.records.get(key);
    if (!record || (record.expiresAt <= now && record.blockedUntil <= now)) {
      record = { hits: 0, expiresAt: now + ttl, blockedUntil: 0 };
      this.records.set(key, record);
    }
    if (record.blockedUntil <= now) {
      record.hits++;
      if (record.hits > limit) record.blockedUntil = now + (blockDuration > 0 ? blockDuration : ttl);
    }
    const isBlocked = record.blockedUntil > now;
    return {
      totalHits: record.hits,
      timeToExpire: Math.max(0, Math.ceil((record.expiresAt - now) / 1000)),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil((record.blockedUntil - now) / 1000) : 0,
    };
  }

  private sweep(now: number) {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now && record.blockedUntil <= now) this.records.delete(key);
    }
  }
}
