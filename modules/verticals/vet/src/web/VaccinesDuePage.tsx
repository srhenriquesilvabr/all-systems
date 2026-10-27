import { api, formatDate, formatPhone, SpreadsheetImport, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Card, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { VaccineDue } from '../contracts';
import { vaccinationImportSpec } from './vaccinationImport';
import { vetKey } from './VaccinesTab';

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Reforços vencidos e a vencer, para a recepção ligar ou mandar mensagem. */
export function VaccinesDuePage() {
  const canWrite = useCan('vet.vaccines.write');
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);
  const now = today();
  const until = addDays(now, days);
  const due = useQuery({ queryKey: [...vetKey, 'due', until], queryFn: () => api<VaccineDue[]>('/vet/vaccinations/due', { query: { until } }) });

  return (
    <>
      <PageHeader
        title="Vacinas a vencer"
        description="Reforços vencidos e próximos. O tutor recebe lembrete automático antes do vencimento."
        actions={
          <>
            <Select aria-label="Período" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              <option value="7">Próximos 7 dias</option>
              <option value="30">Próximos 30 dias</option>
              <option value="90">Próximos 90 dias</option>
            </Select>
            {canWrite && <SpreadsheetImport spec={vaccinationImportSpec()} onImported={() => queryClient.invalidateQueries({ queryKey: vetKey })} />}
          </>
        }
      />
      <Card>
        {due.isPending ? (
          <Spinner />
        ) : due.isError ? (
          <div className="p-4">
            <Alert>{due.error.message}</Alert>
          </div>
        ) : due.data.length === 0 ? (
          <EmptyState title="Nenhum reforço no período" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reforço</Th>
                <Th>Pet</Th>
                <Th>Vacina</Th>
                <Th>Tutor</Th>
                <Th>Lembrete</Th>
              </tr>
            </thead>
            <tbody>
              {due.data.map((v) => (
                <tr key={v.id}>
                  <Td className="whitespace-nowrap tabular-nums">
                    {formatDate(v.nextDueOn)} {v.nextDueOn < now && <Badge tone="danger">Vencida</Badge>}
                  </Td>
                  <Td>
                    <Link to={`/pets/${v.pet.id}`} className="font-medium text-brand-700 hover:underline">
                      {v.pet.name}
                    </Link>
                  </Td>
                  <Td>{v.vaccine}</Td>
                  <Td>
                    {v.tutor.name}
                    {v.tutor.phone && <span className="ml-2 text-sm text-fg-muted">{formatPhone(v.tutor.phone)}</span>}
                  </Td>
                  <Td>{v.reminderSentAt ? <Badge tone="success">Enviado</Badge> : <span className="text-fg-subtle">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
