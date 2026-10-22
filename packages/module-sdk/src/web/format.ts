const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatMoney = (value: number) => brl.format(value);

/** Aceita ISO completo ou só a data (YYYY-MM-DD, interpretada no fuso local, sem "voltar um dia"). */
export function formatDate(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return dateFmt.format(new Date(y!, m! - 1, d!));
  }
  return dateFmt.format(new Date(value));
}

export const formatDateTime = (value: string | Date) => dateTimeFmt.format(new Date(value));

/** "12,90" ou "12.90" → 12.9. Retorna NaN se não for número. */
export function parseMoney(input: string): number {
  const normalized = input.trim().replace(/\s|R\$/g, '');
  const decimal = normalized.includes(',') ? normalized.replace(/\./g, '').replace(',', '.') : normalized;
  return decimal === '' ? NaN : Number(decimal);
}

/** Data de hoje no fuso local, no formato YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
