import { api, ApiError, formatDate, formatDateTime, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Field, PageHeader, Select, Spinner, Textarea, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { contractTypeLabel, jobStatusLabel, salaryLabel, workModelLabel, type JobStatus } from '../contracts';
import { copyText, ScoreBadge } from './common';
import { statusTone } from './JobsPage';
import { recruitingKey, type BoardApplication, type JobDetail } from './types';

const REJECTED = '__rejected';

export function JobPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManageJob = useCan('recruiting.jobs.manage');
  const canMove = useCan('recruiting.candidates.manage');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [rejecting, setRejecting] = useState<BoardApplication | null>(null);

  const job = useQuery({ queryKey: [...recruitingKey, 'job', id], queryFn: () => api<JobDetail>(`/recruiting/jobs/${id}`) });
  const board = useQuery({
    queryKey: [...recruitingKey, 'board', id],
    queryFn: () => api<{ stages: JobDetail['stages']; applications: BoardApplication[] }>(`/recruiting/jobs/${id}/applications`),
    // Enquanto há análise na fila, atualiza sozinho para mostrar a nota quando ela chegar.
    refetchInterval: (q) => (q.state.data?.applications.some((a) => a.analysisStatus === 'pending' || a.analysisStatus === 'running') ? 15_000 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: recruitingKey });

  const setStatus = useMutation({ mutationFn: (status: JobStatus) => api(`/recruiting/jobs/${id}/status`, { method: 'POST', body: { status } }), onSuccess: refresh });
  const move = useMutation({
    mutationFn: ({ appId, stageId }: { appId: string; stageId: string }) => api(`/recruiting/applications/${appId}/move`, { method: 'POST', body: { stageId } }),
    onSuccess: refresh,
  });

  if (job.isPending) return <Spinner />;
  if (job.isError) return <Alert>{job.error.message}</Alert>;
  const j = job.data;
  const apps = board.data?.applications ?? [];
  const columns = [...j.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind as string })), { id: REJECTED, name: 'Reprovados', kind: 'rejected' }];
  const inColumn = (col: string) => (col === REJECTED ? apps.filter((a) => a.status === 'rejected') : apps.filter((a) => a.stageId === col && a.status !== 'rejected'));

  function drop(app: BoardApplication, col: string) {
    if (col === REJECTED) {
      if (app.status !== 'rejected') setRejecting(app);
      return;
    }
    if (app.stageId === col && app.status !== 'rejected') return;
    move.mutate({ appId: app.id, stageId: col });
  }

  const salary = salaryLabel(j.salaryMin, j.salaryMax);
  return (
    <>
      <Link to="/recrutamento/vagas" className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← Vagas
      </Link>
      <PageHeader
        title={j.title}
        description={[j.company ?? 'Própria empresa', j.area, workModelLabel[j.workModel], [j.city, j.state].filter(Boolean).join('/'), contractTypeLabel[j.contractType], `${j.positions} posição(ões)`]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canManageJob && (
            <div className="flex flex-wrap gap-2">
              {j.status !== 'open' && (
                <Button loading={setStatus.isPending} onClick={() => setStatus.mutate('open')}>
                  {j.status === 'draft' ? 'Abrir vaga' : 'Reabrir'}
                </Button>
              )}
              {j.status === 'open' && (
                <Button variant="secondary" onClick={() => setStatus.mutate('paused')}>
                  Pausar
                </Button>
              )}
              {j.status !== 'closed' && j.status !== 'draft' && (
                <Button variant="secondary" onClick={() => setStatus.mutate('closed')}>
                  Encerrar
                </Button>
              )}
              <Button variant="secondary" onClick={() => navigate(`/recrutamento/vagas/${id}/editar`)}>
                Editar
              </Button>
            </div>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={statusTone[j.status]}>{jobStatusLabel[j.status]}</Badge>
        {j.confidential && <Badge>Confidencial</Badge>}
        {salary && <span className="text-fg-muted">{salary}{j.showSalary ? '' : ' (não divulgado)'}</span>}
        {j.openedAt && <span className="text-fg-muted">Aberta em {formatDate(j.openedAt)}</span>}
      </div>
      {setStatus.error && <Alert>{setStatus.error instanceof ApiError ? setStatus.error.message : 'Erro'}</Alert>}
      {move.error && <Alert>{move.error instanceof ApiError ? move.error.message : 'Erro ao mover'}</Alert>}

      <PublicationPanel job={j} canManage={canManageJob} />

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Candidatos</h2>
        <div className="flex gap-2">
          {canMove && j.status !== 'closed' && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/recrutamento/candidatos?vaga=${id}`)}>
              Incluir candidato
            </Button>
          )}
          <div role="tablist" className="flex rounded-lg border border-line p-0.5 text-sm">
            {(['board', 'list'] as const).map((v) => (
              <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => setView(v)} className={cn('rounded-md px-3 py-1', view === v ? 'bg-brand-600 text-white' : 'text-fg-muted')}>
                {v === 'board' ? 'Quadro' : 'Lista'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {rejecting && <RejectForm app={rejecting} onDone={() => setRejecting(null)} />}

      {board.isPending ? (
        <Spinner />
      ) : board.isError ? (
        <Alert>{board.error.message}</Alert>
      ) : view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <Column key={col.id} col={col} apps={inColumn(col.id)} canMove={canMove} onDrop={drop} />
          ))}
        </div>
      ) : (
        <Card>
          {apps.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">Nenhuma candidatura ainda.</p>
          ) : (
            <ul className="divide-y divide-line">
              {apps.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <ScoreBadge score={a.score} method={a.scoreMethod} status={a.analysisStatus} />
                  <Link to={`/recrutamento/candidaturas/${a.id}`} className="flex-1 font-medium hover:underline">
                    {a.candidate.name}
                    {a.candidate.city && <span className="ml-1 font-normal text-fg-muted">· {[a.candidate.city, a.candidate.state].filter(Boolean).join('/')}</span>}
                  </Link>
                  {canMove ? (
                    <Select
                      aria-label={`Etapa de ${a.candidate.name}`}
                      className="max-w-48"
                      value={a.status === 'rejected' ? REJECTED : a.stageId}
                      onChange={(e) => {
                        const target = e.target.value;
                        drop(a, target);
                      }}
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge>{a.status === 'rejected' ? 'Reprovado' : (j.stages.find((s) => s.id === a.stageId)?.name ?? a.stageId)}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

function Column({
  col,
  apps,
  canMove,
  onDrop,
}: {
  col: { id: string; name: string; kind: string };
  apps: BoardApplication[];
  canMove: boolean;
  onDrop: (app: BoardApplication, col: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      aria-label={col.name}
      className={cn('flex w-64 shrink-0 flex-col rounded-2xl border bg-muted/40 p-2', over ? 'border-brand-600' : 'border-line')}
      onDragOver={(e) => {
        if (!canMove) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        setOver(false);
        const raw = e.dataTransfer.getData('application/json');
        if (raw) onDrop(JSON.parse(raw) as BoardApplication, col.id);
      }}
    >
      <h3 className="flex items-center justify-between px-2 py-1 text-sm font-medium">
        <span className={col.kind === 'rejected' ? 'text-danger-700' : col.kind === 'hired' ? 'text-success-700' : ''}>{col.name}</span>
        <span className="text-fg-muted tabular-nums">{apps.length}</span>
      </h3>
      <ul className="min-h-16 space-y-2">
        {apps.map((a) => (
          <li
            key={a.id}
            draggable={canMove}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/json', JSON.stringify(a));
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={cn('rounded-xl border border-line bg-surface p-3 text-sm shadow-sm', canMove && 'cursor-grab active:cursor-grabbing')}
          >
            <div className="flex items-start justify-between gap-2">
              <Link to={`/recrutamento/candidaturas/${a.id}`} className="font-medium hover:underline">
                {a.candidate.name}
              </Link>
              <ScoreBadge score={a.score} method={a.scoreMethod} status={a.analysisStatus} />
            </div>
            <div className="mt-1 text-xs text-fg-muted">
              {[a.candidate.city, a.candidate.state].filter(Boolean).join('/') || 'Cidade não informada'} · {formatDate(a.createdAt)}
            </div>
            {a.rejectionReason && <div className="mt-1 line-clamp-2 text-xs text-danger-700">{a.rejectionReason}</div>}
            {a.status === 'hired' && <div className="mt-1 text-xs text-success-700">{a.teamMemberId ? 'Na equipe' : 'Contratado — falta cadastrar na equipe'}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Motivo da reprovação, aberto na própria página (sem pop-up). */
function RejectForm({ app, onDone }: { app: BoardApplication; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const reject = useMutation({
    mutationFn: () => api(`/recruiting/applications/${app.id}/reject`, { method: 'POST', body: { reason } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: recruitingKey });
      onDone();
    },
  });
  return (
    <Card className="mb-4 space-y-3 border-danger-600/40 p-4">
      <h3 className="font-medium">Reprovar {app.candidate.name}</h3>
      {reject.error && <Alert>{reject.error instanceof ApiError ? reject.error.message : 'Erro'}</Alert>}
      <Field label="Motivo" hint="Fica no histórico do candidato. Seja objetivo e profissional (o candidato pode pedir acesso aos dados).">
        {(fid) => <Textarea id={fid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button variant="danger" loading={reject.isPending} disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>
          Reprovar
        </Button>
      </div>
    </Card>
  );
}

const gupyStatusLabel = { none: 'Não publicada', pending: 'Enviando…', synced: 'Publicada', error: 'Erro' } as const;

/** Onde a vaga está publicada: página pública, Indeed (feed), Gupy e o texto para o LinkedIn. */
function PublicationPanel({ job, canManage }: { job: JobDetail; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const resync = useMutation({ mutationFn: () => api(`/recruiting/jobs/${job.id}/gupy/sync`, { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: recruitingKey }) });
  const p = job.publication;
  async function copy(key: string, text: string) {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }
  }
  return (
    <Card className="grid gap-4 p-5 md:grid-cols-2">
      <div className="space-y-3 text-sm">
        <h2 className="font-medium">Publicação</h2>
        <div>
          <div className="text-xs text-fg-muted">Página de candidatura</div>
          {p.publicUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <a className="break-all text-brand-700 underline" href={p.publicUrl} target="_blank" rel="noreferrer">
                {p.publicUrl}
              </a>
              <Button size="sm" variant="ghost" onClick={() => copy('url', p.publicUrl!)}>
                {copied === 'url' ? 'Copiado!' : 'Copiar'}
              </Button>
            </div>
          ) : (
            <span className="text-fg-muted">{job.status === 'open' ? 'Página pública desligada nas configurações' : 'Aparece quando a vaga estiver aberta'}</span>
          )}
        </div>
        <div>
          <div className="text-xs text-fg-muted">Indeed</div>
          {p.indeedFeedUrl ? (
            <span>
              {job.status === 'open' ? 'No feed de vagas' : 'Fora do feed (só vagas abertas)'} ·{' '}
              <button type="button" className="text-brand-700 underline" onClick={() => copy('feed', p.indeedFeedUrl!)}>
                {copied === 'feed' ? 'endereço copiado!' : 'copiar endereço do feed'}
              </button>
            </span>
          ) : (
            <span className="text-fg-muted">Feed desligado (página pública desligada)</span>
          )}
        </div>
        <div>
          <div className="text-xs text-fg-muted">Gupy{p.gupyMode === 'simulated' ? ' (modo simulado)' : ''}</div>
          {p.gupyMode === 'off' ? (
            <span className="text-fg-muted">Integração desligada nas configurações</span>
          ) : !job.publishGupy && !job.gupyJobId ? (
            <span className="text-fg-muted">Não marcada para publicar (edite a vaga)</span>
          ) : (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={job.gupySyncStatus === 'synced' ? 'success' : job.gupySyncStatus === 'error' ? 'danger' : 'neutral'}>{gupyStatusLabel[job.gupySyncStatus]}</Badge>
                {job.gupyJobId && <span className="text-xs text-fg-muted">id {job.gupyJobId}</span>}
                {job.gupySyncedAt && <span className="text-xs text-fg-muted">em {formatDateTime(job.gupySyncedAt)}</span>}
                {canManage && (job.gupySyncStatus === 'error' || job.gupySyncStatus === 'synced') && (
                  <Button size="sm" variant="ghost" loading={resync.isPending} onClick={() => resync.mutate()}>
                    {job.gupySyncStatus === 'error' ? 'Tentar de novo' : 'Reenviar'}
                  </Button>
                )}
              </div>
              {job.gupyError && <p className="text-xs text-danger-700">{job.gupyError}</p>}
              {resync.error && <p className="text-xs text-danger-700">{resync.error instanceof ApiError ? resync.error.message : 'Erro'}</p>}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <h2 className="font-medium">LinkedIn</h2>
        <p className="text-fg-muted">
          A API de vagas do LinkedIn é restrita a parceiros e não aceita novas integrações. A vaga chega ao LinkedIn pela Gupy (que publica nele pela conta da empresa) ou
          compartilhando o link da página pública. Texto pronto para o post:
        </p>
        {p.linkedinText ? (
          <>
            <textarea readOnly rows={7} className="w-full rounded-lg border border-line bg-muted/40 p-2 text-xs" value={p.linkedinText} />
            <Button size="sm" variant="secondary" onClick={() => copy('post', p.linkedinText!)}>
              {copied === 'post' ? 'Copiado!' : 'Copiar texto'}
            </Button>
          </>
        ) : (
          <span className="text-fg-muted">A empresa precisa de um endereço público (Dados da empresa).</span>
        )}
      </div>
    </Card>
  );
}
