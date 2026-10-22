import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Button, Field, Input } from '@all/ui';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AuthShell } from './AuthShell';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Não foi possível enviar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Esqueci minha senha" description="Informe seu e-mail para receber um link de redefinição.">
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">Se houver uma conta com esse e-mail, enviamos um link. Ele vale por 30 minutos.</Alert>
          <BackToLogin />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="E-mail">
            {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Enviar link
          </Button>
          <BackToLogin />
        </form>
      )}
    </AuthShell>
  );
}

export function BackToLogin() {
  return (
    <p className="text-center text-sm">
      <Link to="/entrar" className="text-brand-700 hover:underline">
        Voltar para o login
      </Link>
    </p>
  );
}
