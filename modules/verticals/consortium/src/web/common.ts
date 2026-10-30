import { ApiError, api } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';
import type { Administrator, BidStatus, CreditStatus, InstallmentStatus, QuotaStatus } from '../contracts';

export const key = ['consortium'] as const;
export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

export const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
export const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
/** "12,5" → 12.5; vazio → null. */
export const parsePercent = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export const quotaTone: Record<QuotaStatus, Tone> = { proposal: 'warning', active: 'brand', contemplated: 'success', rejected: 'danger', cancelled: 'neutral' };
export const installmentTone: Record<InstallmentStatus, Tone> = { upcoming: 'neutral', paid: 'success', late: 'danger', cancelled: 'neutral' };
export const bidTone: Record<BidStatus, Tone> = { registered: 'neutral', sent: 'brand', won: 'success', lost: 'danger', void: 'neutral' };
export const creditTone: Record<CreditStatus, Tone> = { awaiting_docs: 'warning', released: 'brand', acquired: 'success' };

export function useAdministrators() {
  return useQuery({ queryKey: [...key, 'administrators'], queryFn: () => api<Administrator[]>('/consortium/administrators'), staleTime: 5 * 60_000 });
}

export function useTeam() {
  return useQuery({ queryKey: [...key, 'team'], queryFn: () => api<{ id: string; name: string }[]>('/users/team'), staleTime: 5 * 60_000 });
}
