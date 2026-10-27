/**
 * Numeração única de processos (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO.
 * DD é o dígito verificador ISO 7064 MOD 97-10 sobre N, A, J, TR e O.
 */

const PARTS = { n: [0, 7], dd: [7, 9], a: [9, 13], j: [13, 14], tr: [14, 16], o: [16, 20] } as const;
const slice = (digits: string, k: keyof typeof PARTS) => digits.slice(...PARTS[k]);

/** Dígitos verificadores corretos para o número (sem o DD). */
export function cnjCheckDigits(n: string, a: string, j: string, tr: string, o: string): string {
  const rest = BigInt(`${n.padStart(7, '0')}${a}${j}${tr}${o}00`) % 97n;
  return String(98n - rest).padStart(2, '0');
}

/** Número formatado se for um CNJ válido; senão `null`. Aceita com ou sem pontuação. */
export function parseCnj(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 20) return null;
  const valid = BigInt(`${slice(digits, 'n')}${slice(digits, 'a')}${slice(digits, 'j')}${slice(digits, 'tr')}${slice(digits, 'o')}${slice(digits, 'dd')}`) % 97n === 1n;
  if (!valid) return null;
  return `${slice(digits, 'n')}-${slice(digits, 'dd')}.${slice(digits, 'a')}.${slice(digits, 'j')}.${slice(digits, 'tr')}.${slice(digits, 'o')}`;
}

/** Segmento da Justiça (o "J" do número). */
export const cnjSegment: Record<string, string> = {
  '1': 'STF',
  '2': 'CNJ',
  '3': 'STJ',
  '4': 'Justiça Federal',
  '5': 'Justiça do Trabalho',
  '6': 'Justiça Eleitoral',
  '7': 'Justiça Militar da União',
  '8': 'Justiça Estadual',
  '9': 'Justiça Militar Estadual',
};
