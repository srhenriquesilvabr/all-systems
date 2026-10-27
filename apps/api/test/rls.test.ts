import { createDb, uuidv7, withScope } from '@all/db';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';

/**
 * Teste obrigatório do CI: nenhum tenant enxerga dados de outro, mesmo que o código esqueça o filtro.
 * Roda direto no banco, como app_user, sem passar pela API.
 */
describe('isolamento entre tenants (RLS)', () => {
  const { db, pool } = createDb(testEnv.DATABASE_URL, 2);
  const admin = new Client({ connectionString: testEnv.MIGRATION_DATABASE_URL });
  const tenantA = uuidv7();
  const tenantB = uuidv7();

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`INSERT INTO tenants (id, name) VALUES ($1, 'A'), ($2, 'B')`, [tenantA, tenantB]);
    for (const [tenant, name] of [
      [tenantA, 'Serviço do A'],
      [tenantB, 'Serviço do B'],
    ] as const) {
      await withScope(db, { tenantId: tenant }, (tx) =>
        tx.execute(sql`insert into laundry_services (id, tenant_id, name, pricing_unit, base_price, turnaround_hours)
                       values (${uuidv7()}, ${tenant}, ${name}, 'piece', 10, 24)`),
      );
    }
  });

  afterAll(async () => {
    await admin.end();
    await pool.end();
  });

  it('toda tabela com tenant_id tem RLS habilitado e política', async () => {
    const { rows } = await admin.query<{ table: string; rls: boolean; policies: number }>(`
      select c.relname as table, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c
      join information_schema.columns col on col.table_name = c.relname and col.column_name = 'tenant_id'
      where c.relkind = 'r' and col.table_schema = 'public'
        -- Exceções justificadas (qualquer tabela nova fora desta lista precisa de RLS):
        and c.relname not in (
          'refresh_tokens', -- consultada por hash antes de haver tenant no contexto
          'outbox_events',   -- o worker lê eventos de todos os tenants; só o OutboxService grava
          'whatsapp_numbers', -- o webhook da Meta chega sem tenant: número → empresa
          'whatsapp_inbound',  -- idem: deduplicação das mensagens recebidas
          'bank_webhook_routes' -- o webhook do banco chega sem tenant: conexão → empresa
        )
    `);
    expect(rows.length).toBeGreaterThan(5);
    const unprotected = rows.filter((r) => !r.rls || r.policies === 0).map((r) => r.table);
    expect(unprotected).toEqual([]);
  });

  it('a aplicação não roda como superuser nem com BYPASSRLS', async () => {
    const res = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(res.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('cada tenant só vê os próprios registros', async () => {
    const names = (tenant: string) =>
      withScope(db, { tenantId: tenant }, async (tx) =>
        (await tx.execute<{ name: string }>(sql`select name from laundry_services`)).rows.map((r) => r.name),
      );
    expect(await names(tenantA)).toEqual(['Serviço do A']);
    expect(await names(tenantB)).toEqual(['Serviço do B']);
  });

  it('sem tenant no escopo, nada é visível', async () => {
    const rows = await withScope(db, {}, async (tx) => (await tx.execute(sql`select * from laundry_services`)).rows);
    expect(rows).toEqual([]);
  });

  it('não grava registro em nome de outro tenant', async () => {
    const error = await withScope(db, { tenantId: tenantA }, (tx) =>
      tx.execute(sql`insert into laundry_services (id, tenant_id, name, pricing_unit, base_price, turnaround_hours)
                     values (${uuidv7()}, ${tenantB}, 'Invasor', 'piece', 1, 1)`),
    ).catch((err: Error & { cause?: Error }) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { cause?: Error }).cause?.message).toMatch(/row-level security/);
  });

  it('não altera registros de outro tenant', async () => {
    const updated = await withScope(db, { tenantId: tenantA }, async (tx) =>
      (await tx.execute(sql`update laundry_services set name = 'Alterado' where tenant_id = ${tenantB} returning id`)).rows,
    );
    expect(updated).toEqual([]);
  });
});
