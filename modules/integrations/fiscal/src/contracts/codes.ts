/**
 * Formatos dos códigos fiscais. Só o formato é conferido aqui (tamanho, dígitos, faixas
 * conhecidas); se o código é o certo para o produto/serviço, quem confirma é o contador do cliente.
 */

export const onlyDigits = (s: string) => s.replace(/\D/g, '');

/** NCM: 8 dígitos (pode vir com pontos, ex.: 1905.90.90). */
export function normalizeNcm(v: string): string | null {
  const d = onlyDigits(v);
  return d.length === 8 ? d : null;
}

/** CFOP: 4 dígitos; o primeiro diz se é entrada (1-3) ou saída (5-7). Notas de venda usam saída. */
export function normalizeCfop(v: string): string | null {
  const d = onlyDigits(v);
  return /^[5-7]\d{3}$/.test(d) ? d : null;
}

/** CEST: 7 dígitos (ex.: 17.049.00). */
export function normalizeCest(v: string): string | null {
  const d = onlyDigits(v);
  return d.length === 7 ? d : null;
}

/** CST do ICMS (regime normal, 2 dígitos) e CSOSN (Simples Nacional, 3 dígitos). */
export const ICMS_CST = ['00', '02', '10', '15', '20', '30', '40', '41', '50', '51', '53', '60', '61', '70', '90'] as const;
export const ICMS_CSOSN = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'] as const;

export function normalizeIcmsSituation(v: string, regime: TaxRegimeLike): string | null {
  const d = onlyDigits(v);
  const simples = regime === 'simples' || regime === 'simples_excess' || regime === 'mei';
  if (simples) return (ICMS_CSOSN as readonly string[]).includes(d) ? d : null;
  return (ICMS_CST as readonly string[]).includes(d.padStart(2, '0')) ? d.padStart(2, '0') : null;
}
type TaxRegimeLike = 'simples' | 'simples_excess' | 'mei' | 'presumido' | 'real';

/** CST de PIS/COFINS: 2 dígitos (01 a 99). */
export function normalizePisCofinsCst(v: string): string | null {
  const d = onlyDigits(v).padStart(2, '0');
  return /^\d{2}$/.test(d) && d !== '00' ? d : null;
}

/** Item da lista de serviços da LC 116/2003: "nn.nn" (ex.: 06.01). Aceita "0601" e "6.01". */
export function normalizeLc116(v: string): string | null {
  const m = /^(\d{1,2})\.?(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const group = Number(m[1]);
  if (group < 1 || group > 40) return null;
  return `${String(group).padStart(2, '0')}.${m[2]}`;
}

/** Código de tributação nacional do ISS (cTribNac, NFS-e Nacional): 6 dígitos (item + subitem + desdobro). */
export function normalizeNationalServiceCode(v: string): string | null {
  const d = onlyDigits(v);
  return d.length === 6 ? d : null;
}

/** NBS (Nomenclatura Brasileira de Serviços): 9 dígitos (ex.: 1.2601.10.00 → 126011000). */
export function normalizeNbs(v: string): string | null {
  const d = onlyDigits(v);
  return d.length === 9 ? d : null;
}

/** CNAE: 7 dígitos (ex.: 9602-5/01 → 9602501). */
export function normalizeCnae(v: string): string | null {
  const d = onlyDigits(v);
  return d.length === 7 ? d : null;
}

/** Código IBGE do município: 7 dígitos, o primeiro é a região (1 a 5). */
export function normalizeIbge(v: string): string | null {
  const d = onlyDigits(v);
  return /^[1-5]\d{6}$/.test(d) ? d : null;
}

/** Classificação tributária do IBS/CBS (cClassTrib, Reforma Tributária): 6 dígitos. */
export function normalizeClassTrib(v: string): string | null {
  const d = onlyDigits(v);
  return d.length === 6 ? d : null;
}

/** CST do IBS/CBS: 3 dígitos. */
export function normalizeIbsCbsCst(v: string): string | null {
  const d = onlyDigits(v);
  return d.length === 3 ? d : null;
}

export const formatNcm = (d: string) => (d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d);
export const formatCest = (d: string) => (d.length === 7 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}` : d);
export const formatNbs = (d: string) => (d.length === 9 ? `${d.slice(0, 1)}.${d.slice(1, 5)}.${d.slice(5, 7)}.${d.slice(7)}` : d);
export const formatCnae = (d: string) => (d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : d);

/** Origem da mercadoria (tabela A do ICMS). */
export const productOrigins = [
  { value: 0, label: '0 — Nacional' },
  { value: 1, label: '1 — Estrangeira, importação direta' },
  { value: 2, label: '2 — Estrangeira, adquirida no mercado interno' },
  { value: 3, label: '3 — Nacional, conteúdo de importação acima de 40% e até 70%' },
  { value: 4, label: '4 — Nacional, produção conforme processos produtivos básicos' },
  { value: 5, label: '5 — Nacional, conteúdo de importação até 40%' },
  { value: 6, label: '6 — Estrangeira, importação direta, sem similar nacional (CAMEX)' },
  { value: 7, label: '7 — Estrangeira, mercado interno, sem similar nacional (CAMEX)' },
  { value: 8, label: '8 — Nacional, conteúdo de importação acima de 70%' },
] as const;

/** Chave de acesso de NF-e/NFC-e: 44 dígitos com dígito verificador módulo 11. */
export function accessKeyCheckDigit(first43: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidAccessKey(key: string): boolean {
  return /^\d{44}$/.test(key) && accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

/** CPF com dígitos conferidos (mesma regra do cadastro de clientes). */
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

/** CNPJ numérico ou alfanumérico (a partir de julho de 2026), com dígitos conferidos. */
export function isValidCnpj(input: string): boolean {
  const cnpj = input.replace(/[^\dA-Za-z]/g, '').toUpperCase();
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * (cnpj.charCodeAt(i) - 48), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

export const isValidPersonOrCompany = (doc: string) => (doc.length === 11 ? isValidCpf(doc) : doc.length === 14 ? isValidCnpj(doc) : false);
