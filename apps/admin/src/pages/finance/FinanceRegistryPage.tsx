import { api, ApiError, formatMoney, parseMoney, SpreadsheetImport } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { HistoryList } from './FinanceEntriesPage';
import { accountImportSpec, categoryImportSpec } from './registryImport';
import { accountTypeLabel, financeKey, useAccounts, useCategories, type Account, type Category, type HistoryEntry } from './shared';

export function FinanceRegistryPage() {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const categories = useCategories();
  const [modal, setModal] = useState<'account' | 'category' | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: financeKey });
  const toggle = useMutation({
    mutationFn: ({ path, active }: { path: string; active: boolean }) => api(path, { method: 'PATCH', body: { active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: financeKey }),
  });

  return (
    <>
      <PageHeader title="Contas e categorias" description="Onde o dinheiro fica e como os lançamentos são classificados." />
      {modal && <CreatePanel kind={modal} onClose={() => setModal(null)} />}
      {toggle.error && (
        <div className="mb-4">
          <Alert>{toggle.error.message}</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Contas</h2>
            <div className="flex flex-wrap justify-end gap-2">
              <SpreadsheetImport spec={accountImportSpec} onImported={refresh} size="sm" />
              <Button size="sm" onClick={() => setModal('account')}>
                Nova conta
              </Button>
            </div>
          </div>
          <Card>
            {accounts.isPending ? (
              <Spinner />
            ) : (
              <Table>
                <tbody>
                  {accounts.data?.map((a: Account) => (
                    <Fragment key={a.id}>
                      <tr>
                        <Td>
                          <p className={a.active ? 'font-medium' : 'text-fg-subtle'}>{a.name}</p>
                          <p className="text-xs text-fg-muted">
                            {accountTypeLabel[a.type]} · saldo inicial {formatMoney(a.initialBalance)}
                          </p>
                        </Td>
                        <Td className="text-right tabular-nums">{formatMoney(a.balance)}</Td>
                        <Td className="whitespace-nowrap text-right">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(editing === a.id ? null : a.id)}>
                            {editing === a.id ? 'Fechar' : 'Editar'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggle.mutate({ path: `/finance/accounts/${a.id}`, active: !a.active })}>
                            {a.active ? 'Desativar' : 'Reativar'}
                          </Button>
                        </Td>
                      </tr>
                      {editing === a.id && (
                        <tr>
                          <Td colSpan={3} className="bg-muted/50">
                            <AccountEditor key={a.id} account={a} />
                          </Td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Categorias</h2>
            <div className="flex flex-wrap justify-end gap-2">
              <SpreadsheetImport spec={categoryImportSpec} onImported={refresh} size="sm" />
              <Button size="sm" onClick={() => setModal('category')}>
                Nova categoria
              </Button>
            </div>
          </div>
          <Card>
            {categories.isPending ? (
              <Spinner />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Categoria</Th>
                    <Th>Tipo</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {categories.data?.map((c: Category) => (
                    <tr key={c.id}>
                      <Td className={c.active ? '' : 'text-fg-subtle'}>{c.name}</Td>
                      <Td>
                        <Badge tone={c.kind === 'income' ? 'success' : 'neutral'}>{c.kind === 'income' ? 'Receita' : 'Despesa'}</Badge>
                      </Td>
                      <Td className="text-right">
                        {/* Categorias do sistema são usadas pelos módulos (ex.: "Serviços" nas ordens de serviço). */}
                        {!c.systemKey && (
                          <Button variant="ghost" size="sm" onClick={() => toggle.mutate({ path: `/finance/categories/${c.id}`, active: !c.active })}>
                            {c.active ? 'Desativar' : 'Reativar'}
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </section>
      </div>

    </>
  );
}

/**
 * Renomear e corrigir o saldo inicial, na própria linha. A correção não vira lançamento (receita ou
 * despesa de ajuste sujaria o resultado): exige motivo, e o valor anterior fica no histórico.
 */
function AccountEditor({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(account.name);
  const [initial, setInitial] = useState(account.initialBalance.toFixed(2).replace('.', ','));
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const history = useQuery({ queryKey: [...financeKey, 'account-history', account.id], queryFn: () => api<HistoryEntry[]>(`/finance/accounts/${account.id}/history`) });
  const done = (message: string) => {
    setSaved(message);
    queryClient.invalidateQueries({ queryKey: financeKey });
  };
  const rename = useMutation({
    mutationFn: () => api(`/finance/accounts/${account.id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => done('Nome alterado.'),
  });
  const correct = useMutation({
    mutationFn: () => api(`/finance/accounts/${account.id}/initial-balance`, { method: 'POST', body: { initialBalance: parseMoney(initial) || 0, reason } }),
    onSuccess: () => {
      setReason('');
      done('Saldo inicial corrigido.');
    },
  });
  const error = rename.error ?? correct.error;
  return (
    <div className="space-y-4 py-1">
      {error && <Alert>{error instanceof ApiError ? error.message : 'Erro ao salvar'}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Field label="Nome da conta">{(id) => <Input id={id} minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        </div>
        <Button variant="secondary" loading={rename.isPending} disabled={name.trim().length < 2 || name === account.name} onClick={() => rename.mutate()}>
          Renomear
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <Field label="Saldo inicial (R$)">{(id) => <Input id={id} inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} />}</Field>
        <Field label="Motivo da correção">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: saldo do extrato informado errado" />}</Field>
        <Button variant="secondary" loading={correct.isPending} disabled={reason.trim().length < 3} onClick={() => correct.mutate()}>
          Corrigir saldo
        </Button>
      </div>
      <p className="text-xs text-fg-muted">Corrigir muda o saldo da conta, mas não entra como receita nem despesa. O valor anterior e o motivo ficam no histórico.</p>
      {history.data && <HistoryList items={history.data} empty="Sem alterações registradas." />}
    </div>
  );
}

function CreatePanel({ kind, onClose }: { kind: 'account' | 'category'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState('bank');
  const [categoryKind, setCategoryKind] = useState('expense');
  const [initial, setInitial] = useState('');
  const create = useMutation({
    mutationFn: () =>
      kind === 'account'
        ? api('/finance/accounts', { method: 'POST', body: { name, type, initialBalance: parseMoney(initial) || 0 } })
        : api('/finance/categories', { method: 'POST', body: { name, kind: categoryKind } }),
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
    <Card className="mb-4 p-5">
      <h2 className="mb-4 font-medium">{kind === 'account' ? 'Nova conta' : 'Nova categoria'}</h2>
      <form onSubmit={submit} className="space-y-4">
        {create.error && <Alert>{create.error instanceof ApiError ? create.error.message : 'Erro ao criar'}</Alert>}
        <Field label="Nome">{(id) => <Input id={id} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        {kind === 'account' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo">
              {(id) => (
                <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
                  {Object.entries(accountTypeLabel).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Saldo inicial (R$)">{(id) => <Input id={id} inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="0,00" />}</Field>
          </div>
        ) : (
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={categoryKind} onChange={(e) => setCategoryKind(e.target.value)}>
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
              </Select>
            )}
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Criar
          </Button>
        </div>
      </form>
    </Card>
  );
}
