import { api } from '@all/module-sdk/web';
import { useQuery } from '@tanstack/react-query';

export interface Account {
  id: string;
  name: string;
  type: 'cash' | 'bank' | 'gateway';
  active: boolean;
  initialBalance: number;
  balance: number;
}

export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  systemKey: string | null;
  active: boolean;
}

export interface Entry {
  id: string;
  kind: 'income' | 'expense';
  status: 'pending' | 'paid' | 'cancelled';
  description: string;
  amount: number;
  dueDate: string;
  competenceDate: string;
  paidAt: string | null;
  accountId: string | null;
  categoryId: string | null;
  sourceType: string;
  notes: string | null;
  categoryName: string | null;
  accountName: string | null;
}

export const accountTypeLabel = { cash: 'Caixa', bank: 'Banco', gateway: 'Gateway de pagamento' } as const;
export const sourceLabel: Record<string, string> = { manual: 'Manual', service_order: 'Ordem de serviço' };

export const financeKey = ['finance'];

export const useAccounts = () => useQuery({ queryKey: [...financeKey, 'accounts'], queryFn: () => api<Account[]>('/finance/accounts') });
export const useCategories = () => useQuery({ queryKey: [...financeKey, 'categories'], queryFn: () => api<Category[]>('/finance/categories') });

/** Períodos rápidos, sempre em meses fechados (de 1º do mês inicial até o último dia do mês atual). */
export const periods = [
  { key: 'month', label: 'Este mês', months: 1 },
  { key: '3m', label: 'Últimos 3 meses', months: 3 },
  { key: '6m', label: 'Últimos 6 meses', months: 6 },
  { key: '12m', label: 'Últimos 12 meses', months: 12 },
] as const;

export function periodRange(months: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(start), to: iso(end) };
}

const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' });
/** "2026-03" → "mar. de 26" */
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return monthFmt.format(new Date(y!, m! - 1, 1));
};
