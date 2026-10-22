import { api, ApiError, formatDateTime, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Tabs, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface Template {
  key: string;
  label: string;
  module: string;
  subject: string;
  body: string;
  variables: string[];
  customized: boolean;
  defaults: { subject: string; body: string };
}

interface Notification {
  id: string;
  templateKey: string;
  recipient: string | null;
  subject: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  detail: string | null;
  createdAt: string;
}

const statusMeta = {
  queued: { label: 'Na fila', tone: 'neutral' },
  sent: { label: 'Enviada', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
  skipped: { label: 'Não enviada', tone: 'warning' },
} as const;

export function NotificationsPage() {
  const [tab, setTab] = useState('templates');
  return (
    <>
      <PageHeader title="Notificações" description="Mensagens que o sistema envia aos seus clientes por e-mail." />
      <Tabs
        items={[
          { key: 'templates', label: 'Mensagens' },
          { key: 'log', label: 'Enviadas' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'templates' ? <Templates /> : <Log />}
    </>
  );
}

function Templates() {
  const canManage = useCan('shared.notifications.manage');
  const templates = useQuery({ queryKey: ['notifications', 'templates'], queryFn: () => api<Template[]>('/notifications/templates') });
  const [editing, setEditing] = useState<Template | null>(null);

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
              <Th>Assunto</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {templates.data.map((t) => (
              <tr key={t.key}>
                <Td>
                  <span className="font-medium">{t.label}</span> {t.customized && <Badge tone="brand">Personalizada</Badge>}
                </Td>
                <Td className="text-fg-muted">{t.subject}</Td>
                <Td className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                    {canManage ? 'Editar' : 'Ver'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {editing && <TemplateModal template={editing} readOnly={!canManage} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateModal({ template, readOnly, onClose }: { template: Template; readOnly: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications', 'templates'] });
    onClose();
  };
  const save = useMutation({ mutationFn: () => api(`/notifications/templates/${template.key}`, { method: 'PUT', body: { subject, body } }), onSuccess: done });
  const reset = useMutation({ mutationFn: () => api(`/notifications/templates/${template.key}`, { method: 'DELETE' }), onSuccess: done });
  const error = save.error ?? reset.error;

  return (
    <Modal
      open
      title={template.label}
      onClose={onClose}
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        ) : (
          <>
            {template.customized && (
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
        <Field label="Assunto">{(id) => <Input id={id} value={subject} disabled={readOnly} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Texto">{(id) => <Textarea id={id} rows={9} value={body} disabled={readOnly} onChange={(e) => setBody(e.target.value)} />}</Field>
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

function Log() {
  const log = useQuery({ queryKey: ['notifications', 'log'], queryFn: () => api<Notification[]>('/notifications', { query: { limit: 100 } }) });
  if (log.isPending) return <Spinner />;
  if (log.isError) return <Alert>{log.error.message}</Alert>;
  if (!log.data.length) return <EmptyState title="Nenhuma mensagem enviada ainda" />;

  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>Quando</Th>
            <Th>Para</Th>
            <Th>Assunto</Th>
            <Th>Situação</Th>
          </tr>
        </thead>
        <tbody>
          {log.data.map((n) => (
            <tr key={n.id}>
              <Td className="whitespace-nowrap tabular-nums text-fg-muted">{formatDateTime(n.createdAt)}</Td>
              <Td>{n.recipient ?? '—'}</Td>
              <Td>{n.subject}</Td>
              <Td>
                <Badge tone={statusMeta[n.status].tone}>{statusMeta[n.status].label}</Badge>
                {n.detail && <p className="mt-1 text-xs text-fg-muted">{n.detail}</p>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
