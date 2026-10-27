import { api, formatDate, formatDateTime, formatMoney, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { quotaStatusLabel, type CommissionTable, type Group, type LateQuota, type Plan } from '../contracts';
import { errorText, key, parsePercent, pct, quotaTone } from './common';

/** Inadimplência: cotas com parcelas vencidas sem pagamento registrado. */
export function LatePage() {
  const canTrack = useCan('consortium.track');
  const queryClient = useQueryClient();
  const [minDays, setMinDays] = useState('');
  const list = useQuery({ queryKey: [...key, 'late', minDays], queryFn: () => api<LateQuota[]>('/consortium/installments/late', { query: { minDays: minDays || undefined } }) });
  const notify = useMutation({
    mutationFn: (quotaId: string) => api(`/consortium/quotas/${quotaId}/late-notice`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...key, 'late'] }),
  });
  const total = list.data?.reduce((s, l) => s + l.lateAmount, 0) ?? 0;
  return (
    <>
      <PageHeader
        title="Inadimplência"
        description="Parcelas vencidas sem pagamento registrado. O cliente recebe um aviso automático quando a parcela passa do prazo configurado em Comissões; a cobrança é da administradora."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label="Atraso mínimo" className="max-w-56" value={minDays} onChange={(e) => setMinDays(e.target.value)}>
          <option value="">Qualquer atraso</option>
          <option value="15">Mais de 15 dias</option>
          <option value="30">Mais de 30 dias</option>
          <option value="60">Mais de 60 dias</option>
          <option value="90">Mais de 90 dias</option>
        </Select>
        {list.data && list.data.length > 0 && (
          <span className="text-sm text-fg-muted">
            {list.data.length} cota(s) · {formatMoney(total)} em atraso
          </span>
        )}
      </div>
      {notify.error && <Alert>{errorText(notify.error, 'Erro ao avisar')}</Alert>}
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <Alert>{list.error.message}</Alert>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma parcela em atraso" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cota</Th>
                <Th>Cliente</Th>
                <Th className="text-right">Parcelas</Th>
                <Th className="text-right">Valor</Th>
                <Th>Mais antiga</Th>
                <Th>Último aviso</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((l) => (
                <tr key={l.quota.id}>
                  <Td>
                    <Link to={`/consorcio/cotas/${l.quota.id}`} className="text-brand-700 hover:underline">
                      nº {l.quota.number}
                    </Link>
                    <div className="text-xs text-fg-muted">
                      {l.quota.groupCode ? `${l.quota.groupCode} / ${l.quota.quotaNumber}` : '—'} · {l.quota.institution}
                    </div>
                    <Badge tone={quotaTone[l.quota.status]}>{quotaStatusLabel[l.quota.status]}</Badge>
                  </Td>
                  <Td>
                    <Link to={`/clientes/${l.customer.id}`} className="text-brand-700 hover:underline">
                      {l.customer.name}
                    </Link>
                    {l.customer.phone && <div className="text-xs text-fg-muted">{l.customer.phone}</div>}
                  </Td>
                  <Td className="text-right tabular-nums">{l.lateCount}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(l.lateAmount)}</Td>
                  <Td>
                    {formatDate(l.oldestDueOn)}
                    <div className={`text-xs ${l.daysLate > 30 ? 'font-medium text-danger-700' : 'text-fg-muted'}`}>{l.daysLate} dia(s) de atraso</div>
                  </Td>
                  <Td className="text-xs">{l.lastNoticeAt ? formatDateTime(l.lastNoticeAt) : '—'}</Td>
                  <Td className="text-right">
                    {canTrack && (
                      <Button size="sm" variant="secondary" loading={notify.isPending && notify.variables === l.quota.id} onClick={() => notify.mutate(l.quota.id)}>
                        Avisar agora
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

/** Grupos das administradoras: participantes, prazo e lance vencedor médio das assembleias lançadas. */
export function GroupsPage() {
  const canManage = useCan('consortium.manage');
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const list = useQuery({ queryKey: [...key, 'groups'], queryFn: () => api<Group[]>('/consortium/groups') });
  return (
    <>
      <PageHeader
        title="Grupos"
        description="Cada cota aceita cadastra o grupo dela. O lance médio vem dos resultados de assembleia lançados; participantes e meses restantes são informados pela administradora."
        actions={canManage && <Button onClick={() => setEditing('new')}>Cadastrar grupo</Button>}
      />
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <Alert>{list.error.message}</Alert>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhum grupo" description="Os grupos aparecem quando as adesões são aceitas." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Grupo</Th>
                <Th>Plano</Th>
                <Th className="text-right">Participantes</Th>
                <Th className="text-right">Meses restantes</Th>
                <Th className="text-right">Assembleias</Th>
                <Th className="text-right">Lance médio</Th>
                <Th>Próxima</Th>
                <Th className="text-right">Nossas cotas</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((g) => (
                <tr key={g.id ?? `${g.connectionId}-${g.groupCode}`}>
                  <Td>
                    <div className="font-medium">{g.groupCode}</div>
                    <div className="text-xs text-fg-muted">{g.institution}</div>
                  </Td>
                  <Td>{g.plan?.name ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{g.members ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{g.monthsRemaining ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{g.assembliesHeld}</Td>
                  <Td className="text-right tabular-nums">
                    {g.averageWinningBid != null ? pct(g.averageWinningBid) : '—'}
                    {g.minWinningBid != null && (
                      <div className="text-xs text-fg-muted">
                        {pct(g.minWinningBid)} a {pct(g.maxWinningBid!)}
                      </div>
                    )}
                  </Td>
                  <Td>{g.nextAssembly ? formatDate(g.nextAssembly.heldOn) : '—'}</Td>
                  <Td className="text-right tabular-nums">{g.ourQuotas}</Td>
                  <Td className="text-right">
                    {canManage && (
                      <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setEditing(g)}>
                        editar
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <GroupModal group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function GroupModal({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: [...key, 'plans', 'all'], queryFn: () => api<Plan[]>('/consortium/plans') });
  const [form, setForm] = useState({
    planId: group?.plan?.id ?? '',
    groupCode: group?.groupCode ?? '',
    members: group?.members != null ? String(group.members) : '',
    monthsRemaining: group?.monthsRemaining != null ? String(group.monthsRemaining) : '',
    notes: group?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api('/consortium/groups', {
        method: 'PUT',
        body: {
          planId: form.planId,
          groupCode: form.groupCode,
          members: form.members ? Number(form.members) : null,
          monthsRemaining: form.monthsRemaining ? Number(form.monthsRemaining) : null,
          notes: form.notes || null,
        },
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
  // O plano define a administradora: num grupo já cadastrado, só planos da mesma administradora.
  const options = (plans.data ?? []).filter((p) => !group || p.connectionId === group.connectionId);
  return (
    <Modal
      open
      title={group ? `Grupo ${group.groupCode}` : 'Cadastrar grupo'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="cons-group-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="cons-group-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plano (administradora)">
            {(id) => (
              <Select id={id} required value={form.planId} onChange={(e) => set({ planId: e.target.value })}>
                <option value="">Escolha…</option>
                {group?.plan && !options.some((p) => p.id === group.plan!.id) && <option value={group.plan.id}>{group.plan.name}</option>}
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.institution}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Grupo">{(id) => <Input id={id} required disabled={!!group} value={form.groupCode} onChange={(e) => set({ groupCode: e.target.value.toUpperCase() })} />}</Field>
          <Field label="Participantes">{(id) => <Input id={id} type="number" min={1} value={form.members} onChange={(e) => set({ members: e.target.value })} />}</Field>
          <Field label="Meses restantes" hint="Hoje; a tela desconta os meses que passarem">
            {(id) => <Input id={id} type="number" min={0} value={form.monthsRemaining} onChange={(e) => set({ monthsRemaining: e.target.value })} />}
          </Field>
        </div>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

interface ModuleSettings {
  commissionPercent: number;
  reversalMonths: number;
  lateNoticeDays: number;
}

/** Comissão da corretora por administradora e por plano, prazo de estorno e aviso de atraso. */
export function CommissionsPage() {
  const queryClient = useQueryClient();
  const table = useQuery({ queryKey: [...key, 'commissions'], queryFn: () => api<CommissionTable>('/consortium/commissions') });
  const save = useMutation({
    mutationFn: (v: { path: string; percent: number | null }) => api<CommissionTable>(v.path, { method: 'PUT', body: { percent: v.percent } }),
    onSuccess: (data) => queryClient.setQueryData([...key, 'commissions'], data),
  });
  return (
    <>
      <PageHeader
        title="Comissões"
        description="Percentual sobre o crédito que a administradora paga à corretora na ativação da cota. Vale o do plano; sem ele, o da administradora; sem os dois, o padrão. Cotas já ativas mantêm o percentual da ativação."
      />
      <SettingsCard />
      {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
      {table.isPending ? (
        <Spinner />
      ) : table.isError ? (
        <Alert>{table.error.message}</Alert>
      ) : table.data.institutions.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma administradora" description='Atualize os planos no Simulador ("Atualizar planos das administradoras").' />
        </Card>
      ) : (
        <div className="space-y-4">
          {table.data.institutions.map((inst) => (
            <Card key={inst.connectionId} className="p-4 text-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{inst.institution}</span>
                <PercentEditor
                  label="Comissão da administradora"
                  value={inst.percent}
                  placeholder={`padrão ${pct(table.data.defaultPercent)}`}
                  onSave={(percent) => save.mutate({ path: `/consortium/commissions/institutions/${inst.connectionId}`, percent })}
                />
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>Plano</Th>
                    <Th className="text-right">Crédito</Th>
                    <Th className="text-right">Vale hoje</Th>
                    <Th className="text-right">Percentual do plano</Th>
                  </tr>
                </thead>
                <tbody>
                  {inst.plans.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        {p.name} {!p.active && <Badge>Fora de oferta</Badge>}
                        <div className="text-xs text-fg-muted">{p.termMonths} meses</div>
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(p.creditValue)}</Td>
                      <Td className="text-right tabular-nums">
                        {pct(p.effectivePercent)}
                        <div className="text-xs text-fg-muted">{formatMoney((p.creditValue * p.effectivePercent) / 100)}</div>
                      </Td>
                      <Td className="text-right">
                        <PercentEditor label={`Comissão do plano ${p.name}`} value={p.percent} placeholder="herdar" onSave={(percent) => save.mutate({ path: `/consortium/commissions/plans/${p.id}`, percent })} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function PercentEditor({ label, value, placeholder, onSave }: { label: string; value: number | null; placeholder: string; onSave: (v: number | null) => void }) {
  const initial = value == null ? '' : String(value).replace('.', ',');
  const [text, setText] = useState(initial);
  const changed = text !== initial;
  return (
    <span className="inline-flex items-center gap-2">
      <Input aria-label={label} inputMode="decimal" className="w-24 text-right" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <span>%</span>
      <Button size="sm" variant="secondary" disabled={!changed} onClick={() => onSave(parsePercent(text))}>
        Salvar
      </Button>
    </span>
  );
}

/** Configurações do módulo (só quem pode configurar a empresa vê). */
function SettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['modules', 'consortium', 'settings'], queryFn: () => api<ModuleSettings>('/modules/consortium/settings'), retry: false });
  if (!settings.data) return null;
  return <SettingsForm initial={settings.data} onSaved={() => queryClient.invalidateQueries({ queryKey: ['modules', 'consortium', 'settings'] }).then(() => queryClient.invalidateQueries({ queryKey: key }))} />;
}

function SettingsForm({ initial, onSaved }: { initial: ModuleSettings; onSaved: () => void }) {
  const [form, setForm] = useState({ commissionPercent: String(initial.commissionPercent).replace('.', ','), reversalMonths: String(initial.reversalMonths), lateNoticeDays: String(initial.lateNoticeDays) });
  const save = useMutation({
    mutationFn: () =>
      api('/modules/consortium/settings', {
        method: 'PUT',
        body: { ...initial, commissionPercent: parsePercent(form.commissionPercent) ?? 0, reversalMonths: Number(form.reversalMonths || 0), lateNoticeDays: Number(form.lateNoticeDays || 0) },
      }),
    onSuccess: onSaved,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Card className="mb-4 p-4">
      <form onSubmit={submit} className="space-y-3">
        {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Comissão padrão (%)">{(id) => <Input id={id} inputMode="decimal" value={form.commissionPercent} onChange={(e) => setForm({ ...form, commissionPercent: e.target.value })} />}</Field>
          <Field label="Estorno se cancelar em até (meses)" hint="0 = nunca estorna">
            {(id) => <Input id={id} type="number" min={0} max={60} value={form.reversalMonths} onChange={(e) => setForm({ ...form, reversalMonths: e.target.value })} />}
          </Field>
          <Field label="Avisar o cliente com atraso de (dias)" hint="0 = não avisar">
            {(id) => <Input id={id} type="number" min={0} max={90} value={form.lateNoticeDays} onChange={(e) => setForm({ ...form, lateNoticeDays: e.target.value })} />}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={save.isPending}>
            Salvar configurações
          </Button>
        </div>
      </form>
    </Card>
  );
}
