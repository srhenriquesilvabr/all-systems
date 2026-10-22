import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  userId?: string;
  tenantId?: string;
  membershipId?: string;
  isOwner?: boolean;
  modules?: ReadonlySet<string>;
  permissions?: ReadonlySet<string>;
  ip?: string;
}

export type TenantContext = RequestContext & { userId: string; tenantId: string };

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Contexto da requisição atual. Um middleware abre um objeto vazio por requisição e o
 * guard de acesso o preenche; os serviços leem daqui sem receber o tenant por parâmetro.
 */
export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext {
    return storage.getStore() ?? {};
  },
  /** Contexto de uma requisição autenticada (tenant e usuário). */
  require(): TenantContext {
    const ctx = storage.getStore();
    if (!ctx?.tenantId || !ctx.userId) throw new Error('Sem tenant no contexto da requisição');
    return ctx as TenantContext;
  },
  /** Só o tenant: vale também para jobs do worker, que rodam sem usuário. */
  requireTenant(): RequestContext & { tenantId: string } {
    const ctx = storage.getStore();
    if (!ctx?.tenantId) throw new Error('Sem tenant no contexto');
    return ctx as RequestContext & { tenantId: string };
  },
};
