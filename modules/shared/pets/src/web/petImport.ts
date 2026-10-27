import { api, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { sizeLabel, species, speciesLabel } from '../contracts';

const columns: ImportColumn[] = [
  {
    key: 'tutorKey',
    label: 'Tutor (CPF ou telefone)',
    required: true,
    example: '123.456.789-09',
    hint: 'CPF/CNPJ ou telefone com DDD de um cliente já cadastrado. Formate a coluna como texto para não perder zeros à esquerda',
  },
  { key: 'tutorName', label: 'Tutor (nome)', example: 'Maria Souza', hint: 'Opcional; confere o tutor e desempata quando o telefone é de mais de um cliente' },
  { key: 'name', label: 'Nome', required: true, example: 'Thor' },
  { key: 'species', label: 'Espécie', type: 'enum', options: species.map((s) => ({ value: s, label: speciesLabel[s] })), example: 'Cachorro', hint: `Um destes: ${species.map((s) => speciesLabel[s]).join(', ')} (vazio = Cachorro)` },
  { key: 'breed', label: 'Raça', example: 'SRD' },
  {
    key: 'sex',
    label: 'Sexo',
    type: 'enum',
    options: [
      { value: 'unknown', label: 'Não informado' },
      { value: 'male', label: 'Macho' },
      { value: 'female', label: 'Fêmea' },
    ],
    example: 'Macho',
    hint: 'Macho, Fêmea ou Não informado (vazio = Não informado)',
  },
  { key: 'birthDate', label: 'Nascimento', type: 'date', example: '10/03/2021' },
  { key: 'weightKg', label: 'Peso (kg)', type: 'number', example: '12,5' },
  { key: 'size', label: 'Porte', type: 'enum', options: Object.entries(sizeLabel).map(([value, label]) => ({ value, label })), example: 'Médio' },
  { key: 'coat', label: 'Pelagem', example: 'Curta, caramelo' },
  { key: 'neutered', label: 'Castrado(a)', type: 'boolean', example: 'Não', hint: 'Sim ou Não (vazio = Não)' },
  { key: 'microchip', label: 'Microchip', example: '985112003456789', hint: 'Formate a coluna como texto para não perder dígitos' },
  { key: 'notes', label: 'Observações', example: 'Bravo com outros cães', hint: 'Temperamento, alergias, cuidados no manejo' },
];

interface CustomerRow {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  anonymizedAt: string | null;
}

const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** Planilha de pets. O tutor é um cliente já cadastrado, achado pelo CPF/CNPJ ou telefone. */
export function petImportSpec(): ImportSpec {
  // Uma busca por documento/telefone por importação, mesmo que o tutor tenha vários pets na planilha.
  const searches = new Map<string, Promise<CustomerRow[]>>();
  const search = (digits: string) => {
    let found = searches.get(digits);
    if (!found) {
      found = api<{ items: CustomerRow[] }>('/customers', { query: { q: digits, limit: 50 } }).then((r) => r.items);
      found.catch(() => searches.delete(digits));
      searches.set(digits, found);
    }
    return found;
  };

  async function findTutor(key: string, name: string | null) {
    const digits = digitsOf(key);
    if (digits.length < 8) throw new Error(`Tutor (CPF ou telefone): "${key}" não parece um CPF/CNPJ nem um telefone com DDD`);
    // A busca da API acha por trecho; aqui só vale o documento ou o telefone inteiro.
    const matches = (await search(digits)).filter((c) => {
      if (c.anonymizedAt) return false;
      const phone = digitsOf(c.phone);
      return c.document === digits || c.document === digits.padStart(11, '0') || phone === digits || phone === `55${digits}`;
    });
    const named = name ? matches.filter((c) => normalize(c.name).includes(normalize(name))) : matches;
    if (!matches.length) throw new Error(`Tutor não encontrado: nenhum cliente com CPF/CNPJ ou telefone ${key}. Cadastre o cliente antes de importar o pet.`);
    if (!named.length) throw new Error(`Tutor (nome): "${name}" não confere com o cadastro de ${key} (${matches.map((c) => c.name).join(', ')})`);
    if (named.length > 1) throw new Error(`Tutor: mais de um cliente com ${key} (${named.map((c) => c.name).join(', ')}). Preencha "Tutor (nome)" para escolher.`);
    return named[0]!.id;
  }

  return {
    entity: 'pets',
    fileName: 'pets',
    columns,
    create: async (row: ImportRow) => {
      const text = (k: string) => (row[k] === null || row[k] === undefined ? null : String(row[k]));
      const customerId = await findTutor(String(row.tutorKey), text('tutorName'));
      return api('/pets', {
        method: 'POST',
        body: {
          customerId,
          name: text('name'),
          species: row.species ?? 'dog',
          breed: text('breed'),
          sex: row.sex ?? 'unknown',
          birthDate: row.birthDate,
          weightKg: row.weightKg,
          size: row.size,
          coat: text('coat'),
          neutered: row.neutered ?? false,
          microchip: text('microchip'),
          notes: text('notes'),
        },
      });
    },
  };
}
