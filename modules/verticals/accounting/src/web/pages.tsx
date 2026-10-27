import { api, ApiError, CustomerSearch, formatDate, formatMoney, parseMoney, SpreadsheetImport, useCan, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { frequencyLabel, obligationStatusLabel, taxRegimeLabel, taxRegimes, type AccountingClient, type Obligation, type ObligationType, type TaxRegime } from '../contracts';
import { clientImportSpec } from './clientImport';

const key = ['accounting'] as const;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const monthBounds = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return { from: `${ym}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

function useTeam() {
  return useQuery({ queryKey: [...key, 'team'], queryFn: () => api<{ id: string; name: string }[]>('/users/team'), staleTime: 5 * 60_000 });
}

export function ObligationsPage() {
  const queryClient = useQueryClient();
  const canWork = useCan('accounting.work');
  const canManage = useCan('accounting.manage');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [status, setStatus] = useState('pending');
  const [catalog, setCatalog] = useState(false);
  const { from, to } = monthBounds(month);
  const list = useQuery({ queryKey: [...key, 'obligations', { month, status }], queryFn: () => api<Obligation[]>('/accounting/obligations', { query: { from, to, status: status || undefined } }) });
  const act = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'pending' | 'done' | 'waived' }) => api(`/accounting/obligations/${id}/status`, { method: 'POST', body: { status: next } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const generate = useMutation({ mutationFn: () => api<{ obligations: number; fees: number }>('/accounting/generate', { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: key }) });
  const now = today();

  const byDay = new Map<string, Obligation[]>();
  for (const o of list.data ?? []) byDay.set(o.dueOn, [...(byDay.get(o.dueOn) ?? []), o]);

  return (
    <>
      <PageHeader
        title="Obrigações"
        description="Calendário gerado pela carteira (regime e funcionários de cada empresa). Prazos padrão: confira e ajuste no catálogo."
        actions={
          canManage && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setCatalog(true)}>
                Catálogo
              </Button>
              <Button variant="secondary" loading={generate.isPending} onClick={() => generate.mutate()}>
                Gerar agora
              </Button>
            </div>
          )
        }
      />
      {generate.data && (
        <Alert tone="success">
          {generate.data.obligations} obrigação(ões) e {generate.data.fees} honorário(s) lançados.
        </Alert>
      )}
      {act.error && <Alert>{act.error instanceof ApiError ? act.error.message : 'Erro'}</Alert>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
          ←
        </Button>
        <span className="min-w-40 text-center font-medium capitalize">{monthName(month)}</span>
        <Button variant="ghost" size="sm" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>
          →
        </Button>
        <Select aria-label="Situação" className="max-w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">A fazer</option>
          <option value="done">Entregues</option>
          <option value="waived">Dispensadas</option>
          <option value="">Todas</option>
        </Select>
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <Alert>{list.error.message}</Alert>
      ) : byDay.size === 0 ? (
        <Card>
          <EmptyState title="Nada neste mês" description={canManage ? 'Cadastre empresas na carteira; o calendário é gerado automaticamente.' : undefined} />
        </Card>
      ) : (
        <div className="space-y-4">
          {[...byDay].map(([day, items]) => (
            <Card key={day}>
              <div className={`border-b border-line px-4 py-2 text-sm font-medium ${day < now && items.some((i) => i.status === 'pending') ? 'text-danger-600' : ''}`}>
                Vence {formatDate(day)} {day < now && items.some((i) => i.status === 'pending') && '· atrasada'}
              </div>
              <ul className="divide-y divide-line text-sm">
                {items.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{o.type.name}</span>
                      <span className="text-fg-muted">
                        {' '}
                        · {o.client.name} · competência {o.competence}
                      </span>
                      {o.status !== 'pending' && (
                        <div className="text-xs text-fg-muted">
                          {obligationStatusLabel[o.status]}
                          {o.doneBy && ` por ${o.doneBy}`}
                        </div>
                      )}
                    </div>
                    {o.responsible && <span className="text-xs text-fg-muted">{o.responsible}</span>}
                    {canWork &&
                      (o.status === 'pending' ? (
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => act.mutate({ id: o.id, next: 'done' })}>
                            Entregue
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: o.id, next: 'waived' })}>
                            Dispensar
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: o.id, next: 'pending' })}>
                          Reabrir
                        </Button>
                      ))}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {catalog && <CatalogModal onClose={() => setCatalog(false)} />}
    </>
  );
}

function CatalogModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const types = useQuery({ queryKey: [...key, 'types'], queryFn: () => api<ObligationType[]>('/accounting/obligation-types') });
  const save = useMutation({
    mutationFn: (t: ObligationType) => api(`/accounting/obligation-types/${t.id}`, { method: 'PATCH', body: { ...t, id: undefined } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return (
    <Modal open title="Catálogo de obrigações" onClose={onClose}>
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro'}</Alert>}
      {types.isPending ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line text-sm">
          {types.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-fg-muted">
                  {frequencyLabel[t.frequency]} · {t.regimes.map((r) => taxRegimeLabel[r]).join(', ')}
                  {t.requiresEmployees && ' · com funcionários'}
                </div>
              </div>
              <label className="flex items-center gap-1 text-xs">
                dia
                <Input
                  aria-label={`Dia de vencimento de ${t.name}`}
                  type="number"
                  min={1}
                  max={31}
                  className="h-8 w-16"
                  defaultValue={t.dueDay}
                  onBlur={(e) => Number(e.target.value) !== t.dueDay && save.mutate({ ...t, dueDay: Number(e.target.value) })}
                />
              </label>
              <Checkbox label="Ativa" checked={t.active} onChange={(e) => save.mutate({ ...t, active: e.target.checked })} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-fg-muted">Mudanças valem para as próximas gerações; o que já foi gerado continua com o prazo antigo.</p>
    </Modal>
  );
}

export function ClientsPage() {
  const queryClient = useQueryClient();
  const canManage = useCan('accounting.manage');
  const list = useQuery({ queryKey: [...key, 'clients'], queryFn: () => api<AccountingClient[]>('/accounting/clients') });
  const [editing, setEditing] = useState<AccountingClient | 'new' | null>(null);
  const total = (list.data ?? []).filter((c) => c.active).reduce((s, c) => s + c.monthlyFee, 0);
  return (
    <>
      <PageHeader
        title="Carteira de empresas"
        description={list.data ? `${list.data.filter((c) => c.active).length} empresas ativas · honorários de ${formatMoney(total)} por mês` : undefined}
        actions={
          canManage && (
            <>
              <SpreadsheetImport spec={clientImportSpec()} onImported={() => queryClient.invalidateQueries({ queryKey: key })} />
              <Button onClick={() => setEditing('new')}>Adicionar empresa</Button>
            </>
          )
        }
      />
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma empresa na carteira" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Empresa</Th>
                <Th>Regime</Th>
                <Th>Responsável</Th>
                <Th className="text-right">Honorário</Th>
                <Th>Obrigações</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className={c.active ? 'font-medium' : 'text-fg-subtle'}>{c.customer.name}</span>
                    {c.hasEmployees && <span className="ml-2 text-xs text-fg-muted">com funcionários</span>}
                  </Td>
                  <Td>{taxRegimeLabel[c.taxRegime]}</Td>
                  <Td>{c.responsible?.name ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(c.monthlyFee)}</Td>
                  <Td>
                    {c.overdueObligations > 0 ? <Badge tone="danger">{c.overdueObligations} atrasada(s)</Badge> : c.pendingObligations > 0 ? <Badge tone="warning">{c.pendingObligations} a fazer</Badge> : <Badge tone="success">Em dia</Badge>}
                  </Td>
                  <Td className="text-right">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                        Editar
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ClientModal client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ClientModal({ client, onClose }: { client: AccountingClient | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const team = useTeam();
  const [customer, setCustomer] = useState<{ id: string; name: string } | CustomerOption | null>(client?.customer ?? null);
  const [form, setForm] = useState({
    taxRegime: client?.taxRegime ?? ('simples' as TaxRegime),
    cnae: client?.cnae ?? '',
    hasEmployees: client?.hasEmployees ?? false,
    monthlyFee: client ? client.monthlyFee.toFixed(2).replace('.', ',') : '',
    feeDueDay: String(client?.feeDueDay ?? 10),
    responsibleUserId: client?.responsible?.id ?? '',
    active: client?.active ?? true,
    notes: client?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(client ? `/accounting/clients/${client.id}` : '/accounting/clients', {
        method: client ? 'PATCH' : 'POST',
        body: { ...form, customerId: customer?.id, cnae: form.cnae || null, monthlyFee: parseMoney(form.monthlyFee) || 0, feeDueDay: Number(form.feeDueDay), responsibleUserId: form.responsibleUserId || null, notes: form.notes || null },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Modal
      open
      title={client ? `Editar ${client.customer.name}` : 'Adicionar empresa'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="acc-client-form" loading={save.isPending} disabled={!customer}>
            Salvar
          </Button>
        </>
      }
    >
      {!customer ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">Busque a empresa no cadastro de clientes.</p>
          <CustomerSearch onSelect={setCustomer} />
        </div>
      ) : (
        <form id="acc-client-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          {!client && (
            <p className="text-sm">
              Empresa: <span className="font-medium">{customer.name}</span>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Regime tributário">
              {(id) => (
                <Select id={id} value={form.taxRegime} onChange={(e) => set({ taxRegime: e.target.value as TaxRegime })}>
                  {taxRegimes.map((r) => (
                    <option key={r} value={r}>
                      {taxRegimeLabel[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="CNAE principal">{(id) => <Input id={id} value={form.cnae} onChange={(e) => set({ cnae: e.target.value })} />}</Field>
            <Field label="Honorário mensal (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.monthlyFee} onChange={(e) => set({ monthlyFee: e.target.value })} />}</Field>
            <Field label="Vencimento do honorário (dia)">{(id) => <Input id={id} type="number" min={1} max={28} value={form.feeDueDay} onChange={(e) => set({ feeDueDay: e.target.value })} />}</Field>
            <Field label="Responsável">
              {(id) => (
                <Select id={id} value={form.responsibleUserId} onChange={(e) => set({ responsibleUserId: e.target.value })}>
                  <option value="">—</option>
                  {team.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Checkbox label="Tem funcionários (folha, eSocial, FGTS)" checked={form.hasEmployees} onChange={(e) => set({ hasEmployees: e.target.checked })} />
          <Checkbox label="Ativa na carteira" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
          <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        </form>
      )}
    </Modal>
  );
}

/** Aba "Contabilidade" na ficha do cliente: obrigações da empresa. */
export function CustomerObligationsTab({ customerId }: { customerId: string }) {
  const clients = useQuery({ queryKey: [...key, 'clients'], queryFn: () => api<AccountingClient[]>('/accounting/clients') });
  const client = clients.data?.find((c) => c.customer.id === customerId);
  const list = useQuery({
    queryKey: [...key, 'obligations', { clientId: client?.id }],
    queryFn: () => api<Obligation[]>('/accounting/obligations', { query: { clientId: client!.id } }),
    enabled: !!client,
  });
  if (clients.isPending) return <Spinner />;
  if (!client) return <Card className="p-5 text-sm text-fg-muted">Esta empresa não está na carteira contábil.</Card>;
  return (
    <Card>
      {list.isPending ? (
        <Spinner />
      ) : !list.data?.length ? (
        <EmptyState title="Nenhuma obrigação gerada" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Vencimento</Th>
              <Th>Obrigação</Th>
              <Th>Competência</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((o) => (
              <tr key={o.id}>
                <Td className="tabular-nums">{formatDate(o.dueOn)}</Td>
                <Td>{o.type.name}</Td>
                <Td>{o.competence}</Td>
                <Td>
                  <Badge tone={o.status === 'done' ? 'success' : o.status === 'waived' ? 'neutral' : o.dueOn < today() ? 'danger' : 'warning'}>{obligationStatusLabel[o.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
