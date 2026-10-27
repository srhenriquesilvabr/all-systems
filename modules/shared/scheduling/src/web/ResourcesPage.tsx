import { api, ApiError, formatDateTime } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { weekdayLabel, type Resource } from '../contracts';
import { localToUtc, schedulingKey, shiftDate, todayLocal, useResources, useServices, useTimeOff } from './hooks';

const COLORS = ['#2d4bff', '#0ea5a4', '#e2557a', '#f59e0b', '#7c3aed', '#16a34a', '#0e1330', '#eb6834'];

export function ResourcesPage() {
  const resources = useResources();
  const [editing, setEditing] = useState<Resource | 'new' | null>(null);
  const [hoursOf, setHoursOf] = useState<Resource | null>(null);
  const [blocksOf, setBlocksOf] = useState<Resource | null>(null);

  return (
    <>
      <PageHeader
        title="Profissionais e horários"
        description="Quem atende, o que cada um faz e o horário de trabalho de cada dia."
        actions={<Button onClick={() => setEditing('new')}>Novo profissional</Button>}
      />
      <Card>
        {resources.isPending ? (
          <Spinner />
        ) : resources.isError ? (
          <div className="p-4">
            <Alert>{resources.error.message}</Alert>
          </div>
        ) : resources.data.length === 0 ? (
          <EmptyState title="Nenhum profissional ainda" action={<Button onClick={() => setEditing('new')}>Cadastrar o primeiro</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Horário</Th>
                <Th>Serviços</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {resources.data.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="flex items-center gap-2 font-medium">
                      <span className="size-3 rounded-full" style={{ background: r.color }} aria-hidden />
                      {r.name}
                      {r.kind === 'room' && <Badge>Sala</Badge>}
                      {!r.active && <Badge>Inativo</Badge>}
                    </span>
                  </Td>
                  <Td className="text-fg-muted">{summarizeHours(r.hours)}</Td>
                  <Td className="text-fg-muted">{r.serviceIds.length ? `${r.serviceIds.length} serviço(s)` : 'Todos'}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => setHoursOf(r)}>
                      Horários
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setBlocksOf(r)}>
                      Bloqueios
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                      Editar
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ResourceModal resource={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {hoursOf && <HoursModal resource={hoursOf} onClose={() => setHoursOf(null)} />}
      {blocksOf && <TimeOffModal resource={blocksOf} onClose={() => setBlocksOf(null)} />}
    </>
  );
}

function summarizeHours(hours: Resource['hours']) {
  if (!hours.length) return 'Sem horário';
  const days = [...new Set(hours.map((h) => h.weekday))].sort();
  return days.map((d) => weekdayLabel[d]!.slice(0, 3)).join(', ');
}

function ResourceModal({ resource, onClose }: { resource: Resource | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const services = useServices();
  const [name, setName] = useState(resource?.name ?? '');
  const [kind, setKind] = useState<Resource['kind']>(resource?.kind ?? 'professional');
  const [color, setColor] = useState(resource?.color ?? COLORS[0]!);
  const [active, setActive] = useState(resource?.active ?? true);
  const [serviceIds, setServiceIds] = useState<string[]>(resource?.serviceIds ?? []);
  const save = useMutation({
    mutationFn: () =>
      api(resource ? `/scheduling/resources/${resource.id}` : '/scheduling/resources', {
        method: resource ? 'PATCH' : 'POST',
        body: { name, kind, color, active, serviceIds },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKey });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open
      title={resource ? 'Editar profissional' : 'Novo profissional'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="resource-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="resource-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field label="Nome">{(id) => <Input id={id} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as Resource['kind'])}>
                <option value="professional">Profissional</option>
                <option value="room">Sala / equipamento</option>
              </Select>
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Cor na agenda</legend>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
                className={`size-7 rounded-full ring-offset-2 ${c === color ? 'ring-2 ring-fg' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Serviços que faz</legend>
          <p className="mb-2 text-xs text-fg-muted">Nenhum marcado = faz todos.</p>
          <div className="grid max-h-48 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {services.data?.map((s) => (
              <Checkbox
                key={s.id}
                label={s.name}
                checked={serviceIds.includes(s.id)}
                onChange={(e) => setServiceIds(e.target.checked ? [...serviceIds, s.id] : serviceIds.filter((id) => id !== s.id))}
              />
            ))}
          </div>
        </fieldset>
        <Checkbox label="Ativo (aparece na agenda)" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {!resource && <p className="text-xs text-fg-muted">O expediente começa como segunda a sexta 9h–12h e 13h–18h, sábado 9h–13h. Ajuste em “Horários”.</p>}
      </form>
    </Modal>
  );
}

function HoursModal({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(resource.hours.map((h) => ({ ...h })));
  const save = useMutation({
    mutationFn: () => api(`/scheduling/resources/${resource.id}/hours`, { method: 'PUT', body: { hours } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKey });
      onClose();
    },
  });
  const update = (i: number, patch: Partial<(typeof hours)[number]>) => setHours(hours.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  const copyMondayToWeek = () => {
    const monday = hours.filter((h) => h.weekday === 1);
    setHours([...hours.filter((h) => h.weekday === 0 || h.weekday === 6), ...[1, 2, 3, 4, 5].flatMap((d) => monday.map((h) => ({ ...h, weekday: d })))]);
  };

  return (
    <Modal
      open
      title={`Horários — ${resource.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={copyMondayToWeek}>
            Copiar segunda para a semana
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      {save.error && (
        <div className="mb-3">
          <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>
        </div>
      )}
      <div className="space-y-3">
        {weekdayLabel.map((label, day) => {
          const rows = hours.map((h, i) => ({ h, i })).filter(({ h }) => h.weekday === day);
          return (
            <div key={day} className="grid grid-cols-[6rem_1fr] items-start gap-3">
              <span className="pt-2 text-sm font-medium">{label}</span>
              <div className="space-y-1.5">
                {rows.length === 0 && <p className="pt-2 text-sm text-fg-muted">Folga</p>}
                {rows.map(({ h, i }) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="time" aria-label={`${label} início`} className="w-28" value={h.start} onChange={(e) => update(i, { start: e.target.value })} />
                    <span className="text-fg-muted">às</span>
                    <Input type="time" aria-label={`${label} fim`} className="w-28" value={h.end} onChange={(e) => update(i, { end: e.target.value })} />
                    <Button variant="ghost" size="sm" aria-label="Remover intervalo" onClick={() => setHours(hours.filter((_, idx) => idx !== i))}>
                      ✕
                    </Button>
                  </div>
                ))}
                <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setHours([...hours, { weekday: day, start: '09:00', end: '18:00' }])}>
                  + intervalo
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function TimeOffModal({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  const queryClient = useQueryClient();
  const from = localToUtc(todayLocal(), '00:00');
  const to = localToUtc(shiftDate(todayLocal(), 120), '00:00');
  const blocks = useTimeOff(from, to);
  const [start, setStart] = useState(`${todayLocal()}T12:00`);
  const [end, setEnd] = useState(`${todayLocal()}T13:00`);
  const [reason, setReason] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: schedulingKey });
  const add = useMutation({
    mutationFn: () =>
      api(`/scheduling/resources/${resource.id}/time-off`, {
        method: 'POST',
        body: { startsAt: localToUtc(start.slice(0, 10), start.slice(11, 16)).toISOString(), endsAt: localToUtc(end.slice(0, 10), end.slice(11, 16)).toISOString(), reason: reason || null },
      }),
    onSuccess: () => {
      setReason('');
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/scheduling/time-off/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const mine = blocks.data?.filter((b) => b.resourceId === resource.id) ?? [];

  return (
    <Modal open title={`Bloqueios — ${resource.name}`} onClose={onClose}>
      <div className="space-y-4">
        {(add.error || remove.error) && <Alert>{(add.error ?? remove.error) instanceof ApiError ? (add.error ?? remove.error)!.message : 'Erro'}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="De">{(id) => <Input id={id} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Até">{(id) => <Input id={id} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        <Field label="Motivo (opcional)">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Folga, médico, curso…" />}</Field>
        <Button size="sm" loading={add.isPending} onClick={() => add.mutate()}>
          Bloquear horário
        </Button>
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-sm font-medium">Próximos bloqueios</p>
          {mine.length === 0 ? (
            <p className="text-sm text-fg-muted">Nenhum.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {mine.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <span>
                    {formatDateTime(b.startsAt)} → {formatDateTime(b.endsAt)}
                    {b.reason && <span className="text-fg-muted"> · {b.reason}</span>}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(b.id)}>
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
