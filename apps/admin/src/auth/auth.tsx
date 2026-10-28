import { api, ApiError, configureApi, SessionContext, type SessionInfo } from '@all/module-sdk/web';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { syncCompanyBrand } from '../layout/theme';

type Status = 'loading' | 'anonymous' | 'authenticated';

export interface TenantOption {
  id: string;
  name: string;
}

type LoginResponse =
  | { accessToken: string; tenant: TenantOption }
  | { selectTenant: true; selectionToken: string; tenants: TenantOption[] };

export type LoginResult = { kind: 'done' } | { kind: 'select-tenant'; selectionToken: string; tenants: TenantOption[] };

interface AuthApi {
  status: Status;
  login(email: string, password: string): Promise<LoginResult>;
  selectTenant(selectionToken: string, tenantId: string): Promise<void>;
  switchTenant(tenantId: string): Promise<void>;
  /** Busca a sessão de novo (ex.: depois de mudar nome, logo ou cor da empresa). */
  reloadSession(): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

let renewing: Promise<string | null> | null = null;

/**
 * Renova a sessão pelo cookie. Pedidos simultâneos na mesma aba compartilham a mesma chamada
 * (cada cookie só pode ser usado uma vez). Se outra aba acabou de renovar (REFRESH_RACE), o
 * navegador já tem o cookie novo: tenta mais uma vez.
 */
function renewSession(): Promise<string | null> {
  renewing ??= (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return (await api<{ accessToken: string }>('/auth/refresh', { method: 'POST' })).accessToken;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'REFRESH_RACE')) return null;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    return null;
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

/**
 * Sessão do admin. O access token fica só em memória; ao recarregar a página, a sessão é
 * restaurada pelo cookie de refresh (httpOnly, inacessível ao JavaScript).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const token = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<SessionInfo | null>(null);

  const reset = useCallback(() => {
    token.current = null;
    setSession(null);
    setStatus('anonymous');
    queryClient.clear();
    // Sem sessão, as telas de login voltam a ser Palmer.
    syncCompanyBrand(null);
  }, [queryClient]);

  const refresh = useCallback(async () => {
    const accessToken = await renewSession();
    if (accessToken) token.current = accessToken;
    return !!accessToken;
  }, []);

  const start = useCallback(
    async (accessToken: string) => {
      token.current = accessToken;
      queryClient.clear();
      setSession(await api<SessionInfo>('/me'));
      setStatus('authenticated');
    },
    [queryClient],
  );

  useEffect(() => {
    configureApi({ getToken: () => token.current, refresh, onUnauthorized: reset });
    refresh().then((ok) => (ok && token.current ? start(token.current).catch(reset) : reset()));
  }, [refresh, reset, start]);

  const value = useMemo<AuthApi>(
    () => ({
      status,
      async login(email, password) {
        const res = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
        if ('selectTenant' in res) return { kind: 'select-tenant', selectionToken: res.selectionToken, tenants: res.tenants };
        await start(res.accessToken);
        return { kind: 'done' };
      },
      async selectTenant(selectionToken, tenantId) {
        const res = await api<{ accessToken: string }>('/auth/select-tenant', { method: 'POST', body: { selectionToken, tenantId } });
        await start(res.accessToken);
      },
      async switchTenant(tenantId) {
        const res = await api<{ accessToken: string }>('/auth/switch-tenant', { method: 'POST', body: { tenantId } });
        await start(res.accessToken);
      },
      async reloadSession() {
        setSession(await api<SessionInfo>('/me'));
      },
      async logout() {
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        reset();
      },
    }),
    [status, start, reset],
  );

  return (
    <AuthContext.Provider value={value}>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
