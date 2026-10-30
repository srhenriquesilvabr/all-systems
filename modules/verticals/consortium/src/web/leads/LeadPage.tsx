import { CreditCheckPanel } from '@all/credit-bureau/web';
import { api, formatDateTime, formatMoney, formatPhone, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  contactBasisLabel,
  leadAssetLabel,
  leadSourceLabel,
  leadStatusLabel,
  lostReasons,
  openLeadStatuses,
  quotaStatusLabel,
  rewardStatusLabel,
  type LeadDetail,
  type QuotaStatus,
} from '../../contracts';
import { errorText, useTeam } from '../common';
import { leadsKey, leadTone, localInput, rewardTone, shortDateTime, whatsappUrl } from './common';

const utmLabel: Record<string, string> = { utm_source: 'Fonte', utm_medium: 'Mídia', utm_campaign: 'Campanha', utm_term: 'Termo', utm_content: 'Conteúdo', gclid: 'Clique Google', fbclid: 'Clique Meta' };

/** Ficha do lead: funil, WhatsApp, retornos, consulta de crédito, histórico e a venda da cota. */
export function LeadPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const canWork = useCan('consortium.leads.work');
  const canManage = useCan('consortium.leads.manage');
  const canSell = useCan('consortium.sell');
  const detailKey = [...leadsKey, 'detail', id];
  const lead = useQuery({ queryKey: detailKey, queryFn: () => api<LeadDetail>(`/consortium/leads/${id}`) });
  const done = (l: LeadDetail) => {
    queryClient.setQueryData(detailKey, l);
    queryClient.invalidateQueries({ queryKey: leadsKey });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<LeadDetail>(`/consortium/leads/${id}/${path}`, { method: 'POST', body: body ?? {} }),
    onSuccess: done,
  });
  const customer = useMutation({
    mutationFn: () => api<{ customerId: string }>(`/consortium/leads/${id}/customer`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadsKey }),
  });
  const [losing, setLosing] = useState(false);
  const [lostReason, setLostReason] = useState(lostReasons[0]!);
  const [otherReason, setOtherReason] = useState('');

  if (lead.isPending) return <Spinner />;
  if (lead.isError) return <Alert>{lead.error.message}</Alert>;
  const l = lead.data;
  const closed = l.status === 'won' || l.status === 'lost';
  const mineOrFree = canManage || !l.seller || l.seller.id === user.id;
  const work = canWork && mineOrFree && !l.anonymized;

  async function sell() {
    const r = l.customerId ? { customerId: l.customerId } : await customer.mutateAsync();
    navigate(`/consorcio/vender?lead=${l.id}&cliente=${r.customerId}`);
  }

  return (
    <>
      <Link to="/consorcio/leads" className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← Leads
      </Link>
      <PageHeader
        title={l.name}
        description={`Lead nº ${l.number} · ${leadSourceLabel[l.source]} · recebido em ${formatDateTime(l.createdAt)}`}
        actions={
          work && (
            <>
              {l.phone && (
                <a href={whatsappUrl(l.phone, l.whatsappText)} target="_blank" rel="noreferrer" onClick={() => act.mutate({ path: 'whatsapp' })}>
                  <Button variant="secondary" type="button">
                    WhatsApp
                  </Button>
                </a>
              )}
              <Button variant="secondary" onClick={() => navigate(`/consorcio/leads/${l.id}/editar`)}>
                Editar
              </Button>
              {canSell && !closed && (
                <Button loading={customer.isPending} onClick={() => sell()}>
                  Vender cota
                </Button>
              )}
            </>
          )
        }
      />
      {(act.error || customer.error) && <Alert>{errorText(act.error ?? customer.error, 'Erro')}</Alert>}
      {l.anonymized && <Alert tone="info">Dados pessoais excluídos (LGPD). O lead fica só para as estatísticas.</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={leadTone[l.status]}>{leadStatusLabel[l.status]}</Badge>
              <span className="text-xs text-fg-muted">desde {shortDateTime(l.statusChangedAt)}</span>
              {l.lostReason && <span className="text-sm">· {l.lostReason}</span>}
            </div>
            {work && l.status !== 'won' && (
              <div className="flex flex-wrap gap-2">
                {openLeadStatuses.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={l.status === s ? 'primary' : 'secondary'}
                    disabled={l.status === s}
                    loading={act.isPending && (act.variables?.body as { status?: string } | undefined)?.status === s}
                    onClick={() => act.mutate({ path: 'status', body: { status: s } })}
                  >
                    {leadStatusLabel[s]}
                  </Button>
                ))}
                {l.status !== 'lost' && (
                  <Button size="sm" variant="ghost" onClick={() => setLosing(!losing)}>
                    Marcar perdido
                  </Button>
                )}
              </div>
            )}
            {losing && (
              <div className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
                <Select aria-label="Motivo" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
                  {lostReasons.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  <option value="other">Outro…</option>
                </Select>
                {lostReason === 'other' ? <Input aria-label="Outro motivo" placeholder="Motivo" value={otherReason} onChange={(e) => setOtherReason(e.target.value)} /> : <span />}
                <Button
                  size="sm"
                  disabled={lostReason === 'other' && !otherReason.trim()}
                  onClick={() => {
                    act.mutate({ path: 'status', body: { status: 'lost', lostReason: lostReason === 'other' ? otherReason.trim() : lostReason } });
                    setLosing(false);
                  }}
                >
                  Confirmar perda
                </Button>
              </div>
            )}
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Item label="Celular">{l.phone ? formatPhone(l.phone) : '—'}</Item>
              <Item label="E-mail">{l.email ?? '—'}</Item>
              <Item label="Cidade">{[l.city, l.state].filter(Boolean).join('/') || '—'}</Item>
              <Item label="Procura">
                {l.creditValue ? `${l.assetType ? leadAssetLabel[l.assetType] : 'consórcio'} · ${formatMoney(l.creditValue)}${l.termMonths ? ` em ${l.termMonths} meses` : ''}` : '—'}
              </Item>
              <Item label="Parcela estimada">{l.estimatedInstallment ? formatMoney(l.estimatedInstallment) : '—'}</Item>
              <Item label="Cliente">
                {l.customerId ? (
                  <Link to={`/clientes/${l.customerId}`} className="text-brand-700 hover:underline">
                    ver cadastro
                  </Link>
                ) : (
                  'ainda não cadastrado'
                )}
              </Item>
            </dl>
            {l.notes && <p className="whitespace-pre-wrap text-sm text-fg-muted">{l.notes}</p>}
            {l.quota && (
              <p className="text-sm">
                Cota{' '}
                <Link to={`/consorcio/cotas/${l.quota.id}`} className="text-brand-700 hover:underline">
                  nº {l.quota.number}
                </Link>{' '}
                · {l.quota.planName} ({l.quota.institution}) · {quotaStatusLabel[l.quota.status as QuotaStatus] ?? l.quota.status}
              </p>
            )}
          </Card>

          {!l.anonymized && (
            <CreditCheckPanel
              defaults={{ subjectName: l.name, customerId: l.customerId, sourceType: 'consortium_lead', sourceId: l.id, purpose: 'consortium_sale' }}
              title="Consulta de crédito (antes da proposta)"
            />
          )}

          <TasksCard lead={l} canWork={work} onChange={done} />
          <HistoryCard lead={l} canWork={work} onChange={done} />
        </div>

        <div className="space-y-4">
          <SellerCard lead={l} canManage={canManage} canWork={canWork} onChange={done} />
          <Card className="space-y-2 p-5 text-sm">
            <h3 className="font-medium">Origem</h3>
            <p>
              {leadSourceLabel[l.source]}
              {l.campaign && ` · ${l.campaign}`}
            </p>
            {Object.entries(l.utm).length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {Object.entries(l.utm).map(([k, v]) => (
                  <Item key={k} label={utmLabel[k] ?? k} inline>
                    {v}
                  </Item>
                ))}
              </dl>
            )}
            {(l.formId || l.adId) && (
              <p className="text-xs text-fg-muted">
                {l.formId && `Formulário ${l.formId}`} {l.adId && `· anúncio ${l.adId}`}
              </p>
            )}
          </Card>
          {l.referrer && <RewardCard lead={l} canManage={canManage} onChange={done} />}
          <Card className="space-y-2 p-5 text-sm">
            <h3 className="font-medium">Base para o contato (LGPD)</h3>
            <p>{contactBasisLabel[l.contactBasis]}</p>
            {l.consent && (
              <>
                <p className="text-xs leading-relaxed text-fg-muted">{l.consent.text}</p>
                <p className="text-xs text-fg-muted">
                  Aceito em {formatDateTime(l.consent.acceptedAt)} (versão {l.consent.version})
                </p>
              </>
            )}
            {canManage && !l.anonymized && <AnonymizeButton id={l.id} onChange={done} />}
          </Card>
        </div>
      </div>
    </>
  );
}

