import { api, formatMoney, parseMoney, today, useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { jobKindLabel, jobKinds, jobStatuses, jobStatusLabel, type JobKind, type JobStatus, type LaundrySettings, type LogisticsJob } from '../contracts';
import { addDays, errorText, JobCard, ScheduleModal, useDrivers, useJobs, useRefreshLogistics, withCurrent } from './logistics';

/** Escritório: coletas e entregas do dia, por motorista, com atribuição e reagendamento. */
export function LogisticsPage() {
  const refresh = useRefreshLogistics();
  const drivers = useDrivers();
  const [date, setDate] = useState(today());
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [kind, setKind] = useState<JobKind | ''>('');
  const [driverId, setDriverId] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [editing, setEditing] = useState<LogisticsJob | null>(null);

  const jobs = useJobs({ date, status: status || undefined, kind: kind || undefined, driverId: driverId || undefined });
  // Não realizadas de qualquer dia: ficam à vista até alguém reagendar ou cancelar.
  const failed = useJobs({ status: 'failed' });
  const pendingFailed = failed.data?.filter((j) => j.date !== date) ?? [];

  const groups = groupByDriver(jobs.data ?? []);
  const counts = (jobs.data ?? []).reduce<Record<string, number>>((acc, j) => ({ ...acc, [j.status]: (acc[j.status] ?? 0) + 1 }), {});

  const cardActions = (job: LogisticsJob) => <OfficeActions job={job} onEdit={() => setEditing(job)} onChanged={refresh} />;

  return (
    <>
      <PageHeader
        title="Coletas e entregas"
        description="Agende coletas, atribua motoristas e acompanhe as entregas do dia. As entregas são agendadas pela ordem (“Entregar no endereço”)."
        actions={<Button onClick={() => setScheduling(true)}>Agendar coleta</Button>}
      />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="flex items-end gap-1">
          <Button variant="secondary" aria-label="Dia anterior" onClick={() => setDate(addDays(date, -1))}>
            ‹
          </Button>
          <Field label="Dia">{(id) => <Input id={id} type="date" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}</Field>
          <Button variant="secondary" aria-label="Próximo dia" onClick={() => setDate(addDays(date, 1))}>
            ›
          </Button>
          {date !== today() && (
            <Button variant="ghost" onClick={() => setDate(today())}>
              Hoje
            </Button>
          )}
        </div>
        <Field label="Situação">
          {(id) => (
            <Select id={id} className="w-40" value={status} onChange={(e) => setStatus(e.target.value as JobStatus | '')}>
              <option value="">Todas</option>
              {jobStatuses.map((s) => (
                <option key={s} value={s}>
                  {jobStatusLabel[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tipo">
          {(id) => (
            <Select id={id} className="w-32" value={kind} onChange={(e) => setKind(e.target.value as JobKind | '')}>
              <option value="">Todos</option>
              {jobKinds.map((k) => (
                <option key={k} value={k}>
                  {jobKindLabel[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Motorista">
          {(id) => (
            <Select id={id} className="w-48" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Todos</option>
              <option value="none">Sem motorista</option>
              {drivers.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {jobs.data && jobs.data.length > 0 && (
          <p className="ml-auto text-sm text-fg-muted">
            {jobStatuses
              .filter((s) => counts[s])
              .map((s) => `${counts[s]} ${jobStatusLabel[s].toLowerCase()}`)
              .join(' · ')}
          </p>
        )}
      </Card>

      {pendingFailed.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-medium text-danger-700">Não realizadas, aguardando reagendamento ({pendingFailed.length})</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pendingFailed.map((j) => (
              <JobCard key={j.id} job={j} onChanged={refresh} actions={cardActions(j)} />
            ))}
          </div>
        </section>
      )}

      {jobs.isPending ? (
        <Spinner />
      ) : jobs.isError ? (
        <Alert>{jobs.error.message}</Alert>
      ) : jobs.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma coleta ou entrega neste dia" description="Agende uma coleta aqui ou uma entrega pela ordem pronta." />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="mb-2 flex items-center gap-2 font-medium">
                {g.label} <span className="text-sm font-normal text-fg-muted">{g.jobs.length}</span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.jobs.map((j) => (
                  <JobCard key={j.id} job={j} onChanged={refresh} actions={cardActions(j)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <FeeSettings />

      {scheduling && (
        <ScheduleModal
          kind="pickup"
          onClose={() => setScheduling(false)}
          onSaved={(job) => {
            setScheduling(false);
            setDate(job.date);
            refresh();
          }}
        />
      )}
      {editing && (
        <ScheduleModal
          kind={editing.kind}
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function groupByDriver(jobs: LogisticsJob[]) {
  const map = new Map<string, { key: string; label: string; jobs: LogisticsJob[] }>();
  for (const j of jobs) {
    const key = j.driver?.id ?? 'none';
    if (!map.has(key)) map.set(key, { key, label: j.driver?.name ?? 'Sem motorista', jobs: [] });
    map.get(key)!.jobs.push(j);
  }
  // "Sem motorista" primeiro: é o que precisa de atenção.
  return [...map.values()].sort((a, b) => (a.key === 'none' ? -1 : b.key === 'none' ? 1 : a.label.localeCompare(b.label)));
}

/** Atribuir motorista na hora, reagendar/editar, cancelar e, na coleta concluída, abrir a ordem. */
function OfficeActions({ job, onEdit, onChanged }: { job: LogisticsJob; onEdit: () => void; onChanged: () => void }) {
  const drivers = useDrivers();
  const canOpenOrder = useCan('laundry.orders.write');
  const assign = useMutation({
    mutationFn: (driverUserId: string | null) => api(`/laundry/logistics/jobs/${job.id}`, { method: 'PATCH', body: { driverUserId } }),
    onSuccess: onChanged,
  });
  const cancel = useMutation({
    mutationFn: (reason: string | null) => api(`/laundry/logistics/jobs/${job.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: onChanged,
  });
  const editable = job.status === 'scheduled' || job.status === 'failed';
  const error = assign.error ?? cancel.error;

  return (
    <div className="w-full space-y-2">
      {error && <Alert>{errorText(error)}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <Select
            aria-label="Motorista"
            className="h-8 w-44"
            value={job.driver?.id ?? ''}
            disabled={assign.isPending}
            onChange={(e) => assign.mutate(e.target.value || null)}
          >
            <option value="">Sem motorista</option>
            {withCurrent(drivers.data, job.driver).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
        {editable && (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            {job.status === 'failed' ? 'Reagendar' : 'Editar'}
          </Button>
        )}
        {job.status !== 'done' && job.status !== 'cancelled' && (
          <Button
            size="sm"
            variant="ghost"
            loading={cancel.isPending}
            onClick={() => {
              const reason = prompt('Motivo do cancelamento (opcional)');
              if (reason !== null) cancel.mutate(reason.trim() || null);
            }}
          >
            Cancelar
          </Button>
        )}
        {job.kind === 'pickup' && job.status === 'done' && !job.order && canOpenOrder && (
          <Link to={`/lavanderia/ordens/nova?cliente=${job.customer.id}&coleta=${job.id}`}>
            <Button size="sm">Abrir ordem no balcão</Button>
          </Link>
        )}
      </div>
    </div>
  );
}

/** Taxas padrão (configurações do módulo): só para quem pode mexer nas configurações. */
function FeeSettings() {
  const queryClient = useQueryClient();
  const canConfigure = useCan('core.access.settings');
  const key = ['modules', 'laundry', 'settings'];
  const settings = useQuery({ queryKey: key, queryFn: () => api<LaundrySettings>('/modules/laundry/settings'), enabled: canConfigure });
  const [pickupFee, setPickupFee] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setPickupFee(String(settings.data.pickupFee).replace('.', ','));
    setDeliveryFee(String(settings.data.deliveryFee).replace('.', ','));
  }, [settings.data]);
  const save = useMutation({
    // O PUT grava o objeto inteiro: parte do que já está salvo.
    mutationFn: () =>
      api('/modules/laundry/settings', {
        method: 'PUT',
        body: { ...settings.data, pickupFee: parseMoney(pickupFee) || 0, deliveryFee: parseMoney(deliveryFee) || 0 },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['laundry', 'logistics', 'defaults'] });
    },
  });
  if (!canConfigure || !settings.data) return null;

  return (
    <Card className="mt-8 max-w-xl space-y-4 p-5">
      <h2 className="font-medium">Taxas padrão</h2>
      {save.error && <Alert>{errorText(save.error)}</Alert>}
      {save.isSuccess && <Alert tone="success">Taxas salvas.</Alert>}
      <p className="text-sm text-fg-muted">
        Sugeridas ao agendar (podem ser mudadas em cada coleta/entrega). A taxa vira um valor a receber no financeiro, separado da ordem. Hoje:{' '}
        coleta {formatMoney(settings.data.pickupFee)}, entrega {formatMoney(settings.data.deliveryFee)}.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Taxa de coleta">{(id) => <Input id={id} inputMode="decimal" value={pickupFee} onChange={(e) => setPickupFee(e.target.value)} />}</Field>
        <Field label="Taxa de entrega">{(id) => <Input id={id} inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />}</Field>
      </div>
      <Button loading={save.isPending} onClick={() => save.mutate()}>
        Salvar taxas
      </Button>
    </Card>
  );
}
