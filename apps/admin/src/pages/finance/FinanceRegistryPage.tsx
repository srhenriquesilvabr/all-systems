import { api, ApiError, formatMoney, parseMoney } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { accountTypeLabel, financeKey, useAccounts, useCategories, type Account, type Category } from './shared';

export function FinanceRegistryPage() {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const categories = useCategories();
  const [modal, setModal] = useState<'account' | 'category' | null>(null);
  const toggle = useMutation({
    mutationFn: ({ path, active }: { path: string; active: boolean }) => api(path, { method: 'PATCH', body: { active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: financeKey }),
  });

  return (
    <>
      <PageHeader title="Contas e categorias" description="Onde o dinheiro fica e como os lançamentos são classificados." />
      {toggle.error && (
        <div className="mb-4">
          <Alert>{toggle.error.message}</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Contas</h2>
            <Button size="sm" onClick={() => setModal('account')}>
              Nova conta
            </Button>
          </div>
          <Card>
            {accounts.isPending ? (
              <Spinner />
            ) : (
              <Table>
                <tbody>
                  {accounts.data?.map((a: Account) => (
                    <tr key={a.id}>
                      <Td>
                        <p className={a.active ? 'font-medium' : 'text-fg-subtle'}>{a.name}</p>
                        <p className="text-xs text-fg-muted">{accountTypeLabel[a.type]}</p>
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(a.balance)}</Td>
                      <Td className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => toggle.mutate({ path: `/finance/accounts/${a.id}`, active: !a.active })}>
                          {a.active ? 'Desativar' : 'Reativar'}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Categorias</h2>
            <Button size="sm" onClick={() => setModal('category')}>
              Nova categoria
            </Button>
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

      {modal && <CreateModal kind={modal} onClose={() => setModal(null)} />}
    </>
  );
}

function CreateModal({ kind, onClose }: { kind: 'account' | 'category'; onClose: () => void }) {
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
    <Modal
      open
      title={kind === 'account' ? 'Nova conta' : 'Nova categoria'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="registry-form" loading={create.isPending}>
            Criar
          </Button>
        </>
      }
    >
      <form id="registry-form" onSubmit={submit} className="space-y-4">
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
      </form>
    </Modal>
  );
}
