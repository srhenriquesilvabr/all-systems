import { api, formatDate, formatDateTime, formatMoney, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { bidStatusLabel, bidTypeLabel, parseWinningBids, type Assembly } from '../contracts';
import { bidTone, errorText, key, pct, useAdministrators } from './common';

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

const resultsText = (bids: { quotaNumber: string; percent: number }[]) => bids.map((b) => `${b.quotaNumber}:${String(b.percent).replace('.', ',')}`).join(', ');

/** Escolha da administradora do grupo: o mesmo código pode existir em mais de uma. */
function AdministratorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const administrators = useAdministrators();
  const list = administrators.data ?? [];
  return (
    <Field label="Administradora" hint={list.length > 1 ? 'Em branco, vale a única que tem este grupo. Se houver mais de uma, o sistema pede para escolher.' : undefined}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{list.length === 1 ? list[0]!.institution : 'Identificar pelo grupo'}</option>
          {list.length > 1 &&
            list.map((a) => (
              <option key={a.connectionId} value={a.connectionId}>
                {a.institution}
              </option>
            ))}
        </Select>
      )}
    </Field>
  );
}

/** Calendário das assembleias: agendadas (recebem lances) e realizadas (com resultado). */
export function AssembliesPage() {
  const canManage = useCan('consortium.manage');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [scheduling, setScheduling] = useState(false);
  const [results, setResults] = useState<Assembly | 'new' | null>(null);
  const [editing, setEditing] = useState<Assembly | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
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
                  Grupo {a.groupCode}
                  {a.institution ? ` (${a.institution})` : ''} · {formatDate(a.heldOn)} <Badge tone="warning">Agendada</Badge>
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
                  Grupo {a.groupCode}
                  {a.institution ? ` (${a.institution})` : ''} · {formatDate(a.heldOn)}
                </span>
                <span className="flex flex-wrap items-center gap-3 text-fg-muted">
                  Sorteio: {a.drawn.join(', ') || '—'} · Lance: {a.bids.map((b) => `${b.quotaNumber} (${pct(b.percent)})`).join(', ') || '—'}
                  {canManage && correcting !== a.id && (
                    <Button size="sm" variant="secondary" onClick={() => setCorrecting(a.id)}>
                      Corrigir resultado
                    </Button>
                  )}
                </span>
              </div>
              {correcting === a.id && <CorrectionForm assembly={a} onClose={() => setCorrecting(null)} />}
              {a.ourWinners.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {a.ourWinners.map((w) => (
                    <li key={w.quotaId}>
                      <Badge tone="success">Contemplada</Badge>{' '}
                      <Link to={`/consorcio/cotas/${w.quotaId}`} className="text-brand-700 hover:underline">
                        {w.customer} — cota {w.quotaNumber}
                      </Link>{' '}
                      ({w.type === 'draw' ? 'sorteio' : 'lance'})
                      {canManage && reverting !== w.quotaId && (
                        <button type="button" className="ml-2 text-xs text-danger-700 hover:underline" onClick={() => setReverting(w.quotaId)}>
                          desfazer
                        </button>
                      )}
                      {reverting === w.quotaId && <RevertForm quotaId={w.quotaId} quotaNumber={w.quotaNumber} onClose={() => setReverting(null)} />}
                    </li>
                  ))}
                </ul>
              )}
              <BidsList assembly={a} />
              {a.notes && <p className="mt-2 text-fg-muted">{a.notes}</p>}
              <CorrectionsHistory assembly={a} />
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

/**
 * Correção de um resultado lançado, na própria tela: a lista nova vale inteira no lugar da anterior,
 * e a tela explica o que acontece com quem sai dela antes de confirmar.
 */
