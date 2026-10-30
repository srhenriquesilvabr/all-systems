import { api, apiUpload, ApiError, AuthImage, formatDate, formatDateTime, formatMoney, parseMoney, today, useCan } from '@all/module-sdk/web';
import { CustomerSearch, ordersKey, type CustomerOption } from '@all/service-orders/web';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, Select, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  feeMethodLabel,
  feeMethods,
  jobKindLabel,
  jobPeriods,
  jobStatusLabel,
  jobStatusTone,
  periodLabel,
  periodWindow,
  phoneLinks,
  type FeeMethod,
  type JobAddress,
  type JobKind,
  type JobPeriod,
  type JobsQuery,
  type LogisticsJob,
} from '../contracts';
import { laundryKey } from './hooks';

export const logisticsKey = [...laundryKey, 'logistics'];

export const useJobs = (q: Partial<JobsQuery>, enabled = true) =>
  useQuery({
    queryKey: [...logisticsKey, 'jobs', q],
    queryFn: () => api<LogisticsJob[]>('/laundry/logistics/jobs', { query: q }),
    enabled,
    refetchInterval: 60_000,
  });

export const useMyRoute = (date: string) =>
  useQuery({
    queryKey: [...logisticsKey, 'my-route', date],
    queryFn: () => api<LogisticsJob[]>('/laundry/logistics/my-route', { query: { date } }),
    refetchInterval: 60_000,
  });

/** Quem tem a permissão de fazer coletas e entregas (o dono da empresa também). */
export const useDrivers = () =>
  useQuery({ queryKey: [...logisticsKey, 'drivers'], queryFn: () => api<{ id: string; name: string }[]>('/laundry/logistics/drivers'), staleTime: 5 * 60_000 });

export const useLogisticsDefaults = () =>
  useQuery({
    queryKey: [...logisticsKey, 'defaults'],
    queryFn: () => api<{ pickupFee: number; deliveryFee: number }>('/laundry/logistics/defaults'),
    staleTime: 60_000,
  });

/** Invalida tudo que uma mudança de coleta/entrega afeta (quadro, rota, ordem). */
export function useRefreshLogistics() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: laundryKey });
    queryClient.invalidateQueries({ queryKey: ordersKey });
  };
}

/** 'YYYY-MM-DD' + n dias. */
export function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y!, m! - 1, d! + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const windowText = (j: Pick<LogisticsJob, 'period' | 'windowStart' | 'windowEnd'>) =>
  `${j.period ? `${periodLabel[j.period]} · ` : ''}${j.windowStart}–${j.windowEnd}`;

/** A tarefa pode estar com alguém que perdeu a permissão depois: continua na lista até ser trocado. */
export function withCurrent(list: { id: string; name: string }[] | undefined, current: { id: string; name: string } | null | undefined) {
  const all = list ?? [];
  return current && !all.some((m) => m.id === current.id) ? [...all, current] : all;
}

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Erro inesperado' : '');

// ---- Registrar depois: quando aconteceu --------------------------------------------------------

