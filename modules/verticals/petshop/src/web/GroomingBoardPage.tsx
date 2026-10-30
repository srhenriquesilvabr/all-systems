import { api, ApiError, formatDate, formatDateTime, formatPhone, useCan } from '@all/module-sdk/web';
import { PetPicker } from '@all/pets/web';
import { AppointmentDetails, localToUtc, localTime, schedulingKey, shiftDate, todayLocal, useAppointments, type SubjectValue } from '@all/scheduling/web';
import type { Appointment, AppointmentStatus } from '@all/scheduling';
import { Alert, Badge, Button, Card, Checkbox, Input, PageHeader, Spinner } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

const columns: { key: string; label: string; statuses: AppointmentStatus[]; next?: { status: AppointmentStatus; label: string } }[] = [
  { key: 'waiting', label: 'A chegar', statuses: ['scheduled', 'confirmed'], next: { status: 'arrived', label: 'Chegou' } },
  { key: 'arrived', label: 'Na loja', statuses: ['arrived'], next: { status: 'in_service', label: 'Iniciar' } },
  { key: 'service', label: 'No banho / tosa', statuses: ['in_service'], next: { status: 'done', label: 'Pronto' } },
  { key: 'done', label: 'Pronto para buscar', statuses: ['done'] },
  { key: 'gone', label: 'Já buscado', statuses: ['done'] },
];

const pickupsKey = ['petshop', 'pickups'];
interface Pickup {
  appointmentId: string;
  pickedUpAt: string;
  userName: string | null;
}

