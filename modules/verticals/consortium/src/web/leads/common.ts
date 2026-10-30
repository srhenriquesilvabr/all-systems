import { api } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';
import type { ConsortiumSettings } from '../../manifest';
import type { LeadStatus, RewardStatus } from '../../contracts';
import { key, type Tone } from '../common';

export const leadsKey = [...key, 'leads'] as const;
export const leadTone: Record<LeadStatus, Tone> = { new: 'brand', contacting: 'warning', simulation_sent: 'warning', proposal: 'brand', won: 'success', lost: 'neutral' };
export const rewardTone: Record<RewardStatus, Tone> = { none: 'neutral', waiting: 'neutral', due: 'warning', paid: 'success', cancelled: 'neutral', reversed: 'danger' };

/** Link do WhatsApp com a mensagem pronta (o telefone já vem em E.164). */
export const whatsappUrl = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** "2026-10-28T13:00:00Z" → "28/10 10:00" (fuso de Brasília). */
export const shortDateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Valor para <input type="datetime-local"> daqui a `hours` horas, no horário local. */
export function localInput(hours = 24) {
  const d = new Date(Date.now() + hours * 3_600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const SETTINGS_KEY = ['modules', 'consortium', 'settings'];
/** Configurações do consórcio (só para quem configura: core.access.settings). */
export function useConsortiumSettings(enabled = true) {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<ConsortiumSettings>('/modules/consortium/settings'), enabled });
}
