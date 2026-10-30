import { api, ApiError, formatDate, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Deadline } from '../contracts';
import { daysUntil, dueText, legalKey, useTeam } from './shared';

const addDays = (n: number) => {
  const d = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Prazos em aberto do escritório (ou só os meus), dos vencidos aos próximos. */
export function DeadlinesPage() {
  const [mine, setMine] = useState(false);
  const [days, setDays] = useState(15);
  const until = addDays(days);
  const deadlines = useQuery({
    queryKey: [...legalKey, 'deadlines', { until, mine }],
    queryFn: () => api<Deadline[]>('/legal/deadlines', { query: { status: 'open', until, mine: mine ? 'true' : undefined } }),
  });

  return (
    <>
      <PageHeader
        title="Prazos"
        description={mine ? 'Os prazos que você cuida e os dos processos em que você é responsável.' : 'Prazos em aberto. A equipe recebe aviso por e-mail com a antecedência escolhida em cada prazo.'}
        actions={
          <div className="flex gap-2">
            <Select aria-label="De quem" value={mine ? 'mine' : 'all'} onChange={(e) => setMine(e.target.value === 'mine')}>
              <option value="all">Todo o escritório</option>
              <option value="mine">Só os meus</option>
            </Select>
            <Select aria-label="Período" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              <option value="7">Até 7 dias</option>
              <option value="15">Até 15 dias</option>
              <option value="30">Até 30 dias</option>
              <option value="90">Até 90 dias</option>
            </Select>
          </div>
        }
      />
      {deadlines.isPending ? <Spinner /> : deadlines.isError ? <Alert>{deadlines.error.message}</Alert> : <DeadlineList deadlines={deadlines.data} />}
    </>
  );
}

export function DeadlineList({ deadlines, showCase = true }: { deadlines: Deadline[]; showCase?: boolean }) {
  const queryClient = useQueryClient();
  const canWrite = useCan('legal.cases.write');
  const [completing, setCompleting] = useState<Deadline | null>(null);
  // Edição e exclusão abrem no próprio cartão, sem janela por cima.
  const [panel, setPanel] = useState<{ id: string; kind: 'edit' | 'delete' } | null>(null);
  const toggle = useMutation({
    mutationFn: (d: Deadline) => api(`/legal/deadlines/${d.id}/reopen`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: legalKey }),
  });
  if (deadlines.length === 0) {
    return (
      <Card>
        <EmptyState title="Nenhum prazo" />
      </Card>
    );
  }
  return (
    <>
      {toggle.error && <Alert>{toggle.error instanceof ApiError ? toggle.error.message : 'Erro ao atualizar'}</Alert>}
      <ul className="space-y-2">
        {deadlines.map((d) => {
          const left = daysUntil(d.dueOn);
          const urgent = d.status === 'open' && left <= 2;
          return (
            <li key={d.id}>
              <Card className={`flex flex-wrap items-center gap-4 p-4 text-sm ${urgent ? 'border-danger-200' : ''}`}>
                <div className="w-24 shrink-0">
                  <div className="font-medium tabular-nums">{formatDate(d.dueOn)}</div>
                  {d.status === 'open' ? (
                    <div className={urgent ? 'text-xs font-medium text-danger-600' : 'text-xs text-fg-muted'}>{dueText(d.dueOn)}</div>
                  ) : (
                    <>
                      <Badge tone="success">Cumprido</Badge>
                      {d.doneAt && <div className="text-xs text-fg-muted tabular-nums">em {formatDate(d.doneAt)}</div>}
                    </>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={d.status === 'done' ? 'font-medium text-fg-subtle line-through' : 'font-medium'}>{d.title}</div>
                  <div className="text-xs text-fg-muted">
                    {showCase && (
                      <Link to={`/juridico/processos/${d.case.id}`} className="text-brand-700 hover:underline">
                        {d.case.title}
                        {d.case.number && ` · ${d.case.number}`}
                      </Link>
                    )}
                    {d.assigned && `${showCase ? ' · ' : ''}${d.assigned.name}`}
                  </div>
                  {d.notes && <div className="mt-1 text-xs text-fg-muted">{d.notes}</div>}
                </div>
                {canWrite && (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant={d.status === 'open' ? 'secondary' : 'ghost'} loading={toggle.isPending && toggle.variables?.id === d.id} onClick={() => (d.status === 'open' ? setCompleting(d) : toggle.mutate(d))}>
                      {d.status === 'open' ? 'Marcar cumprido' : 'Reabrir'}
                    </Button>
                    {d.status === 'open' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setPanel({ id: d.id, kind: 'edit' })}>
                          Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPanel({ id: d.id, kind: 'delete' })}>
                          Excluir
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {panel?.id === d.id && panel.kind === 'edit' && <DeadlineEdit deadline={d} onClose={() => setPanel(null)} />}
                {panel?.id === d.id && panel.kind === 'delete' && <DeadlineDelete deadline={d} onClose={() => setPanel(null)} />}
              </Card>
            </li>
          );
        })}
      </ul>
      {completing && <CompleteModal deadline={completing} onClose={() => setCompleting(null)} />}
    </>
  );
}

/** Corrige o prazo no próprio cartão. Mudar data, antecedência ou quem cuida libera o aviso de novo. */
function DeadlineEdit({ deadline, onClose }: { deadline: Deadline; onClose: () => void }) {
  const queryClient = useQueryClient();
  const team = useTeam();
  const [form, setForm] = useState({ title: deadline.title, dueOn: deadline.dueOn, alertDays: String(deadline.alertDays), assignedUserId: deadline.assigned?.id ?? '', notes: deadline.notes ?? '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => api(`/legal/deadlines/${deadline.id}`, { method: 'PATCH', body: { ...form, alertDays: Number(form.alertDays), assignedUserId: form.assignedUserId || null, notes: form.notes || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: legalKey });
      onClose();
    },
  });
  return (
    <div className="w-full space-y-3 border-t border-line pt-3">
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
      <Field label="Prazo">{(id) => <Input id={id} required minLength={3} value={form.title} onChange={(e) => set({ title: e.target.value })} />}</Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Vencimento">{(id) => <Input id={id} type="date" required value={form.dueOn} onChange={(e) => set({ dueOn: e.target.value })} />}</Field>
        <Field label="Avisar com antecedência">
          {(id) => (
            <Select id={id} value={form.alertDays} onChange={(e) => set({ alertDays: e.target.value })}>
              {[0, 1, 2, 3, 5, 7, 10, 15].map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'No dia' : `${d} dia${d > 1 ? 's' : ''} antes`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Quem cuida">
          {(id) => (
            <Select id={id} value={form.assignedUserId} onChange={(e) => set({ assignedUserId: e.target.value })}>
              <option value="">—</option>
              {team.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Voltar
        </Button>
        <Button size="sm" loading={save.isPending} disabled={form.title.trim().length < 3 || !form.dueOn} onClick={() => save.mutate()}>
          Salvar prazo
        </Button>
      </div>
    </div>
  );
}

/** Prazo errado se exclui com motivo, em vez de virar "cumprido". */
function DeadlineDelete({ deadline, onClose }: { deadline: Deadline; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const remove = useMutation({
    mutationFn: () => api(`/legal/deadlines/${deadline.id}/delete`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: legalKey });
      onClose();
    },
  });
  return (
    <div className="w-full space-y-3 border-t border-line pt-3">
      {remove.error && <Alert>{remove.error instanceof ApiError ? remove.error.message : 'Erro ao excluir'}</Alert>}
      <Field label="Por que excluir este prazo?" hint="O prazo sai das telas e dos avisos. O motivo fica na auditoria.">
        {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Voltar
        </Button>
        <Button size="sm" variant="danger" loading={remove.isPending} disabled={reason.trim().length < 3} onClick={() => remove.mutate()}>
          Excluir prazo
        </Button>
      </div>
    </div>
  );
}

/** Confirma o cumprimento com a data real (padrão hoje); o andamento "Prazo cumprido" sai com ela. */
function CompleteModal({ deadline, onClose }: { deadline: Deadline; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [doneOn, setDoneOn] = useState(today());
  const done = useMutation({
    mutationFn: () => api(`/legal/deadlines/${deadline.id}/done`, { method: 'POST', body: { doneOn } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: legalKey });
      onClose();
    },
  });
  return (
    <Modal
      open
      title={`Prazo cumprido: ${deadline.title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="legal-deadline-done" loading={done.isPending} disabled={!doneOn}>
            Marcar cumprido
          </Button>
        </>
      }
    >
      <form
        id="legal-deadline-done"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          done.mutate();
        }}
      >
        {done.error && <Alert>{done.error instanceof ApiError ? done.error.message : 'Erro ao atualizar'}</Alert>}
        <Field label="Cumprido em">{(id) => <Input id={id} type="date" required max={today()} value={doneOn} onChange={(e) => setDoneOn(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
