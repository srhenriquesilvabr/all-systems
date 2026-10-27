import { api, ApiError, formatPhone, useCan } from '@all/module-sdk/web';
import { AppointmentDetails, localToUtc, localTime, schedulingKey, todayLocal, useAppointments } from '@all/scheduling/web';
import type { Appointment, AppointmentStatus } from '@all/scheduling';
import { Alert, Button, Card, Checkbox, PageHeader, Spinner } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

const columns: { key: string; label: string; statuses: AppointmentStatus[]; next?: { status: AppointmentStatus; label: string } }[] = [
  { key: 'waiting', label: 'A chegar', statuses: ['scheduled', 'confirmed'], next: { status: 'arrived', label: 'Chegou' } },
  { key: 'arrived', label: 'Na loja', statuses: ['arrived'], next: { status: 'in_service', label: 'Iniciar' } },
  { key: 'service', label: 'No banho / tosa', statuses: ['in_service'], next: { status: 'done', label: 'Pronto' } },
  { key: 'done', label: 'Pronto para buscar', statuses: ['done'] },
];

/** Quadro do dia do banho e tosa: cada pet anda da chegada até "pronto" (que avisa o tutor). */
export function GroomingBoardPage() {
  const today = todayLocal();
  const [from, to] = useMemo(() => [localToUtc(today, '00:00'), localToUtc(today, '23:59')], [today]);
  const appointments = useAppointments(from, to);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Banho e tosa — hoje"
        description="Marque a chegada, o início e quando o pet ficar pronto. Ao marcar pronto, o tutor recebe o aviso."
        actions={
          <Link to="/agenda">
            <Button variant="secondary">Abrir agenda</Button>
          </Link>
        }
      />
      {appointments.isPending ? (
        <Spinner />
      ) : appointments.isError ? (
        <Alert>{appointments.error.message}</Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((col) => {
            const items = appointments.data.filter((a) => col.statuses.includes(a.status));
            return (
              <section key={col.key} className="rounded-2xl bg-muted/60 p-3">
                <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-medium">
                  {col.label}
                  <span className="rounded-full bg-surface px-2 text-xs tabular-nums text-fg-muted">{items.length}</span>
                </h2>
                <div className="space-y-2">
                  {items.map((a) => (
                    <PetCard key={a.id} appointment={a} next={col.next} onOpen={() => setOpenId(a.id)} />
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

function PetCard({ appointment: a, next, onOpen }: { appointment: Appointment; next?: { status: AppointmentStatus; label: string }; onOpen: () => void }) {
  const queryClient = useQueryClient();
  const canMove = useCan('shared.scheduling.status');
  const move = useMutation({
    mutationFn: (status: AppointmentStatus) => api(`/scheduling/appointments/${a.id}/status`, { method: 'POST', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: schedulingKey }),
  });

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
      {move.error && (
        <div className="mt-2">
          <Alert>{move.error instanceof ApiError ? move.error.message : 'Erro ao atualizar'}</Alert>
        </div>
      )}
      {next && canMove && (
        <Button size="sm" className="mt-2 w-full" loading={move.isPending} onClick={() => move.mutate(next.status)}>
          {next.label}
        </Button>
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
