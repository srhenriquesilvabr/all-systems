import { ProposalList, useProposals } from '@all/banking/web';
import { api, formatDate, formatDateTime, formatMoney, parseMoney, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  bidStatusLabel,
  bidTypeLabel,
  bidTypes,
  creditStatuses,
  creditStatusLabel,
  installmentStatusLabel,
  quotaStatusLabel,
  type Assembly,
  type Bid,
  type BidType,
  type CreditStatus,
  type CreditUsage,
  type Group,
  type Installment,
  type Quota,
  type QuotaInstallments,
} from '../contracts';
import { RevertForm } from './assemblies';
import { bidTone, creditTone, errorText, installmentTone, key, parsePercent, pct, quotaTone } from './common';

const money = (s: string) => (s.trim() ? parseMoney(s) : null);

/**
 * Adesão em análise: a proposta na administradora. Nas instituições sem API (modo manual), é aqui
 * que a equipe registra a resposta (grupo e cota), e a cota ativa como nas demais.
 */
function AdhesionProposals({ quotaId }: { quotaId: string }) {
  const proposals = useProposals('consortium_quota', quotaId);
  return (
    <div className="mb-4">
      <ProposalList proposals={proposals.data} loading={proposals.isPending} />
    </div>
  );
}

/** Ficha da cota: dados, grupo e as abas de parcelas, lances e crédito. */
export function QuotaPage() {
  const { id = '' } = useParams();
  const canManage = useCan('consortium.manage');
  const [tab, setTab] = useState('installments');
  const [cancelling, setCancelling] = useState(false);
  const [reverting, setReverting] = useState(false);
  const quota = useQuery({ queryKey: [...key, 'quota', id], queryFn: () => api<Quota>(`/consortium/quotas/${id}`) });
  if (quota.isPending) return <Spinner />;
  if (quota.isError) return <Alert>{quota.error.message}</Alert>;
  const q = quota.data;
  return (
    <>
      <PageHeader
        title={`Cota nº ${q.number} — ${q.customer.name}`}
        description={`${q.plan.name} · ${q.plan.institution} · crédito ${formatMoney(q.plan.creditValue)} em ${q.plan.termMonths}x de ${formatMoney(q.plan.installment)}`}
        actions={
          canManage && (
            <>
              {(q.status === 'proposal' || q.status === 'active') && (
                <Button variant="secondary" onClick={() => setCancelling(true)}>
                  Cancelar cota
                </Button>
              )}
              {q.status === 'contemplated' && (
                <Button variant="secondary" onClick={() => setReverting(true)}>
                  Desfazer contemplação
                </Button>
              )}
            </>
          )
        }
      />
      {reverting && (
        <Card className="mb-4 p-4">
          <RevertForm quotaId={q.id} quotaNumber={q.quotaNumber} onClose={() => setReverting(false)} />
        </Card>
      )}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Info label="Situação">
              <Badge tone={quotaTone[q.status]}>{quotaStatusLabel[q.status]}</Badge>
              {q.statusMessage && <div className="text-xs text-fg-muted">{q.statusMessage}</div>}
            </Info>
            <Info label="Grupo / cota">{q.groupCode ? `${q.groupCode} / ${q.quotaNumber}` : '—'}</Info>
            <Info label="Cliente">
              <Link to={`/clientes/${q.customer.id}`} className="text-brand-700 hover:underline">
                {q.customer.name}
              </Link>
            </Info>
            <Info label="Vendedor">{q.sellerName ?? '—'}</Info>
            <Info label="Vencimento">Dia {q.dueDay}</Info>
            <Info label="Ativa desde">{q.activatedAt ? formatDate(q.activatedAt) : '—'}</Info>
            <Info label={`Comissão (${pct(q.commissionPercent)})`}>
              {formatMoney(q.commission)} {q.commissionReversed && <Badge tone="danger">Estornada</Badge>}
            </Info>
            {q.contemplatedOn && (
              <Info label="Contemplada">
                {q.contemplationType === 'draw' ? 'Sorteio' : `Lance ${pct(q.bidPercent ?? 0)}`} em {formatDate(q.contemplatedOn)}
              </Info>
            )}
            {q.cancelledAt && <Info label="Cancelada em">{formatDate(q.cancelledAt)}</Info>}
          </dl>
        </Card>
        <GroupCard quotaId={q.id} hasGroup={!!q.groupCode} />
      </div>
      {q.status === 'proposal' && <AdhesionProposals quotaId={q.id} />}
      <Tabs
        items={[
          { key: 'installments', label: 'Parcelas' },
          { key: 'bids', label: 'Lances' },
          { key: 'credit', label: 'Crédito' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'installments' && <InstallmentsTab quota={q} />}
      {tab === 'bids' && <BidsTab quota={q} />}
      {tab === 'credit' && <CreditTab quota={q} />}
      {cancelling && <CancelModal quota={q} onClose={() => setCancelling(false)} />}
    </>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function GroupCard({ quotaId, hasGroup }: { quotaId: string; hasGroup: boolean }) {
  const group = useQuery({ queryKey: [...key, 'quota', quotaId, 'group'], queryFn: async () => (await api<Group | undefined>(`/consortium/quotas/${quotaId}/group`)) ?? null, enabled: hasGroup });
  return (
    <Card className="p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Grupo</span>
        <Link to="/consorcio/grupos" className="text-xs text-brand-700 hover:underline">
          ver grupos
        </Link>
      </div>
      {!hasGroup ? (
        <p className="text-fg-muted">O grupo chega quando a administradora aceita a adesão.</p>
      ) : group.isPending ? (
        <Spinner />
      ) : group.isError ? (
        <Alert>{group.error.message}</Alert>
      ) : !group.data ? (
        <p className="text-fg-muted">Sem dados do grupo.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Info label="Grupo">
            {group.data.groupCode} · {group.data.institution}
          </Info>
          <Info label="Participantes">{group.data.members ?? '—'}</Info>
          <Info label="Meses restantes">{group.data.monthsRemaining ?? '—'}</Info>
          <Info label="Assembleias lançadas">{group.data.assembliesHeld}</Info>
          <Info label="Lance vencedor médio">
            {group.data.averageWinningBid != null ? `${pct(group.data.averageWinningBid)} (de ${pct(group.data.minWinningBid!)} a ${pct(group.data.maxWinningBid!)})` : '—'}
          </Info>
          <Info label="Próxima assembleia">{group.data.nextAssembly ? formatDate(group.data.nextAssembly.heldOn) : '—'}</Info>
        </dl>
      )}
    </Card>
  );
}

// ---- Parcelas -----------------------------------------------------------------------------------

function InstallmentsTab({ quota }: { quota: Quota }) {
  const canManage = useCan('consortium.manage');
  const canTrack = useCan('consortium.track');
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<Installment | null>(null);
  const [generating, setGenerating] = useState(false);
  const data = useQuery({ queryKey: [...key, 'quota', quota.id, 'installments'], queryFn: () => api<QuotaInstallments>(`/consortium/quotas/${quota.id}/installments`) });
  const unpay = useMutation({
    mutationFn: (id: string) => api(`/consortium/installments/${id}/unpay`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  if (data.isPending) return <Spinner />;
  if (data.isError) return <Alert>{data.error.message}</Alert>;
  const d = data.data;
  const open = quota.status === 'active' || quota.status === 'contemplated';
  return (
    <>
      <Card className="mb-4 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              Parcela {formatMoney(d.monthly)} · dia {d.dueDay}
            </span>
            <span>
              Pagas {d.paidCount} de {d.total} ({formatMoney(d.paidAmount)})
            </span>
            <span className={d.lateCount ? 'font-medium text-danger-700' : ''}>
              Em atraso: {d.lateCount} ({formatMoney(d.lateAmount)})
            </span>
            {d.nextDue && <span>Próxima: {formatDate(d.nextDue.dueOn)}</span>}
          </div>
          {canManage && open && (
            <Button size="sm" variant="secondary" onClick={() => setGenerating(true)}>
              {d.generated ? 'Ajustar calendário' : 'Gerar parcelas'}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-fg-muted">Quem cobra é a administradora: aqui se registra o pagamento informado pelo cliente ou pela administradora, só para acompanhamento (não entra no financeiro).</p>
      </Card>
      {unpay.error && <Alert>{errorText(unpay.error, 'Erro ao desfazer')}</Alert>}
      <Card>
        {!d.items.length ? (
          <EmptyState title="Sem parcelas" description={open ? 'Gere o calendário a partir do primeiro vencimento.' : 'Parcelas só para cotas ativas ou contempladas.'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Vencimento</Th>
                <Th className="text-right">Valor</Th>
                <Th>Situação</Th>
                <Th>Pagamento</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.id}>
                  <Td className="tabular-nums">{i.seq}</Td>
                  <Td>{formatDate(i.dueOn)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.amount)}</Td>
                  <Td>
                    <Badge tone={installmentTone[i.status]}>{installmentStatusLabel[i.status]}</Badge>
                    {i.status === 'late' && <span className="ml-1 text-xs text-danger-700">{i.daysLate} dia(s)</span>}
                    {i.lateNoticeSentAt && <div className="text-xs text-fg-muted">Avisado em {formatDateTime(i.lateNoticeSentAt)}</div>}
                  </Td>
                  <Td>
                    {i.paidOn ? (
                      <>
                        {formatDate(i.paidOn)} · {formatMoney(i.paidAmount ?? i.amount)}
                        {i.notes && <div className="text-xs text-fg-muted">{i.notes}</div>}
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-right">
                    {canTrack && open && !i.paidOn && (
                      <Button size="sm" variant={i.status === 'late' ? 'primary' : 'secondary'} onClick={() => setPaying(i)}>
                        Marcar paga
                      </Button>
                    )}
                    {canTrack && i.paidOn && (
                      <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => unpay.mutate(i.id)}>
                        desfazer
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {paying && <PayModal installment={paying} onClose={() => setPaying(null)} />}
      {generating && <GenerateModal quota={quota} data={d} onClose={() => setGenerating(false)} />}
    </>
  );
}

function PayModal({ installment, onClose }: { installment: Installment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ paidOn: today(), amount: installment.amount.toFixed(2).replace('.', ','), notes: '' });
  const save = useMutation({
    mutationFn: () => api(`/consortium/installments/${installment.id}/pay`, { method: 'POST', body: { paidOn: form.paidOn, amount: money(form.amount), notes: form.notes || null } }),
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
      title={`Parcela ${installment.seq} paga`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="cons-pay-form" loading={save.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="cons-pay-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao registrar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pago em">{(id) => <Input id={id} type="date" required max={today()} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />}</Field>
          <Field label="Valor pago (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}</Field>
        </div>
        <Field label="Observação" hint="Ex.: comprovante enviado pelo cliente por WhatsApp">
          {(id) => <Input id={id} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
        </Field>
      </form>
    </Modal>
  );
}

function GenerateModal({ quota, data, onClose }: { quota: Quota; data: QuotaInstallments; onClose: () => void }) {
  const queryClient = useQueryClient();
  const first = data.items[0];
  const [form, setForm] = useState({
    firstDueOn: first?.dueOn ?? today(),
    count: String(data.total || quota.plan.termMonths),
    amount: (first?.amount ?? data.monthly).toFixed(2).replace('.', ','),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/consortium/quotas/${quota.id}/installments`, { method: 'POST', body: { firstDueOn: form.firstDueOn, count: form.count ? Number(form.count) : null, amount: money(form.amount) } }),
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
      title={data.generated ? 'Ajustar calendário de parcelas' : 'Gerar parcelas'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="cons-generate-form" loading={save.isPending}>
            {data.generated ? 'Refazer calendário' : 'Gerar'}
          </Button>
        </>
      }
    >
      <form id="cons-generate-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao gerar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="1º vencimento" hint="Até o dia 28">
            {(id) => <Input id={id} type="date" required value={form.firstDueOn} onChange={(e) => setForm({ ...form, firstDueOn: e.target.value })} />}
          </Field>
          <Field label="Parcelas">{(id) => <Input id={id} type="number" min={1} max={420} value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />}</Field>
          <Field label="Valor (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}</Field>
        </div>
        <p className="text-xs text-fg-muted">Use quando o calendário da administradora for diferente (ex.: cota de grupo em andamento). Só é possível sem parcelas pagas.</p>
      </form>
    </Modal>
  );
}

// ---- Lances -------------------------------------------------------------------------------------

function BidsTab({ quota }: { quota: Quota }) {
  const canTrack = useCan('consortium.track');
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const bids = useQuery({ queryKey: [...key, 'quota', quota.id, 'bids'], queryFn: () => api<Bid[]>(`/consortium/quotas/${quota.id}/bids`) });
  const done = () => queryClient.invalidateQueries({ queryKey: key });
  const status = useMutation({ mutationFn: (b: { id: string; status: 'registered' | 'sent' }) => api(`/consortium/bids/${b.id}`, { method: 'PATCH', body: { status: b.status } }), onSuccess: done });
  const remove = useMutation({ mutationFn: (id: string) => api(`/consortium/bids/${id}`, { method: 'DELETE' }), onSuccess: done });
  return (
    <>
      {canTrack && quota.status === 'active' && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setAdding(true)}>Registrar lance</Button>
        </div>
      )}
      {(status.error || remove.error) && <Alert>{errorText(status.error ?? remove.error, 'Erro ao salvar')}</Alert>}
      <Card>
        {bids.isPending ? (
          <Spinner />
        ) : bids.isError ? (
          <Alert>{bids.error.message}</Alert>
        ) : !bids.data.length ? (
          <EmptyState title="Nenhum lance" description="Lances são registrados para uma assembleia agendada do grupo da cota." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Assembleia</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Lance</Th>
                <Th>Situação</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {bids.data.map((b) => {
                const open = b.assembly.status === 'scheduled' && (b.status === 'registered' || b.status === 'sent');
                return (
                  <tr key={b.id}>
                    <Td>
                      {formatDate(b.assembly.heldOn)} · grupo {b.assembly.groupCode}
                      {b.notes && <div className="text-xs text-fg-muted">{b.notes}</div>}
                    </Td>
                    <Td>{bidTypeLabel[b.type]}</Td>
                    <Td className="text-right tabular-nums">
                      {pct(b.percent)} · {formatMoney(b.amount)}
                    </Td>
                    <Td>
                      <Badge tone={bidTone[b.status]}>{bidStatusLabel[b.status]}</Badge>
                    </Td>
                    <Td className="space-x-2 text-right">
                      {canTrack && open && (
                        <>
                          <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => status.mutate({ id: b.id, status: b.status === 'sent' ? 'registered' : 'sent' })}>
                            {b.status === 'sent' ? 'voltar a registrado' : 'marcar enviado'}
                          </button>
                          <button type="button" className="text-xs text-danger-700 hover:underline" onClick={() => remove.mutate(b.id)}>
                            excluir
                          </button>
                        </>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {adding && <BidModal quota={quota} onClose={() => setAdding(false)} />}
    </>
  );
}

function BidModal({ quota, onClose }: { quota: Quota; onClose: () => void }) {
  const queryClient = useQueryClient();
  const assemblies = useQuery({
    queryKey: [...key, 'assemblies', 'scheduled', quota.groupCode, quota.plan.connectionId],
    queryFn: () => api<Assembly[]>('/consortium/assemblies', { query: { status: 'scheduled', groupCode: quota.groupCode ?? undefined, connectionId: quota.plan.connectionId } }),
  });
  const installments = useQuery({ queryKey: [...key, 'quota', quota.id, 'installments'], queryFn: () => api<QuotaInstallments>(`/consortium/quotas/${quota.id}/installments`) });
  const [form, setForm] = useState({ assemblyId: '', type: 'free' as BidType, mode: 'percent' as 'percent' | 'amount', value: '', notes: '' });
  const value = form.mode === 'percent' ? parsePercent(form.value) : money(form.value);
  const preview = value ? (form.mode === 'percent' ? `${formatMoney((quota.plan.creditValue * value) / 100)}` : pct((value / quota.plan.creditValue) * 100)) : null;
  const save = useMutation({
    mutationFn: () =>
      api(`/consortium/quotas/${quota.id}/bids`, {
        method: 'POST',
        body: { assemblyId: form.assemblyId, type: form.type, percent: form.mode === 'percent' ? value : null, amount: form.mode === 'amount' ? value : null, notes: form.notes || null },
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
  const options = (assemblies.data ?? []).filter((a) => a.heldOn >= today());
  return (
    <Modal
      open
      title={`Lance — cota ${quota.quotaNumber ?? quota.number}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="cons-bid-form" loading={save.isPending} disabled={!form.assemblyId || !value}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="cons-bid-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao registrar')}</Alert>}
        {assemblies.isSuccess && !options.length && <Alert tone="info">Nenhuma assembleia agendada para o grupo {quota.groupCode}. Agende em Assembleias.</Alert>}
        {!!installments.data?.lateCount && (
          <Alert tone="info">Esta cota tem {installments.data.lateCount} parcela(s) em atraso no acompanhamento. Quem decide se ela concorre é a administradora, pelas regras do grupo: confirme antes de enviar o lance.</Alert>
        )}
        <Field label="Assembleia">
          {(id) => (
            <Select id={id} required value={form.assemblyId} onChange={(e) => setForm({ ...form, assemblyId: e.target.value })}>
              <option value="">Escolha…</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatDate(a.heldOn)} — grupo {a.groupCode}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as BidType })}>
                {bidTypes.map((t) => (
                  <option key={t} value={t}>
                    {bidTypeLabel[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Informar">
            {(id) => (
              <Select id={id} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as 'percent' | 'amount', value: '' })}>
                <option value="percent">Percentual</option>
                <option value="amount">Valor (R$)</option>
              </Select>
            )}
          </Field>
          <Field label={form.mode === 'percent' ? 'Percentual (%)' : 'Valor (R$)'} hint={preview ? `= ${preview}` : undefined}>
            {(id) => <Input id={id} inputMode="decimal" required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />}
          </Field>
        </div>
        {form.type === 'embedded' && <p className="text-xs text-fg-muted">Lance embutido: se vencer, o valor sai do próprio crédito liberado.</p>}
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

// ---- Crédito ------------------------------------------------------------------------------------

function CreditTab({ quota }: { quota: Quota }) {
  const canTrack = useCan('consortium.track');
  const credit = useQuery({
    queryKey: [...key, 'quota', quota.id, 'credit'],
    queryFn: async () => (await api<CreditUsage | undefined>(`/consortium/quotas/${quota.id}/credit`)) ?? null,
    enabled: quota.status === 'contemplated',
  });
  if (quota.status !== 'contemplated') {
    return (
      <Card>
        <EmptyState title="Crédito ainda não disponível" description="O acompanhamento do crédito começa quando a cota é contemplada." />
      </Card>
    );
  }
  if (credit.isPending) return <Spinner />;
  if (credit.isError) return <Alert>{credit.error.message}</Alert>;
  return <CreditForm quota={quota} credit={credit.data} readOnly={!canTrack} />;
}

function CreditForm({ quota, credit, readOnly }: { quota: Quota; credit: CreditUsage | null; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    status: (credit?.status ?? 'awaiting_docs') as CreditStatus,
    amount: (credit?.amount ?? quota.plan.creditValue).toFixed(2).replace('.', ','),
    releasedOn: credit?.releasedOn ?? '',
    assetDescription: credit?.assetDescription ?? '',
    acquiredOn: credit?.acquiredOn ?? '',
    notes: credit?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(`/consortium/quotas/${quota.id}/credit`, {
        method: 'PUT',
        body: {
          status: form.status,
          amount: money(form.amount),
          releasedOn: form.releasedOn || null,
          assetDescription: form.assetDescription || null,
          acquiredOn: form.acquiredOn || null,
          notes: form.notes || null,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2 text-sm">
        <Badge tone={creditTone[credit?.status ?? 'awaiting_docs']}>{creditStatusLabel[credit?.status ?? 'awaiting_docs']}</Badge>
        {credit && <span className="text-fg-muted">Atualizado em {formatDateTime(credit.updatedAt)}</span>}
      </div>
      <form onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
        {save.isSuccess && <Alert tone="success">Crédito atualizado.</Alert>}
        <fieldset disabled={readOnly} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Situação">
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => set({ status: e.target.value as CreditStatus })}>
                  {creditStatuses.map((s) => (
                    <option key={s} value={s}>
                      {creditStatusLabel[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Valor do crédito (R$)" hint="Já descontado o lance embutido, se houver">
              {(id) => <Input id={id} inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />}
            </Field>
            <Field label="Crédito liberado em">{(id) => <Input id={id} type="date" required={form.status !== 'awaiting_docs'} value={form.releasedOn} onChange={(e) => set({ releasedOn: e.target.value })} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Bem adquirido">
                {(id) => <Input id={id} required={form.status === 'acquired'} placeholder="Ex.: VW T-Cross 2024, placa ABC1D23" value={form.assetDescription} onChange={(e) => set({ assetDescription: e.target.value })} />}
              </Field>
            </div>
            <Field label="Adquirido em">{(id) => <Input id={id} type="date" value={form.acquiredOn} onChange={(e) => set({ acquiredOn: e.target.value })} />}</Field>
          </div>
          <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
          {!readOnly && (
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending}>
                Salvar
              </Button>
            </div>
          )}
        </fieldset>
      </form>
    </Card>
  );
}

function CancelModal({ quota, onClose }: { quota: Quota; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/consortium/quotas/${quota.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  return (
    <Modal
      open
      title={`Cancelar cota nº ${quota.number}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()}>
            Cancelar cota
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao cancelar')}</Alert>}
        <Field label="Motivo">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
        {quota.status === 'active' && (
          <p className="text-xs text-fg-muted">Se a cota for cancelada dentro do prazo de estorno (configurado em Comissões), a comissão a receber é cancelada; a já recebida vira despesa de estorno no financeiro.</p>
        )}
      </div>
    </Modal>
  );
}
