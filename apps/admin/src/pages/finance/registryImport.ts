import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { accountTypeLabel } from './shared';

const kindOptions = [
  { value: 'expense', label: 'Despesa' },
  { value: 'income', label: 'Receita' },
];

/** Planilha de contas: nome, tipo e saldo inicial. */
export const accountImportSpec: ImportSpec = {
  entity: 'contas',
  fileName: 'contas',
  columns: [
    { key: 'name', label: 'Nome', required: true, example: 'Banco do Brasil' },
    {
      key: 'type',
      label: 'Tipo',
      required: true,
      type: 'enum',
      options: Object.entries(accountTypeLabel).map(([value, label]) => ({ value, label })),
      example: accountTypeLabel.bank,
    },
    { key: 'initialBalance', label: 'Saldo inicial (R$)', type: 'money', example: '1.500,00', hint: 'Valor em reais, ex.: 1.500,00 (vazio = 0; negativo se a conta começa no vermelho)' },
  ],
  create: (row: ImportRow) =>
    api('/finance/accounts', {
      method: 'POST',
      body: { name: String(row.name), type: row.type, initialBalance: row.initialBalance ?? 0 },
    }),
};

/** Planilha de categorias: nome e tipo (receita ou despesa). */
export const categoryImportSpec: ImportSpec = {
  entity: 'categorias',
  fileName: 'categorias',
  columns: [
    { key: 'name', label: 'Nome', required: true, example: 'Aluguel' },
    { key: 'kind', label: 'Tipo', required: true, type: 'enum', options: kindOptions, example: 'Despesa' },
  ],
  create: (row: ImportRow) => api('/finance/categories', { method: 'POST', body: { name: String(row.name), kind: row.kind } }),
};
