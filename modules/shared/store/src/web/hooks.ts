import { api } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';
import type { Order, OrderStatus, OrderSummary, PaymentMode, StoreProduct } from '../contracts';

export const storeKey = ['store'] as const;

export interface StoreStatus {
  slug: string | null;
  publicUrl: string | null;
  open: boolean;
  companyPhone: string | null;
  notifications: boolean;
  whatsappApi: boolean;
  paymentModes: PaymentMode[];
  onlinePaymentAvailable: boolean;
  bannerFileId: string | null;
}

export function useStoreStatus() {
  return useQuery({ queryKey: [...storeKey, 'status'], queryFn: () => api<StoreStatus>('/store/status'), staleTime: 60_000 });
}

export function useStoreProducts(query: { q?: string; listed?: boolean }) {
  return useQuery({
    queryKey: [...storeKey, 'products', query],
    queryFn: () => api<StoreProduct[]>('/store/products', { query }),
    placeholderData: (prev) => prev,
  });
}

export function useStoreCategories() {
  return useQuery({ queryKey: [...storeKey, 'categories'], queryFn: () => api<string[]>('/store/categories'), staleTime: 60_000 });
}

export function useStoreOrders(query: { status?: OrderStatus | 'open'; q?: string }) {
  return useQuery({
    queryKey: [...storeKey, 'orders', query],
    queryFn: () => api<OrderSummary[]>('/store/orders', { query }),
    placeholderData: (prev) => prev,
    // Pedidos chegam pela vitrine a qualquer hora.
    refetchInterval: 30_000,
  });
}

export function useStoreOrder(id: string | undefined) {
  return useQuery({ queryKey: [...storeKey, 'order', id], queryFn: () => api<Order>(`/store/orders/${id}`), enabled: !!id });
}

export const moneyText = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','));
