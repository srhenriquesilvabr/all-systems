import { ApiError } from '@all/module-sdk/web';
import { Alert, Button, Card, Checkbox, Field, Input, Spinner, applyBrand, brandPalette, cn, isHexColor } from '@all/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { estimateInstallment, leadAssetLabel, UTM_KEYS, type LeadAssetType, type PublicSimulator } from '../../contracts';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: n >= 1000 ? 0 : 2 });
const title: Record<LeadAssetType, string> = { real_estate: 'Imóvel', vehicle: 'Carro ou moto', heavy: 'Caminhão e pesados', services: 'Serviços' };

/** Página pública: sem login, fala direto com /api/public/consortium/<slug>. */
async function publicApi<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/public/consortium${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, data?.code, Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? 'Erro'), data);
  return data as T;
}

/** Simulador de consórcio com a marca da empresa (/consorcio/:slug), que gera o lead. */
export function PublicSimulatorPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const ref = params.get('ind');
  const info = useQuery({
    queryKey: ['public-consortium', slug, ref],
    queryFn: () => publicApi<PublicSimulator>(`/${slug}${ref ? `?ind=${encodeURIComponent(ref)}` : ''}`),
    retry: false,
  });
  useCompanyColor(info.data?.company.brandColor ?? null);
  if (info.isPending) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }
  if (info.isError) {
    return (
      <Shell>
        <Alert>{info.error instanceof ApiError && info.error.status === 404 ? 'Simulador indisponível para esta empresa.' : 'Não foi possível carregar. Tente de novo.'}</Alert>
      </Shell>
    );
  }
  return <Simulator slug={slug} data={info.data} refCode={ref} utm={Object.fromEntries(UTM_KEYS.map((k) => [k, params.get(k) ?? '']).filter(([, v]) => v))} />;
}

