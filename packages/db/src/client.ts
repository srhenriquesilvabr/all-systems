import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbScope {
  tenantId?: string | null;
  userId?: string | null;
}

export function createDb(connectionString: string, max = 10) {
  const pool = new Pool({ connectionString, max });
  return { db: drizzle(pool), pool };
}

/**
 * Abre uma transação com o escopo de RLS definido.
 *
 * `set_config(..., true)` vale só até o fim da transação, então é seguro com pool de
 * conexões: a próxima requisição que pegar a mesma conexão não herda o tenant.
 */
export function withScope<T>(db: Db, scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${scope.tenantId ?? ''}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
