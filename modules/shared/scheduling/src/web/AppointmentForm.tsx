import { api, ApiError, CustomerSearch, formatMoney, formatPhone, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import { MAX_OCCURRENCES, recurrenceFrequencies, recurrenceLabel, type Appointment, type RecurrenceFrequency, type SeriesResult } from '../contracts';
import { hhmmOf, localToUtc, minutesOf, schedulingKey, useAvailability, useResources, useServices } from './hooks';

/** Seletor de "para quem é" (ex.: o pet), registrado pela vertical que precisa dele. */
export interface SubjectPicker {
  label: string;
  /** Módulo dono do seletor: só aparece se estiver ativo no tenant. */
  moduleKey: string;
  Component: ComponentType<{ customerId: string; value: SubjectValue | null; onChange: (v: SubjectValue | null) => void }>;
}
export interface SubjectValue {
  type: string;
  id: string;
  label: string;
}

// Vale o primeiro seletor cujo módulo está ativo no tenant (ex.: pets numa veterinária, processos num escritório).
const subjectPickers: SubjectPicker[] = [];
export function registerSubjectPicker(picker: SubjectPicker) {
  if (!subjectPickers.some((p) => p.moduleKey === picker.moduleKey)) subjectPickers.push(picker);
}

export function AppointmentForm({
  initial,
  activeModules,
  onClose,
  onSaved,
}: {
  initial: { date: string; time?: string; resourceId?: string; roomId?: string; customer?: CustomerOption | null };
  activeModules: string[];
  onClose: () => void;
  onSaved: (a: Appointment) => void;
}) {
  const queryClient = useQueryClient();
  const resources = useResources();
  const services = useServices();
  const [customer, setCustomer] = useState<CustomerOption | null>(initial.customer ?? null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [resourceId, setResourceId] = useState(initial.resourceId ?? '');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time ?? '');
  const [notes, setNotes] = useState('');
  const [subject, setSubject] = useState<SubjectValue | null>(null);
  const [roomId, setRoomId] = useState(initial.roomId ?? '');
  const [repeat, setRepeat] = useState<{ on: boolean; frequency: RecurrenceFrequency; end: 'count' | 'until'; count: string; until: string }>({
    on: false,
    frequency: 'weekly',
    end: 'count',
    count: '4',
    until: '',
  });
  const [result, setResult] = useState<SeriesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const professionals = (resources.data ?? []).filter((r) => r.active && r.kind === 'professional');
  const allRooms = (resources.data ?? []).filter((r) => r.active && r.kind === 'room');
  const chosen = (services.data ?? []).filter((s) => serviceIds.includes(s.id));
  // Salas que servem para todos os serviços (serviço sem sala ligada = qualquer sala).
  const rooms = allRooms.filter((room) =>
    chosen.every((s) => {
      const linked = allRooms.filter((r) => s.resourceIds.includes(r.id));
      return !linked.length || linked.some((r) => r.id === room.id);
    }),
  );
  const needsRoom = chosen.some((s) => s.requiresRoom);
  const duration = chosen.reduce((sum, s) => sum + s.durationMin + s.bufferMin, 0);
  const total = chosen.reduce((sum, s) => sum + s.price, 0);
  const availability = useAvailability(date, serviceIds, resourceId || undefined);
  const slots = availability.data?.find((a) => a.resourceId === resourceId)?.slots ?? [];
  const usePicker = subjectPickers.find((p) => activeModules.includes(p.moduleKey)) ?? null;

  useEffect(() => {
    if (!resourceId && professionals.length === 1) setResourceId(professionals[0]!.id);
  }, [professionals, resourceId]);

  // A sala escolhida deixou de servir para os serviços marcados: limpa.
  useEffect(() => {
    if (roomId && resources.data && !rooms.some((r) => r.id === roomId)) setRoomId('');
  }, [rooms, roomId, resources.data]);

  const save = useMutation({
    mutationFn: async (): Promise<{ appointment: Appointment; series?: SeriesResult }> => {
      const body = { customerId: customer?.id, resourceId, roomId: roomId || null, serviceIds, startsAt: localToUtc(date, time).toISOString(), notes: notes || null, subject };
      if (!repeat.on) return { appointment: await api<Appointment>('/scheduling/appointments', { method: 'POST', body }) };
      const recurrence = { frequency: repeat.frequency, ...(repeat.end === 'count' ? { count: Number(repeat.count) } : { until: repeat.until }) };
      const series = await api<SeriesResult>('/scheduling/appointments/series', { method: 'POST', body: { ...body, recurrence } });
      return { appointment: series.created[0]!, series };
    },
    onSuccess: ({ appointment, series }) => {
      queryClient.invalidateQueries({ queryKey: schedulingKey });
      // Algumas datas não couberam: mostra quais antes de fechar.
      if (series?.skipped.length) setResult(series);
      else onSaved(appointment);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao marcar'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!customer) return setError('Escolha o cliente');
    if (!serviceIds.length) return setError('Escolha ao menos um serviço');
    if (!resourceId) return setError('Escolha o profissional');
    if (!time) return setError('Escolha o horário');
    if (repeat.on && repeat.end === 'count' && !(Number(repeat.count) >= 2 && Number(repeat.count) <= MAX_OCCURRENCES)) return setError(`Repetir de 2 a ${MAX_OCCURRENCES} vezes`);
    if (repeat.on && repeat.end === 'until' && !(repeat.until > date)) return setError('A data final precisa ser depois do primeiro dia');
    setError(null);
    save.mutate();
  }

  if (result) {
    const fmt = (d: string) => d.split('-').reverse().join('/');
    return (
      <Modal
        open
        title="Horários marcados"
        onClose={() => onSaved(result.created[0]!)}
        footer={<Button onClick={() => onSaved(result.created[0]!)}>Ok</Button>}
      >
        <div className="space-y-3 text-sm">
          <p>
            <strong>{result.created.length}</strong> {result.created.length === 1 ? 'marcado' : 'marcados'}, <strong>{result.skipped.length}</strong> não{' '}
            {result.skipped.length === 1 ? 'coube' : 'couberam'}:
          </p>
          <ul className="space-y-1">
            {result.skipped.map((s) => (
              <li key={s.date} className="flex justify-between gap-2 rounded-lg bg-muted px-3 py-1.5">
                <span className="tabular-nums">
                  {fmt(s.date)} às {s.time}
                </span>
                <span className="text-fg-muted">{s.reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-muted">Essas datas podem ser marcadas avulsas, em outro horário.</p>
        </div>
      </Modal>
    );
  }

  const freeLater = time && !slots.includes(time);

  return (
    <Modal
      open
      title="Novo horário"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-fg-muted">
            {duration ? `${duration} min · ${formatMoney(total)}` : ''}
            {duration && time ? ` · termina ${hhmmOf(minutesOf(time) + duration)}` : ''}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="appointment-form" loading={save.isPending}>
            Marcar
          </Button>
        </>
      }
    >
      <form id="appointment-form" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <div>
          <p className="mb-1.5 text-sm font-medium">Cliente</p>
          {customer ? (
            <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
              <span>
                <span className="font-medium">{customer.name}</span>
                <span className="ml-2 text-sm text-fg-muted">{formatPhone(customer.phone)}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                Trocar
              </Button>
            </div>
          ) : (
            <CustomerSearch onSelect={setCustomer} />
          )}
        </div>

        {usePicker && customer && (
          <div>
            <p className="mb-1.5 text-sm font-medium">{usePicker.label}</p>
            <usePicker.Component customerId={customer.id} value={subject} onChange={setSubject} />
          </div>
        )}

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Serviços</legend>
          {services.isPending ? (
            <Spinner />
          ) : (
            <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
              {services.data
                ?.filter((s) => s.active)
                .map((s) => (
                  <Checkbox
                    key={s.id}
                    label={
                      <span>
                        {s.name} <span className="text-fg-muted">· {s.durationMin} min · {formatMoney(s.price)}</span>
                      </span>
                    }
                    checked={serviceIds.includes(s.id)}
                    onChange={(e) => setServiceIds(e.target.checked ? [...serviceIds, s.id] : serviceIds.filter((id) => id !== s.id))}
                  />
                ))}
            </div>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Profissional">
            {(id) => (
              <Select id={id} value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                <option value="">Escolha</option>
                {professionals.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Dia">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>

        {(allRooms.length > 0 || needsRoom) && (
          <Field label="Sala/equipamento" hint={needsRoom ? 'Algum serviço precisa de sala: sem escolher, fica a primeira livre.' : undefined}>
            {(id) => (
              <Select id={id} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">{needsRoom ? 'Automática (primeira livre)' : 'Nenhuma'}</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <div>
          <p className="mb-1.5 text-sm font-medium">Horário</p>
          {!serviceIds.length || !resourceId ? (
            <p className="text-sm text-fg-muted">Escolha os serviços e o profissional para ver os horários livres.</p>
          ) : availability.isPending ? (
            <Spinner label="Buscando horários livres…" />
          ) : (
            <>
              {slots.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setTime(s)}
                      className={`rounded-full border px-3 py-1 text-sm tabular-nums ${s === time ? 'border-brand-600 bg-brand-600 text-white' : 'border-line hover:border-fg'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-fg-muted">Sem horário livre neste dia para estes serviços.</p>
              )}
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="text-fg-muted">Outro horário:</span>
                <Input type="time" aria-label="Outro horário" className="w-28" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              {freeLater && <p className="mt-1 text-xs text-warning-700">Fora da lista de livres: confira se não passa do expediente.</p>}
            </>
          )}
        </div>

        <fieldset className="space-y-3 rounded-lg border border-line p-3">
          <Checkbox label="Repetir" checked={repeat.on} onChange={(e) => setRepeat({ ...repeat, on: e.target.checked })} />
          {repeat.on && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Frequência">
                  {(id) => (
                    <Select id={id} value={repeat.frequency} onChange={(e) => setRepeat({ ...repeat, frequency: e.target.value as RecurrenceFrequency })}>
                      {recurrenceFrequencies.map((f) => (
                        <option key={f} value={f}>
                          {recurrenceLabel[f]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Termina">
                  {(id) => (
                    <div className="flex gap-2">
                      <Select id={id} className="w-40" value={repeat.end} onChange={(e) => setRepeat({ ...repeat, end: e.target.value as 'count' | 'until' })}>
                        <option value="count">Depois de</option>
                        <option value="until">Em</option>
                      </Select>
                      {repeat.end === 'count' ? (
                        <Input
                          type="number"
                          aria-label="Quantas vezes"
                          min={2}
                          max={MAX_OCCURRENCES}
                          className="w-24"
                          value={repeat.count}
                          onChange={(e) => setRepeat({ ...repeat, count: e.target.value })}
                        />
                      ) : (
                        <Input type="date" aria-label="Até o dia" min={date} value={repeat.until} onChange={(e) => setRepeat({ ...repeat, until: e.target.value })} />
                      )}
                    </div>
                  )}
                </Field>
              </div>
              <p className="text-xs text-fg-muted">
                {repeat.end === 'count' ? 'O total conta esta data e as que não couberem. ' : ''}Mesmo horário em todas. No mensal, vale o mesmo dia do mês (meses sem esse dia ficam de fora). Datas
                ocupadas, de folga ou fora do expediente são puladas e aparecem no final. Máximo de {MAX_OCCURRENCES}.
              </p>
            </>
          )}
        </fieldset>

        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
