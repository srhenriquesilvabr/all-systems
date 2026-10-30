import { MedicalRecordTimeline, medicalRecordsKey, type AppointmentOption } from '@all/medical-records/web';
import { api, ApiError, formatDate, today, useCan } from '@all/module-sdk/web';
import type { Pet } from '@all/pets';
import type { Appointment, AvailabilitySlots } from '@all/scheduling';
import { localDate, localTime, localToUtc, schedulingKey, useResources, useServices } from '@all/scheduling/web';
import { Alert, Button, Field, Input, Select } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

const label = (a: Appointment) => `${formatDate(localDate(a.startsAt))} ${localTime(a.startsAt)} · ${a.services.map((s) => s.name).join(', ')}`;

/** Aba "Prontuário" na ficha do pet: cada consulta pode ficar ligada ao horário e marcar o retorno. */
export function PetRecordsTab({ pet }: { pet: Pet }) {
  const canReadAgenda = useCan('shared.scheduling.read');
  const appointments = useQuery({
    queryKey: [...schedulingKey, 'appointments', 'pet', pet.id],
    queryFn: () => api<Appointment[]>('/scheduling/appointments', { query: { customerId: pet.customerId } }),
    enabled: canReadAgenda,
  });
  const mine = useMemo(() => (appointments.data ?? []).filter((a) => a.subject?.id === pet.id || !a.subject), [appointments.data, pet.id]);
  const options: AppointmentOption[] = useMemo(() => {
    const now = today();
    return mine
      .filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
      .map((a) => ({ id: a.id, label: label(a), suggested: localDate(a.startsAt) === now && ['arrived', 'in_service', 'done'].includes(a.status) }))
      .sort((a, b) => Number(b.suggested) - Number(a.suggested));
  }, [mine]);

  return (
    <MedicalRecordTimeline
      subjectType="pet"
      subjectId={pet.id}
      appointments={canReadAgenda ? options : undefined}
      entryExtra={(entry) => {
        const returnOn = entry.data.returnOn;
        return typeof returnOn === 'string' ? <ReturnBlock pet={pet} returnOn={returnOn} appointments={mine} /> : null;
      }}
    />
  );
}

/** Retorno da consulta: mostra o horário já marcado para o dia, ou deixa marcar aqui mesmo. */
function ReturnBlock({ pet, returnOn, appointments }: { pet: Pet; returnOn: string; appointments: Appointment[] }) {
  const canRecord = useCan('shared.medical-records.write');
  const canBook = useCan('shared.scheduling.write');
  const canRead = useCan('shared.scheduling.read');
  const [open, setOpen] = useState(false);
  const booked = appointments.find((a) => a.subject?.id === pet.id && localDate(a.startsAt) === returnOn && a.status !== 'cancelled' && a.status !== 'no_show');
  if (booked) return <p className="mt-3 text-sm text-fg-muted print:hidden">Retorno marcado: {label(booked)}</p>;
  if (returnOn < today() || !canRead || !(canRecord || canBook)) return null;
  return open ? (
    <ReturnForm pet={pet} returnOn={returnOn} onClose={() => setOpen(false)} />
  ) : (
    <div className="mt-3 print:hidden">
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Marcar retorno
      </Button>
    </div>
  );
}

function ReturnForm({ pet, returnOn, onClose }: { pet: Pet; returnOn: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const resources = useResources();
  const services = useServices();
  const professionals = (resources.data ?? []).filter((r) => r.active && r.kind === 'professional');
  const active = (services.data ?? []).filter((s) => s.active);
  const [resourceId, setResourceId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(returnOn);
  const [time, setTime] = useState('');
  // Um serviço chamado "Retorno" é o caminho comum; um profissional só já vem escolhido.
  useEffect(() => {
    if (!serviceId) setServiceId(active.find((s) => s.name.toLowerCase().includes('retorno'))?.id ?? '');
    if (!resourceId && professionals.length === 1) setResourceId(professionals[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.data, resources.data]);
  const availability = useQuery({
    queryKey: [...schedulingKey, 'availability', date, serviceId, resourceId],
    queryFn: () => api<AvailabilitySlots[]>('/scheduling/availability', { query: { date, serviceIds: serviceId, resourceId } }),
    enabled: !!date && !!serviceId && !!resourceId,
  });
  const slots = availability.data?.find((a) => a.resourceId === resourceId)?.slots ?? [];
  const save = useMutation({
    mutationFn: () =>
      api(`/vet/pets/${pet.id}/return-appointment`, {
        method: 'POST',
        body: { resourceId, serviceIds: [serviceId], startsAt: localToUtc(date, time).toISOString(), notes: `Retorno de ${pet.name}` },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKey });
      queryClient.invalidateQueries({ queryKey: medicalRecordsKey });
      onClose();
    },
  });

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line p-3 print:hidden">
      <p className="text-sm font-medium">Marcar retorno de {pet.name}</p>
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao marcar'}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Serviço">
          {(id) => (
            <Select id={id} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Escolha</option>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
        <Field label="Dia">{(id) => <Input id={id} type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      {serviceId && resourceId && (
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
          {!availability.isPending && slots.length === 0 && <p className="text-sm text-fg-muted">Sem horário livre neste dia.</p>}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!time} loading={save.isPending} onClick={() => save.mutate()}>
          Marcar
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
