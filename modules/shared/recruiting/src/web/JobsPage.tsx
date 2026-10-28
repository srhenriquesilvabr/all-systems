import { api, ApiError, formatDate, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, Textarea, Checkbox, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  contractTypeLabel,
  contractTypes,
  DEFAULT_STAGES,
  jobStatusLabel,
  slugId,
  workModelLabel,
  workModels,
  type ContractType,
  type JobQuestion,
  type JobStage,
  type JobStatus,
  type WorkModel,
} from '../contracts';
import { TextList } from './common';
import { recruitingKey, type CompanyOption, type JobDetail, type JobSummary, type RecruitingStatus } from './types';

export const statusTone: Record<JobStatus, 'success' | 'warning' | 'neutral' | 'danger'> = { open: 'success', paused: 'warning', draft: 'neutral', closed: 'danger' };

export function useRecruitingStatus() {
  return useQuery({ queryKey: [...recruitingKey, 'status'], queryFn: () => api<RecruitingStatus>('/recruiting/status'), staleTime: 60_000 });
}

export function JobsPage() {
  const canManage = useCan('recruiting.jobs.manage');
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('active');
  const [q, setQ] = useState('');
  const status$ = useRecruitingStatus();
  const jobs = useQuery({
    queryKey: [...recruitingKey, 'jobs', status, q],
    queryFn: () => api<JobSummary[]>('/recruiting/jobs', { query: { status: status || undefined, q: q || undefined } }),
  });

  return (
    <>
      <PageHeader
        title="Vagas"
        description="Vagas da empresa e das empresas-clientes, com o funil de cada uma."
        actions={canManage && <Button onClick={() => navigate('/recrutamento/vagas/nova')}>Nova vaga</Button>}
      />
      {status$.data?.publicUrl && (
        <p className="mb-4 text-sm text-fg-muted">
          Página pública de vagas:{' '}
          <a className="text-brand-700 underline" href={status$.data.publicUrl} target="_blank" rel="noreferrer">
            {status$.data.publicUrl}
          </a>
        </p>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <Select aria-label="Situação" className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Em andamento</option>
          <option value="open">Abertas</option>
          <option value="paused">Pausadas</option>
          <option value="draft">Rascunhos</option>
          <option value="closed">Encerradas</option>
          <option value="">Todas</option>
        </Select>
        <Input aria-label="Buscar" className="max-w-64" placeholder="Buscar por título ou área" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        {jobs.isPending ? (
          <Spinner />
        ) : jobs.isError ? (
          <div className="p-4">
            <Alert>{jobs.error.message}</Alert>
          </div>
        ) : jobs.data.length === 0 ? (
          <EmptyState title="Nenhuma vaga" description={canManage ? 'Crie uma vaga para começar a receber candidaturas.' : undefined} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vaga</Th>
                <Th>Contratante</Th>
                <Th>Situação</Th>
                <Th className="text-right">Candidatos</Th>
                <Th>Aberta em</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.map((j) => (
                <tr key={j.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/recrutamento/vagas/${j.id}`)}>
                  <Td>
                    <div className="font-medium">{j.title}</div>
                    <div className="text-xs text-fg-muted">
                      {[j.area, workModelLabel[j.workModel], [j.city, j.state].filter(Boolean).join('/'), contractTypeLabel[j.contractType]].filter(Boolean).join(' · ')}
                    </div>
                  </Td>
                  <Td>
                    {j.company ?? <span className="text-fg-muted">Própria empresa</span>}
                    {j.confidential && <span className="ml-1 text-xs text-fg-muted">(confidencial)</span>}
                  </Td>
                  <Td>
                    <Badge tone={statusTone[j.status]}>{jobStatusLabel[j.status]}</Badge>
                    {j.gupySyncStatus === 'error' && (
                      <span className="ml-1">
                        <Badge tone="danger">Gupy: erro</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {j.applications.active}
                    <span className="text-fg-muted"> / {j.applications.total}</span>
                    {j.applications.hired > 0 && <div className="text-xs text-success-700">{j.applications.hired} contratado(s)</div>}
                  </Td>
                  <Td className="tabular-nums">{j.openedAt ? formatDate(j.openedAt) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

// ---- Formulário da vaga (página própria, sem pop-up) ------------------------------------------

interface Draft {
  customerId: string;
  confidential: boolean;
  title: string;
  area: string;
  description: string;
  requirements: string[];
  niceToHave: string[];
  salaryMin: string;
  salaryMax: string;
  showSalary: boolean;
  benefits: string[];
  workModel: WorkModel;
  city: string;
  state: string;
  contractType: ContractType;
  positions: string;
  stages: JobStage[];
  questions: JobQuestion[];
  publishGupy: boolean;
}

const emptyDraft = (): Draft => ({
  customerId: '',
  confidential: false,
  title: '',
  area: '',
  description: '',
  requirements: [],
  niceToHave: [],
  salaryMin: '',
  salaryMax: '',
  showSalary: false,
  benefits: [],
  workModel: 'onsite',
  city: '',
  state: '',
  contractType: 'clt',
  positions: '1',
  stages: DEFAULT_STAGES.map((s) => ({ ...s })),
  questions: [],
  publishGupy: false,
});

const fromJob = (j: JobDetail): Draft => ({
  customerId: j.customerId ?? '',
  confidential: j.confidential,
  title: j.title,
  area: j.area ?? '',
  description: j.description,
  requirements: j.requirements,
  niceToHave: j.niceToHave,
  salaryMin: j.salaryMin == null ? '' : String(j.salaryMin),
  salaryMax: j.salaryMax == null ? '' : String(j.salaryMax),
  showSalary: j.showSalary,
  benefits: j.benefits,
  workModel: j.workModel,
  city: j.city ?? '',
  state: j.state ?? '',
  contractType: j.contractType,
  positions: String(j.positions),
  stages: j.stages,
  questions: j.questions,
  publishGupy: j.publishGupy,
});

const money = (v: string) => (v.trim() ? Number(v.replace(/\./g, '').replace(',', '.')) : null);

export function JobFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useRecruitingStatus();
  const companies = useQuery({ queryKey: [...recruitingKey, 'companies'], queryFn: () => api<CompanyOption[]>('/recruiting/companies') });
  const job = useQuery({ queryKey: [...recruitingKey, 'job', id], queryFn: () => api<JobDetail>(`/recruiting/jobs/${id}`), enabled: !!id });
  const [d, setD] = useState<Draft | null>(id ? null : emptyDraft());
  useEffect(() => {
    if (job.data && !d) setD(fromJob(job.data));
  }, [job.data, d]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        customerId: d!.customerId || null,
        confidential: d!.confidential,
        title: d!.title,
        area: d!.area || null,
        description: d!.description,
        requirements: d!.requirements,
        niceToHave: d!.niceToHave,
        salaryMin: money(d!.salaryMin),
        salaryMax: money(d!.salaryMax),
        showSalary: d!.showSalary,
        benefits: d!.benefits,
        workModel: d!.workModel,
        city: d!.city || null,
        state: d!.state || null,
        contractType: d!.contractType,
        positions: Number(d!.positions) || 1,
        stages: d!.stages,
        questions: d!.questions,
        publishGupy: d!.publishGupy,
      };
      return id ? api<{ id: string }>(`/recruiting/jobs/${id}`, { method: 'PATCH', body }) : api<{ id: string }>('/recruiting/jobs', { method: 'POST', body });
    },
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: recruitingKey });
      navigate(`/recrutamento/vagas/${r.id}`);
    },
  });

  if (!d || (id && job.isPending)) return <Spinner />;
  if (job.isError) return <Alert>{job.error.message}</Alert>;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <>
      <Link to={id ? `/recrutamento/vagas/${id}` : '/recrutamento/vagas'} className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← Voltar
      </Link>
      <PageHeader title={id ? 'Editar vaga' : 'Nova vaga'} description="A vaga nasce como rascunho; abra quando quiser receber candidaturas." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Empresa contratante</h2>
          <Field label="Contratante" hint="Clientes do tipo empresa. Deixe em branco para uma vaga da própria empresa.">
            {(fid) => (
              <Select id={fid} value={d.customerId} onChange={(e) => set('customerId', e.target.value)}>
                <option value="">Própria empresa</option>
                {companies.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {d.customerId && <Checkbox label="Vaga confidencial: não mostrar o nome da contratante na página pública nem nos anúncios" checked={d.confidential} onChange={(e) => set('confidential', e.target.checked)} />}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">A vaga</h2>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Título">{(fid) => <Input id={fid} required value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Analista financeiro pleno" />}</Field>
            <Field label="Área">{(fid) => <Input id={fid} value={d.area} onChange={(e) => set('area', e.target.value)} placeholder="Ex.: Financeiro" />}</Field>
          </div>
          <Field label="Descrição" hint="Atividades, time, rotina. Aparece na página pública.">
            {(fid) => <Textarea id={fid} rows={6} value={d.description} onChange={(e) => set('description', e.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Modelo">
              {(fid) => (
                <Select id={fid} value={d.workModel} onChange={(e) => set('workModel', e.target.value as WorkModel)}>
                  {workModels.map((m) => (
                    <option key={m} value={m}>
                      {workModelLabel[m]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Contrato">
              {(fid) => (
                <Select id={fid} value={d.contractType} onChange={(e) => set('contractType', e.target.value as ContractType)}>
                  {contractTypes.map((c) => (
                    <option key={c} value={c}>
                      {contractTypeLabel[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Posições">{(fid) => <Input id={fid} type="number" min={1} value={d.positions} onChange={(e) => set('positions', e.target.value)} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Cidade">{(fid) => <Input id={fid} value={d.city} onChange={(e) => set('city', e.target.value)} />}</Field>
            <Field label="UF">{(fid) => <Input id={fid} maxLength={2} value={d.state} onChange={(e) => set('state', e.target.value.toUpperCase())} />}</Field>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Requisitos</h2>
          <p className="text-sm text-fg-muted">Um por item. A nota de aderência compara o currículo com estes requisitos (os obrigatórios pesam mais).</p>
          <Field label="Obrigatórios">{() => <TextList items={d.requirements} onChange={(v) => set('requirements', v)} placeholder="Ex.: Excel avançado" />}</Field>
          <Field label="Desejáveis">{() => <TextList items={d.niceToHave} onChange={(v) => set('niceToHave', v)} placeholder="Ex.: Inglês intermediário" />}</Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Remuneração e benefícios</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Salário de (R$)">{(fid) => <Input id={fid} inputMode="decimal" value={d.salaryMin} onChange={(e) => set('salaryMin', e.target.value)} />}</Field>
            <Field label="até (R$)">{(fid) => <Input id={fid} inputMode="decimal" value={d.salaryMax} onChange={(e) => set('salaryMax', e.target.value)} />}</Field>
          </div>
          <Checkbox label="Mostrar a faixa salarial na página pública e nos anúncios" checked={d.showSalary} onChange={(e) => set('showSalary', e.target.checked)} />
          <Field label="Benefícios">{() => <TextList items={d.benefits} onChange={(v) => set('benefits', v)} placeholder="Ex.: Vale-refeição" />}</Field>
        </Card>

        <StagesEditor stages={d.stages} onChange={(v) => set('stages', v)} />
        <QuestionsEditor questions={d.questions} onChange={(v) => set('questions', v)} />

        <Card className="space-y-3 p-5">
          <h2 className="font-medium">Publicação</h2>
          <p className="text-sm text-fg-muted">A vaga aberta aparece na página pública e no feed do Indeed automaticamente.</p>
          <Checkbox
            label={status.data?.gupyMode === 'off' ? 'Publicar na Gupy (ligue a integração nas configurações do Head hunter)' : 'Publicar também na Gupy (e, por ela, no LinkedIn e em outros portais)'}
            checked={d.publishGupy}
            disabled={status.data?.gupyMode === 'off' && !d.publishGupy}
            onChange={(e) => set('publishGupy', e.target.checked)}
          />
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate(id ? `/recrutamento/vagas/${id}` : '/recrutamento/vagas')}>
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

function StagesEditor({ stages, onChange }: { stages: JobStage[]; onChange: (s: JobStage[]) => void }) {
  const [name, setName] = useState('');
  const open = stages.filter((s) => s.kind === 'open');
  const hired = stages.find((s) => s.kind === 'hired')!;
  const update = (list: JobStage[]) => onChange([...list, hired]);
  function add() {
    const v = name.trim();
    if (!v) return;
    update([...open, { id: slugId(v, stages.map((s) => s.id)), name: v, kind: 'open' }]);
    setName('');
  }
  function moveUp(i: number) {
    if (i === 0) return;
    const list = [...open];
    [list[i - 1], list[i]] = [list[i]!, list[i - 1]!];
    update(list);
  }
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-medium">Etapas do processo</h2>
      <p className="text-sm text-fg-muted">A candidatura entra na primeira etapa. "{hired.name}" fecha o processo; a reprovação (com motivo) pode acontecer em qualquer etapa.</p>
      <ol className="space-y-1">
        {open.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
            <span className="w-5 text-fg-muted tabular-nums">{i + 1}.</span>
            <input
              aria-label={`Nome da etapa ${i + 1}`}
              className="flex-1 bg-transparent focus:outline-none"
              value={s.name}
              onChange={(e) => update(open.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
            />
            <button type="button" className="text-fg-muted hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => moveUp(i)} aria-label="Subir">
              ↑
            </button>
            <button type="button" className="text-fg-muted hover:text-danger-600 disabled:opacity-30" disabled={open.length <= 1} onClick={() => update(open.filter((x) => x.id !== s.id))} aria-label={`Remover ${s.name}`}>
              ×
            </button>
          </li>
        ))}
        <li className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-1.5 text-sm">
          <span className="w-5 text-fg-muted tabular-nums">{open.length + 1}.</span>
          <input aria-label="Nome da etapa de contratação" className="flex-1 bg-transparent focus:outline-none" value={hired.name} onChange={(e) => onChange([...open, { ...hired, name: e.target.value }])} />
          <Badge tone="success">contratação</Badge>
        </li>
      </ol>
      <div className="flex gap-2">
        <Input aria-label="Nova etapa" placeholder="Ex.: Teste técnico" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <Button type="button" variant="secondary" onClick={add} disabled={!name.trim()}>
          Adicionar etapa
        </Button>
      </div>
    </Card>
  );
}

function QuestionsEditor({ questions, onChange }: { questions: JobQuestion[]; onChange: (q: JobQuestion[]) => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<JobQuestion['kind']>('text');
  function add() {
    const v = label.trim();
    if (v.length < 3) return;
    onChange([...questions, { id: slugId(v, questions.map((q) => q.id)), label: v, kind, required: false }]);
    setLabel('');
  }
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-medium">Perguntas da candidatura</h2>
      <p className="text-sm text-fg-muted">Opcional. As respostas entram na nota de aderência. Não pergunte idade, estado civil, religião ou outros dados sensíveis.</p>
      {questions.length > 0 && (
        <ul className="space-y-1">
          {questions.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
              <span className="flex-1">{q.label}</span>
              <span className="text-xs text-fg-muted">{q.kind === 'yes_no' ? 'Sim/não' : 'Texto'}</span>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" className="accent-brand-600" checked={q.required} onChange={(e) => onChange(questions.map((x) => (x.id === q.id ? { ...x, required: e.target.checked } : x)))} />
                obrigatória
              </label>
              <button type="button" className="text-fg-muted hover:text-danger-600" onClick={() => onChange(questions.filter((x) => x.id !== q.id))} aria-label={`Remover ${q.label}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={cn('flex flex-wrap gap-2')}>
        <Input aria-label="Nova pergunta" className="min-w-64 flex-1" placeholder="Ex.: Tem disponibilidade para viagens?" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Select aria-label="Tipo de resposta" className="max-w-36" value={kind} onChange={(e) => setKind(e.target.value as JobQuestion['kind'])}>
          <option value="text">Texto</option>
          <option value="yes_no">Sim/não</option>
        </Select>
        <Button type="button" variant="secondary" onClick={add} disabled={label.trim().length < 3}>
          Adicionar pergunta
        </Button>
      </div>
    </Card>
  );
}
