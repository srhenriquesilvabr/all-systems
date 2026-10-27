import { api, ApiError, formatDateTime, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Tabs, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

type Channel = 'email' | 'whatsapp';

interface Template {
  key: string;
  label: string;
  module: string;
  variables: string[];
  email?: { subject: string; body: string; customized: boolean; defaults: { subject: string; body: string } };
  whatsapp?: { body: string; customized: boolean; defaults: { body: string }; metaTemplate: string | null; buttons: string[] };
}

interface Notification {
  id: string;
  channel: Channel;
  templateKey: string;
  recipient: string | null;
  subject: string;
  status: 'queued' | 'sent' | 'manual' | 'failed' | 'skipped';
  detail: string | null;
  actionUrl: string | null;
  createdAt: string;
}

const statusMeta = {
  queued: { label: 'Na fila', tone: 'neutral' },
  sent: { label: 'Enviada', tone: 'success' },
  manual: { label: 'Enviar pelo WhatsApp', tone: 'warning' },
  failed: { label: 'Falhou', tone: 'danger' },
  skipped: { label: 'Não enviada', tone: 'neutral' },
} as const;

const channelLabel: Record<Channel, string> = { email: 'E-mail', whatsapp: 'WhatsApp' };

export function NotificationsPage() {
  const [tab, setTab] = useState('templates');
  return (
    <>
      <PageHeader title="Notificações" description="Mensagens que o sistema envia aos seus clientes por e-mail e WhatsApp." />
      <Tabs
        items={[
          { key: 'templates', label: 'Mensagens' },
          { key: 'pending', label: 'A enviar pelo WhatsApp' },
          { key: 'log', label: 'Enviadas' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'templates' ? <Templates /> : <Log status={tab === 'pending' ? 'manual' : undefined} />}
    </>
  );
}

function Templates() {
  const canManage = useCan('shared.notifications.manage');
  const templates = useQuery({ queryKey: ['notifications', 'templates'], queryFn: () => api<Template[]>('/notifications/templates') });
  const [editing, setEditing] = useState<{ template: Template; channel: Channel } | null>(null);

  if (templates.isPending) return <Spinner />;
  if (templates.isError) return <Alert>{templates.error.message}</Alert>;
  if (!templates.data.length) return <EmptyState title="Nenhuma mensagem automática nos módulos contratados" />;

  return (
    <>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Mensagem</Th>
              <Th>Canais</Th>
            </tr>
          </thead>
          <tbody>
            {templates.data.map((t) => (
              <tr key={t.key}>
                <Td className="font-medium">{t.label}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {(['email', 'whatsapp'] as const)
                      .filter((c) => t[c])
                      .map((c) => (
                        <Button key={c} variant="secondary" size="sm" onClick={() => setEditing({ template: t, channel: c })}>
                          {channelLabel[c]}
                          {t[c]!.customized && <Badge tone="brand">Personalizada</Badge>}
                        </Button>
                      ))}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {editing && <TemplateModal template={editing.template} channel={editing.channel} readOnly={!canManage} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateModal({ template, channel, readOnly, onClose }: { template: Template; channel: Channel; readOnly: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const current = template[channel]!;
  const [subject, setSubject] = useState(channel === 'email' ? template.email!.subject : '');
  const [body, setBody] = useState(current.body);
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications', 'templates'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => api(`/notifications/templates/${template.key}/${channel}`, { method: 'PUT', body: channel === 'email' ? { subject, body } : { body } }),
    onSuccess: done,
  });
  const reset = useMutation({ mutationFn: () => api(`/notifications/templates/${template.key}/${channel}`, { method: 'DELETE' }), onSuccess: done });
  const error = save.error ?? reset.error;

  return (
    <Modal
      open
      title={`${template.label} · ${channelLabel[channel]}`}
      onClose={onClose}
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        ) : (
          <>
            {current.customized && (
              <Button variant="ghost" className="mr-auto" loading={reset.isPending} onClick={() => reset.mutate()}>
                Voltar ao texto padrão
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Salvar
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error instanceof ApiError ? error.message : 'Erro ao salvar'}</Alert>}
        {channel === 'email' && <Field label="Assunto">{(id) => <Input id={id} value={subject} disabled={readOnly} onChange={(e) => setSubject(e.target.value)} />}</Field>}
        <Field label="Texto">{(id) => <Textarea id={id} rows={channel === 'email' ? 9 : 5} value={body} disabled={readOnly} onChange={(e) => setBody(e.target.value)} />}</Field>
        {channel === 'whatsapp' && template.whatsapp?.metaTemplate && (
          <p className="text-xs text-fg-muted">
            No envio automático (API oficial), a Meta usa o template aprovado <code>{template.whatsapp.metaTemplate}</code>
            {template.whatsapp.buttons.length ? `, com os botões ${template.whatsapp.buttons.join(' e ')}` : ''}. Este texto vale para o envio manual.
          </p>
        )}
        <div className="text-sm">
          <p className="mb-1 text-fg-muted">Variáveis disponíveis:</p>
          <div className="flex flex-wrap gap-1">
            {template.variables.map((v) => (
              <code key={v} className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{{${v}}}`}</code>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Log({ status }: { status?: 'manual' }) {
  const queryClient = useQueryClient();
  const log = useQuery({
    queryKey: ['notifications', 'log', status],
    queryFn: () => api<Notification[]>('/notifications', { query: { limit: 100, status } }),
  });
  const markSent = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/sent`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'log'] }),
  });

  if (log.isPending) return <Spinner />;
  if (log.isError) return <Alert>{log.error.message}</Alert>;
  if (!log.data.length) return <EmptyState title={status ? 'Nada pendente. Tudo enviado!' : 'Nenhuma mensagem enviada ainda'} />;

  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>Quando</Th>
            <Th>Canal</Th>
            <Th>Para</Th>
            <Th>Mensagem</Th>
            <Th>Situação</Th>
          </tr>
        </thead>
        <tbody>
          {log.data.map((n) => (
            <tr key={n.id}>
              <Td className="whitespace-nowrap tabular-nums text-fg-muted">{formatDateTime(n.createdAt)}</Td>
              <Td>{channelLabel[n.channel]}</Td>
              <Td>{n.recipient ?? '—'}</Td>
              <Td>{n.subject}</Td>
              <Td>
                {n.status === 'manual' && n.actionUrl ? (
                  <span className="flex flex-wrap gap-1">
                    <a href={n.actionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-full bg-[#25d366] px-3.5 text-sm font-medium text-[#0b3d1f] hover:brightness-95">
                      Abrir no WhatsApp
                    </a>
                    <Button size="sm" variant="ghost" onClick={() => markSent.mutate(n.id)}>
                      Já enviei
                    </Button>
                  </span>
                ) : (
                  <>
                    <Badge tone={statusMeta[n.status].tone}>{statusMeta[n.status].label}</Badge>
                    {n.detail && <p className="mt-1 text-xs text-fg-muted">{n.detail}</p>}
                  </>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
