import { api, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { caseAreaLabel, caseAreas, caseRoleLabel, caseRoles } from '../contracts';

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

interface CustomerHit {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
}

/** Cliente pelo CPF/CNPJ (ou telefone) ou pelo nome exato. Cada termo é buscado uma vez só por importação. */
function customerFinder(what: string) {
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
    const byNumber = !/[a-z]/i.test(value) && digits.length >= 10;
    const items = await search(byNumber ? digits : value.trim());
    const found = byNumber
      ? items.filter((c) => c.document === digits || digitsOf(c.phone) === digits || digitsOf(c.phone) === `55${digits}`)
      : items.filter((c) => fold(c.name) === fold(value));
    if (found.length === 1) return found[0]!.id;
    if (found.length > 1) throw new Error(`${what}: há mais de um cadastro "${value}"; informe o CPF/CNPJ`);
    throw new Error(`${what}: "${value}" não encontrado em Clientes; cadastre antes de importar`);
  };
}

/** Planilha de processos: mesmos campos do cadastro manual; cliente e responsável pelo nome/documento. */
export function caseImportSpec(): ImportSpec {
  const findCustomer = customerFinder('Cliente');
  let team: Promise<{ id: string; name: string }[]> | undefined;
  const findResponsible = async (name: string) => {
    team ??= api<{ id: string; name: string }[]>('/legal/team');
    const found = (await team).filter((u) => fold(u.name) === fold(name));
    if (found.length === 1) return found[0]!.id;
    throw new Error(found.length ? `Responsável: mais de um usuário chamado "${name}"` : `Responsável: "${name}" não está na equipe`);
  };

  return {
    entity: 'processos',
    fileName: 'processos',
    columns: [
      { key: 'customer', label: 'Cliente', required: true, example: '123.456.789-09', hint: 'CPF/CNPJ do cliente ou o nome exatamente como está em Clientes' },
      { key: 'title', label: 'Título', required: true, example: 'Reclamação trabalhista — horas extras' },
      { key: 'number', label: 'Número CNJ', example: '0001234-56.2024.5.02.0001', hint: 'Formato 0000000-00.0000.0.00.0000 (formate a célula como texto); vazio em caso consultivo' },
      { key: 'area', label: 'Área', type: 'enum', options: caseAreas.map((a) => ({ value: a, label: caseAreaLabel[a] })), example: 'Trabalhista', hint: `Um destes: ${caseAreas.map((a) => caseAreaLabel[a]).join(', ')} (vazio = Cível)` },
      { key: 'role', label: 'O cliente é', type: 'enum', options: caseRoles.map((r) => ({ value: r, label: caseRoleLabel[r] })), example: 'Autor', hint: `Um destes: ${caseRoles.map((r) => caseRoleLabel[r]).join(', ')} (vazio = Autor)` },
      { key: 'court', label: 'Vara / tribunal', example: '1ª Vara do Trabalho de São Paulo' },
      { key: 'opposingParty', label: 'Parte contrária', example: 'Empresa Exemplo Ltda.' },
      { key: 'claimValue', label: 'Valor da causa (R$)', type: 'money', example: '25.000,00' },
      { key: 'responsible', label: 'Responsável', example: 'Ana Lima', hint: 'Nome do usuário da equipe, como aparece no sistema' },
      { key: 'notes', label: 'Observações' },
    ],
    create: async (row) => {
      const responsible = text(row, 'responsible');
      return api('/legal/cases', {
        method: 'POST',
        body: {
          customerId: await findCustomer(text(row, 'customer')!),
          title: text(row, 'title'),
          number: text(row, 'number') ?? null,
          area: row.area ?? undefined,
          role: row.role ?? undefined,
          court: text(row, 'court') ?? null,
          opposingParty: text(row, 'opposingParty') ?? null,
          claimValue: row.claimValue,
          responsibleUserId: responsible ? await findResponsible(responsible) : null,
          notes: text(row, 'notes') ?? null,
        },
      });
    },
  };
}