/** Valor de um input datetime-local ('YYYY-MM-DDTHH:mm') no horário deste aparelho. */
function toLocalInput(d: Date | string) {
  const v = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}`;
}

/** Para a API: sem data (campo fechado ou vazio) é agora, e não vai no corpo. */
const whenBody = (value: string | null) => (value ? new Date(value).toISOString() : undefined);

/**
 * Sugestão para registrar uma tarefa de um dia que já passou: o início da janela, ou logo depois
 * do último evento (saída, tentativa que falhou). Tarefa de hoje ou futura: null (agora).
 */
function pastSuggestion(job: LogisticsJob, minutesAfter = 0) {
  if (job.date >= today()) return null;
  const events = [new Date(`${job.date}T${job.windowStart}`).getTime(), job.startedAt ? Date.parse(job.startedAt) : 0, job.failedAt ? Date.parse(job.failedAt) : 0];
  return toLocalInput(new Date(Math.min(Math.max(...events) + minutesAfter * 60_000, Date.now())));
}

/** Menor horário aceito para o evento: o dia da tarefa, a saída e a tentativa que falhou. */
function eventMin(job: LogisticsJob) {
  const events = [new Date(`${job.date}T00:00`).getTime(), job.startedAt ? Date.parse(job.startedAt) : 0, job.failedAt ? Date.parse(job.failedAt) : 0];
  return toLocalInput(new Date(Math.max(...events)));
}

/**
 * "Quando aconteceu": vazio é agora. Como nas outras telas de lançamento retroativo, o campo só
 * aparece quando a pessoa pede (ou já vem aberto na tarefa de um dia que já passou); o ✕ volta para agora.
 */
function WhenField({ label, value, onChange, min }: { label: string; value: string | null; onChange: (value: string | null) => void; min?: string }) {
  if (value === null) {
    return (
      <button type="button" className="text-left text-sm text-brand-700 hover:underline" onClick={() => onChange(toLocalInput(new Date()))}>
        Aconteceu em outro horário
      </button>
    );
  }
  return (
    <Field label={label} hint="Vazio é agora. Registrando depois, o cliente não é avisado; a taxa recebida entra no financeiro nesta data.">
      {(id) => (
        <div className="flex items-center gap-2">
          <Input id={id} type="datetime-local" className="w-auto" min={min} max={toLocalInput(new Date())} value={value} onChange={(e) => onChange(e.target.value)} />
          <Button variant="ghost" size="sm" aria-label="Usar agora" onClick={() => onChange(null)}>
            ✕
          </Button>
        </div>
      )}
    </Field>
  );
}

export function JobBadges({ job }: { job: LogisticsJob }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={job.kind === 'pickup' ? 'warning' : 'brand'}>{jobKindLabel[job.kind]}</Badge>
      <Badge tone={jobStatusTone[job.status]}>{jobStatusLabel[job.status]}</Badge>
      {job.attempts > 0 && job.status !== 'failed' && <Badge tone="warning">{job.attempts}ª tentativa falhou</Badge>}
    </span>
  );
}

/** Ligar, WhatsApp e mapa: botões grandes, pensados para o celular. */
export function ContactLinks({ job }: { job: LogisticsJob }) {
  const phone = phoneLinks(job.customer.phone);
  const link = 'inline-flex h-10 items-center justify-center rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:border-fg';
  return (
    <div className="grid grid-cols-3 gap-2">
      {job.mapsUrl ? (
        <a href={job.mapsUrl} target="_blank" rel="noreferrer" className={link}>
          Mapa
        </a>
      ) : (
        <span />
      )}
      {phone ? (
        <>
          <a href={phone.tel} className={link}>
            Ligar
          </a>
          <a href={phone.whatsapp} target="_blank" rel="noreferrer" className={link}>
            WhatsApp
          </a>
        </>
      ) : (
        <span className="col-span-2 self-center text-sm text-fg-muted">Cliente sem telefone</span>
      )}
    </div>
  );
}

/** Comprovante: quem recebeu, quando, peças coletadas, fotos. */
export function JobProof({ job }: { job: LogisticsJob }) {
  if (job.status === 'failed') {
    return (
      <p className="text-sm text-danger-700">
        Não realizada: {job.failReason}
        {job.failedAt && <span className="text-fg-muted"> · {formatDateTime(job.failedAt)}</span>}
      </p>
    );
  }
  if (job.status === 'cancelled') return <p className="text-sm text-fg-muted">Cancelada{job.cancelReason ? `: ${job.cancelReason}` : ''}</p>;
  if (job.status !== 'done') {
    return job.attempts > 0 && job.failReason ? <p className="text-sm text-fg-muted">Tentativa anterior: {job.failReason}</p> : null;
  }
  return (
    <div className="space-y-2 text-sm">
      <p>
        {job.kind === 'delivery' ? `Recebido por ${job.receiverName}` : `${job.itemsCount} peça(s) coletada(s)`}
        {job.completedAt && <span className="text-fg-muted"> · {formatDateTime(job.completedAt)}</span>}
      </p>
      {job.photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {job.photos.map((p) => (
            <AuthImage key={p.id} fileId={p.id} alt="Foto do comprovante" className="size-16 rounded-md border border-line object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Sair para a rota / concluir / não realizada. Serve ao motorista e ao escritório. */
export function JobActions({ job, onChanged, size = 'md' }: { job: LogisticsJob; onChanged: () => void; size?: 'sm' | 'md' }) {
  const [completing, setCompleting] = useState(false);
  const [failing, setFailing] = useState(false);
  const [starting, setStarting] = useState(false);
  const start = useMutation({ mutationFn: () => api(`/laundry/logistics/jobs/${job.id}/start`, { method: 'POST' }), onSuccess: onChanged });
  if (job.status !== 'scheduled' && job.status !== 'en_route') return null;
  // Tarefa de um dia que já passou: a saída é registrada com o horário (janela com o campo aberto).
  const past = job.date < today();

  return (
    <div className="space-y-2">
      {start.error && <Alert>{errorText(start.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        {job.status === 'scheduled' && (
          <Button size={size} variant="secondary" className="flex-1" loading={start.isPending} onClick={() => (past ? setStarting(true) : start.mutate())}>
            Sair para {job.kind === 'pickup' ? 'a coleta' : 'a entrega'}
          </Button>
        )}
        <Button size={size} className="flex-1" onClick={() => setCompleting(true)}>
          Concluir
        </Button>
        <Button size={size} variant="ghost" onClick={() => setFailing(true)}>
          Não realizada
        </Button>
      </div>
      {completing && (
        <CompleteModal
          job={job}
          onClose={() => setCompleting(false)}
          onDone={() => {
            setCompleting(false);
            onChanged();
          }}
        />
      )}
      {failing && (
        <FailModal
          job={job}
          onClose={() => setFailing(false)}
          onDone={() => {
            setFailing(false);
            onChanged();
          }}
        />
      )}
      {starting && (
        <StartModal
          job={job}
          onClose={() => setStarting(false)}
          onDone={() => {
            setStarting(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Saída para a rota registrada depois (tarefa de um dia que já passou). */
function StartModal({ job, onClose, onDone }: { job: LogisticsJob; onClose: () => void; onDone: () => void }) {
  const [occurredAt, setOccurredAt] = useState<string | null>(pastSuggestion(job));
  const save = useMutation({
    mutationFn: () => api(`/laundry/logistics/jobs/${job.id}/start`, { method: 'POST', body: { occurredAt: whenBody(occurredAt) } }),
    onSuccess: onDone,
  });
  return (
    <Modal
      open
      title={`Saída para ${job.kind === 'pickup' ? 'a coleta' : 'a entrega'} — ${job.customer.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Registrar saída
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorText(save.error)}</Alert>}
        <WhenField label="Saiu em" value={occurredAt} onChange={setOccurredAt} min={eventMin(job)} />
      </div>
    </Modal>
  );
}

