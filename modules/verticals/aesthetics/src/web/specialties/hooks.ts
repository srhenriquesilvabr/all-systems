import { api } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';
import type { AesCase, AesProduct, ConsentTemplate, PatientSpecialtyData, ProfessionalCredential, SpecialtyKey, SpecialtyOverview } from '../../contracts';

export const specialtiesKey = ['aesthetics', 'specialties'] as const;

export const useSpecialtyOverview = () =>
  useQuery({ queryKey: [...specialtiesKey, 'overview'], queryFn: () => api<SpecialtyOverview>('/aesthetics/specialties'), staleTime: 60_000 });

export const useCredentials = (enabled = true) =>
  useQuery({ queryKey: [...specialtiesKey, 'credentials'], queryFn: () => api<ProfessionalCredential[]>('/aesthetics/credentials'), enabled });

export const useAesProducts = (query: { specialty?: SpecialtyKey; active?: boolean } = {}) =>
  useQuery({ queryKey: [...specialtiesKey, 'products', query], queryFn: () => api<AesProduct[]>('/aesthetics/products', { query }) });

export const useConsentTemplates = (specialty?: SpecialtyKey) =>
  useQuery({ queryKey: [...specialtiesKey, 'templates', specialty ?? 'all'], queryFn: () => api<ConsentTemplate[]>('/aesthetics/consent-templates', { query: { specialty } }) });

export const usePatientSpecialties = (customerId: string) =>
  useQuery({ queryKey: [...specialtiesKey, 'patient', customerId], queryFn: () => api<PatientSpecialtyData>(`/aesthetics/patients/${customerId}`) });

export const useCases = (query: { specialty?: SpecialtyKey; status?: string; customerId?: string }) =>
  useQuery({ queryKey: [...specialtiesKey, 'cases', query], queryFn: () => api<AesCase[]>('/aesthetics/cases', { query }) });

/** Data (YYYY-MM-DD) somando dias (ex.: retorno em 15 dias). */
export const daysFrom = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};
