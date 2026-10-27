import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));

/** Planilha de colaboradores: mesmos campos da admissão manual. */
export const employeeImportSpec: ImportSpec = {
  entity: 'colaboradores',
  fileName: 'colaboradores',
  columns: [
    { key: 'name', label: 'Nome completo', required: true, example: 'Maria Souza' },
    { key: 'cpf', label: 'CPF', required: true, example: '123.456.789-09', hint: 'Com ou sem pontuação (11 dígitos)' },
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
  create: (row) =>
    api('/hr/employees', {
      method: 'POST',
      body: {
        name: text(row, 'name'),
        // Excel pode guardar o CPF como número e perder os zeros à esquerda.
        cpf: typeof row.cpf === 'string' && /^\d{1,10}$/.test(row.cpf) ? row.cpf.padStart(11, '0') : text(row, 'cpf'),
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
