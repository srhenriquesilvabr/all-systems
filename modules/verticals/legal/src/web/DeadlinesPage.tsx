import { api, ApiError, formatDate, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Select, Spinner } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Deadline } from '../contracts';
import { daysUntil, dueText, legalKey } from './shared';

const addDays = (n: number) => {
  const d = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Prazos em aberto do escritório (ou só os meus), dos vencidos aos próximos. */
export function DeadlinesPage() {
  const { user } = useSession();
  const [mine, setMine] = useState(false);
  const [days, setDays] = useState(15);
  const until = addDays(days);
  const deadlines = useQuery({
    queryKey: [...legalKey, 'deadlines', { until, mine }],
    queryFn: () => api<Deadline[]>('/legal/deadlines', { query: { status: 'open', until, assignedUserId: mine ? user.id : undefined } }),
  });

  return (
    <>
      <PageHeader
        title="Prazos"
        description="Prazos em aberto. A equipe recebe aviso por e-mail com a antecedência escolhida em cada prazo."
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
  const toggle = useMutation({
    mutationFn: (d: Deadline) => api(`/legal/deadlines/${d.id}/${d.status === 'open' ? 'done' : 'reopen'}`, { method: 'POST' }),
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
                    <Badge tone="success">Cumprido</Badge>
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
                  <Button size="sm" variant={d.status === 'open' ? 'secondary' : 'ghost'} loading={toggle.isPending && toggle.variables?.id === d.id} onClick={() => toggle.mutate(d)}>
                    {d.status === 'open' ? 'Marcar cumprido' : 'Reabrir'}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
