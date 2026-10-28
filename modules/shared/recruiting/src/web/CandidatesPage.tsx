import { api, ApiError, apiUpload, formatDate, formatDateTime, formatPhone, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Info, ResumeButton, ScoreBadge, Timeline } from './common';
import { recruitingKey, type CandidateDetail, type CandidateListItem, type JobDetail, type JobSummary } from './types';

const PAGE = 50;

export function CandidatesPage() {
  const navigate = useNavigate();
  const canManage = useCan('recruiting.candidates.manage');
  const [params] = useSearchParams();
  const jobId = params.get('vaga');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const job = useQuery({ queryKey: [...recruitingKey, 'job', jobId], queryFn: () => api<JobDetail>(`/recruiting/jobs/${jobId}`), enabled: !!jobId });
  const list = useQuery({
    queryKey: [...recruitingKey, 'candidates', q, page],
    queryFn: () => api<{ items: CandidateListItem[]; total: number }>('/recruiting/candidates', { query: { q: q || undefined, limit: PAGE, offset: page * PAGE } }),
  });

  return (
    <>
      <PageHeader
        title={jobId && job.data ? `Incluir na vaga: ${job.data.title}` : 'Banco de talentos'}
        description={jobId ? 'Escolha um candidato do banco de talentos ou cadastre um novo.' : 'Todos os candidatos da empresa, um por e-mail, com as candidaturas de cada um.'}
        actions={
          canManage && (
            <Button onClick={() => navigate(`/recrutamento/candidatos/novo${jobId ? `?vaga=${jobId}` : ''}`)}>Cadastrar candidato</Button>
          )
        }
      />
      <Input aria-label="Buscar" className="mb-4 max-w-80" placeholder="Buscar por nome, e-mail ou cidade" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Nenhum candidato" description="As candidaturas pela página pública entram aqui automaticamente." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Cidade</Th>
                <Th className="text-right">Candidaturas</Th>
                <Th>Melhor nota</Th>
                <Th>Última</Th>
                {jobId && <Th />}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/recrutamento/candidatos/${c.id}${jobId ? `?vaga=${jobId}` : ''}`)}>
                  <Td>
                    <div className="font-medium">{c.anonymizedAt ? <span className="text-fg-muted">Candidato anonimizado</span> : c.name}</div>
                    {c.email && <div className="text-xs text-fg-muted">{c.email}</div>}
                  </Td>
                  <Td>{[c.city, c.state].filter(Boolean).join('/') || '—'}</Td>
                  <Td className="text-right tabular-nums">
                    {c.applications}
                    {c.activeApplications > 0 && <span className="text-xs text-fg-muted"> ({c.activeApplications} em andamento)</span>}
                  </Td>
                  <Td>{c.bestScore != null ? <ScoreBadge score={c.bestScore} method={null} /> : '—'}</Td>
                  <Td className="tabular-nums">{c.lastApplicationAt ? formatDate(c.lastApplicationAt) : '—'}</Td>
                  {jobId && (
                    <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                      {!c.anonymizedAt && <AddToJob candidateId={c.id} jobId={jobId} compact />}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {list.data && list.data.total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          <span className="text-fg-muted">
            {page * PAGE + 1}–{Math.min((page + 1) * PAGE, list.data.total)} de {list.data.total}
          </span>
          <Button size="sm" variant="secondary" disabled={(page + 1) * PAGE >= list.data.total} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </>
  );
}

/** Inclui o candidato numa vaga (candidatura lançada pela equipe). */
function AddToJob({ candidateId, jobId, compact = false }: { candidateId: string; jobId: string; compact?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: () => api<{ id: string }>('/recruiting/applications', { method: 'POST', body: { candidateId, jobId } }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: recruitingKey });
      navigate(`/recrutamento/candidaturas/${r.id}`);
    },
  });
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" loading={add.isPending} onClick={() => add.mutate()}>
        {compact ? 'Incluir' : 'Incluir na vaga'}
      </Button>
      {add.error && <span className="mt-1 text-xs text-danger-600">{add.error instanceof ApiError ? add.error.message : 'Erro'}</span>}
    </span>
  );
}

// ---- Cadastro do candidato (página própria) ---------------------------------------------------

interface Draft {
  name: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  city: string;
  state: string;
  notes: string;
}

export function CandidateFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const jobId = params.get('vaga');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: [...recruitingKey, 'candidate', id], queryFn: () => api<CandidateDetail>(`/recruiting/candidates/${id}`), enabled: !!id });
  const [d, setD] = useState<Draft | null>(id ? null : { name: '', email: '', phone: '', linkedinUrl: '', city: '', state: '', notes: '' });
  const [resume, setResume] = useState<File | null>(null);
  useEffect(() => {
    const c = current.data;
    if (c && !d) setD({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', linkedinUrl: c.linkedinUrl ?? '', city: c.city ?? '', state: c.state ?? '', notes: c.notes ?? '' });
  }, [current.data, d]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: d!.name, email: d!.email, phone: d!.phone || null, linkedinUrl: d!.linkedinUrl || null, city: d!.city || null, state: d!.state || null, notes: d!.notes || null };
      const saved = id ? await api<{ id: string }>(`/recruiting/candidates/${id}`, { method: 'PATCH', body }) : await api<{ id: string }>('/recruiting/candidates', { method: 'POST', body });
      if (resume) await apiUpload(`/recruiting/candidates/${saved.id}/resume`, 'file', resume);
      return saved;
    },
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: recruitingKey });
      navigate(`/recrutamento/candidatos/${r.id}${jobId ? `?vaga=${jobId}` : ''}`);
    },
  });

  if (!d) return current.isError ? <Alert>{current.error.message}</Alert> : <Spinner />;
  const set = (k: keyof Draft, v: string) => setD({ ...d, [k]: v });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <>
      <PageHeader title={id ? 'Editar candidato' : 'Cadastrar candidato'} description="Indicações e currículos recebidos por fora da página pública." />
      <form onSubmit={submit} className="max-w-2xl space-y-4">
        {save.error && (
          <Alert>
            {save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}
            {save.error instanceof ApiError && save.error.code === 'DUPLICATE_EMAIL' && (save.error.body as { existing?: { id: string } })?.existing && (
              <>
                {' '}
                <Link className="underline" to={`/recrutamento/candidatos/${(save.error.body as { existing: { id: string } }).existing.id}${jobId ? `?vaga=${jobId}` : ''}`}>
                  Abrir o cadastro existente
                </Link>
              </>
            )}
          </Alert>
        )}
        <Card className="space-y-4 p-5">
          <Field label="Nome completo">{(fid) => <Input id={fid} required value={d.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="E-mail">{(fid) => <Input id={fid} type="email" required value={d.email} onChange={(e) => set('email', e.target.value)} />}</Field>
            <Field label="Telefone">{(fid) => <Input id={fid} value={d.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(11) 99999-0000" />}</Field>
          </div>
          <Field label="LinkedIn">{(fid) => <Input id={fid} value={d.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} placeholder="linkedin.com/in/…" />}</Field>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Cidade">{(fid) => <Input id={fid} value={d.city} onChange={(e) => set('city', e.target.value)} />}</Field>
            <Field label="UF">{(fid) => <Input id={fid} maxLength={2} value={d.state} onChange={(e) => set('state', e.target.value.toUpperCase())} />}</Field>
          </div>
          <Field label="Observações">{(fid) => <Textarea id={fid} rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
          <Field label={id ? 'Substituir currículo (PDF ou Word)' : 'Currículo (PDF ou Word)'} hint="A nota de aderência lê PDFs.">
            {(fid) => <input id={fid} type="file" accept=".pdf,.doc,.docx,application/pdf" onChange={(e) => setResume(e.target.files?.[0] ?? null)} className="text-sm" />}
          </Field>
          <p className="text-xs text-fg-muted">Cadastre só com a autorização do candidato. Os dados ficam no banco de talentos pelo prazo definido nas configurações do Head hunter.</p>
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </>
  );
}

// ---- Ficha do candidato -----------------------------------------------------------------------

export function CandidatePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const jobId = params.get('vaga');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = useCan('recruiting.candidates.manage');
  const canPrivacy = useCan('recruiting.candidates.privacy');
  const [confirming, setConfirming] = useState(false);
  const [targetJob, setTargetJob] = useState(jobId ?? '');
  const c = useQuery({ queryKey: [...recruitingKey, 'candidate', id], queryFn: () => api<CandidateDetail>(`/recruiting/candidates/${id}`) });
  const openJobs = useQuery({ queryKey: [...recruitingKey, 'jobs', 'active', ''], queryFn: () => api<JobSummary[]>('/recruiting/jobs', { query: { status: 'active' } }), enabled: canManage });
  const anonymize = useMutation({
    mutationFn: () => api(`/recruiting/candidates/${id}/anonymize`, { method: 'POST' }),
    onSuccess: () => {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: recruitingKey });
    },
  });
  const exportData = useMutation({
    mutationFn: async () => {
      const data = await api<unknown>(`/recruiting/candidates/${id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: `candidato-${id}.json` }).click();
      URL.revokeObjectURL(url);
    },
  });

  if (c.isPending) return <Spinner />;
  if (c.isError) return <Alert>{c.error.message}</Alert>;
  const cand = c.data;
  const anonymized = !!cand.anonymizedAt;
  const already = new Set(cand.applications.map((a) => a.jobId));

  return (
    <>
      <Link to={jobId ? `/recrutamento/candidatos?vaga=${jobId}` : '/recrutamento/candidatos'} className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← Banco de talentos
      </Link>
      <PageHeader
        title={cand.name}
        description={`${cand.source === 'public' ? 'Veio pela página pública' : 'Cadastrado pela equipe'} em ${formatDate(cand.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {cand.resume && <ResumeButton path={`/recruiting/candidates/${id}/resume`} />}
            {canManage && !anonymized && (
              <Button variant="secondary" onClick={() => navigate(`/recrutamento/candidatos/${id}/editar`)}>
                Editar
              </Button>
            )}
          </div>
        }
      />
      {anonymized && <Alert tone="info">Os dados pessoais foram excluídos em {formatDateTime(cand.anonymizedAt!)} (LGPD). Ficam só as etapas e notas das candidaturas, sem identificar a pessoa.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Card className="space-y-2 p-5 text-sm">
            {cand.email && <Info label="E-mail">{cand.email}</Info>}
            {cand.phone && <Info label="Telefone">{formatPhone(cand.phone)}</Info>}
            {cand.linkedinUrl && (
              <Info label="LinkedIn">
                <a className="text-brand-700 underline" href={cand.linkedinUrl} target="_blank" rel="noreferrer">
                  {cand.linkedinUrl.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              </Info>
            )}
            {(cand.city || cand.state) && <Info label="Cidade">{[cand.city, cand.state].filter(Boolean).join('/')}</Info>}
            {cand.notes && <Info label="Observações">{cand.notes}</Info>}
            {cand.retainUntil && <Info label="Dados guardados até">{formatDate(cand.retainUntil)}</Info>}
            {cand.resume && <Info label="Currículo">{cand.resume.filename}</Info>}
          </Card>

          {canPrivacy && (
            <Card className="space-y-2 p-5 text-sm">
              <h2 className="font-medium">Privacidade (LGPD)</h2>
              {exportData.error && <Alert>{exportData.error instanceof ApiError ? exportData.error.message : 'Erro'}</Alert>}
              {anonymize.error && <Alert>{anonymize.error instanceof ApiError ? anonymize.error.message : 'Erro'}</Alert>}
              <Button size="sm" variant="secondary" loading={exportData.isPending} onClick={() => exportData.mutate()}>
                Exportar dados (JSON)
              </Button>
              {!anonymized &&
                (confirming ? (
                  <div className="space-y-2 rounded-lg border border-danger-600/40 p-3">
                    <p>Apaga nome, contato, currículos, respostas, anotações e os textos das análises. Não dá para desfazer.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                        Cancelar
                      </Button>
                      <Button size="sm" variant="danger" loading={anonymize.isPending} onClick={() => anonymize.mutate()}>
                        Excluir os dados
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                    Excluir dados a pedido do candidato
                  </Button>
                ))}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="border-b border-line px-4 py-3 font-medium">Candidaturas</h2>
            {cand.applications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-fg-muted">Nenhuma candidatura.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Vaga</Th>
                    <Th>Etapa</Th>
                    <Th>Nota</Th>
                    <Th>Data</Th>
                  </tr>
                </thead>
                <tbody>
                  {cand.applications.map((a) => (
                    <tr key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/recrutamento/candidaturas/${a.id}`)}>
                      <Td>
                        <div className="font-medium">{a.jobTitle}</div>
                        <div className="text-xs text-fg-muted">{a.company ?? 'Própria empresa'}</div>
                      </Td>
                      <Td>{a.status === 'active' ? a.stageName : <Badge tone={a.status === 'hired' ? 'success' : a.status === 'rejected' ? 'danger' : 'neutral'}>{a.statusLabel}</Badge>}</Td>
                      <Td>
                        <ScoreBadge score={a.score} method={a.scoreMethod} />
                      </Td>
                      <Td className="tabular-nums">{formatDate(a.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {canManage && !anonymized && (
              <div className="flex flex-wrap items-end gap-2 border-t border-line p-4">
                <Field label="Incluir em outra vaga">
                  {(fid) => (
                    <Select id={fid} className="min-w-64" value={targetJob} onChange={(e) => setTargetJob(e.target.value)}>
                      <option value="">Escolha a vaga</option>
                      {openJobs.data
                        ?.filter((j) => j.status !== 'closed' && !already.has(j.id))
                        .map((j) => (
                          <option key={j.id} value={j.id}>
                            {j.title}
                            {j.company ? ` — ${j.company}` : ''}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
                {targetJob && !already.has(targetJob) && <AddToJob candidateId={id} jobId={targetJob} />}
              </div>
            )}
          </Card>
          <Card>
            <h2 className="border-b border-line px-4 py-3 font-medium">Histórico</h2>
            <Timeline events={cand.events} />
          </Card>
        </div>
      </div>
    </>
  );
}

