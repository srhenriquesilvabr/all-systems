import { api, apiDownload, ApiError, formatDate, formatDateTime, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, PageHeader, Spinner, Tabs } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useWebModules } from '../../modules';
import { CustomerSegment } from '../segmentation/SegmentsPage';
import { useCustomFields } from './CustomerForm';
import { formatDocument, formatPhone } from './format';
import type { ConsentPurpose, CustomerDetail } from './types';

interface TimelineEntry {
  id: string;
  title: string;
  type: string;
  createdAt: string;
}

const consentLabels: Record<ConsentPurpose, { label: string; hint: string }> = {
  service_notifications: { label: 'Avisos sobre os serviços', hint: 'Ordem pronta, pagamentos. Enviados por padrão (execução do contrato).' },
  marketing_email: { label: 'Ofertas por e-mail', hint: 'Só com autorização do cliente.' },
  marketing_whatsapp: { label: 'Ofertas por WhatsApp', hint: 'Só com autorização do cliente.' },
};

export function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const canWrite = useCan('core.customers.write');
  const canPrivacy = useCan('core.customers.privacy');
  const [tab, setTab] = useState('data');
  const navigate = useNavigate();
  const customer = useQuery({ queryKey: ['customers', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`) });

  // Abas que os módulos ativos acrescentam à ficha (ex.: "Ordens de serviço").
  const active = new Set(session.modules.map((m) => m.key));
  const webModules = useWebModules();
  const moduleTabs = (webModules.data ?? [])
    .filter((m) => active.has(m.key))
    .flatMap((m) => m.customerTabs ?? [])
    .filter((t) => !t.permission || session.permissions.includes(t.permission));

  if (customer.isPending) return <Spinner />;
  if (customer.isError) return <Alert>{customer.error.message}</Alert>;
  const c = customer.data;
  const ModuleTab = moduleTabs.find((t) => t.key === tab)?.Component;

  return (
    <>
      <PageHeader
        title={c.name}
        description={c.type === 'person' ? 'Pessoa física' : 'Empresa'}
        actions={
          canWrite &&
          !c.anonymizedAt && (
            <Button variant="secondary" onClick={() => navigate(`/clientes/${c.id}/editar`)}>
              Editar
            </Button>
          )
        }
      />
      {!c.anonymizedAt && <CustomerSegment customerId={c.id} />}
      {c.anonymizedAt && (
        <div className="mb-4">
          <Alert tone="info">Dados pessoais anonimizados em {formatDateTime(c.anonymizedAt)} a pedido do titular.</Alert>
        </div>
      )}

      <Tabs
        items={[
          { key: 'data', label: 'Dados' },
          ...moduleTabs.map((t) => ({ key: t.key, label: t.label })),
          { key: 'timeline', label: 'Linha do tempo' },
          { key: 'privacy', label: 'Privacidade' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'data' && <DataTab customer={c} />}
      {tab === 'timeline' && <TimelineTab customerId={c.id} />}
      {tab === 'privacy' && <PrivacyTab customer={c} canWrite={canWrite} canPrivacy={canPrivacy} />}
      {ModuleTab && <ModuleTab customerId={c.id} />}

    </>
  );
}

function DataTab({ customer: c }: { customer: CustomerDetail }) {
  const fields = useCustomFields();
  const address = c.address
    ? [[c.address.street, c.address.number].filter(Boolean).join(', '), c.address.complement, c.address.district, [c.address.city, c.address.state].filter(Boolean).join(' - '), c.address.zip]
        .filter(Boolean)
        .join(' · ')
    : '';
  const rows: [string, string][] = [
    [c.type === 'person' ? 'CPF' : 'CNPJ', formatDocument(c.document)],
    ['Telefone', formatPhone(c.phone)],
    ['E-mail', c.email ?? ''],
    ...(c.type === 'person' ? [['Nascimento', c.birthDate ? formatDate(c.birthDate) : ''] as [string, string]] : []),
    ['Endereço', address],
    ...(fields.data ?? []).map((f): [string, string] => {
      const v = c.customFields[f.key];
      return [f.label, v === undefined || v === null ? '' : f.type === 'boolean' ? (v ? 'Sim' : 'Não') : f.type === 'date' ? formatDate(String(v)) : String(v)];
    }),
    ['Cliente desde', formatDate(c.createdAt)],
  ];

  return (
    <Card className="p-5">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm text-fg-muted">{label}</dt>
            <dd className="text-sm">{value || <span className="text-fg-subtle">—</span>}</dd>
          </div>
        ))}
      </dl>
      {c.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-sm">{c.notes}</p>}
    </Card>
  );
}

function TimelineTab({ customerId }: { customerId: string }) {
  const timeline = useQuery({ queryKey: ['customers', customerId, 'timeline'], queryFn: () => api<TimelineEntry[]>(`/customers/${customerId}/timeline`) });
  if (timeline.isPending) return <Spinner />;
  if (timeline.isError) return <Alert>{timeline.error.message}</Alert>;
  if (!timeline.data.length) return <EmptyState title="Nada registrado ainda" />;
  return (
    <Card className="p-5">
      <ol className="space-y-3">
        {timeline.data.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className="w-32 shrink-0 tabular-nums text-fg-muted">{formatDateTime(e.createdAt)}</span>
            <span>{e.title}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function PrivacyTab({ customer: c, canWrite, canPrivacy }: { customer: CustomerDetail; canWrite: boolean; canPrivacy: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['customers', c.id] });
  const consent = useMutation({
    mutationFn: (body: { purpose: ConsentPurpose; granted: boolean }) => api(`/customers/${c.id}/consents`, { method: 'POST', body: { ...body, source: 'admin' } }),
    onSuccess: refresh,
  });
  const anonymize = useMutation({ mutationFn: () => api(`/customers/${c.id}/anonymize`, { method: 'POST' }), onSuccess: refresh });
  const exportData = useMutation({ mutationFn: () => apiDownload(`/customers/${c.id}/export`, `cliente-${c.id}.json`) });
  const error = consent.error ?? anonymize.error ?? exportData.error;

  return (
    <div className="space-y-4">
      {error && <Alert>{error instanceof ApiError ? error.message : 'Erro'}</Alert>}
      <Card className="space-y-4 p-5">
        <h2 className="font-medium">Comunicações</h2>
        {(Object.keys(consentLabels) as ConsentPurpose[]).map((purpose) => {
          const current = c.consents[purpose];
          const granted = current ? current.granted : purpose === 'service_notifications';
          return (
            <div key={purpose}>
              <Checkbox
                label={consentLabels[purpose].label}
                checked={granted}
                disabled={!canWrite || !!c.anonymizedAt || consent.isPending}
                onChange={(e) => consent.mutate({ purpose, granted: e.target.checked })}
              />
              <p className="ml-6 text-xs text-fg-muted">
                {consentLabels[purpose].hint}
                {current && ` Última alteração: ${formatDateTime(current.at)} (${current.source}).`}
              </p>
            </div>
          );
        })}
      </Card>

      {canPrivacy && (
        <Card className="space-y-3 p-5">
          <h2 className="font-medium">Direitos do titular (LGPD)</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" loading={exportData.isPending} onClick={() => exportData.mutate()}>
              Exportar dados (JSON)
            </Button>
            <span className="text-sm text-fg-muted">Tudo o que a empresa guarda sobre este cliente, em todos os módulos.</span>
          </div>
          {!c.anonymizedAt && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <Button
                variant="danger"
                loading={anonymize.isPending}
                onClick={() =>
                  confirm(`Anonimizar ${c.name}? Nome, documento, contatos e observações serão apagados de forma definitiva. Valores financeiros são mantidos.`) &&
                  anonymize.mutate()
                }
              >
                Anonimizar
              </Button>
              <span className="text-sm text-fg-muted">
                Atende o pedido de eliminação. <Badge tone="danger">Não pode ser desfeito</Badge>
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