function Simulator({ slug, data, refCode, utm }: { slug: string; data: PublicSimulator; refCode: string | null; utm: Record<string, string> }) {
  const startedAt = useRef(Date.now());
  const first = data.lines[0];
  const [assetType, setAssetType] = useState<LeadAssetType | null>(first?.assetType ?? null);
  const line = data.lines.find((l) => l.assetType === assetType);
  const [credit, setCredit] = useState(() => (first ? roundStep((first.minCredit + first.maxCredit) / 2) : 0));
  const [term, setTerm] = useState(first?.terms[Math.floor(first.terms.length / 2)] ?? 0);
  const [form, setForm] = useState({ name: '', phone: '', email: '', city: '', state: '', website: '' });
  const [consent, setConsent] = useState(false);
  const estimate = useMemo(() => (assetType ? estimateInstallment(data.profiles, assetType, credit, term) : null), [data.profiles, assetType, credit, term]);
  const send = useMutation({
    mutationFn: () =>
      publicApi<{ ok: boolean }>(`/${slug}/leads`, {
        method: 'POST',
        body: { ...form, assetType, creditValue: credit, termMonths: term, consent, consentVersion: data.consent.version, ref: refCode, utm, startedAt: startedAt.current },
      }),
  });
  function pick(type: LeadAssetType) {
    const l = data.lines.find((x) => x.assetType === type)!;
    setAssetType(type);
    setCredit(roundStep((l.minCredit + l.maxCredit) / 2));
    setTerm(l.terms[Math.floor(l.terms.length / 2)]!);
  }
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  function submit(e: FormEvent) {
    e.preventDefault();
    send.mutate();
  }

  if (send.isSuccess) {
    return (
      <Shell company={data.company}>
        <Card className="space-y-3 p-6 text-center">
          <p className="font-display text-2xl font-medium">Recebemos sua simulação!</p>
          <p className="text-fg-muted">
            Um consultor da {data.company.name} vai falar com você pelo telefone ou WhatsApp informado para apresentar os planos de {assetType ? leadAssetLabel[assetType] : 'consórcio'} de{' '}
            {brl(credit)}.
          </p>
        </Card>
      </Shell>
    );
  }
  if (!line) {
    return (
      <Shell company={data.company}>
        <Alert tone="info">No momento não há planos para simular por aqui. Fale com a {data.company.name}.</Alert>
      </Shell>
    );
  }
  const minC = Math.floor(line.minCredit * 0.5);
  const maxC = Math.ceil(line.maxCredit * 1.5);
  return (
    <Shell company={data.company}>
      {data.referrer && (
        <Alert tone="success">
          {data.referrer.name} indicou você{data.referrer.reward ? `. Indicação premiada: ${data.referrer.reward}` : ''}.
        </Alert>
      )}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">O que você quer conquistar?</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {data.lines.map((l) => (
            <button
              key={l.assetType}
              type="button"
              onClick={() => pick(l.assetType)}
              className={cn('rounded-2xl border p-3 text-sm font-medium transition', assetType === l.assetType ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-surface hover:border-brand-600')}
            >
              {title[l.assetType]}
            </button>
          ))}
        </div>
        <Card className="space-y-4 p-5">
          <Field label={`Valor da carta de crédito: ${brl(credit)}`}>
            {(id) => (
              <input id={id} type="range" className="w-full accent-brand-600" min={minC} max={maxC} step={step(maxC)} value={credit} onChange={(e) => setCredit(Number(e.target.value))} />
            )}
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium">Prazo</p>
            <div className="flex flex-wrap gap-2">
              {line.terms.map((t) => (
                <button key={t} type="button" onClick={() => setTerm(t)} className={cn('rounded-full border px-3 py-1 text-sm', term === t ? 'border-brand-600 bg-brand-600 text-white' : 'border-line')}>
                  {t} meses
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-muted/50 p-4 text-center">
            <p className="text-sm text-fg-muted">Parcela estimada</p>
            <p className="font-display text-3xl font-semibold tabular-nums">{estimate ? (estimate.min === estimate.max ? brl(estimate.min) : `${brl(estimate.min)} a ${brl(estimate.max)}`) : '—'}</p>
            <p className="mt-1 text-xs text-fg-muted">Sem juros: crédito + taxa de administração, fundo de reserva e seguro, divididos pelo prazo. Valores das administradoras parceiras; sujeitos a confirmação.</p>
          </div>
        </Card>
      </section>

      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-lg font-medium">Receba a proposta</h2>
        {send.error && <Alert>{send.error.message}</Alert>}
        <Card className="space-y-4 p-5">
          <Field label="Nome completo">{(id) => <Input id={id} required autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Celular / WhatsApp (com DDD)">{(id) => <Input id={id} type="tel" required autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
            <Field label="E-mail (opcional)">{(id) => <Input id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[3fr_1fr]">
            <Field label="Cidade">{(id) => <Input id={id} required autoComplete="address-level2" value={form.city} onChange={(e) => set('city', e.target.value)} />}</Field>
            <Field label="UF">{(id) => <Input id={id} maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} />}</Field>
          </div>
          {/* Armadilha para robôs: escondido de pessoas e de leitores de tela. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Site
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
            </label>
          </div>
          <div className="rounded-xl border border-line bg-muted/40 p-3 text-xs leading-relaxed text-fg-muted">{data.consent.text}</div>
          <Checkbox required label="Li e concordo com o uso dos meus dados descrito acima." checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <Button type="submit" loading={send.isPending} disabled={!consent} className="w-full">
            Quero receber a proposta
          </Button>
        </Card>
      </form>
    </Shell>
  );
}

/** Passo do controle deslizante: R$ 1 mil até 100 mil, R$ 5 mil até 1 milhão, depois R$ 10 mil. */
const step = (max: number) => (max <= 100_000 ? 1000 : max <= 1_000_000 ? 5000 : 10_000);
const roundStep = (v: number) => {
  const s = step(v * 1.5);
  return Math.round(v / s) * s;
};

/** Cor da empresa nesta página (mesma regra do agendamento online e das vagas). */
function useCompanyColor(color: string | null) {
  useEffect(() => {
    if (!color || !isHexColor(color)) return;
    applyBrand(brandPalette(color), { id: 'brand-public', root: ':root:root:root' });
    return () => applyBrand(null, { id: 'brand-public' });
  }, [color]);
}

function Shell({ company, children }: { company?: PublicSimulator['company']; children: ReactNode }) {
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
            <p className="text-sm text-ink-fg-muted">Simulador de consórcio</p>
            <h1 className="font-display text-2xl font-medium">{company?.name ?? ' '}</h1>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">{children}</main>
      <footer className="pb-8 text-center text-xs text-fg-muted">
        Simulador por <span className="font-display font-semibold">palmer</span>
        <span className="font-display font-light text-brand-600">tech</span>
      </footer>
    </div>
  );
}
