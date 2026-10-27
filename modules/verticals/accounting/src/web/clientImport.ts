import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { taxRegimeLabel, taxRegimes } from '../contracts';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

interface CustomerHit {
  id: string;
  name: string;
  document: string | null;
}

/** Empresa pelo CNPJ/CPF ou pelo nome exato. Cada termo é buscado uma vez só por importação. */
function customerFinder() {
  const cache = new Map<string, Promise<CustomerHit[]>>();
  const search = (q: string) => {
    let hit = cache.get(q);
    if (!hit) {
      hit = api<{ items: CustomerHit[] }>('/customers', { query: { q, limit: 100 } }).then((r) => r.items);
      hit.catch(() => cache.delete(q));
      cache.set(q, hit);
    }
    return hit;
  };
  return async (value: string) => {
    const digits = digitsOf(value);
    const byDocument = !/[a-z]/i.test(value) && digits.length >= 11;
    const items = await search(byDocument ? digits : value.trim());
    const found = items.filter((c) => (byDocument ? c.document === digits : fold(c.name) === fold(value)));
    if (found.length === 1) return found[0]!.id;
    if (found.length > 1) throw new Error(`Empresa: há mais de um cadastro "${value}"; informe o CNPJ`);
    throw new Error(`Empresa: "${value}" não encontrada em Clientes; cadastre antes de importar`);
  };
}

/** Planilha da carteira: mesmos campos do cadastro manual; empresa e responsável pelo nome/documento. */
export function clientImportSpec(): ImportSpec {
  const findCustomer = customerFinder();
  let team: Promise<{ id: string; name: string }[]> | undefined;
  const findResponsible = async (name: string) => {
    team ??= api<{ id: string; name: string }[]>('/users/team');
    const found = (await team).filter((u) => fold(u.name) === fold(name));
    if (found.length === 1) return found[0]!.id;
    throw new Error(found.length ? `Responsável: mais de um usuário chamado "${name}"` : `Responsável: "${name}" não está na equipe`);
  };

  return {
    entity: 'empresas',
    fileName: 'carteira-de-empresas',
    columns: [
      { key: 'customer', label: 'Empresa', required: true, example: '12.345.678/0001-95', hint: 'CNPJ da empresa ou o nome exatamente como está em Clientes' },
      { key: 'taxRegime', label: 'Regime tributário', required: true, type: 'enum', options: taxRegimes.map((r) => ({ value: r, label: taxRegimeLabel[r] })), example: 'Simples Nacional' },
      { key: 'cnae', label: 'CNAE principal', example: '6201-5/01' },
      { key: 'monthlyFee', label: 'Honorário mensal (R$)', type: 'money', example: '450,00', hint: 'Valor em reais, ex.: 1.234,56 (vazio = sem cobrança recorrente)' },
      { key: 'feeDueDay', label: 'Vencimento do honorário (dia)', type: 'integer', example: 10, hint: 'Dia do mês, de 1 a 28 (vazio = 10)' },
      { key: 'responsible', label: 'Responsável', example: 'Ana Lima', hint: 'Nome do usuário da equipe, como aparece no sistema' },
      { key: 'hasEmployees', label: 'Tem funcionários', type: 'boolean', example: 'Não', hint: 'Sim ou Não (vazio = Não); gera folha, eSocial e FGTS' },
      { key: 'active', label: 'Ativa na carteira', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Sim)' },
      { key: 'notes', label: 'Observações' },
    ],
    create: async (row) => {
      const responsible = text(row, 'responsible');
      return api('/accounting/clients', {
        method: 'POST',
        body: {
          customerId: await findCustomer(text(row, 'customer')!),
          taxRegime: row.taxRegime,
          cnae: text(row, 'cnae') ?? null,
          monthlyFee: row.monthlyFee ?? 0,
          feeDueDay: row.feeDueDay ?? 10,
          responsibleUserId: responsible ? await findResponsible(responsible) : null,
          hasEmployees: row.hasEmployees ?? false,
          active: row.active ?? true,
          notes: text(row, 'notes') ?? null,
        },
      });
    },
  };
}
