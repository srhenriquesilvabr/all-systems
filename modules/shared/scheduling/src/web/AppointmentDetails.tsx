import { api, ApiError, formatDateTime, formatMoney, formatPhone, parseMoney, PixCharge, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Field, Input, Modal, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { appointmentStatusLabel, paymentMethods, type Appointment, type AppointmentStatus } from '../contracts';
import { RescheduleRoomSelect, rescheduleRoomBody, RoomForm } from './AppointmentRoom';
import { localDate, localTime, localToUtc, schedulingKey, useAvailability, useResources } from './hooks';

const methodLabel: Record<(typeof paymentMethods)[number], string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  transfer: 'Transferência',
  other: 'Outro',
};

export const statusTone: Record<AppointmentStatus, 'brand' | 'success' | 'warning' | 'neutral' | 'danger'> = {
  scheduled: 'neutral',
  confirmed: 'brand',
  arrived: 'warning',
  in_service: 'warning',
  done: 'success',
  no_show: 'danger',
  cancelled: 'danger',
};

/** Próximos passos mais comuns para cada status (os demais ficam no menu "Mais"). */
const actions: Partial<Record<AppointmentStatus, { to: AppointmentStatus; label: string }[]>> = {
  scheduled: [
    { to: 'confirmed', label: 'Confirmar' },
    { to: 'arrived', label: 'Chegou' },
    { to: 'no_show', label: 'Faltou' },
  ],
  confirmed: [
    { to: 'arrived', label: 'Chegou' },
    { to: 'no_show', label: 'Faltou' },
  ],
  arrived: [
    { to: 'in_service', label: 'Iniciar atendimento' },
    { to: 'done', label: 'Concluir' },
  ],
  in_service: [{ to: 'done', label: 'Concluir' }],
};

interface Message {
  id: string;
  channel: 'email' | 'whatsapp';
  subject: string;
  status: 'queued' | 'sent' | 'manual' | 'failed' | 'skipped';
  detail: string | null;
  actionUrl: string | null;
  createdAt: string;
}

