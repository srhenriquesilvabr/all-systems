import { api, ApiError, CustomerSearch, formatDate, formatDocument, formatMoney, parseMoney, today, useCan, useSession, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  adjustmentIndexes,
  adjustmentIndexLabel,
  adjustmentStatusLabel,
  extraKindLabel,
  extraKinds,
  guaranteeTypeLabel,
  guaranteeTypes,
  leaseStatuses,
  leaseStatusLabel,
  MAX_DEPOSIT_RENTS,
  payoutStatusLabel,
  receiptStatusLabel,
  type AdjustmentIndex,
  type AdjustmentStatus,
  type ExtraKind,
  type GuaranteeType,
  type Lease,
  type LeaseAdjustment,
  type LeaseDetail,
  type LeaseStatus,
  type OwnerStatement,
  type PayoutStatus,
  type Property,
  type RealEstateSettings,
  type ReceiptStatus,
} from '../contracts';

const key = ['real-estate'] as const;
type Tone = 'brand' | 'warning' | 'success' | 'danger' | 'neutral';
export const leaseTone: Record<LeaseStatus, Tone> = { active: 'success', ended: 'neutral', terminated: 'neutral' };
const receiptTone: Record<ReceiptStatus, Tone> = { pending: 'brand', overdue: 'danger', paid: 'success', cancelled: 'neutral' };
const payoutTone: Record<PayoutStatus, Tone> = { pending: 'warning', paid: 'success', cancelled: 'neutral' };
const adjustmentTone: Record<AdjustmentStatus, Tone> = { pending: 'warning', applied: 'success', skipped: 'neutral' };
const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const monthOf = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const thisMonth = () => today().slice(0, 7);
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

// ---- Lista ----------------------------------------------------------------------------------------

