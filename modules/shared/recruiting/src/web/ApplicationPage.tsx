import { api, ApiError, formatDate, formatDateTime, formatMoney, formatPhone, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { applicationStatusLabel } from '../contracts';
import { Info, ResumeButton, ScoreBadge, Timeline } from './common';
import { recruitingKey, type Analysis, type ApplicationDetail } from './types';

export function ApplicationPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const canManage = useCan('recruiting.candidates.manage');
  const hrActive = session.modules.some((m) => m.key === 'hr');
  const canSeeTeam = useCan('core.team.read');
  const app = useQuery({
    queryKey: [...recruitingKey, 'application', id],
    queryFn: () => api<ApplicationDetail>(`/recruiting/applications/${id}`),
    refetchInterval: (q) => (q.state.data && (q.state.data.analysisStatus === 'pending' || q.state.data.analysisStatus === 'running') ? 10_000 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: recruitingKey });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [startedOn, setStartedOn] = useState('');

  const move = useMutation({ mutationFn: (stageId: string) => api(`/recruiting/applications/${id}/move`, { method: 'POST', body: { stageId } }), onSuccess: refresh });
  const reject = useMutation({
    mutationFn: () => api(`/recruiting/applications/${id}/reject`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      setRejecting(false);
      setReason('');
      refresh();
    },
  });
  const addNote = useMutation({
    mutationFn: () => api(`/recruiting/applications/${id}/notes`, { method: 'POST', body: { text: note } }),
    onSuccess: () => {
      setNote('');
      refresh();
    },
  });
  const analyze = useMutation({ mutationFn: (analysis: 'auto' | 'heuristic') => api(`/recruiting/applications/${id}/analyze`, { method: 'POST', body: { analysis } }), onSuccess: refresh });
  const hire = useMutation({
    mutationFn: () => api<{ teamMemberId: string; hrActive: boolean }>(`/recruiting/applications/${id}/hire`, { method: 'POST', body: { startedOn: startedOn || null } }),
    onSuccess: async (r) => {
      await refresh();
      // Com o RH ativo, segue para a admissão com a pessoa já escolhida.
      if (r.hrActive) navigate(`/rh/colaboradores?admitir=${r.teamMemberId}`);
    },
  });

  if (app.isPending) return <Spinner />;
  if (app.isError) return <Alert>{app.error.message}</Alert>;
  const a = app.data;
  const c = a.candidate;
  const stage = a.job.stages.find((s) => s.id === a.stageId);
  const latest = a.analyses[0];
  const anonymized = !!c.anonymizedAt;
  const error = [move.error, reject.error, addNote.error, analyze.error, hire.error].find(Boolean);

  return (
    <>
      <Link to={`/recrutamento/vagas/${a.job.id}`} className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← {a.job.title}
      </Link>
      <PageHeader
        title={c.name}
        description={`${a.job.title} · ${a.status === 'rejected' ? 'Reprovado' : (stage?.name ?? a.stageId)} · candidatura em ${formatDate(a.createdAt)}${a.source === 'public' ? ' pela página pública' : ' pela equipe'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate(`/recrutamento/candidatos/${c.id}`)}>
              Ficha do candidato
            </Button>
            {a.resume && <ResumeButton path={`/recruiting/applications/${id}/resume`} />}
          </div>
        }
      />
      {error && <Alert>{error instanceof ApiError ? error.message : 'Erro'}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Card className="space-y-2 p-5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg-muted">Situação</span>
              <Badge tone={a.status === 'rejected' ? 'danger' : a.status === 'hired' ? 'success' : 'brand'}>{applicationStatusLabel[a.status]}</Badge>
            </div>
            {c.email && <Info label="E-mail">{c.email}</Info>}
            {c.phone && <Info label="Telefone">{formatPhone(c.phone)}</Info>}
            {c.linkedinUrl && (
              <Info label="LinkedIn">
                <a className="text-brand-700 underline" href={c.linkedinUrl} target="_blank" rel="noreferrer">
                  {c.linkedinUrl.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              </Info>
            )}
            {(c.city || c.state) && <Info label="Cidade">{[c.city, c.state].filter(Boolean).join('/')}</Info>}
            {a.salaryExpectation != null && <Info label="Pretensão salarial">{formatMoney(a.salaryExpectation)}</Info>}
            {a.rejectionReason && <Info label="Motivo da reprovação">{a.rejectionReason}</Info>}
            {anonymized && <Alert tone="info">Os dados pessoais deste candidato foram excluídos (LGPD).</Alert>}
          </Card>

          {canManage && !anonymized && a.job.status !== 'closed' && (
            <Card className="space-y-3 p-5 text-sm">
              <h2 className="font-medium">Etapa</h2>
              <Select aria-label="Mover para a etapa" value={a.status === 'rejected' ? '' : a.stageId} onChange={(e) => e.target.value && move.mutate(e.target.value)}>
                {a.status === 'rejected' && <option value="">Reprovado — escolha a etapa para reabrir</option>}
                {a.job.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              {a.status !== 'rejected' && !a.teamMemberId && !rejecting && (
                <Button variant="danger" size="sm" onClick={() => setRejecting(true)}>
                  Reprovar
                </Button>
              )}
              {rejecting && (
                <div className="space-y-2">
                  <Field label="Motivo da reprovação">{(fid) => <Textarea id={fid} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setRejecting(false)}>
                      Cancelar
                    </Button>
                    <Button size="sm" variant="danger" loading={reject.isPending} disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>
                      Reprovar
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {a.status === 'hired' && (
            <Card className="space-y-3 p-5 text-sm">
              <h2 className="font-medium">Contratação</h2>
              {a.teamMemberId ? (
                <>
                  <p>Cadastrado na equipe.</p>
                  <div className="flex flex-wrap gap-2">
                    {canSeeTeam && (
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/equipe/${a.teamMemberId}`)}>
                        Ver na equipe
                      </Button>
                    )}
                    {hrActive && (
                      <Button size="sm" onClick={() => navigate(`/rh/colaboradores?admitir=${a.teamMemberId}`)}>
                        Abrir admissão no RH
                      </Button>
                    )}
                  </div>
                </>
              ) : canManage && !anonymized ? (
                <>
                  <p className="text-fg-muted">Cria a pessoa da equipe com nome, contato, LinkedIn e currículo do candidato{hrActive ? ' e segue para a admissão no RH' : ''}.</p>
                  <Field label="Início previsto (opcional)">{(fid) => <Input id={fid} type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />}</Field>
                  <Button loading={hire.isPending} onClick={() => hire.mutate()}>
                    {hrActive ? 'Cadastrar na equipe e admitir' : 'Cadastrar na equipe'}
                  </Button>
                </>
              ) : null}
            </Card>
          )}

          {a.consent && (
            <Card className="space-y-1 p-5 text-xs text-fg-muted">
              <h2 className="text-sm font-medium text-fg">Consentimento (LGPD)</h2>
              <p>
                Aceito em {formatDateTime(a.consent.acceptedAt)} (versão {a.consent.version}).
              </p>
              <details>
                <summary className="cursor-pointer">Texto aceito</summary>
                <p className="mt-1 whitespace-pre-wrap">{a.consent.text}</p>
              </details>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <AnalysisCard analysis={latest} status={a.analysisStatus} score={a.score} method={a.scoreMethod} canManage={canManage && !anonymized} onAnalyze={(m) => analyze.mutate(m)} analyzing={analyze.isPending} history={a.analyses.slice(1)} />

          {a.answers.length > 0 && (
            <Card>
              <h2 className="border-b border-line px-4 py-3 font-medium">Respostas</h2>
              <dl className="divide-y divide-line text-sm">
                {a.answers.map((ans) => (
                  <div key={ans.questionId} className="px-4 py-3">
                    <dt className="text-fg-muted">{ans.question}</dt>
                    <dd className="mt-1 whitespace-pre-wrap">{ans.answer}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          <Card>
            <h2 className="border-b border-line px-4 py-3 font-medium">Histórico e anotações</h2>
            {canManage && !anonymized && (
              <div className="space-y-2 border-b border-line p-4">
                <Textarea aria-label="Nova anotação" rows={2} placeholder="Anotação sobre a entrevista, combinados, retorno…" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex justify-end">
                  <Button size="sm" loading={addNote.isPending} disabled={!note.trim()} onClick={() => addNote.mutate()}>
                    Anotar
                  </Button>
                </div>
              </div>
            )}
            <Timeline events={a.events} />
          </Card>
        </div>
      </div>
    </>
  );
}

function AnalysisCard({
  analysis,
  status,
  score,
  method,
  canManage,
  onAnalyze,
  analyzing,
  history,
}: {
  analysis: Analysis | undefined;
  status: string;
  score: number | null;
  method: 'ai' | 'heuristic' | null;
  canManage: boolean;
  onAnalyze: (m: 'auto' | 'heuristic') => void;
  analyzing: boolean;
  history: Analysis[];
}) {
  const running = status === 'pending' || status === 'running';
  const done = analysis?.status === 'done' ? analysis : history.find((h) => h.status === 'done');
  return (
    <Card className="space-y-3 p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          Aderência à vaga <ScoreBadge score={score} method={method} status={status} />
        </h2>
        {canManage && !running && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" loading={analyzing} onClick={() => onAnalyze('auto')}>
              Analisar de novo
            </Button>
          </div>
        )}
      </div>
      {running && <p className="text-fg-muted">Análise na fila. A nota aparece aqui em alguns instantes.</p>}
      {method === 'heuristic' && done && <Alert tone="info">Estimativa sem IA: compara palavras dos requisitos com o currículo e as respostas. Confira o currículo antes de decidir.</Alert>}
      {done && (
        <>
          {done.summary && <p>{done.summary}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-success-700">Pontos fortes</h3>
              {done.strengths.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {done.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-fg-muted">—</p>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-danger-700">Lacunas</h3>
              {done.gaps.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {done.gaps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-fg-muted">—</p>
              )}
            </div>
          </div>
          <p className="text-xs text-fg-muted">
            {done.method === 'ai' ? `IA (${done.model ?? 'modelo'})` : 'Estimativa sem IA'}
            {done.finishedAt && ` · ${formatDateTime(done.finishedAt)}`}
            {done.inputTokens != null && ` · ${done.inputTokens.toLocaleString('pt-BR')} tokens de entrada, ${done.outputTokens?.toLocaleString('pt-BR') ?? '?'} de saída`}
            {done.costUsd != null && ` · custo aproximado US$ ${done.costUsd.toFixed(4)}`}
          </p>
          {done.error && <p className="text-xs text-danger-700">{done.error}</p>}
          <p className="text-xs text-fg-muted">A nota apoia a triagem; a decisão é da equipe. O candidato pode pedir revisão humana (LGPD art. 20).</p>
        </>
      )}
      {!done && !running && <p className="text-fg-muted">Sem análise concluída.</p>}
    </Card>
  );
}