function Item({ label, children, inline }: { label: string; children: ReactNode; inline?: boolean }) {
  return inline ? (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="break-all">{children}</dd>
    </>
  ) : (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function SellerCard({ lead: l, canManage, canWork, onChange }: { lead: LeadDetail; canManage: boolean; canWork: boolean; onChange: (l: LeadDetail) => void }) {
  const team = useTeam();
  const [sellerId, setSellerId] = useState(l.seller?.id ?? '');
  const save = useMutation({
    mutationFn: (path: 'assign' | 'claim') => api<LeadDetail>(`/consortium/leads/${l.id}/${path}`, { method: 'POST', body: path === 'assign' ? { sellerId: sellerId || null } : {} }),
    onSuccess: onChange,
  });
  return (
    <Card className="space-y-2 p-5 text-sm">
      <h3 className="font-medium">Vendedor</h3>
      {save.error && <Alert>{errorText(save.error, 'Erro')}</Alert>}
      <p>{l.seller?.name ?? 'Sem vendedor'}</p>
      {canManage ? (
        <div className="flex gap-2">
          <Select aria-label="Vendedor" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
            <option value="">Sem vendedor</option>
            {team.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" disabled={sellerId === (l.seller?.id ?? '')} loading={save.isPending} onClick={() => save.mutate('assign')}>
            Distribuir
          </Button>
        </div>
      ) : (
        canWork &&
        !l.seller && (
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate('claim')}>
            Assumir este lead
          </Button>
        )
      )}
    </Card>
  );
}

function TasksCard({ lead: l, canWork, onChange }: { lead: LeadDetail; canWork: boolean; onChange: (l: LeadDetail) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: 'Ligar de novo', dueAt: localInput(24) });
  const add = useMutation({
    mutationFn: () => api<LeadDetail>(`/consortium/leads/${l.id}/tasks`, { method: 'POST', body: { title: form.title, dueAt: new Date(form.dueAt).toISOString() } }),
    onSuccess: (r) => {
      onChange(r);
      setForm({ title: 'Ligar de novo', dueAt: localInput(24) });
    },
  });
  const done = useMutation({
    mutationFn: (taskId: string) => api(`/consortium/lead-tasks/${taskId}/done`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadsKey }),
  });
  const open = l.tasks.filter((t) => !t.doneAt);
  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }
  const closed = l.status === 'won' || l.status === 'lost';
  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-medium">Retornos</h3>
      {(add.error || done.error) && <Alert>{errorText(add.error ?? done.error, 'Erro')}</Alert>}
      {l.tasks.length === 0 && <p className="text-sm text-fg-muted">Nenhum retorno agendado.</p>}
      <ul className="divide-y divide-line text-sm">
        {l.tasks.map((t) => {
          const overdue = !t.doneAt && Date.parse(t.dueAt) < Date.now();
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className={cn('tabular-nums', overdue && 'font-medium text-danger-600', t.doneAt && 'text-fg-subtle line-through')}>{shortDateTime(t.dueAt)}</span>
              <span className={cn('flex-1', t.doneAt && 'text-fg-subtle line-through')}>{t.title}</span>
              <span className="text-xs text-fg-muted">{t.assignedTo?.name}</span>
              {canWork && !t.doneAt && (
                <Button size="sm" variant="secondary" loading={done.isPending && done.variables === t.id} onClick={() => done.mutate(t.id)}>
                  Feito
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {canWork && !closed && (
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input aria-label="Retorno" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input aria-label="Quando" type="datetime-local" required value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          <Button type="submit" size="sm" loading={add.isPending}>
            Agendar
          </Button>
        </form>
      )}
      {open.length > 0 && <p className="text-xs text-fg-muted">Os retornos em aberto aparecem em Leads → Retornos.</p>}
    </Card>
  );
}

function HistoryCard({ lead: l, canWork, onChange }: { lead: LeadDetail; canWork: boolean; onChange: (l: LeadDetail) => void }) {
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => api<LeadDetail>(`/consortium/leads/${l.id}/notes`, { method: 'POST', body: { text } }),
    onSuccess: (r) => {
      onChange(r);
      setText('');
    },
  });
  return (
    <Card className="space-y-3 p-5">
      <h3 className="font-medium">Histórico</h3>
      {add.error && <Alert>{errorText(add.error, 'Erro')}</Alert>}
      {canWork && (
        <div className="space-y-2">
          <Textarea aria-label="Anotação" rows={2} placeholder="Anotar o que foi conversado…" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate()}>
            Anotar
          </Button>
        </div>
      )}
      <ul className="space-y-2 text-sm">
        {l.events.map((e) => (
          <li key={e.id} className="border-l-2 border-line pl-3">
            <div className="text-xs text-fg-muted">
              {formatDateTime(e.createdAt)} · {e.user ?? 'sistema'}
            </div>
            <div className={cn(e.kind === 'note' && 'whitespace-pre-wrap')}>{e.text ?? '—'}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RewardCard({ lead: l, canManage, onChange }: { lead: LeadDetail; canManage: boolean; onChange: (l: LeadDetail) => void }) {
  const [amount, setAmount] = useState(l.rewardAmount != null ? String(l.rewardAmount).replace('.', ',') : '');
  const save = useMutation({
    mutationFn: (status: 'due' | 'paid' | 'cancelled') =>
      api<LeadDetail>(`/consortium/leads/${l.id}/reward`, { method: 'POST', body: { status, amount: amount ? Number(amount.replace(/\./g, '').replace(',', '.')) : null } }),
    onSuccess: onChange,
  });
  return (
    <Card className="space-y-2 p-5 text-sm">
      <h3 className="font-medium">Indicação premiada</h3>
      {save.error && <Alert>{errorText(save.error, 'Erro')}</Alert>}
      <p>
        Indicado por <strong>{l.referrer!.name}</strong>
      </p>
      <p>
        Recompensa: <Badge tone={rewardTone[l.rewardStatus]}>{rewardStatusLabel[l.rewardStatus]}</Badge>
        {l.rewardAmount != null && ` ${formatMoney(l.rewardAmount)}`}
      </p>
      {l.rewardStatus === 'due' && <p className="text-xs text-fg-muted">Está no financeiro como despesa a pagar. "Marcar paga" dá baixa nela hoje, na conta padrão; para outra conta ou data, dê baixa em Financeiro.</p>}
      {l.rewardStatus === 'reversed' && <p className="text-xs text-fg-muted">A recompensa já paga virou um valor a receber de quem indicou, no financeiro.</p>}
      {canManage && (l.rewardStatus === 'due' || l.rewardStatus === 'waiting') && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Valor (R$)">{(fid) => <Input id={fid} inputMode="decimal" className="max-w-32" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          {l.rewardStatus === 'due' && (
            <Button size="sm" loading={save.isPending && save.variables === 'paid'} onClick={() => save.mutate('paid')}>
              Marcar paga
            </Button>
          )}
          <Button size="sm" variant="ghost" loading={save.isPending && save.variables === 'cancelled'} onClick={() => save.mutate('cancelled')}>
            Cancelar recompensa
          </Button>
        </div>
      )}
    </Card>
  );
}

function AnonymizeButton({ id, onChange }: { id: string; onChange: (l: LeadDetail) => void }) {
  const [confirming, setConfirming] = useState(false);
  const run = useMutation({ mutationFn: () => api<LeadDetail>(`/consortium/leads/${id}/anonymize`, { method: 'POST' }), onSuccess: onChange });
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Excluir dados pessoais (pedido do titular)
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-danger-600/30 p-3">
      {run.error && <Alert>{errorText(run.error, 'Erro')}</Alert>}
      <p className="text-xs">Nome, telefone, e-mail, cidade e anotações serão apagados. Não dá para desfazer.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" loading={run.isPending} onClick={() => run.mutate()}>
          Excluir dados
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
