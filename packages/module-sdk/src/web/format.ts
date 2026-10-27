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

/** 12345678909 → 123.456.789-09 · 11222333000181 → 11.222.333/0001-81 */
export function formatDocument(doc: string | null | undefined): string {
  if (!doc) return '';
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

/** +5511987654321 → (11) 98765-4321. Números de outros países ficam como estão. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = phone.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}
