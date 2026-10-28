import { formatDate, formatDateTime, formatMoney, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Th } from '@all/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { specialtyDescription, specialtyLabel, surgeryStageLabel, type AesCase, type SpecialtyKey } from '../../contracts';
import { BudgetEditor, CaseCard, NewCaseForm } from './Cases';
import { useCases, useSpecialtyOverview } from './hooks';
import { PatientSpecialties } from './PatientSpecialties';

function NoSpecialties() {
  const canSetup = useCan('aesthetics.setup.manage');
  return (
    <Card>
      <EmptyState
        title="Nenhuma especialidade ligada"
        description="Harmonização facial, clareamento, cirurgia plástica, micropigmentação, laser e tricologia são ligadas nas configurações da clínica."
        action={
          canSetup ? (
            <Link to="/estetica/cadastros" className="text-sm font-medium text-brand-700 hover:underline">
              Ligar especialidades
            </Link>
          ) : undefined
        }
      />
    </Card>
  );
}

/** Tratamentos em andamento por especialidade; o paciente abre na própria página. */
export function SpecialtiesPage() {
  const overview = useSpecialtyOverview();
  const [tab, setTab] = useState<string | null>(null);
  const [status, setStatus] = useState('active');
  const [patient, setPatient] = useState<{ id: string; name: string; specialty: SpecialtyKey } | null>(null);
  const [creating, setCreating] = useState(false);
  const canWrite = useCan('shared.medical-records.write');
  const enabled = overview.data?.enabled ?? [];
  const specialty = (tab ?? enabled[0]) as SpecialtyKey | undefined;
  const cases = useCases({ specialty, status: status || undefined });

  if (overview.isPending) return <Spinner />;
  if (overview.isError) return <Alert>{overview.error.message}</Alert>;
  return (
    <>
      <PageHeader
        title="Especialidades"
        description="Tratamentos em andamento. Fichas, fotos e termos ficam no prontuário de cada paciente."
        actions={
          specialty && (
            <>
              <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Em andamento</option>
                <option value="finished">Concluídos</option>
                <option value="cancelled">Cancelados</option>
                <option value="">Todos</option>
              </Select>
              {canWrite && <Button onClick={() => setCreating(true)}>Novo tratamento</Button>}
            </>
          )
        }
      />
      {!specialty ? (
        <NoSpecialties />
      ) : (
        <>
          <Tabs items={enabled.map((k) => ({ key: k, label: specialtyLabel[k] }))} active={specialty} onChange={setTab} />
          <p className="mb-3 text-sm text-fg-muted">{specialtyDescription[specialty]}</p>
          <Card>
            {cases.isPending ? (
              <Spinner />
            ) : cases.isError ? (
              <div className="p-4">
                <Alert>{cases.error.message}</Alert>
              </div>
            ) : cases.data.length === 0 ? (
              <EmptyState title="Nenhum tratamento" />
            ) : (
              <CasesTable cases={cases.data} onOpen={(c) => setPatient({ id: c.customer.id, name: c.customer.name, specialty })} />
            )}
          </Card>
        </>
      )}
      {patient && (
        <Modal open title={patient.name} onClose={() => setPatient(null)}>
          <PatientSpecialties customerId={patient.id} enabled={enabled} initial={patient.specialty} />
        </Modal>
      )}
      {creating && specialty && <NewCaseForm specialty={specialty} onClose={() => setCreating(false)} />}
    </>
  );
}

function CasesTable({ cases, onOpen }: { cases: AesCase[]; onOpen: (c: AesCase) => void }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Paciente</Th>
          <Th>Tratamento</Th>
          <Th>Profissional</Th>
          <Th>Andamento</Th>
          <Th>Início</Th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <tr key={c.id}>
            <Td>
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onOpen(c)}>
                {c.customer.name}
              </button>
            </Td>
            <Td>{c.title}</Td>
            <Td>{c.professional?.name ?? '—'}</Td>
            <Td className="whitespace-nowrap">
              {c.stage ? (
                <>
                  <Badge tone="warning">{surgeryStageLabel[c.stage]}</Badge>
                  {c.surgery && c.surgery.status !== 'cancelled' && <div className="text-xs text-fg-muted">{formatDateTime(c.surgery.startsAt)}</div>}
                </>
              ) : c.plannedSessions ? (
                `${c.doneSessions} de ${c.plannedSessions} sessões`
              ) : (
                `${c.doneSessions} sessão(ões)`
              )}
            </Td>
            <Td className="whitespace-nowrap tabular-nums">{formatDate(c.startedOn)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Orçamentos de cirurgia (recepção/gestão): monta, aprova e lança no financeiro. */
export function SurgeryBudgetsPage() {
  const overview = useSpecialtyOverview();
  const [status, setStatus] = useState('active');
  const cases = useCases({ specialty: 'plastic_surgery', status: status || undefined });
  const [open, setOpen] = useState<AesCase | null>(null);
  const [details, setDetails] = useState<AesCase | null>(null);
  if (overview.isPending) return <Spinner />;
  const enabled = overview.data?.enabled.includes('plastic_surgery');
  return (
    <>
      <PageHeader
        title="Orçamentos de cirurgia"
        description="Honorários, anestesia, hospital, próteses e materiais. Aprovado, a parte da clínica vira contas a receber."
        actions={
          <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Em andamento</option>
            <option value="finished">Concluídos</option>
            <option value="cancelled">Cancelados</option>
            <option value="">Todos</option>
          </Select>
        }
      />
      {!enabled ? (
        <NoSpecialties />
      ) : (
        <Card>
          {cases.isPending ? (
            <Spinner />
          ) : cases.isError ? (
            <div className="p-4">
              <Alert>{cases.error.message}</Alert>
            </div>
          ) : cases.data.length === 0 ? (
            <EmptyState title="Nenhuma cirurgia" description="A cirurgia é aberta no prontuário do paciente (Especialidades › Cirurgia plástica)." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Paciente</Th>
                  <Th>Cirurgia</Th>
                  <Th>Etapa</Th>
                  <Th>Orçamento</Th>
                  <Th className="text-right">Clínica</Th>
                  <Th className="text-right">Terceiros</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {cases.data.map((c) => (
                  <tr key={c.id}>
                    <Td className="font-medium">{c.customer.name}</Td>
                    <Td>{c.title}</Td>
                    <Td>{c.stage ? surgeryStageLabel[c.stage] : '—'}</Td>
                    <Td>{!c.budget ? <Badge>Sem orçamento</Badge> : c.budget.status === 'approved' ? <Badge tone="success">Aprovado em {formatDate(c.budget.approvedOn!)}</Badge> : <Badge tone="warning">Rascunho</Badge>}</Td>
                    <Td className="text-right tabular-nums">{c.budget ? formatMoney(c.budget.clinicTotal) : '—'}</Td>
                    <Td className="text-right tabular-nums">{c.budget ? formatMoney(c.budget.thirdPartyTotal) : '—'}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetails(c)}>
                        Detalhes
                      </Button>
                      {c.status === 'active' && (
                        <Button size="sm" variant="secondary" onClick={() => setOpen(c)}>
                          {c.budget?.status === 'approved' ? 'Ver' : 'Montar'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      {open && <BudgetEditor item={open} onClose={() => setOpen(null)} />}
      {details && (
        <Modal open title={`${details.customer.name} — ${details.title}`} onClose={() => setDetails(null)}>
          <CaseCard item={details} />
        </Modal>
      )}
    </>
  );
}

export { SetupPage } from './SetupPage';
