import { api, apiBlob, ApiError, apiUpload, CustomerSearch, formatDate, formatMoney, parseMoney, SpreadsheetImport, useCan, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  feeDueDate,
  frequencies,
  frequencyLabel,
  obligationStatusLabel,
  taxRegimeLabel,
  taxRegimes,
  type AccountingClient,
  type Frequency,
  type Obligation,
  type ObligationType,
  type RegimeImpactItem,
  type SaveClientResult,
  type TaxRegime,
} from '../contracts';
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
  const [openId, setOpenId] = useState<string | null>(null);
  const { from, to } = monthBounds(month);
  const list = useQuery({ queryKey: [...key, 'obligations', { month, status }], queryFn: () => api<Obligation[]>('/accounting/obligations', { query: { from, to, status: status || undefined } }) });
  const act = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'pending' | 'done' | 'waived' }) => api(`/accounting/obligations/${id}/status`, { method: 'POST', body: { status: next } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const generate = useMutation({ mutationFn: () => api<{ obligations: number; fees: number; feesMoved: { name: string; dueOn: string }[] }>('/accounting/generate', { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: key }) });
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
              <Link to="/contabil/catalogo">
                <Button variant="secondary">Catálogo</Button>
              </Link>
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
      {generate.data && generate.data.feesMoved.length > 0 && (
        <Alert tone="info">
          O dia de vencimento já tinha passado, então o honorário ficou para o mês seguinte: {generate.data.feesMoved.map((f) => `${f.name} (${formatDate(f.dueOn)})`).join(', ')}.
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
                  <li key={o.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
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
                        {openId !== o.id && o.notes && <div className="truncate text-xs text-fg-muted">{o.notes}</div>}
                      </div>
                      {o.responsible && <span className="text-xs text-fg-muted">{o.responsible}</span>}
                      <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                        {openId === o.id ? 'Fechar' : `Detalhes${o.attachments.length ? ` (${o.attachments.length})` : ''}`}
                      </Button>
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
                    </div>
                    {openId === o.id && <ObligationDetails obligation={o} canWork={canWork} />}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** Observação e anexos (guia, recibo), abertos na própria linha da obrigação. */
function ObligationDetails({ obligation: o, canWork }: { obligation: Obligation; canWork: boolean }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState(o.notes ?? '');
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const save = useMutation({ mutationFn: () => api(`/accounting/obligations/${o.id}/notes`, { method: 'PATCH', body: { notes: notes.trim() || null } }), onSuccess: refresh });
  const upload = useMutation({ mutationFn: (file: File) => apiUpload(`/accounting/obligations/${o.id}/attachments`, 'file', file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (fileId: string) => api(`/accounting/obligations/${o.id}/attachments/${fileId}`, { method: 'DELETE' }), onSuccess: refresh });
  const error = save.error ?? upload.error ?? remove.error;
  const open = async (fileId: string) => {
    const tab = window.open('', '_blank');
    const blob = await apiBlob(`/accounting/attachments/${fileId}`).catch(() => {
      tab?.close();
      window.alert('Não foi possível abrir o anexo');
      return null;
    });
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-muted/50 p-3">
      {error && <Alert>{error instanceof ApiError ? error.message : 'Erro ao salvar'}</Alert>}
      <Field label="Observação">{(id) => <Textarea id={id} rows={3} maxLength={2000} readOnly={!canWork} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      {canWork && (
        <Button size="sm" variant="secondary" disabled={notes === (o.notes ?? '')} loading={save.isPending} onClick={() => save.mutate()}>
          Salvar observação
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {o.attachments.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-xs">
            <button type="button" className="hover:underline" onClick={() => open(a.id)}>
              {a.filename}
            </button>
            {canWork && (
              <button type="button" aria-label={`Remover ${a.filename}`} className="text-fg-muted hover:text-danger-600" onClick={() => confirm(`Remover ${a.filename}?`) && remove.mutate(a.id)}>
                ✕
              </button>
            )}
          </span>
        ))}
        {o.attachments.length === 0 && <span className="text-xs text-fg-muted">Sem anexo.</span>}
        {canWork && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="ghost" loading={upload.isPending} onClick={() => fileInput.current?.click()}>
              Anexar guia ou recibo
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const typeDraft = { code: '', name: '', regimes: [] as TaxRegime[], requiresEmployees: false, frequency: 'monthly' as Frequency, dueDay: '20', dueMonth: '12', active: true };

/** Catálogo de obrigações: o que o sistema sabe gerar, com tudo editável, na própria página. */
export function CatalogPage() {
  const types = useQuery({ queryKey: [...key, 'types'], queryFn: () => api<ObligationType[]>('/accounting/obligation-types') });
  const [editing, setEditing] = useState<ObligationType | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Catálogo de obrigações"
        description="Mudanças valem para as próximas gerações; o que já foi gerado continua com o prazo antigo. Os prazos são referência: confira com a legislação."
        actions={
          <div className="flex gap-2">
            <Link to="/contabil/obrigacoes">
              <Button variant="secondary">Voltar para Obrigações</Button>
            </Link>
            {!editing && <Button onClick={() => setEditing('new')}>Nova obrigação</Button>}
          </div>
        }
      />
      {editing && <TypeForm key={editing === 'new' ? 'new' : editing.id} type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Card>
        {types.isPending ? (
          <Spinner />
        ) : types.isError ? (
          <div className="p-4">
            <Alert>{types.error.message}</Alert>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Obrigação</Th>
                <Th>Periodicidade</Th>
                <Th>Vencimento</Th>
                <Th>Regimes</Th>
                <Th>Situação</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {types.data.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <span className="font-medium">{t.name}</span> <span className="text-xs text-fg-muted">{t.code}</span>
                  </Td>
                  <Td>{frequencyLabel[t.frequency]}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    Dia {t.dueDay}
                    {t.frequency === 'annual' && ` de ${String(t.dueMonth ?? 12).padStart(2, '0')}`}
                  </Td>
                  <Td className="text-sm text-fg-muted">
                    {t.regimes.map((r) => taxRegimeLabel[r]).join(', ')}
                    {t.requiresEmployees && ' · com funcionários'}
                  </Td>
                  <Td>{t.active ? <Badge tone="success">Ativa</Badge> : <Badge>Desligada</Badge>}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                      Editar
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function TypeForm({ type, onClose }: { type: ObligationType | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(
    type
      ? { code: type.code, name: type.name, regimes: type.regimes, requiresEmployees: type.requiresEmployees, frequency: type.frequency, dueDay: String(type.dueDay), dueMonth: String(type.dueMonth ?? 12), active: type.active }
      : typeDraft,
  );
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(type ? `/accounting/obligation-types/${type.id}` : '/accounting/obligation-types', {
        method: type ? 'PATCH' : 'POST',
        body: { ...form, dueDay: Number(form.dueDay), dueMonth: form.frequency === 'annual' ? Number(form.dueMonth) : null },
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
    <Card className="mb-4 p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-medium">{type ? `Editar ${type.name}` : 'Nova obrigação'}</h2>
        {save.error && <Alert>{save.error instanceof ApiError ? String(save.error.message) : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Código" hint="Único no catálogo. Ex.: GIA">{(id) => <Input id={id} required maxLength={30} value={form.code} onChange={(e) => set({ code: e.target.value })} />}</Field>
          <Field label="Nome">{(id) => <Input id={id} required maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Regimes</legend>
          <div className="flex flex-wrap gap-4">
            {taxRegimes.map((r) => (
              <Checkbox key={r} label={taxRegimeLabel[r]} checked={form.regimes.includes(r)} onChange={(e) => set({ regimes: e.target.checked ? [...form.regimes, r] : form.regimes.filter((x) => x !== r) })} />
            ))}
          </div>
        </fieldset>
        <Checkbox label="Só para empresa com funcionários" checked={form.requiresEmployees} onChange={(e) => set({ requiresEmployees: e.target.checked })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Periodicidade">
            {(id) => (
              <Select id={id} value={form.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
                {frequencies.map((f) => (
                  <option key={f} value={f}>
                    {frequencyLabel[f]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Dia do vencimento" hint="Dia maior que o último do mês cai no último dia.">
            {(id) => <Input id={id} type="number" required min={1} max={31} value={form.dueDay} onChange={(e) => set({ dueDay: e.target.value })} />}
          </Field>
          {form.frequency === 'annual' && (
            <Field label="Mês do vencimento" hint="No ano seguinte ao de referência.">
              {(id) => <Input id={id} type="number" required min={1} max={12} value={form.dueMonth} onChange={(e) => set({ dueMonth: e.target.value })} />}
            </Field>
          )}
        </div>
        <Checkbox label="Ativa (é gerada para as empresas)" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ClientsPage() {
  const queryClient = useQueryClient();
  const canManage = useCan('accounting.manage');
  const list = useQuery({ queryKey: [...key, 'clients'], queryFn: () => api<AccountingClient[]>('/accounting/clients') });
  const [editing, setEditing] = useState<AccountingClient | 'new' | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
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
              <Button onClick={() => { setSaved(null); setEditing('new'); }}>Adicionar empresa</Button>
            </>
          )
        }
      />
      {saved && (
        <div className="mb-4">
          <Alert tone="success">{saved}</Alert>
        </div>
      )}
      {editing && (
        <ClientForm
          key={editing === 'new' ? 'new' : editing.id}
          client={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setSaved(text);
            setEditing(null);
          }}
        />
      )}
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
                      <Button size="sm" variant="ghost" onClick={() => { setSaved(null); setEditing(c); }}>
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
    </>
  );
}

function ClientForm({ client, onClose, onSaved }: { client: AccountingClient | null; onClose: () => void; onSaved: (text: string) => void }) {
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
  // Mudou o regime ou os funcionários: mostra o que deixa de valer e deixa escolher antes de salvar.
  const situationChanged = !!client && (client.taxRegime !== form.taxRegime || client.hasEmployees !== form.hasEmployees);
  const impact = useQuery({
    queryKey: [...key, 'regime-impact', client?.id, form.taxRegime, form.hasEmployees],
    queryFn: () => api<RegimeImpactItem[]>(`/accounting/clients/${client!.id}/regime-impact`, { query: { taxRegime: form.taxRegime, hasEmployees: form.hasEmployees } }),
    enabled: situationChanged,
  });
  const items = situationChanged ? (impact.data ?? []) : [];
  // Sugestão: dispensar o que ainda não venceu; o vencido era devido no regime antigo.
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const willWaive = (i: RegimeImpactItem) => choices[i.id] ?? !i.overdue;
  const save = useMutation({
    mutationFn: () =>
      api<SaveClientResult>(client ? `/accounting/clients/${client.id}` : '/accounting/clients', {
        method: client ? 'PATCH' : 'POST',
        body: {
          ...form,
          customerId: customer?.id,
          cnae: form.cnae || null,
          monthlyFee: parseMoney(form.monthlyFee) || 0,
          feeDueDay: Number(form.feeDueDay),
          responsibleUserId: form.responsibleUserId || null,
          notes: form.notes || null,
          waiveObligationIds: situationChanged && impact.data ? items.filter(willWaive).map((i) => i.id) : undefined,
        },
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: key });
      onSaved(result.regimeChange ? `Empresa salva. ${result.regimeChange.waived} obrigação(ões) dispensada(s) e ${result.regimeChange.kept} mantida(s) a fazer, com a observação do motivo.` : 'Empresa salva.');
    },
  });
  // Honorário que nasceria vencido: avisa antes e diz para quando fica.
  const firstFee = !client && (parseMoney(form.monthlyFee) || 0) > 0 ? feeDueDate(today(), Number(form.feeDueDay) || 10) : null;
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Card className="mb-4 space-y-4 p-5">
      <h2 className="font-medium">{client ? `Editar ${client.customer.name}` : 'Adicionar empresa'}</h2>
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
          {firstFee?.moved && (
            <Alert tone="info">
              O dia {form.feeDueDay} deste mês já passou. O primeiro honorário, de {firstFee.competence.split('-').reverse().join('/')}, vai vencer em {formatDate(firstFee.dueOn)}, para não nascer vencido.
            </Alert>
          )}
          {items.length > 0 && (
            <div className="space-y-2 rounded-lg border border-warning-600/40 p-3 text-sm">
              <p className="font-medium">Estas obrigações em aberto deixam de valer. Marque as que devem ser dispensadas:</p>
              <p className="text-fg-muted">As desmarcadas continuam a fazer. Todas ganham uma observação com o motivo, e a dispensa pode ser desfeita com Reabrir. As vencidas vêm desmarcadas porque eram devidas no regime antigo.</p>
              {items.map((i) => (
                <Checkbox
                  key={i.id}
                  label={`${i.name} · competência ${i.competence} · vence ${formatDate(i.dueOn)}${i.overdue ? ' (vencida)' : ''}`}
                  checked={willWaive(i)}
                  onChange={(e) => setChoices({ ...choices, [i.id]: e.target.checked })}
                />
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending} disabled={!customer}>
              Salvar
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Voltar
            </Button>
          </div>
        </form>
      )}
      {!customer && (
        <Button variant="secondary" onClick={onClose}>
          Voltar
        </Button>
      )}
    </Card>
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
