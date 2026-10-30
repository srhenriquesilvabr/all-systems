import type { MedicalEntry, MedicalForm } from '@all/medical-records';
import { MedicalRecordTimeline } from '@all/medical-records/web';
import { api, useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Spinner, Tabs } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { sessionForms, specialtyForms, specialtyLabel, type AesCase, type SpecialtyKey } from '../../contracts';
import { CaseCard, NewCaseForm } from './Cases';
import { ConsentForm } from './Consent';
import { usePatientSpecialties, useSpecialtyOverview } from './hooks';
import { PhotoBoard } from './Photos';
import { ScheduleReturn, SpecialtyEntryCard, SpecialtyRecordForm, useCanSchedule } from './RecordForm';

const common = new Map(specialtyForms.common.map((f) => [f.key, f]));
const formOf = (key: string) => Object.values(specialtyForms).flat().find((f) => f.key === key);
/** Serviço sugerido para o retorno/retoque de cada ficha (busca por parte do nome). */
const returnService: Record<string, string[]> = {
  'aesthetics.harmonization': ['Retorno de injetáveis', 'retoque'],
  'aesthetics.micropigmentation': ['Retoque de micropigmentação', 'retoque'],
  'aesthetics.laser': ['Depilação a laser'],
  'aesthetics.surgery.postop': ['Retorno pós-operatório'],
};

/** Aba "Prontuário" do paciente: especialidades ligadas (se houver) e o prontuário completo. */
export function CustomerRecordsTab({ customerId }: { customerId: string }) {
  const overview = useSpecialtyOverview();
  if (overview.isPending) return <Spinner />;
  // Nenhuma especialidade ligada: o prontuário de sempre.
  if (!overview.data?.enabled.length) return <MedicalRecordTimeline subjectType="customer" subjectId={customerId} />;
  return <PatientSpecialties customerId={customerId} enabled={overview.data.enabled} />;
}

/** Fichas, tratamentos, fotos e termos do paciente, por especialidade. */
export function PatientSpecialties({ customerId, enabled, initial }: { customerId: string; enabled: SpecialtyKey[]; initial?: SpecialtyKey }) {
  const [tab, setTab] = useState<string>(initial ?? 'records');
  const items = [{ key: 'records', label: 'Prontuário completo' }, ...enabled.map((k) => ({ key: k, label: specialtyLabel[k] }))];
  return (
    <div>
      <Tabs items={items} active={tab} onChange={setTab} />
      {tab === 'records' ? <MedicalRecordTimeline subjectType="customer" subjectId={customerId} /> : <SpecialtyPanel key={tab} customerId={customerId} specialty={tab as SpecialtyKey} />}
    </div>
  );
}

type Writing = { kind: 'record'; form: MedicalForm; caseId?: string; nextSession?: number; amends?: MedicalEntry } | { kind: 'consent'; caseId?: string } | { kind: 'case' } | { kind: 'return'; formKey: string; date: string; professionalId: string | null };

