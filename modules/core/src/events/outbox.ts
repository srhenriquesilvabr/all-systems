import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db';
import { outboxDeliveries, outboxEvents } from './schema';

export interface OutboxEvent<P = Record<string, unknown>> {
  id: string;
  tenantId: string;
  userId: string | null;
  type: string;
  payload: P;
  attempts: number;
}

type Handler = (event: OutboxEvent<any>) => Promise<void>;

const MAX_ATTEMPTS = 10;
const BATCH = 20;

/** Publica eventos dentro da transação da mudança: ou os dois acontecem, ou nenhum. */
@Injectable()
export class OutboxService {
  async publish(tx: Tx, type: string, payload: Record<string, unknown>): Promise<void> {
    const ctx = requestContext.requireTenant();
    await tx.insert(outboxEvents).values({ tenantId: ctx.tenantId, userId: ctx.userId ?? null, type, payload });
  }
}

/**
 * Handlers de eventos. Os módulos registram no onModuleInit:
 *   handlers.on('shared.notifications.deliver', 'notifications.send', (e) => ...)
 * O nome identifica o handler: numa nova tentativa, só os que ainda não concluíram rodam.
 * Entrega é "pelo menos uma vez": handlers precisam tolerar repetição.
 */
@Injectable()
export class OutboxHandlers {
  private readonly byType = new Map<string, { name: string; fn: Handler }[]>();

  on<P>(type: string, name: string, fn: (event: OutboxEvent<P>) => Promise<void>) {
    const list = this.byType.get(type) ?? [];
    if (list.some((h) => h.name === name)) throw new Error(`Handler duplicado: ${name}`);
    list.push({ name, fn: fn as Handler });
    this.byType.set(type, list);
  }

  for(type: string) {
    return this.byType.get(type) ?? [];
  }
}

/**
 * Lê o outbox e entrega os eventos aos handlers. Roda no processo worker
 * (apps/api/src/worker.ts); nos testes, `drain()` processa tudo de forma síncrona.
 * Em produção o mesmo papel pode ser feito por SQS/EventBridge sem mudar quem publica.
 */
@Injectable()
export class OutboxRelay implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<number>;

  constructor(
    private readonly tdb: TenantDb,
    private readonly handlers: OutboxHandlers,
  ) {}

  start(intervalMs = 1000) {
    const tick = async () => {
      try {
        await this.drain();
      } catch (err) {
        this.logger.error(`Falha no relay: ${err}`);
      }
      this.timer = setTimeout(tick, intervalMs);
    };
    this.logger.log('Relay do outbox iniciado');
    tick();
  }

  /** Processa lotes até não haver eventos prontos. Retorna quantos eventos foram tratados. */
  drain(): Promise<number> {
    this.running ??= this.drainLoop().finally(() => (this.running = undefined));
    return this.running;
  }

  private async drainLoop() {
    let total = 0;
    for (;;) {
      const handled = await this.processBatch();
      total += handled;
      if (handled < BATCH) return total;
    }
  }

  private processBatch(): Promise<number> {
    return this.tdb.db.transaction(async (tx) => {
      const events = await tx
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.processedAt), isNull(outboxEvents.failedAt), lte(outboxEvents.nextAttemptAt, new Date())))
        .orderBy(outboxEvents.id)
        .limit(BATCH)
        .for('update', { skipLocked: true });

      for (const event of events) {
        const done = new Set(
          (await tx.select({ handler: outboxDeliveries.handler }).from(outboxDeliveries).where(eq(outboxDeliveries.eventId, event.id))).map(
            (d) => d.handler,
          ),
        );
        let error: unknown;
        for (const handler of this.handlers.for(event.type)) {
          if (done.has(handler.name)) continue;
          try {
            await requestContext.run({ tenantId: event.tenantId, userId: event.userId ?? undefined }, () =>
              handler.fn(event as OutboxEvent),
            );
            await tx.insert(outboxDeliveries).values({ eventId: event.id, handler: handler.name });
          } catch (err) {
            error = err;
            this.logger.warn(`Handler ${handler.name} falhou para ${event.type} (${event.id}): ${err}`);
          }
        }

        if (!error) {
          await tx.update(outboxEvents).set({ processedAt: new Date() }).where(eq(outboxEvents.id, event.id));
          continue;
        }
        const attempts = event.attempts + 1;
        await tx
          .update(outboxEvents)
          .set({
            attempts,
            lastError: String(error).slice(0, 2000),
            // Espera exponencial: 2s, 4s, 8s… até 1h.
            nextAttemptAt: sql`now() + make_interval(secs => ${Math.min(2 ** attempts, 3600)})`,
            failedAt: attempts >= MAX_ATTEMPTS ? new Date() : null,
          })
          .where(eq(outboxEvents.id, event.id));
      }
      return events.length;
    });
  }

  onApplicationShutdown() {
    clearTimeout(this.timer);
  }
}
