import { api, ApiError, formatDateTime, formatMoney, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  docStatusLabel,
  docStatuses,
  docTypeLabel,
  docTypeShort,
  docTypes,
  sourceTypeLabel,
  type DocType,
  type DocumentSummary,
  type FiscalDocument,
  type FiscalSource,
  type VoidRecord,
} from '../contracts';
import { docPath, EnvironmentBadge, ErrorMessage, fiscalKey, StatusBadge, useOverview } from './shared';

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

/** Notas emitidas, origens a emitir (vendas, atendimentos, ordens) e numeração. */
export function DocumentsPage() {
  const [tab, setTab] = useState('documents');
  const canIssue = useCan('integration.fiscal.issue');
  const overview = useOverview();
  const environment = (overview.data?.settings.environment as 'homologation' | 'production' | undefined) ?? 'homologation';
  const blocking = overview.data?.readiness.filter((r) => !r.ok && r.blocking) ?? [];
  return (
    <>
      <PageHeader
        title="Notas fiscais"
        description="NFS-e, NFC-e e NF-e emitidas pelo provedor. Vendas, atendimentos pagos e ordens concluídas aparecem em “A emitir”."
        actions={
          <div className="flex items-center gap-2">
            {overview.data && <EnvironmentBadge environment={environment} />}
            {canIssue && (
              <Link to="/fiscal/nova">
                <Button>Nota avulsa</Button>
              </Link>
            )}
          </div>
        }
      />
      {blocking.length > 0 && (
        <div className="mb-4">
          <Alert>
            Falta configurar para emitir: {blocking.map((b) => b.label).join('; ')}.{' '}
            <Link className="underline" to="/configuracoes/fiscal">
              Abrir configuração fiscal
            </Link>
          </Alert>
        </div>
      )}
      <Tabs
        items={[
          { key: 'documents', label: 'Notas' },
          { key: 'sources', label: 'A emitir' },
          { key: 'numbering', label: 'Numeração' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'documents' && <DocumentList />}
      {tab === 'sources' && <SourceList />}
      {tab === 'numbering' && <Numbering />}
    </>
  );
}

function DocumentList() {
  const [filters, setFilters] = useState({ from: monthStart(), to: '', type: '', status: '', q: '' });
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));
  const list = useQuery({
    queryKey: [...fiscalKey, 'documents', filters],
    queryFn: () => api<DocumentSummary[]>('/fiscal/documents', { query: { from: filters.from || undefined, to: filters.to || undefined, type: filters.type || undefined, status: filters.status || undefined, q: filters.q || undefined } }),
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="De">{(id) => <Input id={id} type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />}</Field>
        <Field label="Até">{(id) => <Input id={id} type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />}</Field>
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={filters.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">Todos</option>
              {docTypes.map((t) => (
                <option key={t} value={t}>
                  {docTypeLabel[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Situação">
          {(id) => (
            <Select id={id} value={filters.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">Todas</option>
              {docStatuses.map((s) => (
                <option key={s} value={s}>
                  {docStatusLabel[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Buscar">{(id) => <Input id={id} value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Cliente, número ou chave" />}</Field>
      </div>
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma nota no período" description="Emita a partir de “A emitir” ou faça uma nota avulsa." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nota</Th>
                <Th>Cliente</Th>
                <Th>Origem</Th>
                <Th>Data</Th>
                <Th className="text-right">Valor</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <Link className="font-medium text-brand-700 hover:underline" to={docPath(d.id)}>
                      {docTypeShort[d.type]} {d.number ? `nº ${d.number}` : '(rascunho)'}
                    </Link>
                    {d.environment === 'homologation' && <span className="ml-1 text-xs text-fg-subtle">homolog.</span>}
                  </Td>
                  <Td>{d.recipientName ?? <span className="text-fg-subtle">Consumidor</span>}</Td>
                  <Td className="text-sm">{d.sourceLabel ?? sourceTypeLabel[d.sourceType]}</Td>
                  <Td className="text-sm">{formatDateTime(d.issuedAt ?? d.createdAt)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(d.total)}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={d.status} />
                      {d.contingency && <Badge tone="warning">Contingência</Badge>}
                    </div>
                    {(d.status === 'rejected' || d.status === 'denied') && d.statusMessage && <p className="mt-1 max-w-xs text-xs text-danger-700">{d.statusMessage}</p>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function SourceList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canIssue = useCan('integration.fiscal.issue');
  const [status, setStatus] = useState<'ready' | 'pending' | 'cancelled' | 'all'>('ready');
  const list = useQuery({ queryKey: [...fiscalKey, 'sources', status], queryFn: () => api<FiscalSource[]>('/fiscal/sources', { query: { status } }) });
  const create = useMutation({
    mutationFn: ({ id, type }: { id: string; type: DocType }) => api<FiscalDocument>(`/fiscal/sources/${id}/document`, { method: 'POST', body: { type } }),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: fiscalKey });
      navigate(docPath(doc.id));
    },
    onError: (err) => {
      const existing = err instanceof ApiError ? (err.body as { documentId?: string } | undefined)?.documentId : undefined;
      if (existing) navigate(docPath(existing));
    },
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mostrar">
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="ready">Prontas para emitir</option>
              <option value="pending">Aguardando (ex.: atendimento não quitado)</option>
              <option value="cancelled">Canceladas na origem</option>
              <option value="all">Todas sem nota</option>
            </Select>
          )}
        </Field>
        <p className="pb-2 text-sm text-fg-muted">Vêm das vendas do caixa, dos atendimentos pagos da agenda e das ordens de serviço concluídas.</p>
      </div>
      <ErrorMessage error={create.error} />
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nada a emitir" description="Novas vendas, atendimentos pagos e ordens concluídas aparecem aqui." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Origem</Th>
                <Th>Cliente</Th>
                <Th>Data</Th>
                <Th className="text-right">Valor</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <span className="font-medium">{s.label}</span> <Badge>{sourceTypeLabel[s.sourceType]}</Badge>
                    {s.autoError && <p className="mt-1 max-w-md text-xs text-danger-700">Emissão automática não saiu: {s.autoError}</p>}
                    {s.document && (
                      <p className="mt-1 text-xs">
                        Última nota:{' '}
                        <Link className="text-brand-700 underline" to={docPath(s.document.id)}>
                          {docTypeShort[s.document.type]} {s.document.number ?? ''} ({docStatusLabel[s.document.status]})
                        </Link>
                      </p>
                    )}
                  </Td>
                  <Td>{s.customer?.name ?? <span className="text-fg-subtle">Não identificado</span>}</Td>
                  <Td className="text-sm">{formatDateTime(s.occurredAt)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.total)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {canIssue && s.status !== 'cancelled' && (
                      <>
                        {s.sourceType === 'sale' ? (
                          <>
                            <Button size="sm" loading={create.isPending} onClick={() => create.mutate({ id: s.id, type: 'nfce' })}>
                              Gerar NFC-e
                            </Button>{' '}
                            <Button size="sm" variant="secondary" loading={create.isPending} onClick={() => create.mutate({ id: s.id, type: 'nfe' })}>
                              NF-e
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" loading={create.isPending} onClick={() => create.mutate({ id: s.id, type: 'nfse' })}>
                            Gerar NFS-e
                          </Button>
                        )}
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Numbering() {
  const queryClient = useQueryClient();
  const canVoid = useCan('integration.fiscal.cancel');
  const gaps = useQuery({ queryKey: [...fiscalKey, 'gaps'], queryFn: () => api<{ type: DocType; series: string; numbers: number[] }[]>('/fiscal/gaps') });
  const voids = useQuery({ queryKey: [...fiscalKey, 'voids'], queryFn: () => api<VoidRecord[]>('/fiscal/voids') });
  const [form, setForm] = useState({ type: 'nfce' as 'nfce' | 'nfe', series: '1', from: '', to: '', reason: '' });
  const submit = useMutation({
    mutationFn: () => api<VoidRecord>('/fiscal/voids', { method: 'POST', body: { ...form, from: Number(form.from), to: Number(form.to || form.from) } }),
    onSuccess: () => {
      setForm({ ...form, from: '', to: '', reason: '' });
      queryClient.invalidateQueries({ queryKey: fiscalKey });
    },
  });
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-base font-semibold">Números pulados</h2>
        <p className="mb-3 text-sm text-fg-muted">NFC-e e NF-e não podem ter buracos na numeração: número que não virou nota autorizada precisa ser inutilizado na SEFAZ.</p>
        {gaps.isPending ? (
          <Spinner />
        ) : gaps.data?.length ? (
          <ul className="space-y-1 text-sm">
            {gaps.data.map((g) => (
              <li key={`${g.type}-${g.series}`}>
                <strong>{docTypeShort[g.type]}</strong> série {g.series}: {g.numbers.join(', ')}{' '}
                {canVoid && (
                  <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, type: g.type as 'nfce' | 'nfe', series: g.series, from: String(g.numbers[0]), to: String(g.numbers[0]) })}>
                    Inutilizar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-success-700">Nenhum número pulado.</p>
        )}
      </Card>
      {canVoid && (
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold">Inutilizar numeração</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Tipo">
              {(id) => (
                <Select id={id} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'nfce' | 'nfe' })}>
                  <option value="nfce">NFC-e</option>
                  <option value="nfe">NF-e</option>
                </Select>
              )}
            </Field>
            <Field label="Série">{(id) => <Input id={id} value={form.series} onChange={(e) => setForm({ ...form, series: e.target.value })} />}</Field>
            <Field label="Do número">{(id) => <Input id={id} inputMode="numeric" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />}</Field>
            <Field label="Até o número">{(id) => <Input id={id} inputMode="numeric" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />}</Field>
          </div>
          <Field label="Justificativa" hint="De 15 a 255 caracteres.">
            {(id) => <Textarea id={id} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
          </Field>
          <ErrorMessage error={submit.error} />
          <Button loading={submit.isPending} disabled={!form.from || form.reason.trim().length < 15} onClick={() => submit.mutate()}>
            Inutilizar
          </Button>
        </Card>
      )}
      <Card>
        {voids.data?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Tipo</Th>
                <Th>Faixa</Th>
                <Th>Justificativa</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {voids.data.map((v) => (
                <tr key={v.id}>
                  <Td className="text-sm">{formatDateTime(v.createdAt)}</Td>
                  <Td>
                    {docTypeShort[v.type]} série {v.series}
                  </Td>
                  <Td>{v.from === v.to ? v.from : `${v.from} a ${v.to}`}</Td>
                  <Td className="text-sm">{v.reason}</Td>
                  <Td>{v.status === 'authorized' ? <Badge tone="success">Homologada</Badge> : <Badge tone="danger">Recusada{v.message ? `: ${v.message}` : ''}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Nenhuma inutilização" />
        )}
      </Card>
    </div>
  );
}
