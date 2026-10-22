import { OutboxHandlers, OutboxService, TenantDb } from '@all/core';
import { requestContext } from '@all/module-sdk';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env';
import { createTenant, createTestApp, ownerSession, type TestApp } from './helpers';

describe('plataforma', () => {
  let t: TestApp;
  const admin = new Client({ connectionString: testEnv.MIGRATION_DATABASE_URL });
  beforeAll(async () => {
    t = await createTestApp();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await t.close();
  });

  describe('outbox', () => {
    it('tenta de novo só o handler que falhou', async () => {
      const { tenantId } = await createTenant(t);
      const handlers = t.app.get(OutboxHandlers);
      const calls = { ok: 0, flaky: 0 };
      handlers.on('test.event', 'test.ok', async () => void calls.ok++);
      handlers.on('test.event', 'test.flaky', async () => {
        if (++calls.flaky === 1) throw new Error('falha temporária');
      });

      const tdb = t.app.get(TenantDb);
      const outbox = t.app.get(OutboxService);
      await requestContext.run({ tenantId }, () => tdb.run((tx) => outbox.publish(tx, 'test.event', { n: 1 })));

      await t.relay.drain();
      expect(calls).toEqual({ ok: 1, flaky: 1 });
      const { rows: failed } = await admin.query(`select attempts, processed_at from outbox_events where type = 'test.event'`);
      expect(failed[0]).toMatchObject({ attempts: 1, processed_at: null });

      // Simula a passagem do tempo de espera.
      await admin.query(`update outbox_events set next_attempt_at = now() where type = 'test.event'`);
      await t.relay.drain();
      expect(calls).toEqual({ ok: 1, flaky: 2 });
      const { rows: done } = await admin.query(`select processed_at from outbox_events where type = 'test.event'`);
      expect(done[0].processed_at).not.toBeNull();
    });
  });

  describe('reconciliação de módulos', () => {
    it('empresa antiga recebe módulos core novos, dependências e dados iniciais', async () => {
      const { tenantId } = await createTenant(t, { modules: ['laundry'] });
      // Simula uma empresa criada antes do financeiro e da ordem de serviço existirem.
      await admin.query(`delete from tenant_modules where tenant_id = $1 and module_key in ('core.finance', 'shared.service-orders')`, [tenantId]);
      await admin.query(`delete from fin_categories where tenant_id = $1`, [tenantId]);

      await t.tenancy.reconcileTenants();

      const { rows: modules } = await admin.query(`select module_key, source from tenant_modules where tenant_id = $1`, [tenantId]);
      expect(modules).toEqual(
        expect.arrayContaining([
          { module_key: 'core.finance', source: 'core' },
          { module_key: 'shared.service-orders', source: 'dependency' },
        ]),
      );
      const { rows: categories } = await admin.query(`select count(*)::int as n from fin_categories where tenant_id = $1`, [tenantId]);
      expect(categories[0].n).toBeGreaterThan(5);
    });

    it('papéis padrão acompanham o manifesto', async () => {
      const s = await ownerSession(t);
      await admin.query(
        `delete from role_permissions rp using roles r where rp.role_id = r.id and r.tenant_id = $1 and r.key = 'laundry.operator'`,
        [s.tenantId],
      );
      await t.tenancy.reconcileTenants();
      const roles = await s.as('get', '/access/roles').expect(200);
      const operator = roles.body.find((r: { key: string }) => r.key === 'laundry.operator');
      expect(operator.permissions).toEqual(expect.arrayContaining(['laundry.orders.read', 'shared.service-orders.status']));
    });

    it('não reativa módulo suspenso', async () => {
      const { tenantId } = await createTenant(t, { modules: ['laundry'] });
      await admin.query(`update tenant_modules set status = 'suspended' where tenant_id = $1 and module_key = 'laundry'`, [tenantId]);
      await t.tenancy.reconcileTenants();
      const { rows } = await admin.query(`select status from tenant_modules where tenant_id = $1 and module_key = 'laundry'`, [tenantId]);
      expect(rows[0].status).toBe('suspended');
    });
  });
});
