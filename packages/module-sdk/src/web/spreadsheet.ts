/**
 * Planilhas de cadastro: modelo para baixar, leitura de .xlsx/.csv e conversão das células
 * para o formato que a API aceita. A conversão é só de formato (data, dinheiro, sim/não,
 * opções); as regras de negócio continuam na API, que valida cada linha como no cadastro manual.
 */

export type ImportColumnType = 'text' | 'number' | 'integer' | 'money' | 'date' | 'boolean' | 'enum' | 'email';

export interface ImportOption {
  value: string;
  label: string;
}

export interface ImportColumn {
  /** Campo na linha convertida (o que vai para a API, antes do `toPayload` da tela). */
  key: string;
  /** Cabeçalho da coluna na planilha. */
  label: string;
  required?: boolean;
  type?: ImportColumnType;
  /** Para `enum`: aceita o valor ou o rótulo, sem diferenciar maiúsculas e acentos. */
  options?: ImportOption[];
  example?: string | number;
  hint?: string;
}

export type ImportRow = Record<string, string | number | boolean | null>;

export interface ParsedRow {
  /** Número da linha na planilha (o cabeçalho é a 1). */
  line: number;
  values: ImportRow;
  errors: string[];
  /** Células como vieram, para o relatório de erros. */
  raw: Record<string, unknown>;
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[*()]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const pad = (n: number) => String(n).padStart(2, '0');

/** Data da célula: Date (Excel), "dd/mm/aaaa", "aaaa-mm-dd" ou número serial do Excel → "aaaa-mm-dd". */
export function toIsoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return valid(+m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  return null;

  function valid(y: number, mo: number, d: number) {
    const date = new Date(Date.UTC(y, mo - 1, d));
    return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
}

/** Número da célula: aceita 1234.56, "1.234,56", "R$ 1.234,56" e "1234,5". */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = normalize(String(v));
  if (['sim', 's', 'x', '1', 'true', 'verdadeiro', 'ativo'].includes(s)) return true;
  if (['nao', 'n', '0', 'false', 'falso', 'inativo'].includes(s)) return false;
  return null;
}

function convert(col: ImportColumn, cell: unknown): { value: ImportRow[string]; error?: string } {
  const empty = cell === undefined || cell === null || String(cell).trim() === '';
  if (empty) return col.required ? { value: null, error: `${col.label}: obrigatório` } : { value: null };

  switch (col.type ?? 'text') {
    case 'date': {
      const d = toIsoDate(cell);
      return d ? { value: d } : { value: null, error: `${col.label}: data inválida (use dd/mm/aaaa)` };
    }
    case 'number':
    case 'money':
    case 'integer': {
      const n = toNumber(cell);
      if (n === null) return { value: null, error: `${col.label}: número inválido` };
      if (col.type === 'integer' && !Number.isInteger(n)) return { value: null, error: `${col.label}: use um número inteiro` };
      return { value: col.type === 'money' ? Math.round(n * 100) / 100 : n };
    }
    case 'boolean': {
      const b = toBoolean(cell);
      return b === null ? { value: null, error: `${col.label}: use Sim ou Não` } : { value: b };
    }
    case 'enum': {
      const key = normalize(String(cell));
      const opt = col.options?.find((o) => normalize(o.value) === key || normalize(o.label) === key);
      return opt ? { value: opt.value } : { value: null, error: `${col.label}: "${String(cell)}" não é aceito (${col.options?.map((o) => o.label).join(', ')})` };
    }
    case 'email': {
      const s = String(cell).trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s } : { value: null, error: `${col.label}: e-mail inválido` };
    }
    default:
      return { value: typeof cell === 'number' ? String(cell) : String(cell).trim() };
  }
}

/** Converte as linhas lidas da planilha, localizando as colunas pelo cabeçalho. */
export function parseRows(columns: ImportColumn[], header: unknown[], rows: unknown[][]): { rows: ParsedRow[]; missingColumns: string[] } {
  const index = new Map<string, number>();
  header.forEach((h, i) => index.set(normalize(String(h ?? '')), i));
  const position = (c: ImportColumn) => index.get(normalize(c.label)) ?? index.get(normalize(c.key));
  const missingColumns = columns.filter((c) => c.required && position(c) === undefined).map((c) => c.label);

  const parsed: ParsedRow[] = [];
  rows.forEach((cells, i) => {
    if (!cells || cells.every((c) => c === undefined || c === null || String(c).trim() === '')) return;
    const values: ImportRow = {};
    const raw: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const col of columns) {
      const at = position(col);
      const cell = at === undefined ? undefined : cells[at];
      raw[col.label] = cell ?? '';
      const { value, error } = convert(col, cell);
      values[col.key] = value;
      if (error) errors.push(error);
    }
    parsed.push({ line: i + 2, values, errors, raw });
  });
  return { rows: parsed, missingColumns };
}

/** SheetJS só é baixado quando alguém usa planilha (não pesa no carregamento do admin). */
const loadXlsx = () => import('xlsx');

/** Lê a primeira aba de um .xlsx/.xls/.csv. */
export async function readSpreadsheet(file: File): Promise<{ header: unknown[]; rows: unknown[][] }> {
  const XLSX = await loadXlsx();
  const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]!]!;
  const [header = [], ...rows] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  return { header, rows };
}

function formatHint(c: ImportColumn): string {
  if (c.hint) return c.hint;
  switch (c.type ?? 'text') {
    case 'date':
      return 'Data no formato dd/mm/aaaa';
    case 'money':
      return 'Valor em reais, ex.: 1.234,56';
    case 'integer':
      return 'Número inteiro';
    case 'number':
      return 'Número';
    case 'boolean':
      return 'Sim ou Não';
    case 'enum':
      return `Um destes: ${c.options?.map((o) => o.label).join(', ')}`;
    case 'email':
      return 'E-mail';
    default:
      return 'Texto';
  }
}

/** Modelo: aba "Dados" só com o cabeçalho (obrigatórias com *) e aba "Instruções". */
export async function downloadTemplate(fileName: string, columns: ImportColumn[]) {
  const XLSX = await loadXlsx();
  const book = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([columns.map((c) => (c.required ? `${c.label} *` : c.label))]);
  data['!cols'] = columns.map((c) => ({ wch: Math.max(14, c.label.length + 4) }));
  XLSX.utils.book_append_sheet(book, data, 'Dados');
  const help = XLSX.utils.aoa_to_sheet([
    ['Coluna', 'Obrigatória', 'Como preencher', 'Exemplo'],
    ...columns.map((c) => [c.label, c.required ? 'Sim' : 'Não', formatHint(c), c.example ?? '']),
    [],
    ['Preencha a aba "Dados" a partir da linha 2. Não mude os nomes das colunas; colunas fora desta lista são ignoradas.'],
  ]);
  help['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 60 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(book, help, 'Instruções');
  XLSX.writeFile(book, `${fileName}.xlsx`);
}

/** Relatório das linhas que não entraram, com o motivo, para corrigir e importar de novo. */
export async function downloadErrors(fileName: string, columns: ImportColumn[], failed: { row: ParsedRow; message: string }[]) {
  const XLSX = await loadXlsx();
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [...columns.map((c) => (c.required ? `${c.label} *` : c.label)), 'Erro'],
    ...failed.map(({ row, message }) => [...columns.map((c) => row.raw[c.label] ?? ''), message]),
  ]);
  XLSX.utils.book_append_sheet(book, sheet, 'Dados');
  XLSX.writeFile(book, `${fileName}-erros.xlsx`);
}
