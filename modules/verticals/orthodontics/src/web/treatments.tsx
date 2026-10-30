import { MedicalRecordTimeline } from '@all/medical-records/web';
import { api, ApiError, CustomerSearch, formatDate, formatMoney, parseMoney, today, useCan, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { applianceLabel, appliances, treatmentStatusLabel, type Treatment, type TreatmentDetail, type TreatmentStatus } from '../contracts';

const key = ['orthodontics'] as const;
const tone: Record<TreatmentStatus, 'brand' | 'success' | 'neutral'> = { active: 'brand', finished: 'success', cancelled: 'neutral' };
const installmentTone = { pending: 'warning', paid: 'success', cancelled: 'neutral' } as const;
const installmentLabel = { pending: 'Em aberto', paid: 'Paga', cancelled: 'Cancelada' } as const;

function useTreatments(query: { customerId?: string; status?: string }) {
  return useQuery({ queryKey: [...key, 'list', query], queryFn: () => api<Treatment[]>('/orthodontics/treatments', { query }) });
}

export function TreatmentsPage() {
  const [status, setStatus] = useState('active');
  const list = useTreatments({ status: status || undefined });
  const canManage = useCan('orthodontics.treatments.manage');
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Tratamentos"
        description="Cada tratamento lança as mensalidades no financeiro. Manutenções de quem está em tratamento saem sem custo na agenda."
        actions={
          <>
            <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Em tratamento</option>
              <option value="finished">Concluídos</option>
              <option value="cancelled">Cancelados</option>
              <option value="">Todos</option>
            </Select>
            {canManage && <Button onClick={() => setStarting(true)}>Iniciar tratamento</Button>}
          </>
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
          <EmptyState title="Nenhum tratamento" />
        ) : (
          <TreatmentsTable treatments={list.data} onOpen={setOpenId} showPatient />
        )}
      </Card>
      {starting && <StartModal onClose={() => setStarting(false)} onStarted={setOpenId} />}
      {openId && <TreatmentModal id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function TreatmentsTable({ treatments, onOpen, showPatient }: { treatments: Treatment[]; onOpen: (id: string) => void; showPatient?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          {showPatient && <Th>Paciente</Th>}
          <Th>Aparelho</Th>
          <Th>Início</Th>
          <Th>Mensalidades</Th>
          <Th className="text-right">Em atraso</Th>
          <Th>Situação</Th>
        </tr>
      </thead>
      <tbody>
        {treatments.map((t) => (
          <tr key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onOpen(t.id)}>
            {showPatient && (
              <Td>
                <Link to={`/clientes/${t.customer.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                  {t.customer.name}
                </Link>
              </Td>
            )}
            <Td>{applianceLabel[t.appliance]}</Td>
            <Td className="whitespace-nowrap tabular-nums">{formatDate(t.startedOn)}</Td>
            <Td className="whitespace-nowrap tabular-nums">
              {t.paidInstallments}/{t.totalInstallments} pagas · {formatMoney(t.monthlyFee)}
            </Td>
            <Td className="text-right tabular-nums">{t.overdueAmount > 0 ? <span className="font-medium text-danger-600">{formatMoney(t.overdueAmount)}</span> : '—'}</Td>
            <Td>
              <Badge tone={tone[t.status]}>{treatmentStatusLabel[t.status]}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function StartModal({ customer: fixed, onClose, onStarted }: { customer?: { id: string }; onClose: () => void; onStarted: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<CustomerOption | { id: string; name?: string } | null>(fixed ?? null);
  const [form, setForm] = useState({ appliance: 'fixed_metal', startedOn: today(), expectedMonths: '24', entryFee: '', monthlyFee: '', dueDay: '10', notes: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: (confirmInstallationCharged: boolean) =>
      api<TreatmentDetail>('/orthodontics/treatments', {
        method: 'POST',
        body: { ...form, customerId: customer?.id, entryFee: form.entryFee ? parseMoney(form.entryFee) : 0, monthlyFee: parseMoney(form.monthlyFee), notes: form.notes || null, confirmInstallationCharged: confirmInstallationCharged || undefined },
      }),
    onSuccess: (t) => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
      onStarted(t.id);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(false);
  }
  const alreadyCharged = save.error instanceof ApiError && save.error.code === 'INSTALLATION_ALREADY_CHARGED';

  return (
    <Modal
      open
      title="Iniciar tratamento"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="ortho-start-form" loading={save.isPending} disabled={!customer}>
            Iniciar
          </Button>
        </>
      }
    >
      {!customer ? (
        <CustomerSearch onSelect={setCustomer} />
      ) : (
        <form id="ortho-start-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          {alreadyCharged && (
            <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate(true)}>
              Lançar a taxa mesmo assim
            </Button>
          )}
          {'name' in customer && customer.name && (
            <p className="text-sm">
              Paciente: <span className="font-medium">{customer.name}</span>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Aparelho">
              {(id) => (
                <Select id={id} value={form.appliance} onChange={(e) => set({ appliance: e.target.value })}>
                  {appliances.map((a) => (
                    <option key={a} value={a}>
                      {applianceLabel[a]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Início">{(id) => <Input id={id} type="date" required value={form.startedOn} onChange={(e) => set({ startedOn: e.target.value })} />}</Field>
            <Field label="Duração prevista (meses)">{(id) => <Input id={id} type="number" min={1} max={60} required value={form.expectedMonths} onChange={(e) => set({ expectedMonths: e.target.value })} />}</Field>
            <Field label="Dia do vencimento">{(id) => <Input id={id} type="number" min={1} max={28} required value={form.dueDay} onChange={(e) => set({ dueDay: e.target.value })} />}</Field>
            <Field label="Mensalidade (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.monthlyFee} onChange={(e) => set({ monthlyFee: e.target.value })} placeholder="0,00" />}</Field>
            <Field label="Documentação e instalação (R$)" hint="Cobrada na data de início. Com valor aqui, o serviço Instalação de aparelho sai sem custo na agenda.">
              {(id) => <Input id={id} inputMode="decimal" value={form.entryFee} onChange={(e) => set({ entryFee: e.target.value })} placeholder="0,00" />}
            </Field>
          </div>
          <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        </form>
      )}
    </Modal>
  );
}

function TreatmentModal({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const canManage = useCan('orthodontics.treatments.manage');
  const detail = useQuery({ queryKey: [...key, id], queryFn: () => api<TreatmentDetail>(`/orthodontics/treatments/${id}`) });
  const [action, setAction] = useState<'extend' | 'finish' | 'cancel' | null>(null);
  const [months, setMonths] = useState('6');
  const [cancelFuture, setCancelFuture] = useState(true);
  const [reason, setReason] = useState('');
  const [closedOn, setClosedOn] = useState(today());
  const run = useMutation({
    mutationFn: () =>
      action === 'extend'
        ? api(`/orthodontics/treatments/${id}/extend`, { method: 'POST', body: { months: Number(months) } })
        : action === 'finish'
          ? api(`/orthodontics/treatments/${id}/finish`, { method: 'POST', body: { cancelFutureInstallments: cancelFuture, finishedOn: closedOn } })
          : api(`/orthodontics/treatments/${id}/cancel`, { method: 'POST', body: { reason, cancelledOn: closedOn } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      setAction(null);
    },
  });

  const t = detail.data;
  return (
    <Modal open title={t ? `${t.customer.name} — ${applianceLabel[t.appliance]}` : 'Tratamento'} onClose={onClose}>
      {detail.isPending ? (
        <Spinner />
      ) : detail.isError ? (
        <Alert>{detail.error.message}</Alert>
      ) : (
        t && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={tone[t.status]}>{treatmentStatusLabel[t.status]}</Badge>
              <span className="text-fg-muted">
                Início {formatDate(t.startedOn)} · {t.expectedMonths} meses · vence todo dia {t.dueDay}
                {t.finishedOn && ` · encerrado em ${formatDate(t.finishedOn)}`}
              </span>
            </div>
            {t.cancelReason && <p className="text-sm text-fg-muted">Motivo: {t.cancelReason}</p>}
            {run.error && <Alert>{run.error instanceof ApiError ? run.error.message : 'Erro'}</Alert>}
            <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
              <Table>
                <thead>
                  <tr>
                    <Th>Vencimento</Th>
                    <Th>Descrição</Th>
                    <Th className="text-right">Valor</Th>
                    <Th>Situação</Th>
                  </tr>
                </thead>
                <tbody>
                  {t.installments.map((i) => (
                    <tr key={i.id}>
                      <Td className="whitespace-nowrap tabular-nums">{formatDate(i.dueDate)}</Td>
                      <Td>{i.description.replace('Ortodontia: ', '')}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(i.amount)}</Td>
                      <Td>
                        <Badge tone={installmentTone[i.status]}>{installmentLabel[i.status]}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <p className="text-xs text-fg-muted">A baixa das mensalidades é feita no financeiro, em Contas a receber.</p>
            {canManage && t.status === 'active' && !action && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setAction('extend')}>
                  Prorrogar
                </Button>
                <Button size="sm" onClick={() => setAction('finish')}>
                  Concluir tratamento
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAction('cancel')}>
                  Cancelar
                </Button>
              </div>
            )}
            {action && (
              <Card className="space-y-3 p-4">
                {action === 'extend' && (
                  <Field label="Mais quantos meses?">{(fid) => <Input id={fid} type="number" min={1} max={24} value={months} onChange={(e) => setMonths(e.target.value)} />}</Field>
                )}
                {(action === 'finish' || action === 'cancel') && (
                  <Field label={action === 'finish' ? 'Concluído em' : 'Cancelado em'}>
                    {(fid) => <Input id={fid} type="date" required min={t.startedOn} max={today()} value={closedOn} onChange={(e) => setClosedOn(e.target.value)} />}
                  </Field>
                )}
                {action === 'finish' && (
                  <Checkbox label="Cancelar as mensalidades que vencem depois dessa data" checked={cancelFuture} onChange={(e) => setCancelFuture(e.target.checked)} />
                )}
                {action === 'cancel' && (
                  <Field label="Motivo do cancelamento" hint="Todas as parcelas em aberto são canceladas.">
                    {(fid) => <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
                  </Field>
                )}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAction(null)}>
                    Voltar
                  </Button>
                  <Button size="sm" variant={action === 'cancel' ? 'danger' : 'primary'} loading={run.isPending} disabled={(action === 'cancel' && reason.trim().length < 3) || (action !== 'extend' && !closedOn)} onClick={() => run.mutate()}>
                    Confirmar
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )
      )}
    </Modal>
  );
}

/** Aba "Tratamento" na ficha do paciente. */
export function CustomerTreatmentsTab({ customerId }: { customerId: string }) {
  const list = useTreatments({ customerId });
  const canManage = useCan('orthodontics.treatments.manage');
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  const hasActive = list.data.some((t) => t.status === 'active');
  return (
    <>
      {canManage && !hasActive && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setStarting(true)}>
            Iniciar tratamento
          </Button>
        </div>
      )}
      <Card>{list.data.length === 0 ? <EmptyState title="Nenhum tratamento" /> : <TreatmentsTable treatments={list.data} onOpen={setOpenId} />}</Card>
      {starting && <StartModal customer={{ id: customerId }} onClose={() => setStarting(false)} onStarted={setOpenId} />}
      {openId && <TreatmentModal id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Aba "Prontuário" na ficha do paciente. */
export function CustomerRecordsTab({ customerId }: { customerId: string }) {
  return <MedicalRecordTimeline subjectType="customer" subjectId={customerId} />;
}
