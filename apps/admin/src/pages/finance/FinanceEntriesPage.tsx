import { api, apiDownload, ApiError, CustomerSearch, formatDate, formatDateTime, formatMoney, parseMoney, SpreadsheetImport, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { auditActionLabel } from '../auditLabels';
import { entryImportSpec } from './entryImport';
import { financeKey, useAccounts, useCategories, type Entry, type HistoryEntry } from './shared';

const PAGE = 50;

const statusMeta = {
  pending: { label: 'Em aberto', tone: 'warning' },
  paid: { label: 'Pago', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
} as const;

type Filters = { status: string; kind: string; q: string; from: string; to: string; dateField: 'due' | 'paid' | 'competence' };
type Panel = { mode: 'new' } | { mode: 'edit' | 'pay' | 'reverse' | 'cancel' | 'history'; entry: Entry } | null;

/** O financeiro dá a baixa nos manuais e nos de módulo que deixam a baixa com ele. */
const settlesHere = (e: Entry) => e.sourceType === 'manual' || e.settleInFinance;

export function FinanceEntriesPage() {
  const canWrite = useCan('core.finance.write');
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<Filters>({ status: params.get('status') ?? '', kind: '', q: '', from: '', to: '', dateField: 'due' });
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const queryClient = useQueryClient();

  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')) as Record<string, string>;
  const entries = useQuery({
    queryKey: [...financeKey, 'entries', query, page],
    queryFn: () =>
      api<{ items: Entry[]; total: number; sums: { income: number; expense: number } }>('/finance/entries', { query: { ...query, limit: PAGE, offset: page * PAGE } }),
    placeholderData: keepPreviousData,
  });
  const download = useMutation({ mutationFn: () => apiDownload('/finance/entries.csv', 'lancamentos.csv', { query }) });

  const set = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
    setPage(0);
  };
  const pages = Math.ceil((entries.data?.total ?? 0) / PAGE);
  const close = () => setPanel(null);

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
            {canWrite && (
              <>
                <SpreadsheetImport spec={entryImportSpec()} onImported={() => queryClient.invalidateQueries({ queryKey: financeKey })} />
                <Button onClick={() => setPanel({ mode: 'new' })}>Novo lançamento</Button>
              </>
            )}
          </>
        }
      />

      {panel?.mode === 'new' && <EntryForm onClose={close} />}
      {panel?.mode === 'edit' && <EntryForm key={panel.entry.id} entry={panel.entry} onClose={close} />}
      {panel?.mode === 'pay' && <PayPanel key={panel.entry.id} entry={panel.entry} onClose={close} />}
      {panel?.mode === 'reverse' && <ReasonPanel key={panel.entry.id} kind="reverse" entry={panel.entry} onClose={close} />}
      {panel?.mode === 'cancel' && <ReasonPanel key={panel.entry.id} kind="cancel" entry={panel.entry} onClose={close} />}
      {panel?.mode === 'history' && <HistoryPanel key={panel.entry.id} entry={panel.entry} onClose={close} />}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input type="search" aria-label="Buscar" placeholder="Buscar descrição ou cliente" className="max-w-64" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
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

      {download.error && (
        <div className="mb-4">
          <Alert>{download.error.message}</Alert>
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
                  <Th>Cliente</Th>
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
                        {e.sourceLabel}
                        {e.paidAt && ` · pago em ${formatDate(e.paidAt)}${e.accountName ? ` (${e.accountName})` : ''}`}
                      </p>
                    </Td>
                    <Td>{e.customerName ?? <span className="text-fg-muted">—</span>}</Td>
                    <Td className="text-fg-muted">{e.categoryName ?? '—'}</Td>
                    <Td className={`whitespace-nowrap text-right tabular-nums ${e.status === 'cancelled' ? 'text-fg-subtle line-through' : ''}`}>
                      {e.kind === 'expense' ? '−' : '+'}
                      {formatMoney(e.amount)}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={statusMeta[e.status].tone}>{statusMeta[e.status].label}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {canWrite && e.status === 'pending' && settlesHere(e) && (
                        <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'pay', entry: e })}>
                          Baixar
                        </Button>
                      )}
                      {canWrite && e.status === 'paid' && settlesHere(e) && (
                        <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'reverse', entry: e })}>
                          Estornar baixa
                        </Button>
                      )}
                      {canWrite && e.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'edit', entry: e })}>
                          Editar
                        </Button>
                      )}
                      {/* Cancelar continua só para os manuais: os de módulo são cancelados na origem. */}
                      {canWrite && e.status === 'pending' && e.sourceType === 'manual' && (
                        <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'cancel', entry: e })}>
                          Cancelar
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setPanel({ mode: 'history', entry: e })}>
                        Histórico
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-baseline justify-end gap-6 px-4 py-3 text-sm">
              {filters.status !== 'cancelled' && <span className="text-xs text-fg-subtle">Sem os cancelados</span>}
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
    </>
  );
}

