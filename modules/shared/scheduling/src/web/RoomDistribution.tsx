import { api, ApiError, formatDateTime, useCan } from '@all/module-sdk/web';
import { Alert, Button, Modal } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RoomDistributionResult } from '../contracts';
import { schedulingKey, useResources } from './hooks';

/**
 * "Distribuir salas": os atendimentos futuros que exigem sala e estão sem (ex.: marcados antes de o
 * serviço passar a exigir sala) recebem a primeira sala livre que serve. Mostra o que ficou sem.
 */
export function DistributeRoomsButton() {
  const queryClient = useQueryClient();
  const canWrite = useCan('shared.scheduling.write');
  const hasRooms = useResources().data?.some((r) => r.kind === 'room' && r.active) ?? false;
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: () => api<RoomDistributionResult>('/scheduling/rooms/distribute', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: schedulingKey }),
    onSettled: () => setOpen(true),
  });
  if (!canWrite || !hasRooms) return null;
  const r = run.data;

  return (
    <>
      <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
        Distribuir salas nos atendimentos sem sala
      </Button>
      {open && (
        <Modal open title="Distribuir salas" onClose={() => setOpen(false)}>
          <div className="space-y-3 text-sm">
            {run.error ? (
              <Alert>{run.error instanceof ApiError ? run.error.message : 'Erro ao distribuir as salas'}</Alert>
            ) : r ? (
              <>
                <Alert tone={r.unassigned.length ? 'info' : 'success'}>
                  {r.assigned === 0 && !r.unassigned.length
                    ? 'Nenhum atendimento futuro que exige sala está sem sala.'
                    : `${r.assigned} atendimento(s) receberam sala.${r.unassigned.length ? ` ${r.unassigned.length} ficaram sem sala livre que sirva.` : ''}`}
                  {r.remaining > 0 && ` Ainda faltam ${r.remaining}: clique de novo para continuar.`}
                </Alert>
                {r.unassigned.length > 0 && (
                  <>
                    <p className="text-fg-muted">Sem sala livre no horário (remarque ou libere uma sala):</p>
                    <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                      {r.unassigned.map((u) => (
                        <li key={u.id}>
                          <span className="tabular-nums">{formatDateTime(u.startsAt)}</span> · {u.customerName}
                          <span className="text-fg-muted">
                            {' '}
                            — {u.services.join(', ')} com {u.resourceName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : null}
          </div>
        </Modal>
      )}
    </>
  );
}
