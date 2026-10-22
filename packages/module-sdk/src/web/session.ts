import { createContext, useContext } from 'react';

export interface SessionInfo {
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string };
  tenants: { id: string; name: string }[];
  modules: { key: string; name: string; layer: string }[];
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
