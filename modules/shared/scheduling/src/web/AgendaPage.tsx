import { useCan, useSession } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Input, PageHeader, Spinner, cn } from '@all/ui';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { appointmentStatusLabel, type Appointment, type Resource } from '../contracts';
import { AppointmentDetails } from './AppointmentDetails';
import { AppointmentForm } from './AppointmentForm';
import {
  formatLongDate,
  hhmmOf,
  localDate,
  localTime,
  localToUtc,
  minutesOf,
  shiftDate,
  todayLocal,
  useAppointments,
  useResources,
  useTimeOff,
  weekday,
} from './hooks';

/** 15 minutos = 20 px. */
const SLOT_MIN = 15;
const SLOT_PX = 20;
const pxPerMin = SLOT_PX / SLOT_MIN;

export function AgendaPage() {
  const session = useSession();
  const canWrite = useCan('shared.scheduling.write');
  const [params, setParams] = useSearchParams();
  const date = params.get('dia') ?? todayLocal();
  const setDate = (d: string) => setParams({ dia: d }, { replace: true });

  const from = localToUtc(date, '00:00');
  const to = localToUtc(shiftDate(date, 1), '00:00');
  const resources = useResources();
  const appointments = useAppointments(from, to);
  const timeOff = useTimeOff(from, to);
  const [creating, setCreating] = useState<{ time?: string; resourceId?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const columns = (resources.data ?? []).filter((r) => r.active && r.kind === 'professional');
  const dayHours = columns.flatMap((r) => r.hours.filter((h) => h.weekday === weekday(date)));
  const visible = (appointments.data ?? []).filter((a) => a.status !== 'cancelled');

  // Faixa visível: do primeiro expediente (ou atendimento) ao último, com folga de meia hora.
  const [startMin, endMin] = useMemo(() => {
    const marks = [
      ...dayHours.flatMap((h) => [minutesOf(h.start), minutesOf(h.end)]),
      ...visible.flatMap((a) => [minutesOf(localTime(a.startsAt)), minutesOf(localTime(a.endsAt)) || 24 * 60]),
    ];
    if (!marks.length) return [8 * 60, 19 * 60];
    return [Math.max(0, Math.floor((Math.min(...marks) - 30) / 60) * 60), Math.min(24 * 60, Math.ceil((Math.max(...marks) + 30) / 60) * 60)];
  }, [dayHours, visible]);

  const hours = Array.from({ length: (endMin - startMin) / 60 }, (_, i) => startMin + i * 60);
  const height = (endMin - startMin) * pxPerMin;

  function onColumnClick(e: MouseEvent<HTMLDivElement>, resource: Resource) {
    if (!canWrite || e.target !== e.currentTarget) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const minute = startMin + Math.floor(y / pxPerMin / SLOT_MIN) * SLOT_MIN;
    setCreating({ time: hhmmOf(minute), resourceId: resource.id });
  }

  return (
    <>
      <PageHeader
        title="Agenda"
        description={formatLongDate(date)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDate(shiftDate(date, -1))} aria-label="Dia anterior">
              ←
            </Button>
            <Button variant="secondary" onClick={() => setDate(todayLocal())}>
              Hoje
            </Button>
            <Button variant="secondary" onClick={() => setDate(shiftDate(date, 1))} aria-label="Próximo dia">
              →
            </Button>
            <Input type="date" aria-label="Escolher dia" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            {canWrite && <Button onClick={() => setCreating({})}>Novo horário</Button>}
          </>
        }
      />

      {resources.isPending ? (
        <Spinner />
      ) : resources.isError ? (
        <Alert>{resources.error.message}</Alert>
      ) : columns.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum profissional cadastrado"
            description="Cadastre quem atende e o horário de trabalho de cada um para começar a marcar."
            action={
              <Link to="/agenda/profissionais">
                <Button>Cadastrar profissionais</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <div className="min-w-fit" style={{ display: 'grid', gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(11rem, 1fr))` }}>
            {/* Cabeçalho */}
            <div className="sticky left-0 z-20 border-b border-line bg-surface" />
            {columns.map((r) => (
              <div key={r.id} className="flex items-center gap-2 border-b border-l border-line px-3 py-2.5 text-sm font-medium">
                <span className="size-2.5 rounded-full" style={{ background: r.color }} aria-hidden />
                {r.name}
              </div>
            ))}

            {/* Régua de horas */}
            <div className="sticky left-0 z-10 bg-surface" style={{ height }}>
              {hours.map((m) => (
                <div key={m} className="relative text-right text-xs text-fg-subtle" style={{ height: 60 * pxPerMin }}>
                  <span className="absolute -top-2 right-2 tabular-nums">{hhmmOf(m)}</span>
                </div>
              ))}
            </div>

            {columns.map((r) => (
              <DayColumn
                key={r.id}
                date={date}
                resource={r}
                startMin={startMin}
                height={height}
                appointments={visible.filter((a) => a.resourceId === r.id)}
                timeOff={(timeOff.data ?? []).filter((t) => t.resourceId === r.id)}
                clickable={canWrite}
                onEmptyClick={(e) => onColumnClick(e, r)}
                onOpen={setOpenId}
              />
            ))}
          </div>
        </Card>
      )}

      {creating && (
        <AppointmentForm
          initial={{ date, time: creating.time, resourceId: creating.resourceId }}
          activeModules={session.modules.map((m) => m.key)}
          onClose={() => setCreating(null)}
          onSaved={(a) => {
            setCreating(null);
            setOpenId(a.id);
          }}
        />
      )}
      {openId && <AppointmentDetails id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function DayColumn({
  date,
  resource,
  startMin,
  height,
  appointments,
  timeOff,
  clickable,
  onEmptyClick,
  onOpen,
}: {
  date: string;
  resource: Resource;
  startMin: number;
  height: number;
  appointments: Appointment[];
  timeOff: { id: string; startsAt: string; endsAt: string; reason: string | null }[];
  clickable: boolean;
  onEmptyClick: (e: MouseEvent<HTMLDivElement>) => void;
  onOpen: (id: string) => void;
}) {
  const working = resource.hours.filter((h) => h.weekday === weekday(date));
  const top = (iso: string) => (Math.max(minutesOf(localTime(iso)), startMin) - startMin) * pxPerMin;
  const span = (startIso: string, endIso: string) => {
    const s = localDate(startIso) < date ? startMin : minutesOf(localTime(startIso));
    const e = localDate(endIso) > date ? 24 * 60 : minutesOf(localTime(endIso));
    return Math.max(SLOT_PX, (e - Math.max(s, startMin)) * pxPerMin);
  };
  const now = useNow();
  const nowMin = localDate(now) === date ? minutesOf(localTime(now)) : null;

  return (
    <div
      className={cn('relative border-l border-line bg-muted/60', clickable && 'cursor-cell')}
      style={{ height, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${60 * pxPerMin - 1}px, var(--color-line) ${60 * pxPerMin - 1}px, var(--color-line) ${60 * pxPerMin}px)` }}
      onClick={onEmptyClick}
      role="grid"
      aria-label={`Agenda de ${resource.name}`}
    >
      {/* Expediente em branco; fora dele fica cinza. */}
      {working.map((h) => (
        <div
          key={h.start}
          className="pointer-events-none absolute inset-x-0 bg-surface/90"
          style={{ top: (minutesOf(h.start) - startMin) * pxPerMin, height: (minutesOf(h.end) - minutesOf(h.start)) * pxPerMin }}
        />
      ))}

      {timeOff.map((t) => (
        <div
          key={t.id}
          className="pointer-events-none absolute inset-x-1 overflow-hidden rounded-md border border-dashed border-fg-subtle/60 px-2 py-1 text-xs text-fg-muted"
          style={{ top: top(t.startsAt), height: span(t.startsAt, t.endsAt), background: 'repeating-linear-gradient(135deg, transparent 0 6px, var(--color-line) 6px 7px)' }}
        >
          Bloqueado{t.reason ? `: ${t.reason}` : ''}
        </div>
      ))}

      {appointments.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpen(a.id)}
          className={cn(
            'absolute inset-x-1 overflow-hidden rounded-md border-l-4 bg-brand-50 px-2 py-1 text-left text-xs shadow-sm transition hover:brightness-95',
            a.status === 'done' && 'opacity-60',
            a.status === 'no_show' && 'bg-danger-50 line-through opacity-70',
          )}
          style={{ top: top(a.startsAt) + 1, height: span(a.startsAt, a.endsAt) - 2, borderLeftColor: resource.color }}
          title={`${localTime(a.startsAt)}–${localTime(a.endsAt)} ${a.customer.name}`}
        >
          <span className="block truncate font-semibold text-fg">
            {localTime(a.startsAt)} {a.customer.name}
          </span>
          <span className="block truncate text-fg-muted">
            {a.subject ? `${a.subject.label} · ` : ''}
            {a.services.map((s) => s.name).join(', ')}
          </span>
          <span className="block truncate text-[0.6875rem] text-fg-muted">{appointmentStatusLabel[a.status]}</span>
        </button>
      ))}

      {nowMin !== null && nowMin >= startMin && (
        <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger-600" style={{ top: (nowMin - startMin) * pxPerMin }} aria-hidden />
      )}
    </div>
  );
}

/** Hora atual, atualizada a cada minuto (para a linha do "agora"). */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