/** Painel na própria página, acima da lista. */
function InlinePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Card className="mb-4 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-medium">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </div>
      {children}
    </Card>
  );
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const moneyText = (v: number) => v.toFixed(2).replace('.', ',');

/**
 * Novo lançamento e edição. O que a API trava também fica travado aqui: lançamento de módulo só muda
 * categoria e observações (e a conta, enquanto em aberto); pago não muda valor nem conta.
 */
function EntryForm({ entry, onClose }: { entry?: Entry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const categories = useCategories();
  const [form, setForm] = useState({
    kind: (entry?.kind ?? 'expense') as 'income' | 'expense',
    description: entry?.description ?? '',
    amount: entry ? moneyText(entry.amount) : '',
    dueDate: entry?.dueDate ?? today(),
    competenceDate: entry?.competenceDate ?? '',
    categoryId: entry?.categoryId ?? '',
    status: 'pending' as 'pending' | 'paid',
    paidAt: today(),
    accountId: entry?.accountId ?? '',
    notes: entry?.notes ?? '',
  });
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(entry?.customerId ? { id: entry.customerId, name: entry.customerName ?? 'Cliente' } : null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const activeAccounts = accounts.data?.filter((a) => a.active) ?? [];
  const fromModule = !!entry && entry.sourceType !== 'manual';
  const paid = entry?.status === 'paid';

  const save = useMutation({
    mutationFn: () => {
      if (!entry) {
        return api('/finance/entries', {
          method: 'POST',
          body: {
            kind: form.kind,
            description: form.description,
            amount: parseMoney(form.amount),
            dueDate: form.dueDate,
            categoryId: form.categoryId || null,
            customerId: customer?.id ?? null,
            status: form.status,
            notes: form.notes || null,
            ...(form.status === 'paid' ? { paidAt: form.paidAt, accountId: form.accountId || activeAccounts[0]?.id } : {}),
          },
        });
      }
      const body: Record<string, unknown> = { categoryId: form.categoryId || null, notes: form.notes || null };
      if (!paid) body.accountId = form.accountId || null;
      if (!fromModule) {
        Object.assign(body, { description: form.description, dueDate: form.dueDate, customerId: customer?.id ?? null, ...(form.competenceDate ? { competenceDate: form.competenceDate } : {}) });
        if (!paid) body.amount = parseMoney(form.amount);
      }
      return api(`/finance/entries/${entry.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financeKey });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <InlinePanel title={entry ? 'Editar lançamento' : 'Novo lançamento'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
        {fromModule && <Alert tone="info">Este lançamento veio de {entry.sourceLabel}. Valor, descrição, datas e cliente são corrigidos por lá; aqui mudam só a categoria, a conta e as observações.</Alert>}
        {paid && !fromModule && <Alert tone="info">Lançamento pago: para mudar o valor ou a conta, estorne a baixa antes.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {!entry && (
            <Field label="Tipo">
              {(id) => (
                <Select id={id} value={form.kind} onChange={(e) => set({ kind: e.target.value as typeof form.kind, categoryId: '' })}>
                  <option value="expense">Despesa (a pagar)</option>
                  <option value="income">Receita (a receber)</option>
                </Select>
              )}
            </Field>
          )}
          <Field label="Valor (R$)">
            {(id) => <Input id={id} required inputMode="decimal" disabled={fromModule || paid} value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0,00" />}
          </Field>
        </div>
        <Field label="Descrição">{(id) => <Input id={id} required minLength={2} disabled={fromModule} value={form.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
        {!fromModule && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Cliente (opcional)</p>
            {customer ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="font-medium">{customer.name}</span>
                <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <CustomerSearch autoFocus={false} onSelect={(c) => setCustomer({ id: c.id, name: c.name })} />
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vencimento">{(id) => <Input id={id} type="date" required disabled={fromModule} value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />}</Field>
          {entry && !fromModule && <Field label="Competência" hint="Mês a que o valor pertence.">{(id) => <Input id={id} type="date" value={form.competenceDate} onChange={(e) => set({ competenceDate: e.target.value })} />}</Field>}
          <Field label="Categoria">
            {(id) => (
              <Select id={id} value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <option value="">Sem categoria</option>
                {categories.data
                  ?.filter((c) => c.kind === form.kind && (c.active || c.id === entry?.categoryId))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {!entry && (
            <Field label="Situação">
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}>
                  <option value="pending">Em aberto</option>
                  <option value="paid">Já pago</option>
                </Select>
              )}
            </Field>
          )}
          {!entry && form.status === 'paid' && <Field label="Data do pagamento">{(id) => <Input id={id} type="date" value={form.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />}</Field>}
          {((!entry && form.status === 'paid') || (entry && !paid)) && (
            <Field label="Conta">
              {(id) => (
                <Select id={id} value={entry ? form.accountId : form.accountId || activeAccounts[0]?.id || ''} onChange={(e) => set({ accountId: e.target.value })}>
                  {entry && <option value="">Sem conta definida</option>}
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Observações">{(id) => <Textarea id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </InlinePanel>
  );
}

function PayPanel({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const activeAccounts = accounts.data?.filter((a) => a.active) ?? [];
  const [paidAt, setPaidAt] = useState(today());
  const [accountId, setAccountId] = useState(entry.accountId ?? '');
  const pay = useMutation({
    mutationFn: () => api(`/finance/entries/${entry.id}/pay`, { method: 'POST', body: { paidAt, accountId: accountId || activeAccounts[0]?.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financeKey });
      onClose();
    },
  });

  return (
    <InlinePanel title={entry.kind === 'income' ? 'Registrar recebimento' : 'Registrar pagamento'} onClose={onClose}>
      <div className="space-y-4">
        {pay.error && <Alert>{errorText(pay.error, 'Erro ao registrar')}</Alert>}
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={pay.isPending} onClick={() => pay.mutate()}>
            Confirmar
          </Button>
        </div>
      </div>
    </InlinePanel>
  );
}

/** Estorno (motivo obrigatório) e cancelamento (motivo opcional). */
function ReasonPanel({ kind, entry, onClose }: { kind: 'reverse' | 'cancel'; entry: Entry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const reverse = kind === 'reverse';
  const run = useMutation({
    mutationFn: () => api(`/finance/entries/${entry.id}/${reverse ? 'reverse' : 'cancel'}`, { method: 'POST', body: { reason: reason.trim() || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financeKey });
      onClose();
    },
  });
  return (
    <InlinePanel title={reverse ? 'Estornar a baixa' : 'Cancelar lançamento'} onClose={onClose}>
      <div className="space-y-4">
        {run.error && <Alert>{errorText(run.error, 'Não foi possível concluir')}</Alert>}
        <p className="text-sm">
          {entry.description} · <span className="font-medium tabular-nums">{formatMoney(entry.amount)}</span>
          {entry.paidAt && ` · pago em ${formatDate(entry.paidAt)}${entry.accountName ? ` (${entry.accountName})` : ''}`}
        </p>
        <p className="text-sm text-fg-muted">
          {reverse ? 'O lançamento volta a ficar em aberto e o valor sai do saldo da conta. O pagamento desfeito e o motivo ficam no histórico.' : 'O lançamento continua na lista como cancelado, fora dos totais. Isso fica no histórico.'}
        </p>
        <Field label={reverse ? 'Motivo' : 'Motivo (opcional)'}>{(id) => <Textarea id={id} rows={2} required={reverse} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" loading={run.isPending} disabled={reverse && reason.trim().length < 3} onClick={() => run.mutate()}>
            {reverse ? 'Estornar baixa' : 'Cancelar lançamento'}
          </Button>
        </div>
      </div>
    </InlinePanel>
  );
}

function HistoryPanel({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const history = useQuery({ queryKey: [...financeKey, 'entry-history', entry.id], queryFn: () => api<HistoryEntry[]>(`/finance/entries/${entry.id}/history`) });
  return (
    <InlinePanel title={`Histórico — ${entry.description}`} onClose={onClose}>
      {history.isPending ? <Spinner /> : history.isError ? <Alert>{history.error.message}</Alert> : <HistoryList items={history.data} empty="Sem registros. Lançamentos criados por outro módulo só aparecem aqui depois de uma alteração no financeiro." />}
    </InlinePanel>
  );
}

export function HistoryList({ items, empty }: { items: HistoryEntry[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {items.map((h) => (
        <li key={h.id} className="py-2">
          <p>
            <span className="font-medium">{auditActionLabel(h.action)}</span>
            <span className="text-fg-muted">
              {' '}
              · {formatDateTime(h.createdAt)} · {h.user?.name ?? 'Sistema'}
            </span>
          </p>
          {typeof h.data?.reason === 'string' && <p className="text-fg-muted">Motivo: {h.data.reason}</p>}
        </li>
      ))}
    </ul>
  );
}