function CorrectionForm({ assembly, onClose }: { assembly: Assembly; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ drawn: assembly.drawn.join(', '), bids: resultsText(assembly.bids), notes: assembly.notes ?? '', reason: '', notifyCustomer: true, connectionId: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const { bids, invalid } = parseWinningBids(form.bids);
      if (invalid.length) throw new Error(`Lance sem percentual: ${invalid.join(', ')}. Use cota:percentual, como 045:32,5.`);
      return api(`/consortium/assemblies/${assembly.id}/correct`, {
        method: 'POST',
        body: { drawn: split(form.drawn), bids, notes: form.notes || null, reason: form.reason, notifyCustomer: form.notifyCustomer, connectionId: form.connectionId || null },
      });
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
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl border border-line bg-muted/30 p-3">
      {save.error && <Alert>{errorText(save.error, 'Erro ao corrigir')}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {!assembly.connectionId && <AdministratorField value={form.connectionId} onChange={(connectionId) => set({ connectionId })} />}
        <Field label="Cotas sorteadas" hint="Separe por vírgula. Ex.: 012, 145">
          {(id) => <Input id={id} value={form.drawn} onChange={(e) => set({ drawn: e.target.value })} />}
        </Field>
        <Field label="Lances vencedores" hint="cota:percentual, separados por vírgula">
          {(id) => <Input id={id} value={form.bids} onChange={(e) => set({ bids: e.target.value })} />}
        </Field>
      </div>
      <Field label="Motivo da correção">{(id) => <Input id={id} required minLength={3} maxLength={300} value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Ex.: número digitado errado; a lista da administradora mostra 145" />}</Field>
      <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      <Checkbox label="Avisar os clientes cuja contemplação for desfeita" checked={form.notifyCustomer} onChange={(e) => set({ notifyCustomer: e.target.checked })} />
      <p className="text-xs text-fg-muted">
        Cota que sai da lista volta a Ativa, o acompanhamento do crédito em aberto é retirado e os lances são refeitos. O aviso de contemplação já enviado não volta: por isso a correção avisa o cliente. Cota que entra é contemplada e avisada normalmente. Se o crédito já foi liberado, a correção é recusada até ele voltar a "Aguardando documentação". Tudo fica no histórico abaixo e na auditoria.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={save.isPending} disabled={form.reason.trim().length < 3}>
          Salvar correção
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onClose}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Desfaz a contemplação de uma cota: ela sai do resultado lançado. */
export function RevertForm({ quotaId, quotaNumber, onClose }: { quotaId: string; quotaNumber: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const save = useMutation({
    mutationFn: () => api(`/consortium/quotas/${quotaId}/revert-contemplation`, { method: 'POST', body: { reason, notifyCustomer } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  return (
    <div className="mt-2 space-y-3 rounded-xl border border-line bg-muted/30 p-3 text-sm">
      {save.error && <Alert>{errorText(save.error, 'Erro ao desfazer')}</Alert>}
      <p>
        A cota {quotaNumber} volta a Ativa e sai do resultado lançado. O acompanhamento do crédito em aberto é retirado e os lances são refeitos. Se o crédito já foi liberado, volte ele a "Aguardando documentação" antes.
      </p>
      <Field label="Motivo">{(id) => <Input id={id} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
      <Checkbox label="Avisar o cliente da correção (o aviso de contemplação já enviado não volta)" checked={notifyCustomer} onChange={(e) => setNotifyCustomer(e.target.checked)} />
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>
          Desfazer contemplação
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

function CorrectionsHistory({ assembly }: { assembly: Assembly }) {
  if (!assembly.corrections.length) return null;
  const list = (items: { quotaNumber: string | null }[]) => items.map((i) => i.quotaNumber).join(', ');
  return (
    <div className="mt-3 border-t border-line pt-2 text-xs text-fg-muted">
      <p className="mb-1 font-medium">Correções</p>
      <ul className="space-y-1">
        {assembly.corrections.map((c) => (
          <li key={c.id}>
            {formatDateTime(c.createdAt)} · {c.userName ?? 'Sistema'} · {c.kind === 'correction' ? 'resultado corrigido' : 'contemplação desfeita'}: {c.reason}. Antes: sorteio {c.before.drawn.join(', ') || '—'}, lance {resultsText(c.before.bids) || '—'}.
            {c.effects.reverted.length > 0 && ` Desfeitas: ${list(c.effects.reverted)}${c.effects.reverted.some((r) => r.notified) ? ' (cliente avisado)' : ' (sem aviso)'}.`}
            {c.effects.contemplated.length > 0 && ` Contempladas: ${list(c.effects.contemplated)}.`}
            {c.effects.changed.length > 0 && ` Alteradas: ${list(c.effects.changed)}.`}
          </li>
        ))}
      </ul>
    </div>
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
  const [form, setForm] = useState({ connectionId: '', groupCode: '', heldOn: '', notes: '' });
  const save = useMutation({
    mutationFn: () => api('/consortium/assemblies/schedule', { method: 'POST', body: { connectionId: form.connectionId || null, groupCode: form.groupCode, heldOn: form.heldOn, notes: form.notes || null } }),
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
        <AdministratorField value={form.connectionId} onChange={(connectionId) => setForm({ ...form, connectionId })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grupo">{(id) => <Input id={id} required value={form.groupCode} onChange={(e) => setForm({ ...form, groupCode: e.target.value })} autoFocus />}</Field>
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
  const [form, setForm] = useState({ connectionId: '', groupCode: assembly?.groupCode ?? '', heldOn: assembly?.heldOn ?? today(), drawn: '', bids: '', notes: assembly?.notes ?? '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const { bids, invalid } = parseWinningBids(form.bids);
      if (invalid.length) throw new Error(`Lance sem percentual: ${invalid.join(', ')}. Use cota:percentual, como 045:32,5.`);
      const results = { connectionId: form.connectionId || null, drawn: split(form.drawn), bids, notes: form.notes || null };
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
        {!assembly?.connectionId && <AdministratorField value={form.connectionId} onChange={(connectionId) => set({ connectionId })} />}
        {!assembly && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Grupo">{(id) => <Input id={id} required value={form.groupCode} onChange={(e) => set({ groupCode: e.target.value })} autoFocus />}</Field>
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
