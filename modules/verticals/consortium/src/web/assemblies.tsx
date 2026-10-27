import { api, formatDate, formatMoney, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { bidStatusLabel, bidTypeLabel, type Assembly } from '../contracts';
import { bidTone, errorText, key, pct } from './common';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
};
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const lastDay = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const split = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Calendário das assembleias: agendadas (recebem lances) e realizadas (com resultado). */
export function AssembliesPage() {
  const canManage = useCan('consortium.manage');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [scheduling, setScheduling] = useState(false);
  const [results, setResults] = useState<Assembly | 'new' | null>(null);
  const [editing, setEditing] = useState<Assembly | null>(null);
  const upcoming = useQuery({ queryKey: [...key, 'assemblies', 'scheduled'], queryFn: () => api<Assembly[]>('/consortium/assemblies', { query: { status: 'scheduled' } }) });
  const held = useQuery({ queryKey: [...key, 'assemblies', 'held'], queryFn: () => api<Assembly[]>('/consortium/assemblies', { query: { status: 'held' } }) });

  return (
    <>
      <PageHeader
        title="Assembleias"
        description="Agende a próxima assembleia de cada grupo para registrar lances; depois lance o resultado: as cotas contempladas são marcadas, os lances acertados e o cliente avisado."
        actions={
          canManage && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setScheduling(true)}>
                Agendar assembleia
              </Button>
              <Button onClick={() => setResults('new')}>Lançar resultado</Button>
            </div>
          )
        }
      />
      <Calendar month={month} onMonth={setMonth} onPick={(a) => canManage && a.status === 'scheduled' && setResults(a)} />

      <h2 className="mb-2 mt-6 text-sm font-medium">Próximas assembleias</h2>
      {upcoming.isPending ? (
        <Spinner />
      ) : upcoming.isError ? (
        <Alert>{upcoming.error.message}</Alert>
      ) : upcoming.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma assembleia agendada" description={canManage ? 'Use "Agendar assembleia" para os lances poderem ser registrados.' : undefined} />
        </Card>
      ) : (
        <div className="space-y-3">
          {[...upcoming.data].reverse().map((a) => (
            <Card key={a.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  Grupo {a.groupCode} · {formatDate(a.heldOn)} <Badge tone="warning">Agendada</Badge>
                </span>
                {canManage && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                      Remarcar
                    </Button>
                    <Button size="sm" onClick={() => setResults(a)}>
                      Lançar resultado
                    </Button>
                  </div>
                )}
              </div>
              <BidsList assembly={a} />
              {a.notes && <p className="mt-2 text-fg-muted">{a.notes}</p>}
            </Card>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-medium">Resultados lançados</h2>
      {held.isPending ? (
        <Spinner />
      ) : held.isError ? (
        <Alert>{held.error.message}</Alert>
      ) : held.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma assembleia lançada" />
        </Card>
      ) : (
        <div className="space-y-3">
          {held.data.map((a) => (
            <Card key={a.id} className="p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">
                  Grupo {a.groupCode} · {formatDate(a.heldOn)}
                </span>
                <span className="text-fg-muted">
                  Sorteio: {a.drawn.join(', ') || '—'} · Lance: {a.bids.map((b) => `${b.quotaNumber} (${pct(b.percent)})`).join(', ') || '—'}
                </span>
              </div>
              {a.ourWinners.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {a.ourWinners.map((w) => (
                    <li key={w.quotaId}>
                      <Badge tone="success">Contemplada</Badge>{' '}
                      <Link to={`/consorcio/cotas/${w.quotaId}`} className="text-brand-700 hover:underline">
                        {w.customer} — cota {w.quotaNumber}
                      </Link>{' '}
                      ({w.type === 'draw' ? 'sorteio' : 'lance'})
                    </li>
                  ))}
                </ul>
              )}
              <BidsList assembly={a} />
              {a.notes && <p className="mt-2 text-fg-muted">{a.notes}</p>}
            </Card>
          ))}
        </div>
      )}
      {scheduling && <ScheduleModal onClose={() => setScheduling(false)} />}
      {results && <ResultsModal assembly={results === 'new' ? null : results} onClose={() => setResults(null)} />}
      {editing && <RescheduleModal assembly={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function BidsList({ assembly }: { assembly: Assembly }) {
  if (!assembly.ourBids.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {assembly.ourBids.map((b) => (
        <li key={b.id}>
          <Badge tone={bidTone[b.status]}>{bidStatusLabel[b.status]}</Badge>{' '}
          <Link to={`/consorcio/cotas/${b.quotaId}`} className="text-brand-700 hover:underline">
            {b.customer} — cota {b.quotaNumber ?? '—'}
          </Link>{' '}
          · lance {bidTypeLabel[b.type].toLowerCase()} de {pct(b.percent)} ({formatMoney(b.amount)})
        </li>
      ))}
    </ul>
  );
}

function Calendar({ month, onMonth, onPick }: { month: string; onMonth: (m: string) => void; onPick: (a: Assembly) => void }) {
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay(month)).padStart(2, '0')}`;
  const list = useQuery({ queryKey: [...key, 'assemblies', 'month', month], queryFn: () => api<Assembly[]>('/consortium/assemblies', { query: { from, to } }) });
  const [y, m] = month.split('-').map(Number) as [number, number];
  const offset = new Date(y, m - 1, 1).getDay();
  const cells = [...Array.from({ length: offset }, () => null), ...Array.from({ length: lastDay(month) }, (_, i) => i + 1)];
  const now = today();
  return (
    <Card className="p-4 text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium capitalize">{monthLabel(month)}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
            ‹
          </Button>
          <Input aria-label="Mês" type="month" className="max-w-44" value={month} onChange={(e) => e.target.value && onMonth(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Próximo mês">
            ›
          </Button>
        </div>
      </div>
      {list.isError && <Alert>{list.error.message}</Alert>}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-1 text-xs text-fg-muted">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const date = day ? `${month}-${String(day).padStart(2, '0')}` : '';
          const items = day ? (list.data ?? []).filter((a) => a.heldOn === date) : [];
          return (
            <div key={i} className={`min-h-16 rounded border border-line p-1 ${day ? '' : 'border-transparent'} ${date === now ? 'bg-brand-50' : ''}`}>
              {day && <div className="text-xs text-fg-muted">{day}</div>}
              {items.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onPick(a)}
                  title={a.status === 'scheduled' ? `Agendada — ${a.ourBids.length} lance(s) da carteira` : 'Realizada'}
                  className={`mt-1 block w-full truncate rounded px-1 text-left text-xs ${a.status === 'scheduled' ? 'bg-warning-50 text-warning-700' : 'bg-success-50 text-success-700'}`}
                >
                  {a.groupCode}
                  {a.ourBids.length > 0 && ` · ${a.ourBids.length} lance(s)`}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ScheduleModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ groupCode: '', heldOn: '', notes: '' });
  const save = useMutation({
    mutationFn: () => api('/consortium/assemblies/schedule', { method: 'POST', body: { groupCode: form.groupCode, heldOn: form.heldOn, notes: form.notes || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
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
      title="Agendar assembleia"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cons-schedule-form" loading={save.isPending}>
            Agendar
          </Button>
        </>
      }
    >
      <form id="cons-schedule-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao agendar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grupo">{(id) => <Input id={id} required value={form.groupCode} onChange={(e) => setForm({ ...form, groupCode: e.target.value.toUpperCase() })} autoFocus />}</Field>
          <Field label="Data">{(id) => <Input id={id} type="date" required min={today()} value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} />}</Field>
        </div>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

function RescheduleModal({ assembly, onClose }: { assembly: Assembly; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ heldOn: assembly.heldOn, notes: assembly.notes ?? '' });
  const done = () => {
    queryClient.invalidateQueries({ queryKey: key });
    onClose();
  };
  const save = useMutation({ mutationFn: () => api(`/consortium/assemblies/${assembly.id}`, { method: 'PATCH', body: { heldOn: form.heldOn, notes: form.notes || null } }), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api(`/consortium/assemblies/${assembly.id}`, { method: 'DELETE' }), onSuccess: done });
  return (
    <Modal
      open
      title={`Remarcar — grupo ${assembly.groupCode}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" loading={remove.isPending} onClick={() => remove.mutate()} disabled={assembly.ourBids.length > 0}>
            Excluir
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(save.error || remove.error) && <Alert>{errorText(save.error ?? remove.error, 'Erro ao salvar')}</Alert>}
        <Field label="Data" hint={assembly.ourBids.length ? 'Os lances registrados acompanham a nova data.' : undefined}>
          {(id) => <Input id={id} type="date" min={today()} value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} />}
        </Field>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

/** Resultado de uma assembleia agendada (pelo id) ou de uma nova (grupo + data). */
function ResultsModal({ assembly, onClose }: { assembly: Assembly | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ groupCode: assembly?.groupCode ?? '', heldOn: assembly?.heldOn ?? today(), drawn: '', bids: '', notes: assembly?.notes ?? '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const results = {
        drawn: split(form.drawn),
        // "045:32,5" = cota 045 com lance de 32,5%.
        bids: split(form.bids).map((b) => {
          const [quotaNumber, percent] = b.split(':');
          return { quotaNumber, percent: Number((percent ?? '0').replace(',', '.')) };
        }),
        notes: form.notes || null,
      };
      return assembly
        ? api(`/consortium/assemblies/${assembly.id}/results`, { method: 'POST', body: results })
        : api('/consortium/assemblies', { method: 'POST', body: { groupCode: form.groupCode, heldOn: form.heldOn, ...results } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
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
      title={assembly ? `Resultado — grupo ${assembly.groupCode}, ${formatDate(assembly.heldOn)}` : 'Resultado da assembleia'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cons-assembly-form" loading={save.isPending}>
            Lançar
          </Button>
        </>
      }
    >
      <form id="cons-assembly-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao lançar')}</Alert>}
        {!assembly && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Grupo">{(id) => <Input id={id} required value={form.groupCode} onChange={(e) => set({ groupCode: e.target.value.toUpperCase() })} autoFocus />}</Field>
            <Field label="Data">{(id) => <Input id={id} type="date" required value={form.heldOn} onChange={(e) => set({ heldOn: e.target.value })} />}</Field>
          </div>
        )}
        <Field label="Cotas sorteadas" hint="Separe por vírgula. Ex.: 012, 145">
          {(id) => <Input id={id} value={form.drawn} onChange={(e) => set({ drawn: e.target.value })} />}
        </Field>
        <Field label="Lances vencedores" hint="cota:percentual, separados por vírgula. Ex.: 045:32,5, 210:28">
          {(id) => <Input id={id} value={form.bids} onChange={(e) => set({ bids: e.target.value })} />}
        </Field>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        {assembly && assembly.ourBids.length > 0 && (
          <p className="text-xs text-fg-muted">Lances da carteira nesta assembleia: os das cotas contempladas por lance viram vencedores; os demais, perdedores.</p>
        )}
      </form>
    </Modal>
  );
}
