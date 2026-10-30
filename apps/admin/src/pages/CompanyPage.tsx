import { AddressFields, api, ApiError, apiUpload, formatPhone } from '@all/module-sdk/web';
import {
  Alert,
  Badge,
  BRAND_SUGGESTIONS,
  brandPalette,
  Button,
  Card,
  checkBrand,
  cn,
  Field,
  Input,
  isHexColor,
  PageHeader,
  PALMER_BLUE,
  PALMER_PALETTE,
  previewVars,
  Spinner,
  type BrandScale,
} from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleCheck, CircleX, IdCard, ImageIcon, MapPin, Palette, Phone, RotateCcw, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/auth';
import { CompanyLogo } from '../layout/CompanyBrand';

interface Address {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
}

interface Company {
  name: string;
  slug: string | null;
  legalName: string | null;
  document: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  address: Address | null;
  brandColor: string | null;
  logoUrl: string | null;
}

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_LOGO_BYTES = 1024 * 1024;

/** CPF 000.000.000-00; CNPJ 00.000.000/0000-00 (o CNPJ novo pode ter letras nas 12 primeiras posições). */
function formatCompanyDocument(doc: string | null): string {
  if (!doc) return '';
  if (/^\d{11}$/.test(doc)) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (/^[0-9A-Z]{12}\d{2}$/.test(doc)) return doc.replace(/(.{2})(.{3})(.{3})(.{4})(.{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

/** "document: CNPJ inválido" → { document: 'CNPJ inválido' }; o que não tem campo vai para `general`. */
function splitErrors(err: unknown): { fields: Record<string, string>; general: string[] } {
  const fields: Record<string, string> = {};
  const general: string[] = [];
  if (!(err instanceof ApiError)) return { fields, general: ['Não foi possível salvar. Tente de novo.'] };
  const body = err.body as { message?: string | string[] } | undefined;
  const messages = Array.isArray(body?.message) ? body.message : [err.message];
  for (const m of messages) {
    const match = m.match(/^(\w+)(?:\.\w+)*: (.*)$/);
    if (match) fields[match[1]!] ??= match[2]!;
    else general.push(m);
  }
  return { fields, general };
}

/** Configurações → Dados da empresa: cadastro, logo e cor do painel (na própria página). */
export function CompanyPage() {
  const company = useQuery({ queryKey: ['company'], queryFn: () => api<Company>('/company') });
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Dados da empresa"
        description="Cadastro, logo e cor do painel. O logo e a cor valem para toda a equipe e aparecem nas páginas públicas, como o agendamento online."
      />
      {company.isPending ? <Spinner /> : company.isError ? <Alert>{company.error.message}</Alert> : <CompanyForm company={company.data} />}
    </div>
  );
}

function CompanyForm({ company }: { company: Company }) {
  const queryClient = useQueryClient();
  const { reloadSession } = useAuth();
  const [form, setForm] = useState({
    name: company.name,
    legalName: company.legalName ?? '',
    document: formatCompanyDocument(company.document),
    stateRegistration: company.stateRegistration ?? '',
    municipalRegistration: company.municipalRegistration ?? '',
    email: company.email ?? '',
    phone: formatPhone(company.phone),
    website: company.website ?? '',
    instagram: company.instagram ? `@${company.instagram}` : '',
  });
  const [address, setAddress] = useState<Address>(company.address ?? {});
  const [color, setColor] = useState<string | null>(company.brandColor);
  const [saved, setSaved] = useState(false);

  const palette = color ? brandPalette(color) : null;
  const check = palette ? checkBrand(palette) : null;

  const save = useMutation({
    mutationFn: () => api<Company>('/company', { method: 'PATCH', body: { ...form, address, brandColor: color } }),
    onSuccess: async (data) => {
      queryClient.setQueryData(['company'], data);
      setForm((f) => ({ ...f, document: formatCompanyDocument(data.document), phone: formatPhone(data.phone), website: data.website ?? '', instagram: data.instagram ? `@${data.instagram}` : '' }));
      setSaved(true);
      // Nome, cor e logo vêm da sessão: o menu e o tema se atualizam na hora.
      await reloadSession();
    },
  });
  const errors = save.error ? splitErrors(save.error) : { fields: {} as Record<string, string>, general: [] as string[] };

  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    if (check && !check.ok) return;
    save.mutate();
  }

  return (
    <div className="space-y-4">
      <LogoSection company={company} />

      <form onSubmit={submit} className="space-y-4">
        <Section icon={IdCard} title="Identificação">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome fantasia" hint="Aparece no menu, nas mensagens e nas páginas públicas." error={errors.fields.name}>
              {(id) => <Input id={id} required minLength={2} maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
            </Field>
            <Field label="Razão social" error={errors.fields.legalName}>
              {(id) => <Input id={id} maxLength={200} value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="CNPJ ou CPF" error={errors.fields.document}>
              {(id) => <Input id={id} autoCapitalize="characters" placeholder="00.000.000/0000-00" value={form.document} onChange={(e) => set({ document: e.target.value })} />}
            </Field>
            <Field label="Inscrição estadual" hint="Ou ISENTO." error={errors.fields.stateRegistration}>
              {(id) => <Input id={id} maxLength={30} value={form.stateRegistration} onChange={(e) => set({ stateRegistration: e.target.value })} />}
            </Field>
            <Field label="Inscrição municipal" error={errors.fields.municipalRegistration}>
              {(id) => <Input id={id} maxLength={30} value={form.municipalRegistration} onChange={(e) => set({ municipalRegistration: e.target.value })} />}
            </Field>
          </div>
        </Section>

        <Section icon={Phone} title="Contato">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="E-mail" error={errors.fields.email}>
              {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />}
            </Field>
            <Field label="Telefone / WhatsApp" error={errors.fields.phone}>
              {(id) => <Input id={id} type="tel" placeholder="(11) 98765-4321" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}
            </Field>
            <Field label="Site" error={errors.fields.website}>
              {(id) => <Input id={id} inputMode="url" placeholder="www.suaempresa.com.br" value={form.website} onChange={(e) => set({ website: e.target.value })} />}
            </Field>
            <Field label="Instagram" error={errors.fields.instagram}>
              {(id) => <Input id={id} placeholder="@suaempresa" value={form.instagram} onChange={(e) => set({ instagram: e.target.value })} />}
            </Field>
          </div>
        </Section>

        <Section icon={MapPin} title="Endereço">
          <AddressFields
            value={address}
            onChange={(next) => {
              setAddress(next);
              setSaved(false);
            }}
          />
          {errors.fields.address && <p className="text-sm text-danger-600">{errors.fields.address}</p>}
        </Section>

        <ColorSection
          company={company}
          color={color}
          onChange={(c) => {
            setColor(c);
            setSaved(false);
          }}
          error={errors.fields.brandColor}
        />

        {errors.general.length > 0 && <Alert>{errors.general.join(' ')}</Alert>}
        {saved && <Alert tone="success">Dados salvos.</Alert>}
        <div className="flex items-center justify-end gap-3">
          {check && !check.ok && <p className="text-sm text-danger-700">Escolha uma cor com contraste suficiente para salvar.</p>}
          <Button type="submit" loading={save.isPending} disabled={!!check && !check.ok}>
            Salvar
          </Button>
        </div>
      </form>
    </div>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <Icon className="size-4 text-brand-600" aria-hidden />
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Logo: enviado e removido na hora (não espera o "Salvar").
// ---------------------------------------------------------------------------

function LogoSection({ company }: { company: Company }) {
  const queryClient = useQueryClient();
  const { reloadSession } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const done = async (data: Company) => {
    queryClient.setQueryData(['company'], data);
    await reloadSession();
  };
  const upload = useMutation({ mutationFn: (file: File) => apiUpload<Company>('/company/logo', 'logo', file), onSuccess: done });
  const remove = useMutation({
    mutationFn: () => api('/company/logo', { method: 'DELETE' }),
    onSuccess: () => done({ ...company, logoUrl: null }),
  });

  function pick(file: File | undefined) {
    setLocalError(null);
    upload.reset();
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setLocalError('Envie o logo em PNG, JPG, SVG ou WebP.');
    if (file.size > MAX_LOGO_BYTES) return setLocalError('O logo pode ter no máximo 1 MB.');
    upload.mutate(file);
  }

  const error = localError ?? (upload.error ? (upload.error instanceof ApiError ? upload.error.message : 'Não foi possível enviar o logo.') : null);

  return (
    <Section icon={ImageIcon} title="Logo" description="PNG, JPG, SVG ou WebP, até 1 MB. Prefira o logo horizontal, com fundo transparente.">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-center">
        {company.logoUrl ? (
          <>
            <figure className="space-y-1.5">
              <div className="flex h-24 items-center justify-center rounded-xl border border-line bg-surface p-3">
                <img src={company.logoUrl} alt={`Logo de ${company.name}`} className="max-h-full max-w-full object-contain" />
              </div>
              <figcaption className="text-xs text-fg-muted">Em fundo claro</figcaption>
            </figure>
            <figure className="space-y-1.5">
              <div className="flex h-24 items-center justify-center rounded-xl bg-ink p-3">
                <CompanyLogo name={company.name} logoUrl={company.logoUrl} className="h-14 w-full max-w-[13rem]" />
              </div>
              <figcaption className="text-xs text-fg-muted">No menu lateral (sobre fundo branco)</figcaption>
            </figure>
          </>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-line text-sm text-fg-muted md:col-span-2">
            Sem logo: o menu mostra a marca Palmer.
          </div>
        )}
        <div className="flex gap-2 md:flex-col">
          <input ref={input} type="file" accept={LOGO_TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }} />
          <Button variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
            <Upload className="size-4" aria-hidden />
            {company.logoUrl ? 'Trocar logo' : 'Enviar logo'}
          </Button>
          {company.logoUrl && (
            <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 className="size-4" aria-hidden />
              Remover
            </Button>
          )}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {remove.error && <Alert>Não foi possível remover o logo.</Alert>}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Cor do painel: sugestões + seletor livre, conferência de contraste e prévia nos dois temas.
// ---------------------------------------------------------------------------

function ColorSection({ company, color, onChange, error }: { company: Company; color: string | null; onChange: (c: string | null) => void; error?: string }) {
  const [draft, setDraft] = useState(color ?? '');
  const palette = color ? brandPalette(color) : PALMER_PALETTE;
  const check = color ? checkBrand(palette) : null;

  const choose = (c: string | null) => {
    setDraft(c ?? '');
    onChange(c);
  };
  const typed = (value: string) => {
    setDraft(value);
    const hex = (value.startsWith('#') ? value : `#${value}`).trim().toLowerCase();
    if (isHexColor(hex)) onChange(hex);
  };

  return (
    <Section icon={Palette} title="Cor do painel" description="A cor principal de botões, links e destaques. Os tons claros e escuros são calculados a partir dela.">
      <div className="space-y-3">
        <p className="text-sm font-medium">Sugestões</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Cores sugeridas">
          {BRAND_SUGGESTIONS.map((s) => (
            <Swatch key={s.color} color={s.color} label={s.name} selected={color === s.color} onClick={() => choose(s.color)} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Outra cor" hint="Escolha no seletor ou digite o código (#rrggbb)." error={error}>
          {(id) => (
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Seletor de cor"
                value={color ?? PALMER_BLUE}
                onChange={(e) => choose(e.target.value.toLowerCase())}
                className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-surface p-1"
              />
              <Input id={id} className="w-32 font-mono" placeholder={PALMER_BLUE} maxLength={7} value={draft} onChange={(e) => typed(e.target.value)} />
            </div>
          )}
        </Field>
        <Button variant="secondary" disabled={!color} onClick={() => choose(null)}>
          <RotateCcw className="size-4" aria-hidden />
          Voltar ao padrão Palmer
        </Button>
        {!color && <Badge tone="brand">Usando o padrão Palmer</Badge>}
        {color && color !== company.brandColor && <Badge tone="warning">Ainda não salva</Badge>}
      </div>

      {check && (
        <div className="space-y-2">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            <ContrastLine label="Texto dos botões no tema claro" value={check.light} />
            <ContrastLine label="Texto dos botões no tema escuro" value={check.dark} />
          </ul>
          {check.problems.map((p) => (
            <Alert key={p}>{p}</Alert>
          ))}
          {check.warnings.map((w) => (
            <Alert key={w} tone="info">
              {w}
            </Alert>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Preview name={company.name} theme="light" scale={palette.light} />
        <Preview name={company.name} theme="dark" scale={palette.dark} />
      </div>
    </Section>
  );
}

function Swatch({ color, label, selected, onClick }: { color: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={`${label} (${color})`}
      className={cn(
        'flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition',
        selected ? 'ring-2 ring-fg' : 'hover:ring-2 hover:ring-line',
      )}
      style={{ backgroundColor: color }}
    >
      {selected && <Check className="size-4 text-white" aria-hidden />}
    </button>
  );
}

function ContrastLine({ label, value }: { label: string; value: number }) {
  const ok = value >= 4.5;
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <li className={cn('flex items-center gap-2 rounded-lg px-3 py-2', ok ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700')}>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>
        {label}: <strong className="tabular-nums">{value.toFixed(1).replace('.', ',')}:1</strong> {ok ? '(legível)' : '(ilegível, mínimo 4,5:1)'}
      </span>
    </li>
  );
}

/**
 * Prévia de um tema com a escala escolhida, isolada neste bloco: os tokens (neutros e marca)
 * são redefinidos no próprio elemento, então os componentes de verdade mostram a cor nova.
 */
function Preview({ name, theme, scale }: { name: string; theme: 'light' | 'dark'; scale: BrandScale }) {
  return (
    <figure className="space-y-1.5">
      <div style={previewVars(scale, theme) as CSSProperties} className="overflow-hidden rounded-xl border border-line bg-canvas text-fg">
        <div className="grid grid-cols-[7.5rem_1fr]">
          <div className="space-y-1 bg-ink p-2.5 text-xs">
            <p className="mb-2 truncate px-1.5 font-medium text-white">{name}</p>
            <p className="rounded-md bg-brand-600 px-1.5 py-1 font-medium text-white">Agenda</p>
            <p className="px-1.5 py-1 text-ink-fg-muted">Clientes</p>
            <p className="px-1.5 py-1 text-ink-fg-muted">Financeiro</p>
          </div>
          <div className="space-y-3 p-3">
            <div className="flex gap-3 border-b border-line text-xs">
              <span className="-mb-px border-b-2 border-brand-600 pb-1.5 font-medium text-brand-700">Hoje</span>
              <span className="pb-1.5 text-fg-muted">Semana</span>
            </div>
            <div className="rounded-lg border border-line bg-surface p-2.5 text-sm">
              <p className="flex items-center justify-between gap-2">
                <span className="font-medium">Corte e escova</span>
                <Badge tone="brand">Confirmado</Badge>
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                14:00 · <span className="text-brand-700 underline">ver cliente</span>
              </p>
            </div>
            <div className="rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs text-brand-700">3 horários livres à tarde</div>
            <div className="flex gap-2">
              <Button size="sm">Novo horário</Button>
              <Button size="sm" variant="secondary">
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="text-xs text-fg-muted">{theme === 'light' ? 'Tema claro' : 'Tema escuro'}</figcaption>
    </figure>
  );
}
