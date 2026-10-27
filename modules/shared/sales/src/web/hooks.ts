import { api } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';
import type { Product, SalesSettings } from '../contracts';

export const salesKey = ['sales'] as const;

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

export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
