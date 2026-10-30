import { api } from '@all/module-sdk/web';
import type { OrderDetail } from '@all/service-orders';
import { useQuery } from '@tanstack/react-query';
import type { GarmentType, LaundryService, Piece, ProductionPiece } from '../contracts';

export const laundryKey = ['laundry'];

export interface LaundryOrderDetail {
  order: OrderDetail;
  pieces: Piece[];
}

export const useServices = () => useQuery({ queryKey: [...laundryKey, 'services'], queryFn: () => api<LaundryService[]>('/laundry/services') });

export const useGarmentTypes = () =>
  useQuery({ queryKey: [...laundryKey, 'garment-types'], queryFn: () => api<GarmentType[]>('/laundry/garment-types') });

export const useLaundryOrder = (id: string) =>
  useQuery({ queryKey: [...laundryKey, 'orders', id], queryFn: () => api<LaundryOrderDetail>(`/laundry/orders/${id}`) });

export const useProduction = (includeReady = false) =>
  useQuery({
    queryKey: [...laundryKey, 'production', includeReady],
    queryFn: () => api<ProductionPiece[]>('/laundry/production', { query: { includeReady: includeReady || undefined } }),
    // Várias pessoas mexem no quadro ao mesmo tempo.
    refetchInterval: 30_000,
  });

/** Preços por tipo de peça de um serviço (para a estimativa no balcão). */
export const useServicePrices = (serviceId: string | undefined) =>
  useQuery({
    queryKey: [...laundryKey, 'prices', serviceId],
    queryFn: () => api<{ garmentTypeId: string; price: number }[]>(`/laundry/services/${serviceId}/prices`),
    enabled: !!serviceId,
  });

