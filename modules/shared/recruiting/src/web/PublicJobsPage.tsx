import { ApiError } from '@all/module-sdk/web';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Spinner, Textarea, applyBrand, brandPalette, isHexColor } from '@all/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { contractTypeLabel, workModelLabel, type ContractType, type JobQuestion, type WorkModel } from '../contracts';

interface Company {
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
}

interface PublicJobItem {
  id: string;
  title: string;
  area: string | null;
  hiringCompany: string | null;
  workModel: WorkModel;
  city: string | null;
  state: string | null;
  contractType: ContractType;
  salary: string | null;
  openedAt: string | null;
}

interface PublicJob extends PublicJobItem {
  description: string;
  requirements: string[];
  niceToHave: string[];
  benefits: string[];
  positions: number;
  questions: JobQuestion[];
}

/** Página pública: sem login, fala direto com /api/public/jobs/<slug>. */
async function publicApi<T>(path: string, init?: { method?: string; body?: FormData }): Promise<T> {
  const res = await fetch(`/api/public/jobs${path}`, { method: init?.method ?? 'GET', body: init?.body });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, data?.code, Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? 'Erro'), data);
  return data as T;
}

const place = (j: Pick<PublicJobItem, 'workModel' | 'city' | 'state'>) =>
  j.workModel === 'remote' ? 'Remoto' : [workModelLabel[j.workModel], [j.city, j.state].filter(Boolean).join('/')].filter(Boolean).join(' · ');

/** Lista de vagas abertas (/vagas/:slug) ou detalhe com candidatura (/vagas/:slug/:jobId). */
export function PublicJobsPage() {
  const { slug = '', jobId } = useParams<{ slug: string; jobId?: string }>();
  return jobId ? <JobDetail slug={slug} jobId={jobId} /> : <JobList slug={slug} />;
}

function JobList({ slug }: { slug: string }) {
  const list = useQuery({ queryKey: ['public-jobs', slug], queryFn: () => publicApi<{ company: Company; jobs: PublicJobItem[] }>(`/${slug}`), retry: false });
  useCompanyColor(list.data?.company.brandColor ?? null);
  if (list.isPending) return <Shell><Spinner /></Shell>;
  if (list.isError) return <Shell><Alert>{list.error instanceof ApiError && list.error.status === 404 ? 'Esta empresa não está publicando vagas aqui.' : 'Não foi possível carregar. Tente de novo.'}</Alert></Shell>;
  const { company, jobs } = list.data;
  return (
    <Shell company={company}>
      <h2 className="text-lg font-medium">{jobs.length ? `${jobs.length} ${jobs.length === 1 ? 'vaga aberta' : 'vagas abertas'}` : 'Nenhuma vaga aberta no momento'}</h2>
      <div className="space-y-3">
        {jobs.map((j) => (
          <Link key={j.id} to={`/vagas/${slug}/${j.id}`} className="block rounded-2xl border border-line bg-surface p-4 transition hover:border-brand-600">
            <span className="block font-medium">{j.title}</span>
            <span className="block text-sm text-fg-muted">
              {[j.hiringCompany, j.area, place(j), contractTypeLabel[j.contractType]].filter(Boolean).join(' · ')}
            </span>
            {j.salary && <span className="mt-1 block text-sm">{j.salary}</span>}
          </Link>
        ))}
      </div>
    </Shell>
  );
}

