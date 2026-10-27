import { createDb, withScope, type Db, type DbScope, type Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool } from 'pg';
import { CoreConfig } from '../config';

/** Conexão da requisição atual, quando o runtime exige uma por requisição (Cloudflare Workers). */
const requestDb = new AsyncLocalStorage<Db>();

/**
 * Acesso ao banco. Toda leitura/escrita de dados de tenant passa por `run`, que abre uma
 * transação com o tenant da requisição — o RLS do Postgres faz o resto.
 */
@Injectable()
export class TenantDb implements OnApplicationShutdown {
  private shared?: { db: Db; pool: Pool };

  constructor(private readonly config: CoreConfig) {}

  /**
   * No Workers uma conexão não pode ser reaproveitada entre requisições: o entrypoint abre
   * uma por requisição e a disponibiliza aqui. No Node (API, worker, CLI, testes) o pool é único.
   */
  static runWith<T>(db: Db, fn: () => Promise<T>): Promise<T> {
    return requestDb.run(db, fn);
  }

  get db(): Db {
    const scoped = requestDb.getStore();
    if (scoped) return scoped;
    this.shared ??= createDb(this.config.databaseUrl);
    return this.shared.db;
  }

  /** Transação no escopo do tenant (e do usuário, se houver) do contexto atual. */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = requestContext.requireTenant();
    return withScope(this.db, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  /** Transação com escopo explícito (login, provisionamento, CLI). */
  withScope<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withScope(this.db, scope, fn);
  }

  async onApplicationShutdown() {
    await this.shared?.pool.end();
  }
}
