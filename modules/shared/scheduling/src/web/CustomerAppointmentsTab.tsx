import { api, formatDateTime, formatMoney } from '@all/module-sdk/web';
import { Alert, Badge, Card, EmptyState, Spinner, Table, Td, Th } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { appointmentStatusLabel, type Appointment } from '../contracts';
import { AppointmentDetails, statusTone } from './AppointmentDetails';
import { schedulingKey } from './hooks';

/** Aba "Agendamentos" na ficha do cliente: histórico e próximos horários. */
export function CustomerAppointmentsTab({ customerId }: { customerId: string }) {
  const list = useQuery({
    queryKey: [...schedulingKey, 'customer', customerId],
    queryFn: () => api<Appointment[]>('/scheduling/appointments', { query: { customerId } }),
  });
  const [openId, setOpenId] = useState<string | null>(null);

  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  if (!list.data.length) return <EmptyState title="Nenhum agendamento deste cliente" />;

  return (
    <>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Quando</Th>
              <Th>Serviços</Th>
              <Th>Profissional</Th>
              <Th className="text-right">Valor</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {[...list.data].reverse().map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpenId(a.id)}>
                <Td className="whitespace-nowrap tabular-nums">{formatDateTime(a.startsAt)}</Td>
                <Td>
                  {a.subject && <span className="text-fg-muted">{a.subject.label} · </span>}
                  {a.services.map((s) => s.name).join(', ')}
                </Td>
                <Td>{a.resourceName}</Td>
                <Td className="text-right tabular-nums">{formatMoney(a.total)}</Td>
                <Td>
                  <Badge tone={statusTone[a.status]}>{appointmentStatusLabel[a.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {openId && <AppointmentDetails id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
