import { api, ApiError, formatDate, formatPhone, SpreadsheetImport, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { reminderStatusLabel, type VaccineCatalogEntry, type VaccineDue } from '../contracts';
import { vaccinationImportSpec } from './vaccinationImport';
import { useVaccineCatalog, vetKey } from './VaccinesTab';

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
  const [tab, setTab] = useState('due');
  const now = today();
  const until = addDays(now, days);
  const due = useQuery({ queryKey: [...vetKey, 'due', until], queryFn: () => api<VaccineDue[]>('/vet/vaccinations/due', { query: { until } }) });

  return (
    <>
      <PageHeader
        title="Vacinas a vencer"
        description="Reforços vencidos e próximos. O tutor recebe lembrete automático antes do vencimento."
        actions={
          tab === 'due' ? (
            <>
              <Select aria-label="Período" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
                <option value="7">Próximos 7 dias</option>
                <option value="30">Próximos 30 dias</option>
                <option value="90">Próximos 90 dias</option>
              </Select>
              {canWrite && <SpreadsheetImport spec={vaccinationImportSpec()} onImported={() => queryClient.invalidateQueries({ queryKey: vetKey })} />}
            </>
          ) : undefined
        }
      />
      <Tabs
        items={[
          { key: 'due', label: 'A vencer' },
          { key: 'catalog', label: 'Catálogo de vacinas' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'catalog' ? (
        <VaccineCatalog canWrite={canWrite} />
      ) : (
        <>
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
                      <Td>{v.vaccineName}</Td>
                      <Td>
                        {v.tutor.name}
                        {v.tutor.phone && <span className="ml-2 text-sm text-fg-muted">{formatPhone(v.tutor.phone)}</span>}
                      </Td>
                      <Td>
                        <ReminderCell reminder={v.reminder} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <ReminderSettings />
        </>
      )}
    </>
  );
}

const reminderTone = { sent: 'success', manual: 'warning', queued: 'neutral', failed: 'danger', skipped: 'warning' } as const;

/** O que aconteceu com o aviso: "Enviado" só quando saiu mesmo. */
function ReminderCell({ reminder }: { reminder: VaccineDue['reminder'] }) {
  if (!reminder) return <span className="text-fg-subtle">—</span>;
  return (
    <>
      <Badge tone={reminderTone[reminder.status]}>{reminderStatusLabel[reminder.status]}</Badge>
      {reminder.status !== 'sent' && reminder.detail && <div className="mt-0.5 text-xs text-fg-muted">{reminder.detail}</div>}
    </>
  );
}

/** Dias do lembrete (configuração do módulo): só para quem pode mexer nas configurações. */
function ReminderSettings() {
  const queryClient = useQueryClient();
  const canConfigure = useCan('core.access.settings');
  const key = ['modules', 'vet', 'settings'];
  const settings = useQuery({ queryKey: key, queryFn: () => api<{ vaccineReminderDays: number }>('/modules/vet/settings'), enabled: canConfigure });
  const [days, setDays] = useState('');
  useEffect(() => {
    if (settings.data) setDays(String(settings.data.vaccineReminderDays));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api('/modules/vet/settings', { method: 'PUT', body: { ...settings.data, vaccineReminderDays: Number(days) } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  if (!canConfigure || !settings.data) return null;
  return (
    <Card className="mt-6 max-w-xl space-y-3 p-5">
      <h2 className="font-medium">Lembrete automático</h2>
      {save.error && <Alert>{save.error instanceof ApiError ? String(save.error.message) : 'Erro ao salvar'}</Alert>}
      {save.isSuccess && <Alert tone="success">Lembrete salvo.</Alert>}
      <Field label="Avisar o tutor quantos dias antes do reforço" hint="De 0 a 60. Com 0, nenhum lembrete é enviado. Vale para os reforços ainda não avisados.">
        {(id) => <Input id={id} type="number" min={0} max={60} className="w-28" value={days} onChange={(e) => setDays(e.target.value)} />}
      </Field>
      <Button loading={save.isPending} onClick={() => save.mutate()}>
        Salvar lembrete
      </Button>
    </Card>
  );
}

/** Catálogo: o nome que aparece na carteira e os apelidos que contam como a mesma vacina. */
function VaccineCatalog({ canWrite }: { canWrite: boolean }) {
  const catalog = useVaccineCatalog();
  const [editing, setEditing] = useState<VaccineCatalogEntry | 'new' | null>(null);
  const [merging, setMerging] = useState<VaccineCatalogEntry | null>(null);
  if (catalog.isPending) return <Spinner />;
  if (catalog.isError) return <Alert>{catalog.error.message}</Alert>;
  return (
    <div className="space-y-4">
      {editing && <VaccineForm vaccine={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {merging && <MergeForm vaccine={merging} catalog={catalog.data} onClose={() => setMerging(null)} />}
      {canWrite && !editing && !merging && (
        <Button onClick={() => setEditing('new')}>Nova vacina</Button>
      )}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Vacina</Th>
              <Th>Também conta como</Th>
              <Th className="text-right">Aplicações</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {catalog.data.map((v) => (
              <tr key={v.id}>
                <Td>
                  <span className={v.active ? 'font-medium' : 'text-fg-subtle'}>{v.name}</span> {!v.active && <Badge>Fora da lista</Badge>}
                </Td>
                <Td className="text-sm text-fg-muted">{v.aliases.join(', ') || '—'}</Td>
                <Td className="text-right tabular-nums">{v.uses}</Td>
                <Td className="whitespace-nowrap text-right">
                  {canWrite && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => { setMerging(null); setEditing(v); }}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setMerging(v); }}>
                        Juntar
                      </Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function VaccineForm({ vaccine, onClose }: { vaccine: VaccineCatalogEntry | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(vaccine?.name ?? '');
  const [aliases, setAliases] = useState(vaccine?.aliases.join(', ') ?? '');
  const [active, setActive] = useState(vaccine?.active ?? true);
  const save = useMutation({
    mutationFn: () =>
      api(vaccine ? `/vet/vaccines/${vaccine.id}` : '/vet/vaccines', {
        method: vaccine ? 'PATCH' : 'POST',
        body: { name, aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean), active },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vetKey });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Card className="max-w-xl p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-medium">{vaccine ? `Editar ${vaccine.name}` : 'Nova vacina'}</h2>
        {save.error && <Alert>{save.error instanceof ApiError ? String(save.error.message) : 'Erro ao salvar'}</Alert>}
        <Field label="Nome na carteira">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Também conta como" hint="Outros nomes da mesma vacina, separados por vírgula.">
          {(id) => <Input id={id} value={aliases} onChange={(e) => setAliases(e.target.value)} />}
        </Field>
        <Checkbox label="Aparece na lista ao registrar" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MergeForm({ vaccine, catalog, onClose }: { vaccine: VaccineCatalogEntry; catalog: VaccineCatalogEntry[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [intoId, setIntoId] = useState('');
  const merge = useMutation({
    mutationFn: () => api(`/vet/vaccines/${vaccine.id}/merge`, { method: 'POST', body: { intoId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vetKey });
      onClose();
    },
  });
  return (
    <Card className="max-w-xl space-y-4 p-5">
      <h2 className="font-medium">Juntar {vaccine.name}</h2>
      {merge.error && <Alert>{merge.error instanceof ApiError ? String(merge.error.message) : 'Erro ao juntar'}</Alert>}
      <p className="text-sm text-fg-muted">
        As {vaccine.uses} aplicações passam para a vacina escolhida, com o nome digitado preservado, e {vaccine.name} vira um apelido dela. Se o pet tiver as duas no mesmo dia, a repetida fica anulada, com o motivo. O reforço passa a contar como uma vacina só.
      </p>
      <Field label="Juntar com">
        {(id) => (
          <Select id={id} value={intoId} onChange={(e) => setIntoId(e.target.value)}>
            <option value="">Escolha</option>
            {catalog
              .filter((v) => v.id !== vaccine.id)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <div className="flex gap-2">
        <Button disabled={!intoId} loading={merge.isPending} onClick={() => merge.mutate()}>
          Juntar
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Voltar
        </Button>
      </div>
    </Card>
  );
}
