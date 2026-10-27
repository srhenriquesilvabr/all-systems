import { api, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import type { CustomField } from './types';

const ADDRESS = ['zip', 'street', 'number', 'complement', 'district', 'city', 'state'] as const;

const base: ImportColumn[] = [
  { key: 'type', label: 'Tipo', type: 'enum', options: [{ value: 'person', label: 'Pessoa física' }, { value: 'company', label: 'Empresa' }], example: 'Pessoa física', hint: 'Pessoa física ou Empresa (vazio = Pessoa física)' },
  { key: 'name', label: 'Nome', required: true, example: 'Maria Souza' },
  { key: 'document', label: 'CPF/CNPJ', example: '123.456.789-09', hint: 'Com ou sem pontuação; o CPF é validado' },
  { key: 'birthDate', label: 'Nascimento', type: 'date', example: '15/04/1988' },
  { key: 'phone', label: 'Telefone / WhatsApp', example: '(11) 98765-4321' },
  { key: 'email', label: 'E-mail', type: 'email', example: 'maria@exemplo.com' },
  { key: 'zip', label: 'CEP', example: '01310-100' },
  { key: 'street', label: 'Rua', example: 'Av. Paulista' },
  { key: 'number', label: 'Número', example: '1000' },
  { key: 'complement', label: 'Complemento', example: 'Sala 12' },
  { key: 'district', label: 'Bairro', example: 'Bela Vista' },
  { key: 'city', label: 'Cidade', example: 'São Paulo' },
  { key: 'state', label: 'UF', example: 'SP' },
  { key: 'notes', label: 'Observações' },
];

const fieldType = { text: 'text', number: 'number', date: 'date', boolean: 'boolean', select: 'enum' } as const;

/** Planilha de clientes: campos do cadastro + os campos personalizados da empresa. */
export function customerImportSpec(fields: CustomField[]): ImportSpec {
  const custom: ImportColumn[] = fields.map((f) => ({
    key: `custom:${f.key}`,
    label: f.label,
    required: f.required,
    type: fieldType[f.type],
    options: f.options?.map((o) => ({ value: o, label: o })),
  }));

  return {
    entity: 'clientes',
    fileName: 'clientes',
    columns: [...base, ...custom],
    create: (row: ImportRow) => {
      const text = (k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));
      const type = (row.type as 'person' | 'company' | null) ?? 'person';
      const address = Object.fromEntries(ADDRESS.map((k) => [k, k === 'state' ? text(k)?.toUpperCase() : text(k)]).filter(([, v]) => v));
      const customFields = Object.fromEntries(fields.filter((f) => row[`custom:${f.key}`] !== null).map((f) => [f.key, row[`custom:${f.key}`]]));
      return api('/customers', {
        method: 'POST',
        body: {
          type,
          name: text('name'),
          document: text('document') ?? null,
          birthDate: type === 'person' ? (text('birthDate') ?? null) : null,
          phone: text('phone') ?? null,
          email: text('email') ?? null,
          address: Object.keys(address).length ? address : null,
          notes: text('notes') ?? null,
          customFields,
        },
      });
    },
  };
}
