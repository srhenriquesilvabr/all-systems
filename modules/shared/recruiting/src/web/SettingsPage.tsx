import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useRecruitingStatus } from './JobsPage';
import { recruitingKey } from './types';

interface Settings {
  publicPage: boolean;
  retentionMonths: number;
  privacyEmail: string;
  analysis: 'auto' | 'heuristic';
  aiModel: string;
  gupyMode: 'off' | 'api' | 'simulated';
  gupyToken: string;
  gupyDepartmentId: string;
  gupyRoleId: string;
  gupyBranchId: string;
}

const KEY = ['modules', 'recruiting', 'settings'];

const gupyModes: { key: Settings['gupyMode']; title: string; text: string }[] = [
  { key: 'off', title: 'Sem Gupy', text: 'As vagas ficam na página pública e no feed do Indeed.' },
  { key: 'api', title: 'API da Gupy', text: 'Publica, atualiza e encerra as vagas marcadas na conta da empresa na Gupy (que também as leva ao LinkedIn).' },
  { key: 'simulated', title: 'Simulado', text: 'Marca as vagas como publicadas sem chamar a Gupy. Para demonstração e treinamento.' },
];

export function RecruitingSettingsPage() {
  const queryClient = useQueryClient();
  const status = useRecruitingStatus();
  const settings = useQuery({ queryKey: KEY, queryFn: () => api<Settings>('/modules/recruiting/settings') });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api('/modules/recruiting/settings', { method: 'PUT', body: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: recruitingKey });
    },
  });

  if (settings.isPending || !form) return settings.isError ? <Alert>{settings.error.message}</Alert> : <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <>
      <PageHeader title="Head hunter" description="Página de vagas, consentimento, nota de aderência e publicação na Gupy." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {save.isSuccess && <Alert tone="success">Configurações salvas.</Alert>}

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Página pública e LGPD</h2>
          <Checkbox label="Publicar as vagas abertas na página pública (e no feed do Indeed)" checked={form.publicPage} onChange={(e) => set('publicPage', e.target.checked)} />
          {status.data?.publicUrl && (
            <p className="text-sm text-fg-muted">
              Página: <span className="break-all">{status.data.publicUrl}</span>
              <br />
              Feed do Indeed: <span className="break-all">{status.data.indeedFeedUrl}</span> (cadastre este endereço com o Indeed)
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Guardar os dados dos candidatos por (meses)" hint="Depois da última candidatura. Vencido o prazo, o sistema anonimiza quem não está em processo.">
              {(id) => <Input id={id} type="number" min={1} max={60} value={form.retentionMonths} onChange={(e) => set('retentionMonths', Number(e.target.value))} />}
            </Field>
            <Field label="E-mail para pedidos de privacidade" hint="Aparece no consentimento da candidatura.">
              {(id) => <Input id={id} type="email" value={form.privacyEmail} onChange={(e) => set('privacyEmail', e.target.value)} placeholder="privacidade@empresa.com.br" />}
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Nota de aderência</h2>
          <Field label="Como calcular">
            {(id) => (
              <Select id={id} value={form.analysis} onChange={(e) => set('analysis', e.target.value as Settings['analysis'])}>
                <option value="auto">Inteligência artificial (Anthropic Claude), com estimativa quando a IA não estiver disponível</option>
                <option value="heuristic">Só a estimativa por palavras-chave (o currículo não sai do sistema)</option>
              </Select>
            )}
          </Field>
          {form.analysis === 'auto' && (
            <>
              <Field label="Modelo" hint="Padrão: claude-opus-5-5.">
                {(id) => <Input id={id} value={form.aiModel} onChange={(e) => set('aiModel', e.target.value)} />}
              </Field>
              {status.data && !status.data.aiAvailable && (
                <Alert tone="info">O servidor ainda não tem a chave da Anthropic (ANTHROPIC_API_KEY). Até lá, as notas são estimativas sem IA.</Alert>
              )}
              <p className="text-xs text-fg-muted">
                O currículo em PDF e as respostas vão para a Anthropic (fora do Brasil); nome, e-mail e telefone não vão no texto enviado. O consentimento da candidatura informa isso.
              </p>
            </>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Gupy</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {gupyModes.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={form.gupyMode === m.key}
                onClick={() => set('gupyMode', m.key)}
                className={cn('rounded-2xl border bg-surface p-4 text-left transition', form.gupyMode === m.key ? 'border-brand-600 ring-2 ring-brand-600/20' : 'border-line hover:border-fg')}
              >
                <span className="block font-medium">{m.title}</span>
                <span className="mt-1 block text-sm text-fg-muted">{m.text}</span>
              </button>
            ))}
          </div>
          {form.gupyMode === 'api' && (
            <>
              <Field label="Token da API da Gupy" hint="Gerado no painel da Gupy. Guardado cifrado; deixe como está para manter o atual.">
                {(id) => <Input id={id} type="password" autoComplete="off" value={form.gupyToken} onChange={(e) => set('gupyToken', e.target.value)} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Id do departamento">{(id) => <Input id={id} value={form.gupyDepartmentId} onChange={(e) => set('gupyDepartmentId', e.target.value)} />}</Field>
                <Field label="Id do cargo">{(id) => <Input id={id} value={form.gupyRoleId} onChange={(e) => set('gupyRoleId', e.target.value)} />}</Field>
                <Field label="Id da filial (opcional)">{(id) => <Input id={id} value={form.gupyBranchId} onChange={(e) => set('gupyBranchId', e.target.value)} />}</Field>
              </div>
              <Alert tone="info">
                A Gupy pede departamento e cargo cadastrados na conta dela para criar vagas. Os erros de publicação aparecem em cada vaga. O LinkedIn não aceita novas integrações de vagas: a
                publicação lá acontece pela Gupy ou pelo link da página pública.
              </Alert>
            </>
          )}
        </Card>

        <Button type="submit" loading={save.isPending}>
          Salvar
        </Button>
      </form>
    </>
  );
}
