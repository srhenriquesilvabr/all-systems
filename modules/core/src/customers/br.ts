// Validações brasileiras usadas no cadastro de clientes.

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** CNPJ sem pontuação, em maiúsculas. O CNPJ alfanumérico (a partir de julho de 2026) mantém as letras. */
export const normalizeCnpj = (value: string) => value.toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * CNPJ numérico ou alfanumérico (IN RFB 2.229/2024): as 12 primeiras posições podem ter letras,
 * os dois dígitos verificadores são sempre números. Cada caractere vale o código ASCII − 48,
 * o que para algarismos dá o próprio número: a conta é a mesma do CNPJ numérico.
 */
export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * (cnpj.charCodeAt(i) - 48), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

/**
 * Normaliza para E.164. Números brasileiros com DDD (10 ou 11 dígitos) ganham +55;
 * números já com código de país são mantidos. Retorna null se não parecer um telefone.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = onlyDigits(trimmed);
  if (trimmed.startsWith('+')) return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return null;
}
