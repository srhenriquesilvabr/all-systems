import { api } from '@all/module-sdk/web';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import type { Pet } from '../contracts';

export const petsKey = ['pets'] as const;

export function usePets(query: { q?: string; customerId?: string }, enabled = true) {
  return useQuery({
    queryKey: [...petsKey, 'list', query],
    queryFn: () => api<Pet[]>('/pets', { query: { ...query, limit: 100 } }),
    enabled,
  });
}

/** Lista da tela de pets, em páginas. */
export function usePetsPage(query: { q?: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: [...petsKey, 'page', query],
    queryFn: () => api<{ items: Pet[]; total: number }>('/pets/page', { query }),
    placeholderData: keepPreviousData,
  });
}

export function usePet(id: string) {
  return useQuery({ queryKey: [...petsKey, id], queryFn: () => api<Pet>(`/pets/${id}`) });
}

/** Aba extra na ficha do pet (ex.: vacinas e prontuário da veterinária). */
export interface PetTab {
  key: string;
  label: string;
  /** Só aparece se o módulo estiver ativo no tenant. */
  moduleKey: string;
  permission?: string;
  Component: ComponentType<{ pet: Pet }>;
}

const petTabs: PetTab[] = [];
export function registerPetTab(tab: PetTab) {
  if (!petTabs.some((t) => t.key === tab.key)) petTabs.push(tab);
}
export function registeredPetTabs(): readonly PetTab[] {
  return petTabs;
}
