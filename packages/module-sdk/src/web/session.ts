import { createContext, useContext } from 'react';

/** Módulo como o admin o mostra (sessão e catálogo `/modules/catalog`). */
export interface ModuleSummary {
  key: string;
  name: string;
  layer: string;
  description?: string;
  icon?: string;
}

export interface SessionInfo {
  user: { id: string; name: string; email: string };
  tenant: {
    id: string;
    name: string;
    slug: string | null;
    /** Logo da empresa (rota pública, com versão no endereço). */
    logoUrl: string | null;
    /** Cor principal do painel (#rrggbb). Nulo = padrão Palmer. */
    brandColor: string | null;
  };
  tenants: { id: string; name: string }[];
  modules: ModuleSummary[];
  permissions: string[];
  isOwner: boolean;
  menu: { label: string; path: string; icon?: string; group?: string; module: string }[];
}

export const SessionContext = createContext<SessionInfo | null>(null);

export function useSession(): SessionInfo {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession fora de uma sessão autenticada');
  return session;
}

export function useCan(permission: string): boolean {
  return useSession().permissions.includes(permission);
}
