import { api, useSession } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { Product, RegisterSession, RegistersOverview, SalesSettings } from '../contracts';

export const salesKey = ['sales'] as const;
export const registersKey = [...salesKey, 'registers'] as const;

export function useProducts(query: { q?: string; active?: boolean; lowStock?: boolean }, enabled = true) {
  return useQuery({
    queryKey: [...salesKey, 'products', query],
    queryFn: () => api<Product[]>('/sales/products', { query: { ...query, limit: query.q ? 20 : 500 } }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useSalesSettings() {
  return useQuery({
    queryKey: ['modules', 'shared.sales', 'settings'],
    queryFn: () => api<SalesSettings>('/modules/shared.sales/settings'),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Caixas, sessão aberta de cada um e se a empresa exige caixa aberto para vender. */
export function useRegisters() {
  return useQuery({
    queryKey: registersKey,
    queryFn: () => api<RegistersOverview>('/sales/registers'),
    // Outro terminal pode abrir/fechar o mesmo caixa.
    refetchInterval: 60_000,
  });
}

export function useRegisterSession(id: string | null | undefined) {
  return useQuery({
    queryKey: [...registersKey, 'session', id],
    queryFn: () => api<RegisterSession>(`/sales/registers/sessions/${id}`),
    enabled: !!id,
  });
}

/**
 * Caixa usado neste navegador (cada computador do balcão é um terminal). Guardado por empresa
 * no localStorage; sem acesso ao armazenamento, vale só enquanto a página estiver aberta.
 */
export function useDeviceRegister(): [string | null, (id: string | null) => void] {
  const { tenant } = useSession();
  const key = `all.sales.register.${tenant.id}`;
  const [value, setValue] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const set = useCallback(
    (id: string | null) => {
      setValue(id);
      try {
        if (id) window.localStorage.setItem(key, id);
        else window.localStorage.removeItem(key);
      } catch {
        // Navegador sem armazenamento: fica só na memória.
      }
    },
    [key],
  );
  return [value, set];
}

export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
