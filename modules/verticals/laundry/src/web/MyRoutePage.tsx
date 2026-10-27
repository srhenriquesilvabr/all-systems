import { formatDate, formatMoney, today } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Spinner } from '@all/ui';
import { useState } from 'react';
import type { LogisticsJob } from '../contracts';
import { addDays, ContactLinks, JobActions, JobBadges, JobProof, useMyRoute, useRefreshLogistics, windowText } from './logistics';

/** Motorista, no celular: as coletas e entregas dele no dia, na ordem das janelas. */
export function MyRoutePage() {
  const refresh = useRefreshLogistics();
  const [date, setDate] = useState(today());
  const route = useMyRoute(date);
  const open = route.data?.filter((j) => j.status === 'scheduled' || j.status === 'en_route') ?? [];
  const closed = route.data?.filter((j) => j.status !== 'scheduled' && j.status !== 'en_route') ?? [];
  const isToday = date === today();

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-medium">{isToday ? 'Minhas rotas de hoje' : `Rotas de ${formatDate(date)}`}</h1>
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" aria-label="Dia anterior" onClick={() => setDate(addDays(date, -1))}>
            ‹
          </Button>
          {!isToday && (
            <Button size="sm" variant="secondary" onClick={() => setDate(today())}>
              Hoje
            </Button>
          )}
          <Button size="sm" variant="secondary" aria-label="Próximo dia" onClick={() => setDate(addDays(date, 1))}>
            ›
          </Button>
        </div>
      </div>

      {route.isPending ? (
        <Spinner />
      ) : route.isError ? (
        <Alert>{route.error.message}</Alert>
      ) : route.data.length === 0 ? (
        <Card>
          <EmptyState title="Nada na sua rota" description="Quando o escritório atribuir coletas ou entregas a você, elas aparecem aqui." />
        </Card>
      ) : (
        <>
          <p className="mb-3 text-sm text-fg-muted">
            {open.length} em aberto{closed.length ? ` · ${closed.length} encerrada(s)` : ''}
          </p>
          <ol className="space-y-3">
            {open.map((j, i) => (
              <li key={j.id}>
                <StopCard job={j} position={i + 1} onChanged={refresh} />
              </li>
            ))}
          </ol>
          {closed.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-medium text-fg-muted">Encerradas</h2>
              <ul className="space-y-3">
                {closed.map((j) => (
                  <li key={j.id}>
                    <StopCard job={j} onChanged={refresh} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function StopCard({ job, position, onChanged }: { job: LogisticsJob; position?: number; onChanged: () => void }) {
  const balance = job.order ? Math.round((job.order.total - job.order.paidAmount) * 100) / 100 : 0;
  const toCollect = (job.kind === 'delivery' ? balance : 0) + (job.feeStatus === 'pending' ? job.fee : 0);
  return (
    <Card className={job.status === 'en_route' ? 'space-y-3 p-4 ring-2 ring-brand-600' : 'space-y-3 p-4'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium tabular-nums text-fg-muted">
            {position ? `${position}. ` : ''}
            {windowText(job)}
            {job.date !== today() && ` · ${formatDate(job.date)}`}
          </p>
          <p className="text-lg font-medium leading-tight">{job.customer.name}</p>
        </div>
        <JobBadges job={job} />
      </div>
      <div className="text-sm">
        <p>{job.addressText || 'Sem endereço — ligue para o cliente'}</p>
        {job.address.reference && <p className="text-fg-muted">Referência: {job.address.reference}</p>}
        {job.order && <p className="text-fg-muted">Ordem nº {job.order.number}</p>}
        {job.notes && <p className="mt-1 whitespace-pre-line rounded-md bg-muted/60 p-2">{job.notes}</p>}
        {toCollect > 0 && job.status !== 'done' && job.status !== 'cancelled' && (
          <p className="mt-1 font-medium">
            A receber: {formatMoney(toCollect)}{' '}
            <span className="font-normal text-fg-muted">
              ({[job.kind === 'delivery' && balance > 0 ? `ordem ${formatMoney(balance)}` : null, job.feeStatus === 'pending' ? `taxa ${formatMoney(job.fee)}` : null]
                .filter(Boolean)
                .join(' + ')})
            </span>
          </p>
        )}
      </div>
      {job.status !== 'done' && job.status !== 'cancelled' && <ContactLinks job={job} />}
      <JobProof job={job} />
      <JobActions job={job} onChanged={onChanged} />
    </Card>
  );
}