function JobDetail({ slug, jobId }: { slug: string; jobId: string }) {
  const detail = useQuery({
    queryKey: ['public-jobs', slug, jobId],
    queryFn: () => publicApi<{ company: Company; job: PublicJob; consent: { version: string; text: string }; maxResumeBytes: number }>(`/${slug}/${jobId}`),
    retry: false,
  });
  useCompanyColor(detail.data?.company.brandColor ?? null);
  const startedAt = useRef(Date.now());
  const [form, setForm] = useState({ name: '', email: '', phone: '', linkedinUrl: '', city: '', state: '', salaryExpectation: '', website: '' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const apply = useMutation({
    mutationFn: () => {
      const body = new FormData();
      for (const [k, v] of Object.entries(form)) if (v) body.append(k, v);
      body.append('answers', JSON.stringify(Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }))));
      body.append('consent', consent ? 'true' : 'false');
      body.append('consentVersion', detail.data!.consent.version);
      body.append('startedAt', String(startedAt.current));
      if (resume) body.append('resume', resume);
      return publicApi<{ ok: boolean }>(`/${slug}/${jobId}/apply`, { method: 'POST', body });
    },
  });

  if (detail.isPending) return <Shell><Spinner /></Shell>;
  if (detail.isError) {
    return (
      <Shell>
        <Alert>{detail.error instanceof ApiError && detail.error.status === 404 ? 'Esta vaga não está mais recebendo candidaturas.' : 'Não foi possível carregar. Tente de novo.'}</Alert>
        <Link to={`/vagas/${slug}`} className="text-sm text-brand-700 underline">
          Ver outras vagas
        </Link>
      </Shell>
    );
  }
  const { company, job, maxResumeBytes } = detail.data;

  if (apply.data) {
    return (
      <Shell company={company}>
        <Card className="space-y-3 p-6 text-center">
          <p className="font-display text-2xl font-medium">Candidatura enviada!</p>
          <p className="text-fg-muted">Recebemos seus dados para a vaga {job.title}. Se o seu perfil seguir no processo, entraremos em contato pelo e-mail ou telefone informados.</p>
          <Link to={`/vagas/${slug}`} className="text-sm text-brand-700 underline">
            Ver outras vagas
          </Link>
        </Card>
      </Shell>
    );
  }

  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  function pickFile(file: File | null) {
    setFileError(null);
    if (file && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return setFileError('Envie o currículo em PDF'), setResume(null);
    if (file && file.size > maxResumeBytes) return setFileError(`O currículo pode ter no máximo ${Math.round(maxResumeBytes / 1024 / 1024)} MB`), setResume(null);
    setResume(file);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!resume) return setFileError('Anexe o currículo em PDF');
    apply.mutate();
  }

  return (
    <Shell company={company}>
      <Link to={`/vagas/${slug}`} className="text-sm text-fg-muted hover:text-fg">
        ← Todas as vagas
      </Link>
      <section className="space-y-3">
        <h2 className="font-display text-2xl font-medium">{job.title}</h2>
        <p className="text-sm text-fg-muted">
          {[job.hiringCompany, job.area, place(job), contractTypeLabel[job.contractType], job.positions > 1 ? `${job.positions} vagas` : null].filter(Boolean).join(' · ')}
        </p>
        {job.salary && <p className="text-sm font-medium">{job.salary}</p>}
        {job.description && <p className="whitespace-pre-wrap text-sm">{job.description}</p>}
        <Bullets title="Requisitos" items={job.requirements} />
        <Bullets title="Desejável" items={job.niceToHave} />
        <Bullets title="Benefícios" items={job.benefits} />
      </section>

      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-lg font-medium">Candidate-se</h2>
        {apply.error && <Alert>{apply.error.message}</Alert>}
        <Card className="space-y-4 p-5">
          <Field label="Nome completo">{(id) => <Input id={id} required autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="E-mail">{(id) => <Input id={id} type="email" required autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />}</Field>
            <Field label="Celular (com DDD)">{(id) => <Input id={id} type="tel" required autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
          </div>
          <Field label="LinkedIn (opcional)">{(id) => <Input id={id} value={form.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} placeholder="linkedin.com/in/…" />}</Field>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <Field label="Cidade">{(id) => <Input id={id} required autoComplete="address-level2" value={form.city} onChange={(e) => set('city', e.target.value)} />}</Field>
            <Field label="UF">{(id) => <Input id={id} maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} />}</Field>
            <Field label="Pretensão (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.salaryExpectation} onChange={(e) => set('salaryExpectation', e.target.value)} />}</Field>
          </div>
          {job.questions.map((q) => (
            <Field key={q.id} label={`${q.label}${q.required ? '' : ' (opcional)'}`}>
              {(id) =>
                q.kind === 'yes_no' ? (
                  <Select id={id} required={q.required} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}>
                    <option value="">Escolha</option>
                    <option value="Sim">Sim</option>
                    <option value="Não">Não</option>
                  </Select>
                ) : (
                  <Textarea id={id} rows={3} required={q.required} maxLength={2000} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                )
              }
            </Field>
          ))}
          <Field label="Currículo (PDF)" error={fileError ?? undefined} hint={`Até ${Math.round(maxResumeBytes / 1024 / 1024)} MB.`}>
            {(id) => <input id={id} type="file" accept="application/pdf,.pdf" required onChange={(e) => pickFile(e.target.files?.[0] ?? null)} className="text-sm" />}
          </Field>
          {/* Armadilha para robôs: escondido de pessoas e de leitores de tela. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Site
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
            </label>
          </div>
          <div className="rounded-xl border border-line bg-muted/40 p-3 text-xs leading-relaxed text-fg-muted">{detail.data.consent.text}</div>
          <Checkbox required label="Li e concordo com o uso dos meus dados descrito acima." checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <Button type="submit" loading={apply.isPending} disabled={!consent} className="w-full">
            Enviar candidatura
          </Button>
        </Card>
      </form>
    </Shell>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

/** Cor da empresa nesta página (mesma regra do agendamento online). */
function useCompanyColor(color: string | null) {
  useEffect(() => {
    if (!color || !isHexColor(color)) return;
    applyBrand(brandPalette(color), { id: 'brand-public', root: ':root:root:root' });
    return () => applyBrand(null, { id: 'brand-public' });
  }, [color]);
}

function Shell({ company, children }: { company?: Company; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b-4 border-brand-600 bg-ink px-4 py-6 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          {company?.logoUrl && (
            <span className="flex h-16 max-w-[10rem] shrink-0 items-center justify-center rounded-xl bg-white p-2">
              <img src={company.logoUrl} alt={`Logo de ${company.name}`} className="max-h-full max-w-full object-contain" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm text-ink-fg-muted">Trabalhe conosco</p>
            <h1 className="font-display text-2xl font-medium">{company?.name ?? ' '}</h1>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">{children}</main>
      <footer className="pb-8 text-center text-xs text-fg-muted">
        Vagas por <span className="font-display font-semibold">palmer</span>
        <span className="font-display font-light text-brand-600">tech</span>
      </footer>
    </div>
  );
}
