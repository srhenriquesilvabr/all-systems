import 'reflect-metadata';
import { configureHttp, OutboxRelay, R2Storage, ScheduledJobs, TenantDb, type R2BucketLike } from '@all/core';
import { createDb } from '@all/db';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { handleAsNodeRequest } from 'cloudflare:node';
import { AppModule } from './app.module.js';

/**
 * Entrypoint no Cloudflare Workers. O admin (estático) é servido pelos assets do Worker;
 * só /api/* chega aqui (wrangler.jsonc). A mesma aplicação Nest roda sobre o servidor HTTP do
 * Node que o runtime emula, e o Cron Trigger faz o papel do processo worker (outbox e jobs).
 */
interface Env {
  HYPERDRIVE: { connectionString: string };
  FILES: R2BucketLike;
  [key: string]: unknown;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const PORT = 8080;
const CRON_TICK_MS = 60_000;

let app: Promise<INestApplication> | undefined;

/** Uma aplicação por isolate, criada na primeira requisição (I/O só é permitido dentro dela). */
function boot(env: Env) {
  app ??= (async () => {
    const vars = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const nest = await NestFactory.create(
      AppModule.forRoot({ NODE_ENV: 'production', ...vars, DATABASE_URL: env.HYPERDRIVE.connectionString }, {
        storage: new R2Storage(env.FILES),
        syncModulesOnBoot: false,
      }),
      { rawBody: true, logger: ['error', 'warn', 'log'] },
    );
    configureHttp(nest);
    await nest.listen(PORT);
    return nest;
  })().catch((err) => {
    app = undefined;
    throw err;
  });
  return app;
}

/** Conexões do Hyperdrive são por requisição: abre, usa e fecha ao final (inclusive o trabalho em background). */
async function withRequestDb<T>(env: Env, ctx: ExecutionContext, fn: (background: (p: () => Promise<unknown>) => void) => Promise<T>) {
  const { db, pool } = createDb(env.HYPERDRIVE.connectionString, 5);
  const pending: Promise<unknown>[] = [];
  try {
    return await TenantDb.runWith(db, () => fn((task) => pending.push(TenantDb.runWith(db, task))));
  } finally {
    ctx.waitUntil(
      Promise.allSettled(pending)
        .then((results) => results.forEach((r) => r.status === 'rejected' && console.error('Tarefa em background falhou:', r.reason)))
        .finally(() => pool.end()),
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return withRequestDb(env, ctx, async (background) => {
      const nest = await boot(env);
      const response = await handleAsNodeRequest(PORT, request);
      // Mudanças publicam eventos no outbox: entrega logo após a resposta, sem esperar o cron.
      if (request.method !== 'GET') background(() => nest.get(OutboxRelay).drain());
      return response;
    });
  },

  scheduled(controller: { scheduledTime: number }, env: Env, ctx: ExecutionContext): Promise<void> {
    return withRequestDb(env, ctx, async () => {
      const nest = await boot(env);
      await nest.get(OutboxRelay).drain();
      await nest.get(ScheduledJobs).runDue(controller.scheduledTime, CRON_TICK_MS);
    });
  },
};
