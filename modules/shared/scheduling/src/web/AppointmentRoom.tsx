import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Button, Field, Select, Spinner } from '@all/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Appointment, AppointmentRoomOptions } from '../contracts';
import { schedulingKey } from './hooks';

/** Salas que servem para o atendimento e se estão livres no horário dele (ou em `startsAt`, ao remarcar). */
export const useAppointmentRooms = (id: string, startsAt?: Date | null, enabled = true) =>
  useQuery({
    queryKey: [...schedulingKey, 'appointment-rooms', id, startsAt?.toISOString() ?? null],
    queryFn: () => api<AppointmentRoomOptions>(`/scheduling/appointments/${id}/rooms`, { query: { startsAt: startsAt?.toISOString() } }),
    enabled,
  });

/** Trocar, definir ou tirar a sala de um atendimento já marcado, no mesmo horário. */
export function RoomForm({ appointment, onDone, onBack }: { appointment: Appointment; onDone: () => void; onBack: () => void }) {
  const options = useAppointmentRooms(appointment.id);
  const [roomId, setRoomId] = useState(appointment.roomId ?? '');
  const save = useMutation({
    mutationFn: () => api<Appointment>(`/scheduling/appointments/${appointment.id}/room`, { method: 'PUT', body: { roomId: roomId || null } }),
    onSuccess: onDone,
  });
  const data = options.data;
  // Só as livres (e a atual): as ocupadas no horário não podem ser escolhidas.
  const choices = data?.rooms.filter((r) => r.free || r.id === appointment.roomId) ?? [];
  const busy = (data?.rooms.length ?? 0) - choices.length;
  const hint = data
    ? [
        data.requiresRoom ? 'Algum serviço exige sala: não pode ficar sem.' : null,
        !choices.length ? 'Nenhuma sala livre que sirva para estes serviços neste horário.' : null,
        busy === 1 ? 'Uma sala que serve já tem reserva neste horário.' : busy > 1 ? `${busy} salas que servem já têm reserva neste horário.` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  return (
    <div className="space-y-3 border-t border-line pt-4">
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar a sala'}</Alert>}
      {options.isPending ? (
        <Spinner />
      ) : options.isError ? (
        <Alert>{options.error.message}</Alert>
      ) : (
        <Field label="Sala/equipamento" hint={hint || undefined}>
          {(id) => (
            <Select id={id} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="" disabled={data!.requiresRoom}>
                {data!.requiresRoom ? 'Escolha a sala' : 'Sem sala'}
              </option>
              {choices.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.id === appointment.roomId ? ' (atual)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="flex gap-2">
        <Button size="sm" loading={save.isPending} disabled={!data || roomId === (appointment.roomId ?? '') || (data.requiresRoom && !roomId)} onClick={() => save.mutate()}>
          Salvar sala
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

/** Escolha da sala ao remarcar: '' = automática (a atual, se livre; senão outra livre), 'none' = sem sala, ou o id. */
export type RescheduleRoomChoice = string;

/** Corpo da remarcação: automática não manda nada; "sem sala" manda null. */
export const rescheduleRoomBody = (choice: RescheduleRoomChoice) => (choice === '' ? {} : { roomId: choice === 'none' ? null : choice });

/** Seletor de sala no novo horário (só aparece se há sala que sirva ou o atendimento já tem uma). */
export function RescheduleRoomSelect({
  appointment,
  startsAt,
  value,
  onChange,
}: {
  appointment: Appointment;
  startsAt: Date | null;
  value: RescheduleRoomChoice;
  onChange: (value: RescheduleRoomChoice) => void;
}) {
  const options = useAppointmentRooms(appointment.id, startsAt, !!startsAt);
  const data = options.data;
  useEffect(() => {
    if (!data) return;
    // Mudou o horário e a sala escolhida deixou de estar livre (ou passou a ser obrigatória): volta para automática.
    if (value === 'none' ? data.requiresRoom : value !== '' && !data.rooms.some((r) => r.id === value && r.free)) onChange('');
  }, [data, value, onChange]);
  if (!startsAt || !data || (!data.rooms.length && !appointment.roomId)) return null;
  const current = appointment.roomId ? data.rooms.find((r) => r.id === appointment.roomId) : null;
  const auto = current?.free ? `Manter ${current.name}` : appointment.roomId || data.requiresRoom ? 'Automática (primeira livre que serve)' : 'Sem sala';
  return (
    <Field label="Sala/equipamento no novo horário" hint={current && !current.free ? `${current.name} já tem reserva neste horário.` : undefined}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{auto}</option>
          {!data.requiresRoom && appointment.roomId && <option value="none">Sem sala</option>}
          {data.rooms
            .filter((r) => r.free && r.id !== appointment.roomId)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </Select>
      )}
    </Field>
  );
}
