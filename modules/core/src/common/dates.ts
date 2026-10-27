/** Mesmo dia `n` meses depois, em datas ISO (31/01 + 1 mês = 28 ou 29/02). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Divide um valor em parcelas iguais; os centavos que sobram vão para a primeira. */
export function splitCents(totalCents: number, parts: number): number[] {
  const base = Math.floor(totalCents / parts);
  return Array.from({ length: parts }, (_, i) => (i === 0 ? base + (totalCents - base * parts) : base));
}
