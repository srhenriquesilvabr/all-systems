import { api, apiDownload, ApiError, formatDate, formatMoney, parseMoney, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { financeKey, sourceLabel, useAccounts, useCategories, type Entry } from './shared';

const PAGE = 50;

const statusMeta = {
  pending: { label: 'Em aberto', tone: 'warning' },
  paid: { label: 'Pago', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
} as const;

type Filters = { status: string; kind: string; q: string; from: string; to: string; dateField: 'due' | 'paid' | 'competence' };

export function FinanceEntriesPage() {
  const canWrite = useCan('core.finance.write');
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<Filters>({ status: params.get('status') ?? '', kind: '', q: '', from: '', to: '', dateField: 'due' });
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Entry | null>(null);
  const queryClient = useQueryClient();

  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')) as Record<string, string>;
  const entries = useQuery({
    queryKey: [...financeKey, 'entries', query, page],
    queryFn: () =>
      api<{ items: Entry[]; total: number; sums: { income: number; expense: number } }>('/finance/entries', { query: { ...query, limit: PAGE, offset: page * PAGE } }),
    placeholderData: keepPreviousData,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/finance/entries/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: financeKey }),
  });
  const download = useMutation({ mutationFn: () => apiDownload('/finance/entries.csv', 'lancamentos.csv', { query }) });

  const set = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
    setPage(0);
  };
  const pages = Math.ceil((entries.data?.total ?? 0) / PAGE);

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description="Contas a receber e a pagar, e tudo o que já entrou ou saiu."
        actions={
          <>
            <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()}>
              Exportar CSV
            </Button>
            {canWrite && <Button onClick={() => setCreating(true)}>Novo lançamento</Button>}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input type="search" aria-label="Buscar" placeholder="Buscar descrição" className="max-w-56" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        <Select aria-label="Situação" className="max-w-40" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Todas as situações</option>
          <option value="pending">Em aberto</option>
          <option value="overdue">Vencidos</option>
          <option value="paid">Pagos</option>
          <option value="cancelled">Cancelados</option>
        </Select>
        <Select aria-label="Tipo" className="max-w-36" value={filters.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="">Receitas e despesas</option>
          <option value="income">Receitas</option>
          <option value="expense">Despesas</option>
        </Select>
        <Select aria-label="Filtrar datas por" className="max-w-40" value={filters.dateField} onChange={(e) => set({ dateField: e.target.value as Filters['dateField'] })}>
          <option value="due">Vencimento</option>
          <option value="paid">Pagamento</option>
          <option value="competence">Competência</option>
        </Select>
        <Input type="date" aria-label="De" className="max-w-40" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        <Input type="date" aria-label="Até" className="max-w-40" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
      </div>

      {(cancel.error || download.error) && (
        <div className="mb-4">
          <Alert>{(cancel.error ?? download.error)!.message}</Alert>
        </div>
      )}

      <Card>
        {entries.isPending ? (
          <Spinner />
        ) : entries.isError ? (
          <div className="p-4">
            <Alert>{entries.error.message}</Alert>
          </div>
        ) : entries.data.items.length === 0 ? (
          <EmptyState title="Nenhum lançamento" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Vencimento</Th>
                  <Th>Descrição</Th>
                  <Th>Categoria</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Situação</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {entries.data.items.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap tabular-nums">{formatDate(e.dueDate)}</Td>
                    <Td>
                      <p>{e.description}</p>
                      <p className="text-xs text-fg-muted">
                        {sourceLabel[e.sourceType] ?? e.sourceType}
                        {e.paidAt && ` · pago em ${formatDate(e.paidAt)}${e.accountName ? ` (${e.accountName})` : ''}`}
                      </p>
                    </Td>
                    <Td className="text-fg-muted">{e.categoryName ?? '—'}</Td>
                    <Td className={`whitespace-nowrap text-right tabular-nums ${e.status === 'cancelled' ? 'text-fg-subtle line-through' : ''}`}>
                      {e.kind === 'expense' ? '−' : '+'}
                      {formatMoney(e.amount)}
                    </Td>
                    <Td>
                      <Badge tone={statusMeta[e.status].tone}>{statusMeta[e.status].label}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {canWrite && e.status === 'pending' && (e.sourceType === 'manual' || e.settleInFinance) && (
                        <Button variant="ghost" size="sm" onClick={() => setPaying(e)}>
                          Baixar
                        </Button>
                      )}
                      {/* Cancelar continua só para os manuais: os de módulo são cancelados na origem. */}
                      {canWrite && e.status === 'pending' && e.sourceType === 'manual' && (
                        <Button variant="ghost" size="sm" onClick={() => confirm(`Cancelar "${e.description}"?`) && cancel.mutate(e.id)}>
                          Cancelar
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap justify-end gap-6 px-4 py-3 text-sm">
              <span className="text-fg-muted">
                Receitas <span className="font-medium tabular-nums text-fg">{formatMoney(entries.data.sums.income)}</span>
              </span>
              <span className="text-fg-muted">
                Despesas <span className="font-medium tabular-nums text-fg">{formatMoney(entries.data.sums.expense)}</span>
              </span>
            </div>
          </>
        )}
      </Card>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-fg-muted">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          Página {page + 1} de {pages}
          <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}

      {creating && <EntryModal onClose={() => setCreating(false)} />}
      {paying && <PayModal entry={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

function EntryModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const categories = useCategories();
  const [form, setForm] = useState({
    kind: 'expense' as 'income' | 'expense',
    description: '',
    amount: '',
    dueDate: today(),
    categoryId: '',
    status: 'pending' as 'pending' | 'paid',
    paidAt: today(),
    accountId: '',
    notes: '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const activeAccounts = accounts.data?.filter((a) => a.active) ?? [];

  const create = useMutation({
    mutationFn: () =>
      api('/finance/entries', {
        method: 'POST',
        body: {
          kind: form.kind,
          description: form.description,
          amount: parseMoney(form.amount),
          dueDate: form.dueDate,
          categoryId: form.categoryId || null,
          status: form.status,
          notes: form.notes || null,
          ...(form.status === 'paid' ? { paidAt: form.paidAt, accountId: form.accountId || activeAccounts[0]?.id } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financeKey });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      open
      title="Novo lançamento"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="entry-form" loading={create.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit} className="space-y-4">
        {create.error && <Alert>{create.error instanceof ApiError ? create.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={form.kind} onChange={(e) => set({ kind: e.target.value as typeof form.kind, categoryId: '' })}>
                <option value="expense">Despesa (a pagar)</option>
                <option value="income">Receita (a receber)</option>
              </Select>
            )}
          </Field>
          <Field label="Valor (R$)">{(id) => <Input id={id} required inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0,00" />}</Field>
        </div>
        <Field label="Descrição">{(id) => <Input id={id} required minLength={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vencimento">{(id) => <Input id={id} type="date" required value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />}</Field>
          <Field label="Categoria">
            {(id) => (
              <Select id={id} value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <option value="">Sem categoria</option>
                {categories.data
                  ?.filter((c) => c.kind === form.kind && c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Situação">
            {(id) => (
              <Select id={id} value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}>
                <option value="pending">Em aberto</option>
                <option value="paid">Já pago</option>
              </Select>
            )}
          </Field>
          {form.status === 'paid' && (
            <>
              <Field label="Data do pagamento">{(id) => <Input id={id} type="date" value={form.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />}</Field>
              <Field label="Conta">
                {(id) => (
                  <Select id={id} value={form.accountId || activeAccounts[0]?.id || ''} onChange={(e) => set({ accountId: e.target.value })}>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
        </div>
        <Field label="Observações">{(id) => <Textarea id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

function PayModal({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const activeAccounts = accounts.data?.filter((a) => a.active) ?? [];
  const [paidAt, setPaidAt] = useState(today());
  const [accountId, setAccountId] = useState('');
  const pay = useMutation({
    mutationFn: () => api(`/finance/entries/${entry.id}/pay`, { method: 'POST', body: { paidAt, accountId: accountId || activeAccounts[0]?.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financeKey });
      onClose();
    },
  });

  return (
    <Modal
      open
      title={entry.kind === 'income' ? 'Registrar recebimento' : 'Registrar pagamento'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={pay.isPending} onClick={() => pay.mutate()}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {pay.error && <Alert>{pay.error instanceof ApiError ? pay.error.message : 'Erro ao registrar'}</Alert>}
        <p className="text-sm">
          {entry.description} · <span className="font-medium tabular-nums">{formatMoney(entry.amount)}</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data">{(id) => <Input id={id} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}</Field>
          <Field label="Conta">
            {(id) => (
              <Select id={id} value={accountId || activeAccounts[0]?.id || ''} onChange={(e) => setAccountId(e.target.value)}>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
