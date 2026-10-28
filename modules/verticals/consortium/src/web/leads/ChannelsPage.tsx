import { api, ApiError, formatDateTime } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { LEGAL_NOTICE, leadAssetLabel, leadAssetTypes, type LeadAssetType, type LeadChannel } from '../../contracts';
import { errorText } from '../common';
import { leadsKey } from './common';

const META_STEPS = [
  'No Gerenciador de Anúncios, crie o formulário instantâneo (Lead Ads) com nome, telefone, e-mail e cidade e a política de privacidade da empresa.',
  'A Palmer liga o webhook de leads do app da Meta (campo "leadgen") ao endereço abaixo — é um só para todas as empresas.',
  'Gere o token de acesso da página com permissão de leitura de leads (a confirmar com a Meta: leads_retrieval, pages_manage_metadata, pages_show_list, pages_read_engagement) e inscreva a página no app.',
  'Informe aqui o id da página e, se quiser filtrar, os ids dos formulários. Use "Gerar lead de teste" (modo simulado) ou a ferramenta de teste de leads da Meta (modo API).',
];
const GOOGLE_STEPS = [
  'No Google Ads, no recurso de formulário de lead, abra "Opções de integração de leads" → webhook.',
  'Cole a URL do webhook deste canal e a mesma chave informada aqui (o Google manda a chave em cada lead).',
  'Use "Enviar dados de teste" do Google para conferir; leads de teste chegam marcados.',
];

