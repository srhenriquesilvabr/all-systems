import { api, ApiError, CustomerSearch, formatMoney, formatPhone, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import type { Appointment } from '../contracts';
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
  initial: { date: string; time?: string; resourceId?: string; customer?: CustomerOption | null };
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
  const [error, setError] = useState<string | null>(null);

  const professionals = (resources.data ?? []).filter((r) => r.active && r.kind === 'professional');
  const chosen = (services.data ?? []).filter((s) => serviceIds.includes(s.id));
  const duration = chosen.reduce((sum, s) => sum + s.durationMin + s.bufferMin, 0);
  const total = chosen.reduce((sum, s) => sum + s.price, 0);
  const availability = useAvailability(date, serviceIds, resourceId || undefined);
  const slots = availability.data?.find((a) => a.resourceId === resourceId)?.slots ?? [];
  const usePicker = subjectPickers.find((p) => activeModules.includes(p.moduleKey)) ?? null;

  useEffect(() => {
    if (!resourceId && professionals.length === 1) setResourceId(professionals[0]!.id);
  }, [professionals, resourceId]);

  const save = useMutation({
    mutationFn: () =>
      api<Appointment>('/scheduling/appointments', {
        method: 'POST',
        body: { customerId: customer?.id, resourceId, serviceIds, startsAt: localToUtc(date, time).toISOString(), notes: notes || null, subject },
      }),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: schedulingKey });
      onSaved(a);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao marcar'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!customer) return setError('Escolha o cliente');
    if (!serviceIds.length) return setError('Escolha ao menos um serviço');
    if (!resourceId) return setError('Escolha o profissional');
    if (!time) return setError('Escolha o horário');
    setError(null);
    save.mutate();
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

        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
