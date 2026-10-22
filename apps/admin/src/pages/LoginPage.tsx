import { ApiError } from '@all/module-sdk/web';
import { Alert, Button, Field, Input } from '@all/ui';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth, type TenantOption } from '../auth/auth';
import { AuthShell } from './AuthShell';

export function LoginPage() {
  const { login, selectTenant } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ token: string; tenants: TenantOption[] } | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar. Tente novamente.');
      if (err instanceof ApiError && err.code === 'SELECTION_EXPIRED') setSelection(null);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const result = await login(email, password);
      if (result.kind === 'select-tenant') setSelection({ token: result.selectionToken, tenants: result.tenants });
    });
  }

  if (selection) {
    return (
      <AuthShell title="Escolha a empresa" description="Seu usuário tem acesso a mais de uma empresa.">
        {error && <div className="mb-4"><Alert>{error}</Alert></div>}
        <ul className="space-y-2">
          {selection.tenants.map((t) => (
            <li key={t.id}>
              <Button variant="secondary" className="w-full justify-start" disabled={busy} onClick={() => run(() => selectTenant(selection.token, t.id))}>
                {t.name}
              </Button>
            </li>
          ))}
        </ul>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Entrar">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="E-mail">
          {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Senha">
          {(id) => (
            <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Entrar
        </Button>
        <p className="text-center text-sm">
          <Link to="/esqueci-senha" className="text-brand-700 hover:underline">
            Esqueci minha senha
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
