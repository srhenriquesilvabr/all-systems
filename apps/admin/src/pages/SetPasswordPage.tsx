import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Button, Field, Input, Spinner } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/auth';
import { AuthShell } from './AuthShell';
import { BackToLogin } from './ForgotPasswordPage';

interface TokenInfo {
  purpose: 'password_reset' | 'invite';
  email: string;
  name: string;
}

/** Serve tanto para o link de redefinição quanto para o aceite de convite. */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { status, logout } = useAuth();
  const info = useQuery({
    queryKey: ['token-info', token],
    queryFn: () => api<TokenInfo>('/auth/token-info', { query: { token } }),
    enabled: !!token,
    retry: false,
  });
  const [name, setName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token || info.isError) {
    return (
      <AuthShell title="Link inválido">
        <div className="space-y-4">
          <Alert>Este link é inválido ou expirou. Peça um novo na tela de login.</Alert>
          <BackToLogin />
        </div>
      </AuthShell>
    );
  }
  if (info.isPending) return <AuthShell title="Definir senha"><Spinner /></AuthShell>;

  const isInvite = info.data.purpose === 'invite';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/set-password', {
        method: 'POST',
        body: { token, password, ...(isInvite ? { name: name ?? info.data!.name } : {}) },
      });
      // Trocar a senha encerra todas as sessões; se havia uma aberta neste navegador, ela também acabou.
      if (status === 'authenticated') await logout();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell title={isInvite ? 'Tudo pronto!' : 'Senha alterada'}>
        <div className="space-y-4">
          <Alert tone="success">{isInvite ? 'Sua conta foi criada.' : 'Sua senha foi alterada.'} Entre com o e-mail {info.data.email}.</Alert>
          <BackToLogin />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={isInvite ? 'Aceitar convite' : 'Definir nova senha'}
      description={isInvite ? `Crie a senha de acesso para ${info.data.email}.` : `Nova senha para ${info.data.email}.`}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {isInvite && (
          <Field label="Seu nome">
            {(id) => <Input id={id} required minLength={2} value={name ?? info.data.name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        )}
        <Field label="Senha" hint="Mínimo de 10 caracteres.">
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <Field label="Confirme a senha">
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Salvar senha
        </Button>
      </form>
    </AuthShell>
  );
}
