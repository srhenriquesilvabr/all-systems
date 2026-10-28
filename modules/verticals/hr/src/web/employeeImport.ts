import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import type { Employer } from '../contracts';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));
const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/**
 * Empresa da coluna "Empresa (CNPJ ou nome)": CNPJ (com ou sem pontuação) ou o nome exato do cliente
 * empresa, sem diferenciar maiúsculas e acentos. Vazio = `fallback` (a empresa do filtro da tela).
 */
export function resolveEmployer(value: string | undefined, employers: Employer[], fallback: string | null): string | null {
  if (!value?.trim()) return fallback;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 14) {
    const byDoc = employers.find((e) => e.document === digits);
    if (!byDoc) throw new Error(`Empresa com CNPJ ${value.trim()} não encontrada nos clientes`);
    return byDoc.id;
  }
  const name = plain(value);
  if (name === 'propria empresa' || name === 'propria') return null;
  const byName = employers.filter((e) => plain(e.name) === name);
  if (byName.length > 1) throw new Error(`Há mais de uma empresa chamada "${value.trim()}": use o CNPJ`);
  if (!byName.length) throw new Error(`Empresa "${value.trim()}" não encontrada nos clientes (cadastre como cliente do tipo empresa)`);
  return byName[0]!.id;
}

/**
 * Planilha de colaboradores: mesmos campos da admissão manual. Com empresas-clientes (consultoria
 * de RH), ganha a coluna "Empresa (CNPJ ou nome)"; vazia, vale a empresa escolhida no filtro da tela.
 */
export function employeeImportSpec(employers: { list: Employer[]; fallback: string | null } | null = null): ImportSpec {
  return {
    entity: 'colaboradores',
    fileName: 'colaboradores',
    columns: [
      { key: 'name', label: 'Nome completo', required: true, example: 'Maria Souza' },
      { key: 'cpf', label: 'CPF', required: true, example: '123.456.789-09', hint: 'Com ou sem pontuação (11 dígitos)' },
      ...(employers
        ? [{ key: 'employer', label: 'Empresa (CNPJ ou nome)', example: '12.345.678/0001-95', hint: 'Cliente do tipo empresa. Vazio = a empresa do filtro da tela (ou a própria empresa)' }]
        : []),
      { key: 'birthDate', label: 'Nascimento', type: 'date', example: '15/04/1990' },
      { key: 'position', label: 'Cargo', required: true, example: 'Auxiliar administrativo' },
      { key: 'department', label: 'Setor', example: 'Financeiro' },
      { key: 'admissionDate', label: 'Admissão', required: true, type: 'date', example: '01/03/2024' },
      { key: 'salary', label: 'Salário (R$)', required: true, type: 'money', example: '2.500,00' },
      { key: 'weeklyHours', label: 'Jornada semanal (h)', type: 'integer', example: 44, hint: 'De 1 a 44 (vazio = 44)' },
      { key: 'dependents', label: 'Dependentes para IR', type: 'integer', example: 0, hint: 'Número inteiro (vazio = 0)' },
      { key: 'email', label: 'E-mail', type: 'email', example: 'maria@exemplo.com' },
      { key: 'phone', label: 'Telefone', example: '(11) 98765-4321' },
      { key: 'pixKey', label: 'Chave Pix (salário)', example: 'maria@exemplo.com' },
      { key: 'notes', label: 'Observações' },
    ],
    create: async (row) =>
      api('/hr/employees', {
        method: 'POST',
        body: {
          name: text(row, 'name'),
          // Excel pode guardar o CPF como número e perder os zeros à esquerda.
          cpf: typeof row.cpf === 'string' && /^\d{1,10}$/.test(row.cpf) ? row.cpf.padStart(11, '0') : text(row, 'cpf'),
          ...(employers ? { employerCustomerId: resolveEmployer(text(row, 'employer'), employers.list, employers.fallback) } : {}),
          birthDate: row.birthDate,
          position: text(row, 'position'),
          department: text(row, 'department') ?? null,
          admissionDate: row.admissionDate,
          salary: row.salary,
          weeklyHours: row.weeklyHours ?? 44,
          dependents: row.dependents ?? 0,
          email: text(row, 'email') ?? null,
          phone: text(row, 'phone') ?? null,
          pixKey: text(row, 'pixKey') ?? null,
          notes: text(row, 'notes') ?? null,
        },
      }),
  };
}
