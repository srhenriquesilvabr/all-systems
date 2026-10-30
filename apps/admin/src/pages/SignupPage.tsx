import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Button, Field, Input, Spinner, cn } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth';
import { iconFor } from '../layout/icons';
import { AuthShell } from './AuthShell';

interface Branch {
  key: string;
  name: string;
  description?: string;
  icon?: string;
}

/**
 * Contratação da Palmer: a empresa escolhe o ramo e cria a conta do dono. Ela entra só com as
 * telas desse ramo; outros ramos e módulos são contratados depois, na página inicial.
 */
export function SignupPage() {
  const { login } = useAuth();
  const openedAt = useRef(Date.now());
  const branches = useQuery({ queryKey: ['signup-branches'], queryFn: () => api<Branch[]>('/public/signup/branches'), staleTime: Infinity });
  const [branch, setBranch] = useState<string | null>(null);
  const [form, setForm] = useState({ companyName: '', document: '', ownerName: '', email: '', password: '', website: '' });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!branch) return setError('Escolha o ramo da empresa.');
    setBusy(true);
    setError(null);
    try {
      await api('/public/signup', { method: 'POST', body: { ...form, document: form.document || undefined, website: form.website || undefined, branch, consent, openedAt: openedAt.current } });
      await login(form.email, form.password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta. Tente novamente.');
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Contratar a Palmer" description="Escolha o ramo da sua empresa. Você usa só o que é desse ramo e pode contratar outros ramos e módulos depois.">
      {branches.isPending ? (
        <Spinner />
      ) : branches.isError ? (
        <Alert>{branches.error.message}</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Ramo da empresa</legend>
            <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
              {branches.data.map((b) => {
                const Icon = iconFor(b.icon);
                const selected = branch === b.key;
                return (
                  <label key={b.key} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition', selected ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface hover:border-brand-200')}>
                    <input type="radio" name="branch" className="sr-only" checked={selected} onChange={() => setBranch(b.key)} />
                    <Icon className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{b.name}</span>
                      {b.description && <span className="block text-xs text-fg-muted">{b.description}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Field label="Nome da empresa">{(id) => <Input id={id} required maxLength={120} autoComplete="organization" value={form.companyName} onChange={(e) => set({ companyName: e.target.value })} />}</Field>
          <Field label="CNPJ ou CPF (opcional)">{(id) => <Input id={id} maxLength={20} value={form.document} onChange={(e) => set({ document: e.target.value })} />}</Field>
          <Field label="Seu nome">{(id) => <Input id={id} required maxLength={120} autoComplete="name" value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />}</Field>
          <Field label="E-mail">{(id) => <Input id={id} type="email" required autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
          <Field label="Senha (mínimo de 10 caracteres)">{(id) => <Input id={id} type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} />}</Field>
          {/* Só robô preenche: fica fora da tela e do teclado. */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] size-px" value={form.website} onChange={(e) => set({ website: e.target.value })} />
          <label className="flex items-start gap-2 text-sm text-fg-muted">
            <input type="checkbox" className="mt-0.5" required checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Autorizo a Palmer Tech a usar estes dados para criar e operar a conta da minha empresa.
          </label>
          <Button type="submit" className="w-full" loading={busy} disabled={!branch}>
            Criar conta
          </Button>
          <p className="text-center text-sm">
            Já tem conta?{' '}
            <Link to="/entrar" className="text-brand-700 hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
