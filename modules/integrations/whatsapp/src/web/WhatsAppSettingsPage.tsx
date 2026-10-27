import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

interface Settings {
  mode: 'manual' | 'cloud_api' | 'simulated';
  phoneNumberId: string;
  accessToken: string;
  displayPhone: string;
  languageCode: string;
}

const KEY = ['modules', 'integration.whatsapp', 'settings'];

const modes: { key: Settings['mode']; title: string; text: string }[] = [
  {
    key: 'manual',
    title: 'Manual (sem custo)',
    text: 'O sistema prepara a mensagem e mostra um botão “Abrir no WhatsApp”. Alguém da equipe envia pelo WhatsApp da empresa.',
  },
  {
    key: 'cloud_api',
    title: 'Automático (API oficial)',
    text: 'Envio automático pela API oficial da Meta, com botões “Confirmar” e “Cancelar” no lembrete. Exige conta no WhatsApp Business Platform e templates aprovados.',
  },
  { key: 'simulated', title: 'Simulado (testes)', text: 'Registra as mensagens como enviadas sem mandar nada. Use só para treinar a equipe.' },
];

export function WhatsAppSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: KEY, queryFn: () => api<Settings>('/modules/integration.whatsapp/settings') });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api('/modules/integration.whatsapp/settings', { method: 'PUT', body: form }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  if (settings.isPending || !form) return <Spinner />;
  if (settings.isError) return <Alert>{settings.error.message}</Alert>;

  return (
    <>
      <PageHeader title="WhatsApp" description="Como os avisos aos clientes (horário marcado, lembrete, pedido pronto) saem pelo WhatsApp." />
      <form onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {save.isSuccess && <Alert tone="success">Configurações salvas.</Alert>}

        <div className="grid gap-3 md:grid-cols-3">
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={form.mode === m.key}
              onClick={() => setForm({ ...form, mode: m.key })}
              className={cn('rounded-2xl border bg-surface p-4 text-left transition', form.mode === m.key ? 'border-brand-600 ring-2 ring-brand-600/20' : 'border-line hover:border-fg')}
            >
              <span className="block font-medium">{m.title}</span>
              <span className="mt-1 block text-sm text-fg-muted">{m.text}</span>
            </button>
          ))}
        </div>

        <Card className="space-y-4 p-5">
          <Field label="Número da empresa (como aparece para a equipe)">
            {(id) => <Input id={id} value={form.displayPhone} onChange={(e) => setForm({ ...form, displayPhone: e.target.value })} placeholder="(48) 99999-0000" />}
          </Field>
          {form.mode === 'cloud_api' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ID do número (Phone number ID)" hint="No painel da Meta: WhatsApp › Configuração da API.">
                  {(id) => <Input id={id} value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} />}
                </Field>
                <Field label="Idioma dos templates">{(id) => <Input id={id} value={form.languageCode} onChange={(e) => setForm({ ...form, languageCode: e.target.value })} />}</Field>
              </div>
              <Field label="Token de acesso permanente" hint="Guardado cifrado. Deixe como está para manter o token atual.">
                {(id) => <Input id={id} type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />}
              </Field>
              <Alert tone="info">
                Crie na Meta os templates <code>agendamento_marcado</code> e <code>lembrete_agendamento</code> (este com dois botões de resposta rápida: Confirmar e Cancelar), com as variáveis na ordem: nome do cliente, serviços, profissional, data e hora. Para receber as respostas, configure o webhook da Meta para o endereço informado pela Palmer Tech.
              </Alert>
            </>
          )}
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </Card>
      </form>
    </>
  );
}
