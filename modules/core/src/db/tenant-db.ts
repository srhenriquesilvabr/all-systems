import { createDb, withScope, type Db, type DbScope, type Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { CoreConfig } from '../config';

/**
 * Acesso ao banco. Toda leitura/escrita de dados de tenant passa por `run`, que abre uma
 * transação com o tenant da requisição — o RLS do Postgres faz o resto.
 */
@Injectable()
export class TenantDb implements OnApplicationShutdown {
  readonly db: Db;
  private readonly pool: Pool;

  constructor(config: CoreConfig) {
    const { db, pool } = createDb(config.databaseUrl);
    this.db = db;
    this.pool = pool;
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
    await this.pool.end();
  }
}