/** Quadro do banho e tosa: cada pet anda da chegada até "pronto" (que avisa o tutor) e a saída com o tutor. */
export function GroomingBoardPage() {
  const today = todayLocal();
  const [day, setDay] = useState(today);
  const [from, to] = useMemo(() => [localToUtc(day, '00:00'), localToUtc(day, '23:59')], [day]);
  const appointments = useAppointments(from, to);
  const pickups = useQuery({
    queryKey: [...pickupsKey, day],
    queryFn: () => api<Pickup[]>('/petshop/pickups', { query: { from: from.toISOString(), to: to.toISOString() } }),
    refetchInterval: 30_000,
  });
  const pickupOf = (id: string) => pickups.data?.find((p) => p.appointmentId === id);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title={day === today ? 'Banho e tosa — hoje' : `Banho e tosa — ${formatDate(day)}`}
        description="Marque a chegada, o início e quando o pet ficar pronto. Ao marcar pronto, o tutor recebe o aviso. Quando ele buscar, registre a saída."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" aria-label="Dia anterior" onClick={() => setDay(shiftDate(day, -1))}>
              ‹
            </Button>
            <Input type="date" aria-label="Dia" className="w-40" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            <Button variant="secondary" aria-label="Próximo dia" onClick={() => setDay(shiftDate(day, 1))}>
              ›
            </Button>
            {day !== today && (
              <Button variant="ghost" onClick={() => setDay(today)}>
                Hoje
              </Button>
            )}
            <Link to="/agenda">
              <Button variant="secondary">Abrir agenda</Button>
            </Link>
          </div>
        }
      />
      {appointments.isPending ? (
        <Spinner />
      ) : appointments.isError ? (
        <Alert>{appointments.error.message}</Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {columns.map((col) => {
            const items = appointments.data.filter((a) => col.statuses.includes(a.status) && (col.key === 'done' ? !pickupOf(a.id) : col.key === 'gone' ? !!pickupOf(a.id) : true));
            return (
              <section key={col.key} className="rounded-2xl bg-muted/60 p-3">
                <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-medium">
                  {col.label}
                  <span className="rounded-full bg-surface px-2 text-xs tabular-nums text-fg-muted">{items.length}</span>
                </h2>
                <div className="space-y-2">
                  {items.map((a) => (
                    <PetCard key={a.id} appointment={a} next={col.next} pickup={pickupOf(a.id)} column={col.key} onOpen={() => setOpenId(a.id)} />
                  ))}
                  {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-fg-subtle">Nenhum</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <SettingsCard />
      {openId && <AppointmentDetails id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function PetCard({
  appointment: a,
  next,
  pickup,
  column,
  onOpen,
}: {
  appointment: Appointment;
  next?: { status: AppointmentStatus; label: string };
  pickup?: Pickup;
  column: string;
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const canMove = useCan('shared.scheduling.status');
  const canWrite = useCan('shared.scheduling.write');
  const canSetPet = canMove || canWrite;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: schedulingKey });
    queryClient.invalidateQueries({ queryKey: pickupsKey });
  };
  const move = useMutation({
    mutationFn: (status: AppointmentStatus) => api(`/scheduling/appointments/${a.id}/status`, { method: 'POST', body: { status } }),
    onSuccess: refresh,
  });
  const pickUp = useMutation({ mutationFn: () => api(`/petshop/appointments/${a.id}/pickup`, { method: 'POST' }), onSuccess: refresh });
  const undo = useMutation({ mutationFn: () => api(`/petshop/appointments/${a.id}/pickup`, { method: 'DELETE' }), onSuccess: refresh });
  const setPet = useMutation({ mutationFn: (petId: string) => api(`/petshop/appointments/${a.id}/pet`, { method: 'POST', body: { petId } }), onSuccess: refresh });
  const [choosing, setChoosing] = useState(false);
  const error = move.error ?? pickUp.error ?? undo.error ?? setPet.error;
  const open = !['done', 'no_show', 'cancelled'].includes(a.status);

  return (
    <Card className="p-3 text-sm">
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{a.subject?.label ?? a.customer.name}</span>
          <span className="tabular-nums text-fg-muted">{localTime(a.startsAt)}</span>
        </div>
        {a.subject && (
          <div className="text-fg-muted">
            {a.customer.name}
            {a.customer.phone && ` · ${formatPhone(a.customer.phone)}`}
          </div>
        )}
        <div className="mt-1 text-xs text-fg-muted">{a.services.map((s) => s.name).join(', ')}</div>
      </button>
      {error && (
        <div className="mt-2">
          <Alert>{error instanceof ApiError ? error.message : 'Erro ao atualizar'}</Alert>
        </div>
      )}
      {!a.subject && (
        <div className="mt-2 space-y-1.5">
          <Badge tone="warning">Sem pet: o aviso de pronto não sai</Badge>
          {open && canSetPet && !choosing && (
            <Button size="sm" variant="secondary" className="w-full" onClick={() => setChoosing(true)}>
              Escolher o pet
            </Button>
          )}
          {choosing && <PetPicker customerId={a.customer.id} value={null} onChange={(v: SubjectValue | null) => v && setPet.mutate(v.id)} />}
        </div>
      )}
      {next && canMove && (
        <Button size="sm" className="mt-2 w-full" loading={move.isPending} onClick={() => move.mutate(next.status)}>
          {next.label}
        </Button>
      )}
      {column === 'done' && canMove && (
        <Button size="sm" variant="secondary" className="mt-2 w-full" loading={pickUp.isPending} onClick={() => pickUp.mutate()}>
          Tutor buscou
        </Button>
      )}
      {column === 'gone' && pickup && (
        <div className="mt-2 text-xs text-fg-muted">
          Saiu em {formatDateTime(pickup.pickedUpAt)}
          {pickup.userName && ` · ${pickup.userName}`}
          {canMove && (
            <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => undo.mutate()}>
              desfazer
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function SettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['modules', 'petshop', 'settings'],
    queryFn: () => api<{ notifyReady: boolean }>('/modules/petshop/settings'),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (notifyReady: boolean) => api('/modules/petshop/settings', { method: 'PUT', body: { notifyReady } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['modules', 'petshop', 'settings'] }),
  });
  if (!settings.data) return null; // sem permissão de configurar: não aparece

  return (
    <Card className="mt-6 p-5">
      <Checkbox
        label="Avisar o tutor (WhatsApp ou e-mail) quando o pet ficar pronto"
        checked={settings.data.notifyReady}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.checked)}
      />
    </Card>
  );
}