export function LeasesPage() {
  const canWrite = useCan('real_estate.leases.write');
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('active');
  const [ownerId, setOwnerId] = useState('');
  const [renterId, setRenterId] = useState('');
  const [dueThisMonth, setDueThisMonth] = useState(false);
  const [creating, setCreating] = useState(false);
  // Sem filtros: base das listas de proprietários e inquilinos.
  const all = useQuery({ queryKey: [...key, 'leases', {}], queryFn: () => api<Lease[]>('/real-estate/leases') });
  const list = useQuery({
    queryKey: [...key, 'leases', { status, ownerId, renterId, dueThisMonth }],
    queryFn: () =>
      api<Lease[]>('/real-estate/leases', {
        query: { status: status || undefined, ownerId: ownerId || undefined, renterId: renterId || undefined, dueThisMonth: dueThisMonth || undefined },
      }),
  });
  const people = (pick: (l: Lease) => { id: string; name: string }) =>
    [...new Map((all.data ?? []).map((l) => [pick(l).id, pick(l).name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <>
      <PageHeader
        title="Locações"
        description="Contratos de aluguel: cobranças do inquilino, repasses ao proprietário e reajustes."
        actions={
          <>
            <Link to="/imoveis/locacoes/extrato" className="inline-flex items-center rounded-xl border border-line px-4 py-2 text-sm font-medium hover:border-fg">
              Extrato do proprietário
            </Link>
            {canWrite && <Button onClick={() => setCreating(true)}>Novo contrato</Button>}
          </>
        }
      />
      <PendingAdjustments />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label="Situação" className="max-w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          {leaseStatuses.map((s) => (
            <option key={s} value={s}>
              {leaseStatusLabel[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Proprietário" className="max-w-60" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Todos os proprietários</option>
          {people((l) => l.owner).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Select aria-label="Inquilino" className="max-w-60" value={renterId} onChange={(e) => setRenterId(e.target.value)}>
          <option value="">Todos os inquilinos</option>
          {people((l) => l.renter).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Checkbox label="Vencendo neste mês" checked={dueThisMonth} onChange={(e) => setDueThisMonth(e.target.checked)} />
      </div>
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhum contrato" description="Alugue um imóvel pela página dele ou pelo botão Novo contrato." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Imóvel</Th>
                <Th>Inquilino</Th>
                <Th>Proprietário</Th>
                <Th className="text-right">Aluguel</Th>
                <Th>Próximo vencimento</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <Link to={`/imoveis/locacoes/${l.id}`} className="font-medium text-brand-700 hover:underline">
                      nº {l.number}
                    </Link>
                  </Td>
                  <Td>
                    Cód. {l.property.code} · {l.property.title}
                  </Td>
                  <Td>{l.renter.name}</Td>
                  <Td>{l.owner.name}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(l.rent)}</Td>
                  <Td>
                    {l.nextCharge ? (
                      <span className={l.nextCharge.overdue ? 'text-danger-600' : ''}>
                        {formatDate(l.nextCharge.dueDate)} · {formatMoney(l.nextCharge.amount)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <Badge tone={leaseTone[l.status]}>{leaseStatusLabel[l.status]}</Badge>
                    {l.overdueCount > 0 && (
                      <div className="text-xs text-danger-600">
                        {l.overdueCount} aluguel{l.overdueCount > 1 ? 'éis' : ''} atrasado{l.overdueCount > 1 ? 's' : ''}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <LeaseSettingsCard />
      {creating && <LeaseModal property={null} onClose={() => setCreating(false)} onSaved={(l) => navigate(`/imoveis/locacoes/${l.id}`)} />}
    </>
  );
}

function PendingAdjustments() {
  const list = useQuery({ queryKey: [...key, 'adjustments', 'pending'], queryFn: () => api<LeaseAdjustment[]>('/real-estate/leases/adjustments', { query: { status: 'pending' } }) });
  const canWrite = useCan('real_estate.leases.write');
  const [applying, setApplying] = useState<LeaseAdjustment | null>(null);
  if (!list.data?.length) return null;
  return (
    <Card className="mb-4 p-4 text-sm">
      <p className="mb-2 font-medium">Reajustes pendentes</p>
      <ul className="divide-y divide-line">
        {list.data.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span>
              <Link to={`/imoveis/locacoes/${a.leaseId}`} className="text-brand-700 hover:underline">
                Contrato nº {a.lease?.number}
              </Link>{' '}
              · Cód. {a.lease?.propertyCode} — {a.lease?.propertyTitle} · {a.lease?.renterName}
              <span className="block text-xs text-fg-muted">
                {adjustmentIndexLabel[a.index]} · aniversário em {formatDate(a.dueOn)} · aluguel atual {formatMoney(a.lease?.rent ?? a.previousRent)}
              </span>
            </span>
            {canWrite && (
              <Button size="sm" onClick={() => setApplying(a)}>
                Informar reajuste
              </Button>
            )}
          </li>
        ))}
      </ul>
      {applying && <AdjustmentModal adjustment={applying} rent={applying.lease?.rent ?? applying.previousRent} onClose={() => setApplying(null)} />}
    </Card>
  );
}

/** Prazos do repasse, do lembrete e do aviso de reajuste. Só aparece para quem configura a empresa. */
function LeaseSettingsCard() {
  const queryClient = useQueryClient();
  const settingsKey = ['modules', 'real_estate', 'settings'];
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => api<RealEstateSettings>('/modules/real_estate/settings'), retry: false });
  const [form, setForm] = useState<Record<keyof RealEstateSettings, string> | null>(null);
  const save = useMutation({
    mutationFn: (body: RealEstateSettings) => api('/modules/real_estate/settings', { method: 'PUT', body }),
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: settingsKey });
    },
  });
  if (!settings.data) return null;
  const s = settings.data;
  const values = form ?? { payoutDelayDays: String(s.payoutDelayDays), rentReminderDays: String(s.rentReminderDays), adjustmentNoticeDays: String(s.adjustmentNoticeDays) };
  const set = (patch: Partial<typeof values>) => setForm({ ...values, ...patch });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ payoutDelayDays: Number(values.payoutDelayDays), rentReminderDays: Number(values.rentReminderDays), adjustmentNoticeDays: Number(values.adjustmentNoticeDays) });
  }
  return (
    <Card className="mt-6 p-5">
      <form onSubmit={submit} className="space-y-3">
        <p className="font-medium">Configurações da locação</p>
        {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Repasse (dias após o vencimento)" hint="Vale para os próximos lançamentos.">
            {(id) => <Input id={id} type="number" min={0} max={30} value={values.payoutDelayDays} onChange={(e) => set({ payoutDelayDays: e.target.value })} />}
          </Field>
          <Field label="Lembrete ao inquilino (dias antes)" hint="0 = não lembrar.">
            {(id) => <Input id={id} type="number" min={0} max={15} value={values.rentReminderDays} onChange={(e) => set({ rentReminderDays: e.target.value })} />}
          </Field>
          <Field label="Reajuste aparece (dias antes)">
            {(id) => <Input id={id} type="number" min={0} max={90} value={values.adjustmentNoticeDays} onChange={(e) => set({ adjustmentNoticeDays: e.target.value })} />}
          </Field>
        </div>
        {form && (
          <Button type="submit" size="sm" loading={save.isPending}>
            Salvar
          </Button>
        )}
      </form>
    </Card>
  );
}

// ---- Detalhe --------------------------------------------------------------------------------------

export function LeasePage() {
  const { id = '' } = useParams();
  const canWrite = useCan('real_estate.leases.write');
  const lease = useQuery({ queryKey: [...key, 'lease', id], queryFn: () => api<LeaseDetail>(`/real-estate/leases/${id}`) });
  const [modal, setModal] = useState<'terminate' | 'extra' | 'extend' | null>(null);
  const [applying, setApplying] = useState<LeaseAdjustment | null>(null);
  const queryClient = useQueryClient();
  const cancelExtra = useMutation({
    mutationFn: (extraId: string) => api(`/real-estate/leases/${id}/extras/${extraId}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  if (lease.isPending) return <Spinner />;
  if (lease.isError) return <Alert>{lease.error.message}</Alert>;
  const l = lease.data;
  const active = l.status === 'active';
  const charges = l.charges.filter((c) => c.status === 'active');
  return (
    <>
      <PageHeader
        title={`Contrato de locação nº ${l.number}`}
        description={`${l.renter.name} · Cód. ${l.property.code} — ${l.property.title}`}
        actions={
          canWrite && (
            <>
              <Button variant="secondary" onClick={() => setModal('extra')}>
                Cobrança extra
              </Button>
              {active && (
                <>
                  <Button variant="secondary" onClick={() => setModal('extend')}>
                    Prorrogar
                  </Button>
                  <Button variant="ghost" onClick={() => setModal('terminate')}>
                    Encerrar / rescindir
                  </Button>
                </>
              )}
            </>
          )
        }
      />
      {cancelExtra.error && <Alert>{errorText(cancelExtra.error, 'Erro ao cancelar')}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit space-y-2 p-5 text-sm">
          <Badge tone={leaseTone[l.status]}>{leaseStatusLabel[l.status]}</Badge>
          {l.terminatedOn && (
            <p className="text-fg-muted">
              {l.status === 'ended' ? 'Encerrado' : 'Rescindido'} em {formatDate(l.terminatedOn)}
              {l.terminationReason ? ` — ${l.terminationReason}` : ''}
            </p>
          )}
          <p className="text-fg-muted">{l.property.address}</p>
          <Line label="Aluguel vigente" strong>
            {formatMoney(l.rent)}
          </Line>
          {l.initialRent !== l.rent && <Line label="Aluguel inicial">{formatMoney(l.initialRent)}</Line>}
          {l.condoFee > 0 && <Line label="Condomínio">{formatMoney(l.condoFee)}</Line>}
          {l.iptuMonthly > 0 && <Line label="IPTU (mensal)">{formatMoney(l.iptuMonthly)}</Line>}
          <Line label="Vencimento">todo dia {l.dueDay}</Line>
          <Line label="Vigência">
            {formatDate(l.startDate)} a {formatDate(l.endDate)}
          </Line>
          <Line label="Prazo">{l.termMonths} meses</Line>
          <Line label="Reajuste">
            {adjustmentIndexLabel[l.adjustmentIndex]}
            {l.adjustmentIndex === 'fixed' && l.adjustmentPercent != null ? ` ${pct(l.adjustmentPercent)}` : ''}
            {l.adjustmentIndex !== 'none' ? ` · ${months[l.adjustmentMonth - 1]}` : ''}
          </Line>
          <Line label={`Taxa de administração`}>{pct(l.adminFeePercent)}</Line>
          <Line label="Garantia">{guaranteeTypeLabel[l.guaranteeType]}</Line>
          {l.guaranteeAmount != null && <Line label="Valor da garantia">{formatMoney(l.guaranteeAmount)}</Line>}
          {l.guarantorName && (
            <Line label="Fiador">
              {l.guarantorName} {l.guarantorDocument ? `(${formatDocument(l.guarantorDocument)})` : ''}
            </Line>
          )}
          {l.guaranteeProvider && <Line label={l.guaranteeType === 'insurance' ? 'Seguradora' : 'Emissora'}>{l.guaranteeProvider}</Line>}
          {l.guaranteeNumber && <Line label={l.guaranteeType === 'insurance' ? 'Apólice' : 'Título'}>{l.guaranteeNumber}</Line>}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div>
              <div className="text-xs text-fg-muted">Inquilino</div>
              <Link to={`/clientes/${l.renter.id}`} className="font-medium text-brand-700 hover:underline">
                {l.renter.name}
              </Link>
            </div>
            <div>
              <div className="text-xs text-fg-muted">Proprietário</div>
              <Link to={`/clientes/${l.owner.id}`} className="font-medium text-brand-700 hover:underline">
                {l.owner.name}
              </Link>
            </div>
          </div>
          {l.notes && <p className="whitespace-pre-line pt-2 text-fg-muted">{l.notes}</p>}
          <Link to={`/imoveis/${l.property.id}`} className="block pt-2 text-brand-700 hover:underline">
            Ver imóvel
          </Link>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="flex items-center justify-between px-4 pt-4">
              <h2 className="font-medium">Mensalidades</h2>
              <span className="text-xs text-fg-muted">Recebimento e repasse são baixados no financeiro.</span>
            </div>
            {charges.length === 0 ? (
              <EmptyState title="Nenhuma mensalidade lançada" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Mês</Th>
                    <Th>Vencimento</Th>
                    <Th className="text-right">Inquilino paga</Th>
                    <Th>Recebimento</Th>
                    <Th className="text-right">Taxa adm.</Th>
                    <Th className="text-right">Repasse</Th>
                    <Th>Repasse</Th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((c) => (
                    <tr key={c.id}>
                      <Td>{monthOf(c.periodStart)}</Td>
                      <Td>{formatDate(c.dueDate)}</Td>
                      <Td className="text-right tabular-nums">
                        {formatMoney(c.total)}
                        {c.total !== c.rent && <div className="text-xs text-fg-muted">aluguel {formatMoney(c.rent)}</div>}
                      </Td>
                      <Td>
                        <Badge tone={receiptTone[c.receipt]}>{receiptStatusLabel[c.receipt]}</Badge>
                        {c.receivedAt && <div className="text-xs text-fg-muted">{formatDate(c.receivedAt)}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(c.adminFee)}</Td>
                      <Td className="text-right tabular-nums">
                        {formatMoney(c.payout)}
                        <div className="text-xs text-fg-muted">{formatDate(c.payoutDate)}</div>
                      </Td>
                      <Td>{c.payoutStatus ? <Badge tone={payoutTone[c.payoutStatus]}>{payoutStatusLabel[c.payoutStatus]}</Badge> : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card className="p-4 text-sm">
            <h2 className="mb-2 font-medium">Cobranças extras</h2>
            {l.extras.length === 0 ? (
              <p className="text-fg-muted">Nenhuma.</p>
            ) : (
              <ul className="divide-y divide-line">
                {l.extras.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>
                      {e.description} · {formatMoney(e.amount)} · vence {formatDate(e.dueDate)}
                      {e.passToOwner && <span className="text-fg-muted"> · repassada ao proprietário</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={receiptTone[e.receipt]}>{receiptStatusLabel[e.receipt]}</Badge>
                      {canWrite && e.status === 'active' && e.receipt !== 'paid' && (
                        <Button size="sm" variant="ghost" loading={cancelExtra.isPending && cancelExtra.variables === e.id} onClick={() => cancelExtra.mutate(e.id)}>
                          Cancelar
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4 text-sm">
            <h2 className="mb-2 font-medium">Reajustes</h2>
            {l.adjustments.length === 0 ? (
              <p className="text-fg-muted">{l.adjustmentIndex === 'none' ? 'Contrato sem reajuste.' : 'Nenhum ainda. O reajuste aparece aqui perto do aniversário do contrato.'}</p>
            ) : (
              <ul className="divide-y divide-line">
                {l.adjustments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>
                      {formatDate(a.dueOn)} · {adjustmentIndexLabel[a.index]}
                      {a.status === 'applied' && a.percent != null && a.newRent != null && (
                        <>
                          {' '}
                          {pct(a.percent)} · {formatMoney(a.previousRent)} → {formatMoney(a.newRent)}
                        </>
                      )}
                      {a.notes && <span className="block text-xs text-fg-muted">{a.notes}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={adjustmentTone[a.status]}>{adjustmentStatusLabel[a.status]}</Badge>
                      {canWrite && active && a.status === 'pending' && (
                        <Button size="sm" onClick={() => setApplying(a)}>
                          Informar reajuste
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {modal === 'terminate' && <TerminateModal lease={l} onClose={() => setModal(null)} />}
      {modal === 'extra' && <ExtraModal lease={l} onClose={() => setModal(null)} />}
      {modal === 'extend' && <ExtendModal lease={l} onClose={() => setModal(null)} />}
      {applying && <AdjustmentModal adjustment={applying} rent={l.rent} fixedPercent={l.adjustmentIndex === 'fixed' ? l.adjustmentPercent : null} onClose={() => setApplying(null)} />}
    </>
  );
}

function Line({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-medium' : ''}`}>
      <span className={strong ? '' : 'text-fg-muted'}>{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

function AdjustmentModal({ adjustment, rent, fixedPercent, onClose }: { adjustment: LeaseAdjustment; rent: number; fixedPercent?: number | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [percent, setPercent] = useState(fixedPercent != null ? String(fixedPercent).replace('.', ',') : '');
  const [skipping, setSkipping] = useState(false);
  const [notes, setNotes] = useState('');
  const value = parseMoney(percent);
  const done = () => {
    queryClient.invalidateQueries({ queryKey: key });
    onClose();
  };
  const apply = useMutation({ mutationFn: () => api(`/real-estate/leases/adjustments/${adjustment.id}/apply`, { method: 'POST', body: { percent: value } }), onSuccess: done });
  const skip = useMutation({ mutationFn: () => api(`/real-estate/leases/adjustments/${adjustment.id}/skip`, { method: 'POST', body: { notes: notes.trim() || null } }), onSuccess: done });
  const error = apply.error ?? skip.error;
  return (
    <Modal
      open
      title={`Reajuste de ${formatDate(adjustment.dueOn)}`}
      onClose={onClose}
      footer={
        skipping ? (
          <>
            <Button variant="secondary" onClick={() => setSkipping(false)}>
              Voltar
            </Button>
            <Button variant="danger" loading={skip.isPending} onClick={() => skip.mutate()}>
              Não reajustar
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setSkipping(true)}>
              Não reajustar este ano
            </Button>
            <Button disabled={Number.isNaN(value)} loading={apply.isPending} onClick={() => apply.mutate()}>
              Aplicar reajuste
            </Button>
          </>
        )
      }
    >
      {error && <Alert>{errorText(error, 'Erro ao salvar')}</Alert>}
      {skipping ? (
        <Field label="Motivo (opcional)" hint="Ex.: negociado com o inquilino. O aluguel continua o mesmo.">
          {(id) => <Input id={id} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />}
        </Field>
      ) : (
        <div className="space-y-3 text-sm">
          <Field label={`Variação do ${adjustmentIndexLabel[adjustment.index]} no período (%)`} hint="Use o acumulado dos últimos 12 meses. Pode ser negativo.">
            {(id) => <Input id={id} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} autoFocus />}
          </Field>
          <p className="text-fg-muted">
            Aluguel atual {formatMoney(rent)}
            {!Number.isNaN(value) && <> → novo {formatMoney(Math.round(rent * (1 + value / 100) * 100) / 100)}</>}. As mensalidades a partir de {formatDate(adjustment.dueOn)} ainda em
            aberto são recalculadas e o inquilino é avisado.
          </p>
        </div>
      )}
    </Modal>
  );
}

function TerminateModal({ lease, onClose }: { lease: LeaseDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [fine, setFine] = useState('');
  const [finePass, setFinePass] = useState(true);
  const early = date < lease.endDate;
  const save = useMutation({
    mutationFn: () =>
      api(`/real-estate/leases/${lease.id}/terminate`, {
        method: 'POST',
        body: { date, reason: reason.trim() || null, fine: fine ? { amount: parseMoney(fine), passToOwner: finePass } : null },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  return (
    <Modal
      open
      title={early ? 'Rescindir contrato' : 'Encerrar contrato'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" disabled={!date || (early && reason.trim().length < 3)} loading={save.isPending} onClick={() => save.mutate()}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {save.error && <Alert>{errorText(save.error, 'Erro ao encerrar')}</Alert>}
        <Field label="Entrega das chaves" hint={`Fim do prazo: ${formatDate(lease.endDate)}.`}>
          {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label={early ? 'Motivo da rescisão' : 'Observação (opcional)'}>{(id) => <Textarea id={id} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {early && (
          <>
            <Field label="Multa rescisória (R$, opcional)">{(id) => <Input id={id} inputMode="decimal" value={fine} onChange={(e) => setFine(e.target.value)} />}</Field>
            {fine && <Checkbox label="Repassar a multa ao proprietário" checked={finePass} onChange={(e) => setFinePass(e.target.checked)} />}
          </>
        )}
        <p className="text-fg-muted">
          Mensalidades dos meses seguintes ainda em aberto são canceladas; o mês da entrega é cobrado pelos dias de uso. O imóvel volta a ficar disponível.
        </p>
      </div>
    </Modal>
  );
}

function ExtraModal({ lease, onClose }: { lease: LeaseDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const nextDue = lease.charges.find((c) => c.status === 'active' && c.receipt !== 'paid')?.dueDate ?? today();
  const [form, setForm] = useState({ kind: 'fine' as ExtraKind, description: '', amount: '', dueDate: nextDue, passToOwner: false });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(`/real-estate/leases/${lease.id}/extras`, {
        method: 'POST',
        body: { kind: form.kind, description: form.description.trim() || null, amount: parseMoney(form.amount), dueDate: form.dueDate, passToOwner: form.passToOwner },
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
      title="Cobrança extra ao inquilino"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="re-extra-form" loading={save.isPending}>
            Lançar
          </Button>
        </>
      }
    >
      <form id="re-extra-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao lançar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={form.kind} onChange={(e) => set({ kind: e.target.value as ExtraKind, passToOwner: e.target.value === 'condo' || e.target.value === 'iptu' })}>
                {extraKinds.map((k) => (
                  <option key={k} value={k}>
                    {extraKindLabel[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Valor (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.amount} onChange={(e) => set({ amount: e.target.value })} />}</Field>
          <Field label="Descrição (opcional)">{(id) => <Input id={id} maxLength={150} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={extraKindLabel[form.kind]} />}</Field>
          <Field label="Vencimento">{(id) => <Input id={id} type="date" required value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />}</Field>
        </div>
        <Checkbox label="Repassar o valor ao proprietário" checked={form.passToOwner} onChange={(e) => set({ passToOwner: e.target.checked })} />
      </form>
    </Modal>
  );
}

function ExtendModal({ lease, onClose }: { lease: LeaseDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [monthsToAdd, setMonthsToAdd] = useState('12');
  const save = useMutation({
    mutationFn: () => api(`/real-estate/leases/${lease.id}/extend`, { method: 'POST', body: { months: Number(monthsToAdd) } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Prorrogar contrato"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button disabled={!(Number(monthsToAdd) > 0)} loading={save.isPending} onClick={() => save.mutate()}>
            Prorrogar
          </Button>
        </>
      }
    >
      {save.error && <Alert>{errorText(save.error, 'Erro ao prorrogar')}</Alert>}
      <Field label="Meses a mais" hint={`Hoje o contrato vai até ${formatDate(lease.endDate)}.`}>
        {(id) => <Input id={id} type="number" min={1} max={120} value={monthsToAdd} onChange={(e) => setMonthsToAdd(e.target.value)} autoFocus />}
      </Field>
    </Modal>
  );
}

// ---- Novo contrato --------------------------------------------------------------------------------

/** Novo contrato: da página do imóvel (imóvel já escolhido) ou da lista de locações. */
export function LeaseModal({ property, onClose, onSaved }: { property: Property | null; onClose: () => void; onSaved?: (l: LeaseDetail) => void }) {
  const queryClient = useQueryClient();
  const [propertyId, setPropertyId] = useState(property?.id ?? '');
  const [renter, setRenter] = useState<CustomerOption | null>(null);
  const available = useQuery({
    queryKey: [...key, 'properties', 'for-rent'],
    queryFn: () => api<Property[]>('/real-estate/properties', { query: { status: 'available' } }),
    enabled: !property,
  });
  const options = (available.data ?? []).filter((p) => p.purpose !== 'sale');
  const chosen = property ?? options.find((p) => p.id === propertyId) ?? null;
  const money = (n: number | null | undefined) => (n ? n.toFixed(2).replace('.', ',') : '');
  const [form, setForm] = useState({
    startDate: today(),
    termMonths: '30',
    rent: money(property?.rentPrice),
    dueDay: '10',
    condoFee: '',
    iptuMonthly: '',
    adjustmentIndex: 'igpm' as AdjustmentIndex,
    adjustmentPercent: '',
    adjustmentMonth: '',
    guaranteeType: 'none' as GuaranteeType,
    guaranteeAmount: '',
    guarantorName: '',
    guarantorDocument: '',
    guaranteeProvider: '',
    guaranteeNumber: '',
    adminFeePercent: '10',
    notes: '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const pickProperty = (id: string) => {
    setPropertyId(id);
    const p = options.find((x) => x.id === id);
    if (p) setForm({ ...form, rent: money(p.rentPrice), condoFee: money(p.condoFee) });
  };
  const m = (v: string) => (v ? parseMoney(v) : 0);
  const dec = (v: string) => (v ? Number(v.replace(',', '.')) : null);
  const rent = m(form.rent) || 0;
  const fee = Math.round(rent * (dec(form.adminFeePercent) ?? 0)) / 100;
  const save = useMutation({
    mutationFn: () =>
      api<LeaseDetail>('/real-estate/leases', {
        method: 'POST',
        body: {
          propertyId: chosen?.id,
          renterId: renter?.id,
          startDate: form.startDate,
          termMonths: Number(form.termMonths),
          rent,
          dueDay: Number(form.dueDay),
          condoFee: m(form.condoFee),
          iptuMonthly: m(form.iptuMonthly),
          adjustmentIndex: form.adjustmentIndex,
          adjustmentPercent: form.adjustmentIndex === 'fixed' ? dec(form.adjustmentPercent) : null,
          adjustmentMonth: form.adjustmentMonth ? Number(form.adjustmentMonth) : null,
          guaranteeType: form.guaranteeType,
          guaranteeAmount: form.guaranteeAmount ? m(form.guaranteeAmount) : null,
          guarantorName: form.guarantorName || null,
          guarantorDocument: form.guarantorDocument || null,
          guaranteeProvider: form.guaranteeProvider || null,
          guaranteeNumber: form.guaranteeNumber || null,
          adminFeePercent: dec(form.adminFeePercent) ?? 0,
          notes: form.notes || null,
        },
      }),
    onSuccess: (l) => {
      queryClient.invalidateQueries({ queryKey: key });
      onSaved?.(l);
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  const g = form.guaranteeType;
  return (
    <Modal
      open
      title="Novo contrato de locação"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="re-lease-form" loading={save.isPending} disabled={!renter || !chosen}>
            Assinar contrato
          </Button>
        </>
      }
    >
      {!renter ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">Quem é o inquilino?</p>
          <CustomerSearch onSelect={setRenter} />
        </div>
      ) : (
        <form id="re-lease-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
          <p className="text-sm">
            Inquilino: <span className="font-medium">{renter.name}</span>
            {chosen && (
              <>
                {' '}
                · Proprietário: <span className="font-medium">{chosen.owner.name}</span>
              </>
            )}
          </p>
          {!property && (
            <Field label="Imóvel" hint="Imóveis disponíveis para locação.">
              {(id) => (
                <Select id={id} required value={propertyId} onChange={(e) => pickProperty(e.target.value)}>
                  <option value="">{available.isPending ? 'Carregando…' : 'Escolha o imóvel'}</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      Cód. {p.code} — {p.title} ({p.district})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Início">{(id) => <Input id={id} type="date" required value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />}</Field>
            <Field label="Prazo (meses)">{(id) => <Input id={id} type="number" min={1} max={240} required value={form.termMonths} onChange={(e) => set({ termMonths: e.target.value })} />}</Field>
            <Field label="Dia do vencimento">{(id) => <Input id={id} type="number" min={1} max={31} required value={form.dueDay} onChange={(e) => set({ dueDay: e.target.value })} />}</Field>
            <Field label="Aluguel (R$/mês)">{(id) => <Input id={id} inputMode="decimal" required value={form.rent} onChange={(e) => set({ rent: e.target.value })} />}</Field>
            <Field label="Condomínio (R$/mês)" hint="Repassado ao proprietário.">
              {(id) => <Input id={id} inputMode="decimal" value={form.condoFee} onChange={(e) => set({ condoFee: e.target.value })} />}
            </Field>
            <Field label="IPTU (R$/mês)" hint="Repassado ao proprietário.">
              {(id) => <Input id={id} inputMode="decimal" value={form.iptuMonthly} onChange={(e) => set({ iptuMonthly: e.target.value })} />}
            </Field>
            <Field label="Taxa de administração (%)" hint={rent > 0 ? `${formatMoney(fee)} por mês; repasse ${formatMoney(rent - fee)} + condomínio e IPTU.` : undefined}>
              {(id) => <Input id={id} inputMode="decimal" value={form.adminFeePercent} onChange={(e) => set({ adminFeePercent: e.target.value })} />}
            </Field>
            <Field label="Índice de reajuste">
              {(id) => (
                <Select id={id} value={form.adjustmentIndex} onChange={(e) => set({ adjustmentIndex: e.target.value as AdjustmentIndex })}>
                  {adjustmentIndexes.map((i) => (
                    <option key={i} value={i}>
                      {adjustmentIndexLabel[i]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {form.adjustmentIndex === 'fixed' && (
              <Field label="Reajuste anual (%)">{(id) => <Input id={id} inputMode="decimal" required value={form.adjustmentPercent} onChange={(e) => set({ adjustmentPercent: e.target.value })} />}</Field>
            )}
            {form.adjustmentIndex !== 'none' && (
              <Field label="Mês do aniversário">
                {(id) => (
                  <Select id={id} value={form.adjustmentMonth} onChange={(e) => set({ adjustmentMonth: e.target.value })}>
                    <option value="">Mês do início</option>
                    {months.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Garantia">
              {(id) => (
                <Select id={id} value={g} onChange={(e) => set({ guaranteeType: e.target.value as GuaranteeType })}>
                  {guaranteeTypes.map((t) => (
                    <option key={t} value={t}>
                      {guaranteeTypeLabel[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {(g === 'deposit' || g === 'capitalization') && (
              <Field label={g === 'deposit' ? 'Valor da caução (R$)' : 'Valor do título (R$)'} hint={g === 'deposit' ? `Até ${MAX_DEPOSIT_RENTS} aluguéis.` : undefined}>
                {(id) => <Input id={id} inputMode="decimal" required={g === 'deposit'} value={form.guaranteeAmount} onChange={(e) => set({ guaranteeAmount: e.target.value })} />}
              </Field>
            )}
            {g === 'guarantor' && (
              <>
                <Field label="Nome do fiador">{(id) => <Input id={id} required value={form.guarantorName} onChange={(e) => set({ guarantorName: e.target.value })} />}</Field>
                <Field label="CPF do fiador">{(id) => <Input id={id} required inputMode="numeric" value={form.guarantorDocument} onChange={(e) => set({ guarantorDocument: e.target.value })} />}</Field>
              </>
            )}
            {(g === 'insurance' || g === 'capitalization') && (
              <>
                <Field label={g === 'insurance' ? 'Seguradora' : 'Emissora'}>
                  {(id) => <Input id={id} required={g === 'insurance'} value={form.guaranteeProvider} onChange={(e) => set({ guaranteeProvider: e.target.value })} />}
                </Field>
                <Field label={g === 'insurance' ? 'Nº da apólice' : 'Nº do título'}>{(id) => <Input id={id} required value={form.guaranteeNumber} onChange={(e) => set({ guaranteeNumber: e.target.value })} />}</Field>
              </>
            )}
          </div>
          <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
          <p className="text-sm text-fg-muted">
            Ao assinar, o imóvel fica "Alugado" e as mensalidades dos próximos 12 meses entram no financeiro: o aluguel a receber do inquilino e o repasse a pagar ao proprietário.
          </p>
        </form>
      )}
    </Modal>
  );
}

// ---- Extrato do proprietário ----------------------------------------------------------------------

export function OwnerStatementPage() {
  const { tenant } = useSession();
  const [params, setParams] = useSearchParams();
  const ownerId = params.get('owner') ?? '';
  const month = params.get('month') ?? thisMonth();
  const update = (patch: Record<string, string>) => setParams({ owner: ownerId, month, ...patch }, { replace: true });
  const leases = useQuery({ queryKey: [...key, 'leases', {}], queryFn: () => api<Lease[]>('/real-estate/leases') });
  const owners = [...new Map((leases.data ?? []).map((l) => [l.owner.id, l.owner.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const statement = useQuery({
    queryKey: [...key, 'statement', ownerId, month],
    queryFn: () => api<OwnerStatement>('/real-estate/leases/statement', { query: { ownerId, month } }),
    enabled: !!ownerId,
  });
  const s = statement.data;
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Extrato do proprietário"
          description="Aluguéis e cobranças repassadas que vencem no mês: o que foi recebido, a taxa de administração e o repasse."
          actions={
            s && (
              <Button variant="secondary" onClick={() => window.print()}>
                Imprimir
              </Button>
            )
          }
        />
        <div className="mb-4 flex flex-wrap gap-3">
          <Select aria-label="Proprietário" className="max-w-72" value={ownerId} onChange={(e) => update({ owner: e.target.value })}>
            <option value="">{leases.isPending ? 'Carregando…' : 'Escolha o proprietário'}</option>
            {owners.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <Input aria-label="Mês" type="month" className="max-w-44" value={month} onChange={(e) => e.target.value && update({ month: e.target.value })} />
        </div>
      </div>
      {!ownerId ? (
        <Card className="print:hidden">
          <EmptyState title="Escolha o proprietário" />
        </Card>
      ) : statement.isPending ? (
        <Spinner />
      ) : statement.isError ? (
        <Alert>{statement.error.message}</Alert>
      ) : (
        s && (
          <Card className="p-5 text-sm print:border-0 print:p-0 print:text-black">
            <div className="mb-4">
              <p className="font-display text-lg font-semibold">{tenant.name}</p>
              <p>
                Extrato de {months[Number(month.slice(5, 7)) - 1]?.toLowerCase()} de {month.slice(0, 4)} · {s.owner.name}
                {s.owner.document ? ` · ${formatDocument(s.owner.document)}` : ''}
              </p>
            </div>
            {s.lines.length === 0 ? (
              <p className="text-fg-muted">Nada vence neste mês.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Contrato / imóvel</Th>
                    <Th>Inquilino</Th>
                    <Th>Descrição</Th>
                    <Th>Vencimento</Th>
                    <Th className="text-right">Valor</Th>
                    <Th>Recebimento</Th>
                    <Th className="text-right">Taxa adm.</Th>
                    <Th className="text-right">Repasse</Th>
                    <Th>Situação do repasse</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l, i) => (
                    <tr key={`${l.leaseId}-${i}`}>
                      <Td>
                        nº {l.leaseNumber} · Cód. {l.propertyCode}
                        <div className="text-xs text-fg-muted">{l.propertyTitle}</div>
                      </Td>
                      <Td>{l.renterName}</Td>
                      <Td>{l.description}</Td>
                      <Td>{formatDate(l.dueDate)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(l.amount)}</Td>
                      <Td>
                        {receiptStatusLabel[l.receipt]}
                        {l.receivedAt && <div className="text-xs text-fg-muted">{formatDate(l.receivedAt)}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(l.adminFee)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(l.payout)}</Td>
                      <Td>
                        {l.payoutStatus ? payoutStatusLabel[l.payoutStatus] : '—'}
                        <div className="text-xs text-fg-muted">{formatDate(l.payoutPaidAt ?? l.payoutDate)}</div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <dl className="mt-4 grid max-w-md gap-1">
              <Line label="Total cobrado dos inquilinos">{formatMoney(s.totals.charged)}</Line>
              <Line label="Recebido">{formatMoney(s.totals.received)}</Line>
              <Line label="Taxa de administração">{formatMoney(s.totals.adminFee)}</Line>
              <Line label="Repasse do mês" strong>
                {formatMoney(s.totals.payout)}
              </Line>
              <Line label="Já repassado">{formatMoney(s.totals.payoutPaid)}</Line>
            </dl>
          </Card>
        )
      )}
    </>
  );
}

// ---- Imóvel e cliente -----------------------------------------------------------------------------

/** Contratos de locação na página do imóvel. */
export function PropertyLeases({ propertyId }: { propertyId: string }) {
  const can = useCan('real_estate.leases.read');
  const list = useQuery({ queryKey: [...key, 'leases', { propertyId }], queryFn: () => api<Lease[]>('/real-estate/leases', { query: { propertyId } }), enabled: can });
  if (!can || !list.data?.length) return null;
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-medium">Locações</h2>
      <LeaseItems leases={list.data} show="renter" />
    </Card>
  );
}

function LeaseItems({ leases, show }: { leases: Lease[]; show: 'renter' | 'property' }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {leases.map((l) => (
        <li key={l.id} className="flex justify-between gap-3 py-2">
          <Link to={`/imoveis/locacoes/${l.id}`} className="text-brand-700 hover:underline">
            nº {l.number} · {show === 'renter' ? l.renter.name : l.property.title} · {formatMoney(l.rent)}/mês
          </Link>
          <Badge tone={leaseTone[l.status]}>{leaseStatusLabel[l.status]}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** Aba "Locações" na ficha do cliente: contratos como inquilino ou proprietário. */
export function CustomerLeasesTab({ customerId }: { customerId: string }) {
  const list = useQuery({ queryKey: [...key, 'leases', { customerId }], queryFn: () => api<Lease[]>('/real-estate/leases', { query: { customerId } }) });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  return <Card className="px-4">{list.data.length === 0 ? <EmptyState title="Nenhum contrato de locação" /> : <LeaseItems leases={list.data} show="property" />}</Card>;
}