function SpecialtyPanel({ customerId, specialty }: { customerId: string; specialty: SpecialtyKey }) {
  const data = usePatientSpecialties(customerId);
  const customer = useQuery({ queryKey: ['aesthetics', 'customer-name', customerId], queryFn: () => api<{ name: string }>(`/customers/${customerId}`), retry: false });
  const canWrite = useCan('shared.medical-records.write');
  const canSchedule = useCanSchedule();
  const [writing, setWriting] = useState<Writing | null>(null);
  const [section, setSection] = useState('records');
  if (data.isPending) return <Spinner />;
  if (data.isError) return <Alert>{data.error.message}</Alert>;

  const label = specialtyLabel[specialty];
  const own = new Set(specialtyForms[specialty].map((f) => f.key));
  const mine = (e: MedicalEntry) => own.has(e.formKey) || (common.has(e.formKey) && e.data.specialty === label);
  const entries = data.data.entries.filter(mine);
  const photos = entries.filter((e) => e.formKey === 'aesthetics.photo');
  const records = entries.filter((e) => e.formKey !== 'aesthetics.photo');
  const cases = data.data.cases.filter((c) => c.specialty === specialty);
  const nextSession = (c?: AesCase) => (c ? c.doneSessions + 1 : undefined);
  const sessionForm = specialtyForms[specialty].find((f) => sessionForms.includes(f.key)) ?? specialtyForms[specialty][0]!;

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { key: 'records', label: `Fichas (${records.length})` },
          { key: 'cases', label: `Tratamentos (${cases.length})` },
          { key: 'photos', label: `Fotos (${photos.filter((p) => p.attachments.length).length})` },
        ]}
        active={section}
        onChange={setSection}
      />
      {section === 'records' && (
        <>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {specialtyForms[specialty].map((f) => (
                <Button key={f.key} size="sm" onClick={() => setWriting({ kind: 'record', form: f, nextSession: sessionForms.includes(f.key) ? nextSession(cases.find((c) => c.status === 'active')) : undefined })}>
                  + {f.label}
                </Button>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setWriting({ kind: 'consent' })}>
                + Termo de consentimento
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setWriting({ kind: 'record', form: common.get('aesthetics.complication')! })}>
                + Intercorrência
              </Button>
            </div>
          )}
          {records.length === 0 ? (
            <Card>
              <EmptyState title={`Nenhuma ficha de ${label.toLowerCase()}`} description="As fichas entram no prontuário e não podem ser apagadas, só retificadas." />
            </Card>
          ) : (
            <ol className="space-y-3">
              {records.map((e) => (
                <li key={e.id}>
                  <SpecialtyEntryCard
                    entry={e}
                    form={formOf(e.formKey)}
                    onAmend={canWrite && formOf(e.formKey) && e.formKey !== 'aesthetics.consent' ? () => setWriting({ kind: 'record', form: formOf(e.formKey)!, amends: e }) : undefined}
                    onSchedule={canSchedule && returnService[e.formKey] ? (date, professionalId) => setWriting({ kind: 'return', formKey: e.formKey, date, professionalId }) : undefined}
                  />
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-fg-muted">Para corrigir uma ficha, use "Retificar": o original continua guardado, e o uso do lote e o estoque são corrigidos com um estorno.</p>
        </>
      )}
      {section === 'cases' && (
        <>
          {canWrite && (
            <Button size="sm" onClick={() => setWriting({ kind: 'case' })}>
              + Novo tratamento
            </Button>
          )}
          {cases.length === 0 ? (
            <Card>
              <EmptyState title="Nenhum tratamento" description={specialty === 'plastic_surgery' ? 'Abra um tratamento para a avaliação, o orçamento e a cirurgia.' : 'Um tratamento agrupa as sessões previstas (ex.: clareamento, protocolo capilar).'} />
            </Card>
          ) : (
            <div className="space-y-3">
              {cases.map((c) => (
                <CaseCard
                  key={c.id}
                  item={c}
                  forms={specialtyForms[specialty]}
                  onRecord={(caseId, form) => setWriting({ kind: 'record', form: form ?? sessionForm, caseId, nextSession: sessionForms.includes((form ?? sessionForm).key) ? nextSession(c) : undefined })}
                  onConsent={(caseId) => setWriting({ kind: 'consent', caseId })}
                />
              ))}
            </div>
          )}
        </>
      )}
      {section === 'photos' && <PhotoBoard customerId={customerId} specialty={specialty} photos={photos} cases={cases} canWrite={canWrite} />}

      {writing?.kind === 'record' && (
        <SpecialtyRecordForm customerId={customerId} specialty={specialty} form={writing.form} cases={cases} caseId={writing.caseId} nextSession={writing.nextSession} amends={writing.amends} onClose={() => setWriting(null)} />
      )}
      {writing?.kind === 'consent' && <ConsentForm customerId={customerId} customerName={customer.data?.name ?? ''} specialty={specialty} cases={cases} caseId={writing.caseId} onClose={() => setWriting(null)} />}
      {writing?.kind === 'case' && <NewCaseForm customerId={customerId} specialty={specialty} onClose={() => setWriting(null)} />}
      {writing?.kind === 'return' && (
        <ScheduleReturn customerId={customerId} date={writing.date} professionalId={writing.professionalId} serviceHint={returnService[writing.formKey] ?? []} onClose={() => setWriting(null)} />
      )}
    </div>
  );
}