const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Canais de anúncio: Meta Lead Ads e formulário de lead do Google Ads, com modo simulado para demonstração. */
export function ChannelsPage() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [...leadsKey, 'channels'], queryFn: () => api<LeadChannel[]>('/consortium/lead-channels') });
  const [editing, setEditing] = useState<LeadChannel | 'meta' | 'google' | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const test = useMutation({
    mutationFn: (id: string) => api<{ leadId: string | null }>(`/consortium/lead-channels/${id}/test`, { method: 'POST' }),
    onSuccess: (_r, id) => {
      setTested(id);
      queryClient.invalidateQueries({ queryKey: leadsKey });
    },
  });
  return (
    <>
      <PageHeader
        title="Anúncios (Meta e Google)"
        description="Leads dos formulários de anúncio entram direto no funil, com campanha e formulário para o relatório."
        actions={
          !editing && (
            <>
              <Button variant="secondary" onClick={() => setEditing('google')}>
                Novo canal Google Ads
              </Button>
              <Button onClick={() => setEditing('meta')}>Novo canal Meta</Button>
            </>
          )
        }
      />
      <Alert tone="info">{LEGAL_NOTICE}</Alert>
      {editing && (
        <div className="my-4">
          <ChannelForm channel={typeof editing === 'string' ? null : editing} kind={typeof editing === 'string' ? editing : editing.kind} onDone={() => setEditing(null)} />
        </div>
      )}
      {test.error && <Alert>{errorText(test.error, 'Erro no teste')}</Alert>}
      <Card className="mt-4">
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhum canal de anúncio" description="Crie um canal do Meta ou do Google. O modo simulado gera leads de demonstração." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Canal</Th>
                <Th>Modo</Th>
                <Th>Webhook</Th>
                <Th className="text-right">Leads</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className={c.active ? 'font-medium' : 'text-fg-subtle'}>{c.name}</span> {!c.active && <Badge>Inativo</Badge>}
                    <div className="text-xs text-fg-muted">
                      {c.kind === 'meta' ? `Meta · página ${c.pageId}${c.formIds.length ? ` · ${c.formIds.length} formulário(s)` : ''}` : 'Google Ads'}
                      {c.assetType && ` · ${leadAssetLabel[c.assetType]}`}
                    </div>
                  </Td>
                  <Td>{c.mode === 'api' ? <Badge tone="success">API</Badge> : <Badge>Simulado</Badge>}</Td>
                  <Td className="max-w-80 break-all text-xs">{c.webhookUrl}</Td>
                  <Td className="text-right text-sm tabular-nums">
                    {c.leads}
                    {c.lastLeadAt && <div className="text-xs text-fg-muted">último {formatDateTime(c.lastLeadAt)}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    {(c.mode === 'simulated' || c.kind === 'google') && c.active && (
                      <Button size="sm" variant="secondary" loading={test.isPending && test.variables === c.id} onClick={() => test.mutate(c.id)}>
                        {tested === c.id ? 'Lead criado ✓' : 'Gerar lead de teste'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                      Editar
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Steps title="Como ligar o Meta Lead Ads" steps={META_STEPS} />
        <Steps title="Como ligar o formulário de lead do Google Ads" steps={GOOGLE_STEPS} />
      </div>
    </>
  );
}

function Steps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <Card className="p-5 text-sm">
      <h2 className="mb-2 font-medium">{title}</h2>
      <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </Card>
  );
}

function ChannelForm({ channel, kind, onDone }: { channel: LeadChannel | null; kind: 'meta' | 'google'; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: channel?.name ?? (kind === 'meta' ? 'Facebook/Instagram' : 'Google Ads'),
    mode: channel?.mode ?? ('simulated' as 'simulated' | 'api'),
    pageId: channel?.pageId ?? '',
    formIds: channel?.formIds.join(', ') ?? '',
    accessToken: '',
    webhookKey: channel ? '' : kind === 'google' ? randomKey() : '',
    assetType: (channel?.assetType ?? '') as LeadAssetType | '',
    active: channel?.active ?? true,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(channel ? `/consortium/lead-channels/${channel.id}` : '/consortium/lead-channels', {
        method: channel ? 'PATCH' : 'POST',
        body: {
          kind,
          name: form.name,
          mode: form.mode,
          pageId: kind === 'meta' ? form.pageId : null,
          formIds: kind === 'meta' ? form.formIds.split(/[\s,;]+/).filter(Boolean) : [],
          accessToken: form.accessToken || null,
          webhookKey: form.webhookKey || null,
          assetType: form.assetType || null,
          active: form.active,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadsKey });
      onDone();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-medium">{channel ? `Editar ${channel.name}` : kind === 'meta' ? 'Novo canal Meta Lead Ads' : 'Novo canal Google Ads'}</h2>
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">{(id) => <Input id={id} required value={form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
          <Field label="Tipo de bem dos leads (opcional)" hint="Quando o formulário é de um produto só.">
            {(id) => (
              <Select id={id} value={form.assetType} onChange={(e) => set({ assetType: e.target.value as LeadAssetType | '' })}>
                <option value="">—</option>
                {leadAssetTypes.map((t) => (
                  <option key={t} value={t}>
                    {leadAssetLabel[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          {(['simulated', 'api'] as const).map((m) => (
            <label key={m} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3 text-sm', form.mode === m ? 'border-brand-600 bg-brand-50/40' : 'border-line')}>
              <input type="radio" name="mode" className="mt-1" checked={form.mode === m} onChange={() => set({ mode: m })} />
              <span>
                <span className="block font-medium">{m === 'simulated' ? 'Simulado' : 'Produção'}</span>
                <span className="block text-fg-muted">
                  {m === 'simulated' ? 'Gera leads fictícios pelo botão de teste, para demonstração.' : kind === 'meta' ? 'Recebe o webhook e lê o lead pela Graph API com o token da página.' : 'Recebe o webhook do Google com a chave.'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {kind === 'meta' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Id da página do Facebook">{(id) => <Input id={id} required inputMode="numeric" value={form.pageId} onChange={(e) => set({ pageId: e.target.value })} />}</Field>
            <Field label="Ids dos formulários (opcional)" hint="Separados por vírgula. Vazio = todos os formulários da página.">
              {(id) => <Input id={id} value={form.formIds} onChange={(e) => set({ formIds: e.target.value })} />}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Token de acesso da página" hint={channel?.hasAccessToken ? 'Guardado cifrado; em branco mantém o atual.' : 'Guardado cifrado; não volta para a tela.'}>
                {(id) => <Input id={id} type="password" autoComplete="off" value={form.accessToken} onChange={(e) => set({ accessToken: e.target.value })} />}
              </Field>
            </div>
          </div>
        ) : (
          <Field label="Chave do webhook (google_key)" hint={channel?.hasWebhookKey ? 'Em branco mantém a atual.' : 'Copie esta chave para o formulário no Google Ads antes de salvar: ela não volta para a tela.'}>
            {(id) => <Input id={id} required={!channel?.hasWebhookKey} value={form.webhookKey} onChange={(e) => set({ webhookKey: e.target.value })} />}
          </Field>
        )}
        {channel && <p className="text-xs text-fg-muted">Webhook: {channel.webhookUrl}</p>}
        <Checkbox label="Ativo" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