export function AppointmentDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const canStatus = useCan('shared.scheduling.status');
  const canWrite = useCan('shared.scheduling.write');
  const canPay = useCan('shared.scheduling.payments');
  const detail = useQuery({ queryKey: [...schedulingKey, 'appointment', id], queryFn: () => api<Appointment>(`/scheduling/appointments/${id}`) });
  const messages = useQuery({
    queryKey: [...schedulingKey, 'messages', id],
    queryFn: () => api<Message[]>('/notifications', { query: { relatedEntity: 'appointment', relatedId: id, limit: 20 } }),
    retry: false,
  });
  const [mode, setMode] = useState<'view' | 'cancel' | 'cancel-series' | 'reschedule' | 'pay' | 'room'>('view');
  const hasRooms = useResources().data?.some((r) => r.kind === 'room' && r.active) ?? false;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: schedulingKey });
  };
  const status = useMutation({
    mutationFn: (body: { status: AppointmentStatus; reason?: string }) => api<Appointment>(`/scheduling/appointments/${id}/status`, { method: 'POST', body }),
    onSuccess: () => {
      setMode('view');
      refresh();
    },
  });
  const cancelSeries = useMutation({
    mutationFn: (reason: string) => api<{ cancelled: number }>(`/scheduling/appointments/${id}/cancel-series`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      setMode('view');
      refresh();
    },
  });
  const markSent = useMutation({ mutationFn: (msgId: string) => api(`/notifications/${msgId}/sent`, { method: 'POST' }), onSuccess: refresh });

  const a = detail.data;
  const balance = a ? Math.round((a.total - a.paidAmount) * 100) / 100 : 0;
  const open = a && !['done', 'no_show', 'cancelled'].includes(a.status);

  return (
    <Modal open title={a ? `${localTime(a.startsAt)} · ${a.customer.name}` : 'Atendimento'} onClose={onClose}>
      {detail.isPending ? (
        <Spinner />
      ) : detail.isError ? (
        <Alert>{detail.error.message}</Alert>
      ) : a ? (
        <div className="space-y-4 text-sm">
          {status.error && <Alert>{status.error instanceof ApiError ? status.error.message : 'Erro'}</Alert>}
          {cancelSeries.error && <Alert>{cancelSeries.error instanceof ApiError ? cancelSeries.error.message : 'Erro'}</Alert>}
          {cancelSeries.data && <Alert tone="success">{cancelSeries.data.cancelled} horário(s) da série cancelado(s).</Alert>}

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[a.status]}>{appointmentStatusLabel[a.status]}</Badge>
            {a.source === 'online' && <Badge tone="brand">Marcado online</Badge>}
            {a.seriesId && <Badge>Faz parte de uma série</Badge>}
            {a.confirmedAt && a.status === 'confirmed' && <span className="text-fg-muted">confirmado em {formatDateTime(a.confirmedAt)}</span>}
          </div>

          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-fg-muted">Cliente</dt>
            <dd>
              <Link to={`/clientes/${a.customer.id}`} className="font-medium text-brand-700 hover:underline">
                {a.customer.name}
              </Link>
              {a.customer.phone && <span className="ml-2 text-fg-muted">{formatPhone(a.customer.phone)}</span>}
            </dd>
            {a.subject && (
              <>
                <dt className="text-fg-muted">Para</dt>
                <dd>{a.subject.label}</dd>
              </>
            )}
            <dt className="text-fg-muted">Quando</dt>
            <dd>
              {localDate(a.startsAt).split('-').reverse().join('/')} das {localTime(a.startsAt)} às {localTime(a.endsAt)}
            </dd>
            <dt className="text-fg-muted">Profissional</dt>
            <dd>{a.resourceName}</dd>
            {a.roomName && (
              <>
                <dt className="text-fg-muted">Sala</dt>
                <dd>{a.roomName}</dd>
              </>
            )}
            <dt className="text-fg-muted">Serviços</dt>
            <dd>
              {a.services.map((s) => (
                <div key={s.name} className="flex justify-between gap-2">
                  <span>{s.name}</span>
                  <span className="tabular-nums">{formatMoney(s.price)}</span>
                </div>
              ))}
            </dd>
            <dt className="text-fg-muted">Pagamento</dt>
            <dd className="tabular-nums">
              {formatMoney(a.paidAmount)} de {formatMoney(a.total)}
              {balance > 0 && a.status !== 'cancelled' && <span className="ml-1 text-fg-muted">(falta {formatMoney(balance)})</span>}
            </dd>
            {a.notes && (
              <>
                <dt className="text-fg-muted">Observações</dt>
                <dd className="whitespace-pre-line">{a.notes}</dd>
              </>
            )}
            {a.cancelReason && (
              <>
                <dt className="text-fg-muted">Motivo</dt>
                <dd>{a.cancelReason}</dd>
              </>
            )}
          </dl>

          {mode === 'view' && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              {canStatus &&
                actions[a.status]?.map((act) => (
                  <Button key={act.to} size="sm" variant={act.to === 'done' || act.to === 'confirmed' ? 'primary' : 'secondary'} loading={status.isPending && status.variables?.status === act.to} onClick={() => status.mutate({ status: act.to })}>
                    {act.label}
                  </Button>
                ))}
              {canPay && balance > 0 && a.status !== 'cancelled' && a.status !== 'no_show' && (
                <Button size="sm" variant="secondary" onClick={() => setMode('pay')}>
                  Registrar pagamento
                </Button>
              )}
              {canWrite && (a.status === 'scheduled' || a.status === 'confirmed') && (
                <Button size="sm" variant="ghost" onClick={() => setMode('reschedule')}>
                  Remarcar
                </Button>
              )}
              {canWrite && open && (hasRooms || a.roomId) && (
                <Button size="sm" variant="ghost" onClick={() => setMode('room')}>
                  {a.roomId ? 'Trocar sala' : 'Definir sala'}
                </Button>
              )}
              {canWrite && open && (
                <Button size="sm" variant="ghost" onClick={() => setMode('cancel')}>
                  Cancelar horário
                </Button>
              )}
              {canWrite && open && a.seriesId && (
                <Button size="sm" variant="ghost" onClick={() => setMode('cancel-series')}>
                  Cancelar esta e as próximas
                </Button>
              )}
            </div>
          )}

          {mode === 'cancel' && <CancelForm onBack={() => setMode('view')} busy={status.isPending} onConfirm={(reason) => status.mutate({ status: 'cancelled', reason })} />}
          {mode === 'cancel-series' && (
            <CancelForm
              label="Cancelar esta e as próximas"
              hint="Cancela este horário e os seguintes da série que ainda não aconteceram. O cliente recebe um aviso só, com as datas."
              onBack={() => setMode('view')}
              busy={cancelSeries.isPending}
              onConfirm={(reason) => cancelSeries.mutate(reason)}
            />
          )}
          {mode === 'reschedule' && <RescheduleForm appointment={a} onDone={() => { setMode('view'); refresh(); }} onBack={() => setMode('view')} />}
          {mode === 'room' && <RoomForm appointment={a} onDone={() => { setMode('view'); refresh(); }} onBack={() => setMode('view')} />}
          {mode === 'pay' && <PaymentForm appointment={a} balance={balance} onDone={() => { setMode('view'); refresh(); }} onBack={() => setMode('view')} />}

          {messages.data && messages.data.length > 0 && (
            <div className="border-t border-line pt-4">
              <p className="mb-2 font-medium">Mensagens ao cliente</p>
              <ul className="space-y-2">
                {messages.data.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Badge tone={m.status === 'sent' ? 'success' : m.status === 'manual' ? 'warning' : m.status === 'skipped' ? 'neutral' : 'neutral'}>
                        {m.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
                      </Badge>{' '}
                      {m.subject}
                      {m.detail && <span className="block text-xs text-fg-muted">{m.detail}</span>}
                    </span>
                    {m.status === 'manual' && m.actionUrl && (
                      <span className="flex gap-1">
                        <a href={m.actionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-full bg-[#25d366] px-3.5 text-sm font-medium text-[#0b3d1f] hover:brightness-95">
                          Abrir no WhatsApp
                        </a>
                        <Button size="sm" variant="ghost" loading={markSent.isPending} onClick={() => markSent.mutate(m.id)}>
                          Já enviei
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function CancelForm({
  onConfirm,
  onBack,
  busy,
  label = 'Cancelar horário',
  hint = 'O cliente recebe um aviso de cancelamento.',
}: {
  onConfirm: (reason: string) => void;
  onBack: () => void;
  busy: boolean;
  label?: string;
  hint?: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <Field label="Motivo do cancelamento">{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
      <p className="text-xs text-fg-muted">{hint}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => onConfirm(reason)}>
          {label}
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

function RescheduleForm({ appointment, onDone, onBack }: { appointment: Appointment; onDone: () => void; onBack: () => void }) {
  const [date, setDate] = useState(localDate(appointment.startsAt));
  const [time, setTime] = useState('');
  const serviceIds = appointment.services.map((s) => s.serviceId).filter((s): s is string => !!s);
  const availability = useAvailability(date, serviceIds, appointment.resourceId);
  const slots = availability.data?.[0]?.slots ?? [];
  // Sala no novo horário: '' = automática (mantém a atual se livre), 'none' = sem sala, ou o id.
  const [room, setRoom] = useState('');
  const startsAt = time ? localToUtc(date, time) : null;
  const save = useMutation({
    mutationFn: () =>
      api(`/scheduling/appointments/${appointment.id}/reschedule`, { method: 'POST', body: { startsAt: localToUtc(date, time).toISOString(), ...rescheduleRoomBody(room) } }),
    onSuccess: onDone,
  });
  return (
    <div className="space-y-3 border-t border-line pt-4">
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao remarcar'}</Alert>}
      <Field label="Novo dia">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      {availability.isPending ? (
        <Spinner />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <button key={s} type="button" onClick={() => setTime(s)} className={`rounded-full border px-3 py-1 tabular-nums ${s === time ? 'border-brand-600 bg-brand-600 text-white' : 'border-line hover:border-fg'}`}>
              {s}
            </button>
          ))}
          {!slots.length && <p className="text-fg-muted">Sem horário livre neste dia.</p>}
        </div>
      )}
      <RescheduleRoomSelect appointment={appointment} startsAt={startsAt} value={room} onChange={setRoom} />
      <div className="flex gap-2">
        <Button size="sm" loading={save.isPending} disabled={!time} onClick={() => save.mutate()}>
          Remarcar para {time || '…'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

function PaymentForm({ appointment, balance, onDone, onBack }: { appointment: Appointment; balance: number; onDone: () => void; onBack: () => void }) {
  const accounts = useQuery({ queryKey: [...schedulingKey, 'payment-accounts'], queryFn: () => api<{ id: string; name: string }[]>('/scheduling/payment-accounts') });
  const [amount, setAmount] = useState(balance.toFixed(2).replace('.', ','));
  const [method, setMethod] = useState<(typeof paymentMethods)[number]>('pix');
  const [accountId, setAccountId] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/scheduling/appointments/${appointment.id}/payments`, {
        method: 'POST',
        body: { amount: parseMoney(amount), method, accountId: accountId || accounts.data?.[0]?.id, paidAt: today() },
      }),
    onSuccess: onDone,
  });
  return (
    <div className="space-y-3 border-t border-line pt-4">
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao registrar'}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Valor (R$)">{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Forma">
          {(id) => (
            <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {paymentMethods.map((m) => (
                <option key={m} value={m}>
                  {methodLabel[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Conta">
          {(id) => (
            <Select id={id} value={accountId || accounts.data?.[0]?.id || ''} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.data?.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {method === 'pix' && <PixCharge amount={parseMoney(amount)} reference={`AG${appointment.id.slice(-8)}`} />}
      <div className="flex gap-2">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          Registrar
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
