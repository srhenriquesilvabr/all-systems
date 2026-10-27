import { api, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import type { Customer } from '../customers/types';
import type { Account, Category } from './shared';

const columns: ImportColumn[] = [
  { key: 'kind', label: 'Tipo', required: true, type: 'enum', options: [{ value: 'expense', label: 'Despesa' }, { value: 'income', label: 'Receita' }], example: 'Despesa' },
  { key: 'description', label: 'Descrição', required: true, example: 'Aluguel de novembro' },
  { key: 'amount', label: 'Valor (R$)', required: true, type: 'money', example: '1.250,00' },
  { key: 'dueDate', label: 'Vencimento', required: true, type: 'date', example: '10/11/2026' },
  { key: 'status', label: 'Situação', type: 'enum', hint: 'Em aberto ou Pago (vazio = Em aberto)', options: [{ value: 'pending', label: 'Em aberto' }, { value: 'paid', label: 'Pago' }], example: 'Em aberto' },
  { key: 'paidAt', label: 'Data do pagamento', type: 'date', example: '10/11/2026', hint: 'dd/mm/aaaa; obrigatória quando a Situação é Pago' },
  { key: 'account', label: 'Conta', example: 'Banco do Brasil', hint: 'Nome de uma conta ativa (Financeiro › Contas e categorias); obrigatória quando a Situação é Pago' },
  { key: 'category', label: 'Categoria', example: 'Aluguel', hint: 'Nome de uma categoria ativa do mesmo Tipo; vazio = sem categoria' },
  { key: 'customer', label: 'Cliente', example: '123.456.789-09', hint: 'CPF/CNPJ ou nome exato de um cliente cadastrado; vazio = sem cliente' },
  {
    key: 'paymentMethod',
    label: 'Forma de pagamento',
    type: 'enum',
    options: [
      { value: 'pix', label: 'Pix' },
      { value: 'cash', label: 'Dinheiro' },
      { value: 'credit_card', label: 'Cartão de crédito' },
      { value: 'debit_card', label: 'Cartão de débito' },
      { value: 'transfer', label: 'Boleto' },
      { value: 'transfer', label: 'Transferência' },
    ],
    example: 'Pix',
  },
  { key: 'notes', label: 'Observações' },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const kindLabel = { income: 'Receita', expense: 'Despesa' } as const;

/** Guarda a busca para não repetir a cada linha; se falhar, a próxima linha tenta de novo. */
function cached<T>(load: () => Promise<T>) {
  let p: Promise<T> | undefined;
  return () => (p ??= load().catch((err) => {
    p = undefined;
    throw err;
  }));
}

/** Cliente pelo CPF/CNPJ (só dígitos e pontuação) ou pelo nome exato. */
async function findCustomer(value: string): Promise<string> {
  if (/^[\d.\-/\s]+$/.test(value)) {
    const digits = value.replace(/\D/g, '');
    if (digits.length > 14) throw new Error(`Cliente: CPF/CNPJ "${value}" inválido`);
    // O Excel tira os zeros à esquerda quando a célula é número.
    const doc = digits.padStart(digits.length <= 11 ? 11 : 14, '0');
    const { items } = await api<{ items: Customer[] }>('/customers', { query: { q: doc, limit: 100 } });
    const found = items.find((c) => c.document === doc);
    if (!found) throw new Error(`Cliente com CPF/CNPJ "${value}" não encontrado`);
    return found.id;
  }
  const { items } = await api<{ items: Customer[] }>('/customers', { query: { q: value.slice(0, 100), limit: 100 } });
  const matches = items.filter((c) => norm(c.name) === norm(value));
  if (!matches.length) throw new Error(`Cliente "${value}" não encontrado`);
  if (matches.length > 1) throw new Error(`Há ${matches.length} clientes chamados "${value}": use o CPF/CNPJ`);
  return matches[0]!.id;
}

/** Planilha de lançamentos: conta, categoria e cliente vão pelo nome (ou CPF/CNPJ) e viram ids aqui. */
export function entryImportSpec(): ImportSpec {
  const accounts = cached(() => api<Account[]>('/finance/accounts'));
  const categories = cached(() => api<Category[]>('/finance/categories'));
  const customers = new Map<string, Promise<string>>();
  const customerId = (value: string) => {
    const key = norm(value);
    if (!customers.has(key)) customers.set(key, findCustomer(value).catch((err) => (customers.delete(key), Promise.reject(err))));
    return customers.get(key)!;
  };

  async function accountId(name: string) {
    const found = (await accounts()).find((a) => norm(a.name) === norm(name));
    if (!found) throw new Error(`Conta "${name}" não encontrada`);
    if (!found.active) throw new Error(`Conta "${name}" está desativada`);
    return found.id;
  }

  async function categoryId(name: string, kind: 'income' | 'expense') {
    const same = (await categories()).filter((c) => norm(c.name) === norm(name));
    const found = same.find((c) => c.kind === kind);
    if (!found) {
      const other = same[0];
      throw new Error(other ? `Categoria "${name}" é de ${kindLabel[other.kind]}, não de ${kindLabel[kind]}` : `Categoria "${name}" não encontrada`);
    }
    if (!found.active) throw new Error(`Categoria "${name}" está desativada`);
    return found.id;
  }

  return {
    entity: 'lançamentos',
    fileName: 'lancamentos',
    columns,
    create: async (row: ImportRow) => {
      const text = (k: string) => (row[k] === null || row[k] === undefined ? undefined : String(row[k]));
      const kind = row.kind as 'income' | 'expense';
      const paid = row.status === 'paid';
      if (paid && (!row.paidAt || !row.account)) throw new Error('Lançamento pago: preencha a Data do pagamento e a Conta');

      const account = text('account');
      const category = text('category');
      const customer = text('customer');
      return api('/finance/entries', {
        method: 'POST',
        body: {
          kind,
          description: text('description'),
          amount: row.amount,
          dueDate: row.dueDate,
          status: row.status ?? 'pending',
          paidAt: paid ? row.paidAt : null,
          accountId: account ? await accountId(account) : null,
          categoryId: category ? await categoryId(category, kind) : null,
          customerId: customer ? await customerId(customer) : null,
          paymentMethod: row.paymentMethod,
          notes: text('notes') ?? null,
        },
      });
    },
  };
}
