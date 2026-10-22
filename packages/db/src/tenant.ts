import { sql } from 'drizzle-orm';
import { pgPolicy, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from './uuid';

/** Tenant e usuário do escopo atual (definidos por `withScope`). Vazio vira NULL, e NULL nunca casa. */
export const CURRENT_TENANT = `nullif(current_setting('app.tenant_id', true), '')::uuid`;
export const CURRENT_USER = `nullif(current_setting('app.user_id', true), '')::uuid`;

export const id = () => uuid('id').primaryKey().$defaultFn(uuidv7);

export const tenantId = () => uuid('tenant_id').notNull();

/**
 * Política padrão de isolamento. Toda tabela com `tenant_id` deve declará-la;
 * o teste de isolamento do CI falha se alguma tabela ficar sem RLS.
 */
export const tenantIsolation = () =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    using: sql.raw(`"tenant_id" = ${CURRENT_TENANT}`),
    withCheck: sql.raw(`"tenant_id" = ${CURRENT_TENANT}`),
  });
