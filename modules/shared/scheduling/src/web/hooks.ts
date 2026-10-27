import { api } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';
import type { Appointment, AvailabilitySlots, Resource, SchedulingSettings, Service } from '../contracts';

export const schedulingKey = ['scheduling'];

export const useResources = () => useQuery({ queryKey: [...schedulingKey, 'resources'], queryFn: () => api<Resource[]>('/scheduling/resources') });
export const useServices = () => useQuery({ queryKey: [...schedulingKey, 'services'], queryFn: () => api<Service[]>('/scheduling/services') });

export const useAppointments = (from: Date, to: Date) =>
  useQuery({
    queryKey: [...schedulingKey, 'appointments', from.toISOString(), to.toISOString()],
    queryFn: () => api<Appointment[]>('/scheduling/appointments', { query: { from: from.toISOString(), to: to.toISOString() } }),
    // A recepção e os profissionais mexem na mesma agenda ao mesmo tempo.
    refetchInterval: 30_000,
  });

export const useTimeOff = (from: Date, to: Date) =>
  useQuery({
    queryKey: [...schedulingKey, 'time-off', from.toISOString(), to.toISOString()],
    queryFn: () =>
      api<{ id: string; resourceId: string; startsAt: string; endsAt: string; reason: string | null }[]>('/scheduling/time-off', {
        query: { from: from.toISOString(), to: to.toISOString() },
      }),
  });

export const useAvailability = (date: string, serviceIds: string[], resourceId?: string) =>
  useQuery({
    queryKey: [...schedulingKey, 'availability', date, serviceIds.join(','), resourceId],
    queryFn: () => api<AvailabilitySlots[]>('/scheduling/availability', { query: { date, serviceIds: serviceIds.join(','), resourceId } }),
    enabled: !!date && serviceIds.length > 0,
  });

export const useSchedulingSettings = () =>
  useQuery({ queryKey: ['modules', 'shared.scheduling', 'settings'], queryFn: () => api<SchedulingSettings>('/modules/shared.scheduling/settings'), retry: false });

// ---- datas no fuso da empresa (São Paulo, UTC−3) -----------------------------------------------

const OFFSET = '-03:00';
export const localToUtc = (date: string, time: string) => new Date(`${date}T${time}:00${OFFSET}`);
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
export const localDate = (d: Date | string) => dateFmt.format(new Date(d));
export const localTime = (d: Date | string) => timeFmt.format(new Date(d));
export const todayLocal = () => localDate(new Date());

export function shiftDate(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

export function weekday(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export const formatLongDate = (date: string) => longDate.format(new Date(`${date}T12:00:00Z`));

export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const hhmmOf = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