function CompleteModal({ job, onClose, onDone }: { job: LogisticsJob; onClose: () => void; onDone: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [receiverName, setReceiverName] = useState('');
  const [itemsCount, setItemsCount] = useState('');
  const [notes, setNotes] = useState('');
  const [feeReceived, setFeeReceived] = useState(false);
  const [feeMethod, setFeeMethod] = useState<FeeMethod>('cash');
  const [photos, setPhotos] = useState<{ id: string; filename: string }[]>(job.photos);
  const [occurredAt, setOccurredAt] = useState<string | null>(pastSuggestion(job, 20));
  // Saldo da ordem: quem tem a permissão registra aqui o que recebeu do cliente.
  const canReceive = useCan('laundry.logistics.receive');
  const canPayOrders = useCan('shared.service-orders.payments');
  const balance = job.kind === 'delivery' && job.order ? Math.round((job.order.total - job.order.paidAmount) * 100) / 100 : 0;
  const showBalance = balance > 0 && (canReceive || canPayOrders);
  const [balanceReceived, setBalanceReceived] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState(balance.toFixed(2).replace('.', ','));
  const [balanceMethod, setBalanceMethod] = useState<FeeMethod>('cash');
  const upload = useMutation({
    mutationFn: (file: File) => apiUpload<{ id: string; filename: string }>(`/laundry/logistics/jobs/${job.id}/photos`, 'photo', file),
    onSuccess: (photo) => setPhotos([...photos, photo]),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/laundry/logistics/jobs/${job.id}/complete`, {
        method: 'POST',
        body: {
          receiverName: job.kind === 'delivery' ? receiverName : null,
          itemsCount: job.kind === 'pickup' ? Number(itemsCount) || null : null,
          notes: notes || null,
          feeMethod: feeReceived ? feeMethod : null,
          balancePayment: balanceReceived ? { amount: parseMoney(balanceAmount), method: balanceMethod } : null,
          occurredAt: whenBody(occurredAt),
        },
      }),
    onSuccess: onDone,
  });
  const showFee = job.fee > 0 && job.feeStatus !== 'paid';

  return (
    <Modal
      open
      title={`Concluir ${job.kind === 'pickup' ? 'coleta' : 'entrega'} — ${job.customer.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={save.isPending} disabled={upload.isPending} onClick={() => save.mutate()}>
            Concluir
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(save.error || upload.error) && <Alert>{errorText(save.error ?? upload.error)}</Alert>}
        {job.kind === 'delivery' ? (
          <Field label="Quem recebeu">{(id) => <Input id={id} value={receiverName} onChange={(e) => setReceiverName(e.target.value)} autoFocus />}</Field>
        ) : (
          <Field label="Peças coletadas" hint="A conferência peça a peça é feita no balcão, ao abrir a ordem.">
            {(id) => <Input id={id} type="number" inputMode="numeric" min={1} value={itemsCount} onChange={(e) => setItemsCount(e.target.value)} autoFocus />}
          </Field>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium">Foto {job.kind === 'delivery' ? 'do comprovante' : 'das peças'} (opcional)</p>
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((p) => (
              <AuthImage key={p.id} fileId={p.id} alt={p.filename} className="size-16 rounded-md border border-line object-cover" />
            ))}
            {/* Em celular, `capture` abre direto a câmera. */}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" loading={upload.isPending} onClick={() => fileInput.current?.click()}>
              Tirar foto
            </Button>
          </div>
        </div>
        {showFee && (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3">
            <Checkbox
              label={`Recebi a taxa de ${formatMoney(job.fee)} agora`}
              checked={feeReceived}
              onChange={(e) => setFeeReceived(e.target.checked)}
            />
            {feeReceived && (
              <Select aria-label="Forma de pagamento da taxa" value={feeMethod} onChange={(e) => setFeeMethod(e.target.value as FeeMethod)}>
                {feeMethods.map((m) => (
                  <option key={m} value={m}>
                    {feeMethodLabel[m]}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}
        {showBalance && (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3">
            <Checkbox label={`Recebi o saldo da ordem (${formatMoney(balance)})`} checked={balanceReceived} onChange={(e) => setBalanceReceived(e.target.checked)} />
            {balanceReceived && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Valor recebido">{(id) => <Input id={id} inputMode="decimal" value={balanceAmount} onChange={(e) => setBalanceAmount(e.target.value)} />}</Field>
                <Field label="Forma de pagamento">
                  {(id) => (
                    <Select id={id} value={balanceMethod} onChange={(e) => setBalanceMethod(e.target.value as FeeMethod)}>
                      {feeMethods.map((m) => (
                        <option key={m} value={m}>
                          {feeMethodLabel[m]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
          </div>
        )}
        <Field label="Observação (opcional)">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <WhenField label="Concluída em" value={occurredAt} onChange={setOccurredAt} min={eventMin(job)} />
      </div>
    </Modal>
  );
}

const FAIL_REASONS = ['Cliente ausente', 'Endereço não encontrado', 'Cliente pediu para remarcar', 'Sem acesso ao local'];

function FailModal({ job, onClose, onDone }: { job: LogisticsJob; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [occurredAt, setOccurredAt] = useState<string | null>(pastSuggestion(job, 15));
  const save = useMutation({
    mutationFn: () => api(`/laundry/logistics/jobs/${job.id}/fail`, { method: 'POST', body: { reason, occurredAt: whenBody(occurredAt) } }),
    onSuccess: onDone,
  });
  return (
    <Modal
      open
      title={`${jobKindLabel[job.kind]} não realizada — ${job.customer.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" loading={save.isPending} onClick={() => save.mutate()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorText(save.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          {FAIL_REASONS.map((r) => (
            <Button key={r} size="sm" variant={reason === r ? 'primary' : 'secondary'} onClick={() => setReason(r)}>
              {r}
            </Button>
          ))}
        </div>
        <Field label="Motivo">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <WhenField label="Tentativa em" value={occurredAt} onChange={setOccurredAt} min={eventMin(job)} />
        {job.kind === 'delivery' && <p className="text-sm text-fg-muted">A ordem volta para “Pronta” e o escritório pode reagendar a entrega.</p>}
      </div>
    </Modal>
  );
}

const emptyAddress: JobAddress = {};
type WindowMode = JobPeriod | 'custom';

/**
 * Agendar coleta (escolhe o cliente), agendar entrega de uma ordem, ou editar/reagendar uma
 * tarefa existente. O endereço vem do cadastro do cliente e pode ser mudado só para esta tarefa.
 */
export function ScheduleModal({
  kind,
  job,
  orderId,
  customer: fixedCustomer,
  onClose,
  onSaved,
}: {
  kind: JobKind;
  job?: LogisticsJob;
  orderId?: string;
  customer?: { id: string; name: string };
  onClose: () => void;
  onSaved: (job: LogisticsJob) => void;
}) {
  const defaults = useLogisticsDefaults();
  const drivers = useDrivers();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(job?.customer ?? fixedCustomer ?? null);
  const [address, setAddress] = useState<JobAddress>(job?.address ?? emptyAddress);
  const [date, setDate] = useState(job?.status === 'failed' ? today() : (job?.date ?? today()));
  const [mode, setMode] = useState<WindowMode>(job ? (job.period ?? 'custom') : 'morning');
  const [from, setFrom] = useState(job?.windowStart ?? '08:00');
  const [to, setTo] = useState(job?.windowEnd ?? '12:00');
  const [fee, setFee] = useState(job ? String(job.fee).replace('.', ',') : '');
  const [driverUserId, setDriverUserId] = useState(job?.driver?.id ?? '');
  const [notes, setNotes] = useState(job?.notes ?? '');
  // Nova tarefa pode ser de um dia que já passou (registro); a tentativa que falhou, a partir do dia
  // dela; a tarefa agendada que ainda não aconteceu, só de hoje em diante (ou mantém o dia que tem).
  const dateMin = !job ? undefined : job.status === 'failed' && job.failedAt ? toLocalInput(job.failedAt).slice(0, 10) : job.date < today() ? job.date : today();

  // Endereço do cadastro do cliente, para quem está agendando agora.
  const customerDetail = useQuery({
    queryKey: ['customers', customer?.id],
    queryFn: () => api<{ address: JobAddress | null }>(`/customers/${customer!.id}`),
    enabled: !!customer && !job,
  });
  useEffect(() => {
    if (!job && customerDetail.data) setAddress(customerDetail.data.address ?? emptyAddress);
  }, [job, customerDetail.data]);

  const defaultFee = kind === 'pickup' ? defaults.data?.pickupFee : defaults.data?.deliveryFee;
  const save = useMutation({
    mutationFn: () => {
      const window = mode === 'custom' ? { period: null, windowStart: from, windowEnd: to } : { period: mode, windowStart: null, windowEnd: null };
      const feeValue = fee.trim() ? parseMoney(fee) : undefined;
      const body = { address, date, ...window, fee: feeValue, driverUserId: driverUserId || null, notes: notes || null };
      if (job) return api<LogisticsJob>(`/laundry/logistics/jobs/${job.id}`, { method: 'PATCH', body });
      if (kind === 'delivery') return api<LogisticsJob>(`/laundry/orders/${orderId}/delivery`, { method: 'POST', body: { ...body, fee: feeValue ?? null } });
      return api<LogisticsJob>('/laundry/logistics/pickups', { method: 'POST', body: { ...body, customerId: customer?.id, fee: feeValue ?? null } });
    },
    onSuccess: onSaved,
  });

  const title = job ? `${job.status === 'failed' ? 'Reagendar' : 'Editar'} ${jobKindLabel[job.kind].toLowerCase()}` : kind === 'pickup' ? 'Agendar coleta' : 'Entregar no endereço';
  const setField = (k: keyof JobAddress) => (e: { target: { value: string } }) => setAddress({ ...address, [k]: e.target.value });

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={save.isPending} disabled={!customer} onClick={() => save.mutate()}>
            {job ? 'Salvar' : 'Agendar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{errorText(save.error)}</Alert>}
        {customer ? (
          <p className="text-sm">
            Cliente: <span className="font-medium">{customer.name}</span>
            {!job && !fixedCustomer && (
              <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => setCustomer(null)}>
                trocar
              </button>
            )}
          </p>
        ) : (
          <Section title="Cliente">
            <CustomerSearch onSelect={(c: CustomerOption) => setCustomer({ id: c.id, name: c.name })} />
          </Section>
        )}

        <Section title="Endereço">
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Field label="Rua">{(id) => <Input id={id} value={address.street ?? ''} onChange={setField('street')} />}</Field>
            <Field label="Número">{(id) => <Input id={id} value={address.number ?? ''} onChange={setField('number')} />}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Complemento">{(id) => <Input id={id} value={address.complement ?? ''} onChange={setField('complement')} />}</Field>
            <Field label="Bairro">{(id) => <Input id={id} value={address.district ?? ''} onChange={setField('district')} />}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_5rem_8rem]">
            <Field label="Cidade">{(id) => <Input id={id} value={address.city ?? ''} onChange={setField('city')} />}</Field>
            <Field label="UF">{(id) => <Input id={id} maxLength={2} value={address.state ?? ''} onChange={setField('state')} />}</Field>
            <Field label="CEP">{(id) => <Input id={id} value={address.zip ?? ''} onChange={setField('zip')} />}</Field>
          </div>
          <Field label="Ponto de referência">{(id) => <Input id={id} value={address.reference ?? ''} onChange={setField('reference')} />}</Field>
        </Section>

        <Section title="Quando">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Dia"
              hint={date < today() ? (job ? 'Nova tentativa que já aconteceu: depois de remarcar, registre a saída e a conclusão com o horário.' : 'Dia que já passou: registra o que já aconteceu, sem aviso ao cliente. Depois, conclua com o horário.') : undefined}
            >
              {(id) => <Input id={id} type="date" min={dateMin} value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="Período">
              {(id) => (
                <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as WindowMode)}>
                  {jobPeriods.map((p) => (
                    <option key={p} value={p}>
                      {periodLabel[p]} ({periodWindow[p].join('–')})
                    </option>
                  ))}
                  <option value="custom">Horário específico</option>
                </Select>
              )}
            </Field>
          </div>
          {mode === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="De">{(id) => <Input id={id} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
              <Field label="Até">{(id) => <Input id={id} type="time" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
            </div>
          )}
        </Section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Taxa de ${kind === 'pickup' ? 'coleta' : 'entrega'}`} hint={!job && defaultFee !== undefined ? `Vazio = padrão (${formatMoney(defaultFee)})` : undefined}>
            {(id) => <Input id={id} inputMode="decimal" placeholder={defaultFee !== undefined ? String(defaultFee).replace('.', ',') : ''} value={fee} onChange={(e) => setFee(e.target.value)} />}
          </Field>
          <Field label="Motorista" hint="Só quem tem a permissão de fazer coletas e entregas. Para incluir alguém, ajuste o papel em Configurações, Usuários.">
            {(id) => (
              <Select id={id} value={driverUserId} onChange={(e) => setDriverUserId(e.target.value)}>
                <option value="">Sem motorista</option>
                {withCurrent(drivers.data, job?.driver).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Observações (para o motorista)">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Cartão de uma tarefa no quadro do escritório e na ordem. */
export function JobCard({ job, onChanged, actions }: { job: LogisticsJob; onChanged: () => void; actions?: ReactNode }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium tabular-nums">
            {formatDate(job.date)} · {windowText(job)}
          </p>
          <p className="truncate">{job.customer.name}</p>
          <p className="text-sm text-fg-muted">{job.addressText || 'Sem endereço'}</p>
          {job.address.reference && <p className="text-sm text-fg-muted">Referência: {job.address.reference}</p>}
        </div>
        <JobBadges job={job} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        {job.order && (
          <>
            <dt className="text-fg-muted">Ordem</dt>
            <dd>
              <Link to={`/lavanderia/ordens/${job.order.id}`} className="text-brand-700 hover:underline">
                nº {job.order.number}
              </Link>
            </dd>
          </>
        )}
        <dt className="text-fg-muted">Motorista</dt>
        <dd>{job.driver?.name ?? <span className="text-warning-700">sem motorista</span>}</dd>
        {job.fee > 0 && (
          <>
            <dt className="text-fg-muted">Taxa</dt>
            <dd className="tabular-nums">
              {formatMoney(job.fee)} {job.feeStatus === 'paid' && <span className="text-success-700">· recebida</span>}
            </dd>
          </>
        )}
        {job.notes && (
          <>
            <dt className="text-fg-muted">Obs.</dt>
            <dd className="whitespace-pre-line">{job.notes}</dd>
          </>
        )}
      </dl>
      <JobProof job={job} />
      <JobActions job={job} onChanged={onChanged} size="sm" />
      {actions && <div className="flex flex-wrap gap-2 border-t border-line pt-3">{actions}</div>}
    </Card>
  );
}
