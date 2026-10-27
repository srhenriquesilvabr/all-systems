import { api, formatDate, SpreadsheetImport, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { caseAreaLabel, caseStatuses, caseStatusLabel, type LegalCase } from '../contracts';
import { caseImportSpec } from './caseImport';
import { CaseModal, daysUntil, dueText, legalKey, statusTone } from './shared';

export function CasesTable({ cases, showCustomer = true }: { cases: LegalCase[]; showCustomer?: boolean }) {
  const navigate = useNavigate();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Processo</Th>
          {showCustomer && <Th>Cliente</Th>}
          <Th>Área</Th>
          <Th>Próximo prazo</Th>
          <Th>Situação</Th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <tr key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/juridico/processos/${c.id}`)}>
            <Td>
              <div className="font-medium">{c.title}</div>
              <div className="text-xs tabular-nums text-fg-muted">{c.number ?? 'Sem número'}</div>
            </Td>
            {showCustomer && <Td>{c.customer.name}</Td>}
            <Td>{caseAreaLabel[c.area]}</Td>
            <Td className="whitespace-nowrap">
              {c.nextDeadline ? (
                <>
                  <div className="tabular-nums">{formatDate(c.nextDeadline.dueOn)}</div>
                  <div className={daysUntil(c.nextDeadline.dueOn) <= 2 ? 'text-xs font-medium text-danger-600' : 'text-xs text-fg-muted'}>{dueText(c.nextDeadline.dueOn)}</div>
                </>
              ) : (
                <span className="text-fg-subtle">—</span>
              )}
            </Td>
            <Td>
              <Badge tone={statusTone[c.status]}>{caseStatusLabel[c.status]}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function CasesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCan('legal.cases.write');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const cases = useQuery({
    queryKey: [...legalKey, 'cases', { q, status }],
    queryFn: () => api<LegalCase[]>('/legal/cases', { query: { q: q || undefined, status: status || undefined } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Processos"
        description="Casos do escritório, com o próximo prazo de cada um."
        actions={
          canWrite && (
            <>
              <SpreadsheetImport spec={caseImportSpec()} onImported={() => queryClient.invalidateQueries({ queryKey: legalKey })} />
              <Button onClick={() => setCreating(true)}>Novo processo</Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" aria-label="Buscar" placeholder="Título, número, cliente ou parte contrária" className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Situação" className="max-w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas as situações</option>
          {caseStatuses.map((s) => (
            <option key={s} value={s}>
              {caseStatusLabel[s]}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {cases.isPending ? (
          <Spinner />
        ) : cases.isError ? (
          <div className="p-4">
            <Alert>{cases.error.message}</Alert>
          </div>
        ) : cases.data.length === 0 ? (
          <EmptyState title="Nenhum processo" action={canWrite && !q && <Button onClick={() => setCreating(true)}>Cadastrar processo</Button>} />
        ) : (
          <CasesTable cases={cases.data} />
        )}
      </Card>
      {creating && <CaseModal legalCase={null} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/juridico/processos/${c.id}`)} />}
    </>
  );
}

/** Aba "Processos" na ficha do cliente. */
export function CustomerCasesTab({ customerId }: { customerId: string }) {
  const canWrite = useCan('legal.cases.write');
  const [creating, setCreating] = useState(false);
  const cases = useQuery({ queryKey: [...legalKey, 'cases', { customerId }], queryFn: () => api<LegalCase[]>('/legal/cases', { query: { customerId } }) });
  if (cases.isPending) return <Spinner />;
  if (cases.isError) return <Alert>{cases.error.message}</Alert>;
  return (
    <>
      {canWrite && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            Novo processo
          </Button>
        </div>
      )}
      <Card>{cases.data.length === 0 ? <EmptyState title="Nenhum processo deste cliente" /> : <CasesTable cases={cases.data} showCustomer={false} />}</Card>
      {creating && <CaseModal legalCase={null} customer={{ id: customerId }} onClose={() => setCreating(false)} />}
    </>
  );
}
