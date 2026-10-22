import type { Tx } from '@all/db';
import { sql } from 'drizzle-orm';

/**
 * Próximo número da sequência `key` do tenant (1, 2, 3…). Seguro sob concorrência:
 * o upsert trava a linha da sequência até o fim da transação.
 */
export async function nextSequence(tx: Tx, tenantId: string, key: string): Promise<number> {
  const result = await tx.execute<{ value: string }>(sql`
    insert into tenant_sequences (tenant_id, key, value) values (${tenantId}, ${key}, 1)
    on conflict (tenant_id, key) do update set value = tenant_sequences.value + 1
    returning value`);
  return Number(result.rows[0]!.value);
}
