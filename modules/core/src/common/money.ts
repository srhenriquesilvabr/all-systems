// Dinheiro: numeric(14,2) no banco, number (reais) na API e centavos inteiros para fazer contas.

/** "12.90" | 12.9 → 1290 */
export const toCents = (value: string | number): number => Math.round(Number(value) * 100);

/** 1290 → "12.90" (para gravar em numeric) */
export const centsToDecimal = (cents: number): string => (cents / 100).toFixed(2);

/** 1290 → 12.9 (para responder na API) */
export const centsToNumber = (cents: number): number => cents / 100;
