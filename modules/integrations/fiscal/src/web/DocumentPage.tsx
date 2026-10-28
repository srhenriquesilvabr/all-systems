import { api, apiDownload, formatDate, formatDateTime, formatMoney, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Field, PageHeader, Spinner, Table, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { docTypeLabel, docTypeShort, editableStatuses, formatNcm, paymentMethodLabel, sourceTypeLabel, type FiscalDocument } from '../contracts';
import { DocumentForm } from './DocumentForm';
import { docPath, EnvironmentBadge, ErrorMessage, fiscalKey, openFile, StatusBadge } from './shared';

type Panel = 'edit' | 'cancel' | 'correction' | null;

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const doc = useQuery({
    queryKey: [...fiscalKey, 'document', id],
    queryFn: () => api<FiscalDocument>(`/fiscal/documents/${id}`),
    // Enviada: acompanha a resposta do provedor sem precisar recarregar.
    refetchInterval: (q) => (q.state.data?.status === 'sending' ? 5000 : false),
  });
  const [panel, setPanel] = useState<Panel>(null);
  const can = { issue: useCan('integration.fiscal.issue'), cancel: useCan('integration.fiscal.cancel'), export: useCan('integration.fiscal.export') };
  const done = (d: FiscalDocument) => {
    queryClient.setQueryData([...fiscalKey, 'document', id], d);
    queryClient.invalidateQueries({ queryKey: fiscalKey });
    setPanel(null);
  };
  const issue = useMutation({ mutationFn: () => api<FiscalDocument>(`/fiscal/documents/${id}/issue`, { method: 'POST' }), onSuccess: done });
  const refresh = useMutation({ mutationFn: () => api<FiscalDocument>(`/fiscal/documents/${id}/refresh`, { method: 'POST' }), onSuccess: done });
  const discard = useMutation({ mutationFn: () => api<FiscalDocument>(`/fiscal/documents/${id}/discard`, { method: 'POST', body: {} }), onSuccess: done });
  const send = useMutation({ mutationFn: (channels: string[]) => api<FiscalDocument>(`/fiscal/documents/${id}/send`, { method: 'POST', body: { channels } }), onSuccess: done });
  const edit = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await api(`/fiscal/documents/${id}`, { method: 'PATCH', body });
      return api<FiscalDocument>(`/fiscal/documents/${id}/issue`, { method: 'POST' });
    },
    onSuccess: done,
  });
  const download = useMutation({
    mutationFn: async ({ kind, name, mime, sequence }: { kind: string; name: string; mime: string | null; sequence?: number }) =>
      kind.endsWith('pdf') ? openFile(`/fiscal/documents/${id}/files/${kind}${sequence ? `?sequence=${sequence}` : ''}`, name, mime) : apiDownload(`/fiscal/documents/${id}/files/${kind}`, name, { query: { sequence } }),
  });

  if (doc.isPending) return <Spinner />;
  if (doc.isError) return <Alert>{doc.error.message}</Alert>;
  const d = doc.data;
  const editable = editableStatuses.includes(d.status);
  const title = `${docTypeShort[d.type]}${d.number ? ` nº ${d.number}` : ''}${d.series ? ` · série ${d.series}` : ''}`;
  const fileName = (suffix: string, ext: string) => `${docTypeShort[d.type]}-${d.series ?? 0}-${d.number ?? 'rascunho'}${suffix}.${ext}`;
  const error = issue.error ?? refresh.error ?? discard.error ?? send.error ?? edit.error ?? download.error;

  return (
    <>
      <PageHeader
        title={title}
        description={`${docTypeLabel[d.type]} · ${d.sourceLabel ?? sourceTypeLabel[d.sourceType]}${d.issuedAt ? ` · emitida em ${formatDateTime(d.issuedAt)}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <EnvironmentBadge environment={d.environment} />
            {d.contingency && <Badge tone="warning">Contingência</Badge>}
            <StatusBadge status={d.status} />
          </div>
        }
      />
      <div className="space-y-4">
        <ErrorMessage error={error} />
        {d.environment === 'homologation' && <Alert tone="info">Ambiente de homologação: nota de teste, sem valor fiscal.</Alert>}
        {d.provider === 'simulated' && <Alert tone="info">Emitida pelo modo simulado (demonstração): XML e PDF são ilustrativos.</Alert>}

        {d.status === 'rejected' || d.status === 'denied' ? (
          <Alert>
            <p className="font-medium">{d.status === 'denied' ? 'Uso denegado' : 'Rejeitada'}{d.statusCode ? ` (${d.statusCode})` : ''}: {d.statusMessage}</p>
            {d.errors.length > 1 && (
              <ul className="mt-1 list-disc pl-5">
                {d.errors.map((e, n) => (
                  <li key={n}>
                    {e.code ? `${e.code}: ` : ''}
                    {e.message}
                  </li>
                ))}
              </ul>
            )}
            {d.status === 'rejected' && <p className="mt-1">Corrija os dados abaixo e reenvie: a nota segue com a mesma referência e o mesmo número.</p>}
          </Alert>
        ) : (
          d.status === 'sending' && <Alert tone="info">{d.statusMessage ?? 'Aguardando a resposta do provedor/SEFAZ/prefeitura. A página atualiza sozinha.'}</Alert>
        )}

        {editable && d.issues.length > 0 && (
          <Alert>
            <p className="font-medium">Antes de emitir, resolva:</p>
            <ul className="mt-1 list-disc pl-5">
              {d.issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
            <p className="mt-1">
              Códigos de produtos e serviços ficam no <Link className="underline" to="/fiscal/cadastro">cadastro fiscal</Link>; dados da empresa e provedor, em{' '}
              <Link className="underline" to="/configuracoes/fiscal">Configurações → Nota fiscal</Link>.
            </p>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {editable && can.issue && panel !== 'edit' && (
            <>
              <Button loading={issue.isPending} onClick={() => issue.mutate()} disabled={d.issues.length > 0}>
                {d.status === 'rejected' ? 'Reenviar' : 'Emitir nota'}
              </Button>
              <Button variant="secondary" onClick={() => setPanel('edit')}>
                {d.status === 'rejected' ? 'Corrigir e reenviar' : 'Editar'}
              </Button>
              <Button variant="ghost" loading={discard.isPending} onClick={() => confirm(d.number ? `Descartar? O nº ${d.number} vai precisar ser inutilizado.` : 'Descartar este rascunho?') && discard.mutate()}>
                Descartar
              </Button>
            </>
          )}
          {(d.status === 'sending' || d.status === 'authorized') && (can.issue || can.cancel) && (
            <Button variant="secondary" loading={refresh.isPending} onClick={() => refresh.mutate()}>
              Atualizar situação
            </Button>
          )}
          {can.export && d.files.pdf && (
            <Button variant="secondary" onClick={() => download.mutate({ kind: 'pdf', name: fileName('-danfe', d.files.pdfMime === 'text/html' ? 'html' : 'pdf'), mime: d.files.pdfMime })}>
              {d.type === 'nfse' ? 'DANFSe' : 'DANFE'}
            </Button>
          )}
          {can.export && d.files.xml && (
            <Button variant="secondary" onClick={() => download.mutate({ kind: 'xml', name: fileName('', 'xml'), mime: 'application/xml' })}>
              XML
            </Button>
          )}
          {can.export && d.files.cancelXml && (
            <Button variant="secondary" onClick={() => download.mutate({ kind: 'cancel-xml', name: fileName('-cancelamento', 'xml'), mime: 'application/xml' })}>
              XML do cancelamento
            </Button>
          )}
          {d.status === 'authorized' && can.issue && (
            <>
              <Button variant="ghost" loading={send.isPending} onClick={() => send.mutate(['email'])}>
                Enviar por e-mail
              </Button>
              <Button variant="ghost" loading={send.isPending} onClick={() => send.mutate(['whatsapp'])}>
                Enviar por WhatsApp
              </Button>
            </>
          )}
          {d.status === 'authorized' && can.cancel && (
            <>
              <Button variant="ghost" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')} disabled={!d.cancelUntil && d.type !== 'nfse'}>
                Cancelar nota
              </Button>
              {d.type === 'nfe' && (
                <Button variant="ghost" onClick={() => setPanel(panel === 'correction' ? null : 'correction')}>
                  Carta de correção
                </Button>
              )}
            </>
          )}
        </div>
        {d.status === 'authorized' && (
          <p className="text-sm text-fg-muted">{d.cancelUntil ? `Pode ser cancelada até ${formatDateTime(d.cancelUntil)}.` : d.type === 'nfse' ? 'Prazo de cancelamento conforme o município.' : 'Prazo de cancelamento encerrado.'}</p>
        )}

        {panel === 'edit' && (
          <DocumentForm
            initial={{
              type: d.type,
              customer: d.customer,
              recipient: d.customer ? null : d.recipient,
              items: d.items,
              payments: d.payments,
              nature: d.nature,
              additionalInfo: d.additionalInfo ?? '',
              serviceDate: d.serviceDate ?? '',
            }}
            allowTypeChange={false}
            submitLabel={d.status === 'rejected' ? 'Salvar e reenviar' : 'Salvar e emitir'}
            busy={edit.isPending}
            onSubmit={(body) => edit.mutate(body)}
            onCancel={() => setPanel(null)}
          />
        )}
        {panel === 'cancel' && <ReasonPanel title="Cancelar a nota" hint="Justificativa de 15 a 255 caracteres (vai para a SEFAZ/prefeitura)." min={15} max={255} action="Confirmar cancelamento" url={`/fiscal/documents/${id}/cancel`} field="reason" onDone={done} onClose={() => setPanel(null)} />}
        {panel === 'correction' && (
          <ReasonPanel
            title="Carta de correção"
            hint="De 15 a 1000 caracteres. Não corrige valores, impostos, remetente/destinatário nem a data de emissão — nesses casos, fale com o contador."
            min={15}
            max={1000}
            action="Enviar carta de correção"
            url={`/fiscal/documents/${id}/correction`}
            field="text"
            onDone={done}
            onClose={() => setPanel(null)}
          />
        )}

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <Card>
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Códigos</Th>
                    <Th className="text-right">Qtd.</Th>
                    <Th className="text-right">Preço</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i, n) => (
                    <tr key={n}>
                      <Td>{i.description}</Td>
                      <Td className="text-xs text-fg-muted">
                        {i.kind === 'product'
                          ? `NCM ${i.ncm ? formatNcm(i.ncm) : '—'} · CFOP ${i.cfop ?? '—'} · ${i.icmsSituation ?? '—'}`
                          : `LC 116 ${i.lc116 ?? '—'} · cTribNac ${i.nationalCode ?? '—'} · ISS ${i.issRate ?? '—'}%${i.issWithheld ? ' (retido)' : ''}`}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {i.quantity.toLocaleString('pt-BR')} {i.unit}
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(i.unitPrice)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(i.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="space-y-1 border-t border-line p-4 text-sm">
                {d.discount > 0 && <Line label="Descontos">{formatMoney(d.discount)}</Line>}
                <Line label="Total da nota">
                  <strong>{formatMoney(d.total)}</strong>
                </Line>
                {d.type === 'nfse' ? (
                  <Line label={`ISS${d.taxes.issWithheld ? ' (retido pelo tomador)' : ''}`}>{formatMoney(d.taxes.iss)}</Line>
                ) : (
                  <>
                    {d.taxes.icms > 0 && <Line label="ICMS">{formatMoney(d.taxes.icms)}</Line>}
                    {d.taxes.pis + d.taxes.cofins > 0 && <Line label="PIS + COFINS">{formatMoney(d.taxes.pis + d.taxes.cofins)}</Line>}
                  </>
                )}
                {Object.values(d.taxes.retentions).some((v) => v > 0) && <Line label="Retenções federais">{formatMoney(Object.values(d.taxes.retentions).reduce((a, b) => a + b, 0))}</Line>}
                {d.taxes.ibs + d.taxes.cbs > 0 && <Line label="IBS / CBS (informativo)">{`${formatMoney(d.taxes.ibs)} / ${formatMoney(d.taxes.cbs)}`}</Line>}
                {d.taxes.approximate > 0 && <Line label="Tributos aproximados">{formatMoney(d.taxes.approximate)}</Line>}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Histórico</h2>
              <ol className="space-y-2 text-sm">
                {d.events.map((e, n) => (
                  <li key={n} className="flex gap-3">
                    <span className="w-32 shrink-0 text-fg-subtle">{formatDateTime(e.at)}</span>
                    <span>
                      {e.message ?? e.kind}
                      <span className="text-fg-subtle"> · {e.userName ?? (e.source === 'webhook' ? 'aviso do provedor' : e.source === 'poll' ? 'consulta automática' : e.source === 'auto' ? 'automático' : e.source === 'public' ? 'link do cliente' : 'sistema')}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="space-y-1 p-4 text-sm">
              <h2 className="mb-1 text-sm font-semibold">Dados da nota</h2>
              {d.accessKey && <Line label="Chave">{<span className="break-all font-mono text-xs">{d.accessKey}</span>}</Line>}
              {d.protocol && <Line label="Protocolo">{d.protocol}</Line>}
              {d.verificationCode && <Line label="Código de verificação">{d.verificationCode}</Line>}
              {d.authorizedAt && <Line label="Autorizada em">{formatDateTime(d.authorizedAt)}</Line>}
              {d.cancelledAt && <Line label="Cancelada em">{`${formatDateTime(d.cancelledAt)}: ${d.cancelReason ?? ''}`}</Line>}
              {d.serviceDate && d.type === 'nfse' && <Line label="Prestação">{formatDate(d.serviceDate)}</Line>}
              <Line label="Natureza">{d.nature}</Line>
              <Line label="Referência">{<span className="font-mono text-xs">{d.reference}</span>}</Line>
              {d.consultUrl && (
                <a className="text-brand-700 underline" href={d.consultUrl} target="_blank" rel="noreferrer">
                  Consultar no portal
                </a>
              )}
            </Card>
            <Card className="space-y-1 p-4 text-sm">
              <h2 className="mb-1 text-sm font-semibold">{d.type === 'nfse' ? 'Tomador' : 'Destinatário'}</h2>
              {d.recipient ? (
                <>
                  <p>{d.recipient.name}</p>
                  {d.recipient.document && <p className="text-fg-muted">{d.recipient.document}</p>}
                  {d.recipient.email && <p className="text-fg-muted">{d.recipient.email}</p>}
                  {d.recipient.address?.city && <p className="text-fg-muted">{[d.recipient.address.street, d.recipient.address.number, d.recipient.address.city, d.recipient.address.state].filter(Boolean).join(', ')}</p>}
                </>
              ) : (
                <p className="text-fg-muted">Consumidor não identificado</p>
              )}
              {d.customer && (
                <Link className="text-brand-700 underline" to={`/clientes/${d.customer.id}`}>
                  Ficha do cliente
                </Link>
              )}
            </Card>
            {d.payments.length > 0 && (
              <Card className="space-y-1 p-4 text-sm">
                <h2 className="mb-1 text-sm font-semibold">Pagamento</h2>
                {d.payments.map((p, n) => (
                  <Line key={n} label={paymentMethodLabel[p.method]}>
                    {formatMoney(p.amount)}
                  </Line>
                ))}
              </Card>
            )}
            {d.corrections.length > 0 && (
              <Card className="space-y-2 p-4 text-sm">
                <h2 className="text-sm font-semibold">Cartas de correção</h2>
                {d.corrections.map((c) => (
                  <div key={c.sequence}>
                    <p>
                      nº {c.sequence} · {formatDateTime(c.at)}
                    </p>
                    <p className="text-fg-muted">{c.text}</p>
                    {can.export && c.hasPdf && (
                      <Button size="sm" variant="ghost" onClick={() => download.mutate({ kind: 'correction-pdf', name: fileName(`-cce${c.sequence}`, 'pdf'), mime: 'application/pdf', sequence: c.sequence })}>
                        PDF
                      </Button>
                    )}
                    {can.export && c.hasXml && (
                      <Button size="sm" variant="ghost" onClick={() => download.mutate({ kind: 'correction-xml', name: fileName(`-cce${c.sequence}`, 'xml'), mime: 'application/xml', sequence: c.sequence })}>
                        XML
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            )}
            {d.delivery.length > 0 && (
              <Card className="space-y-1 p-4 text-sm">
                <h2 className="mb-1 text-sm font-semibold">Envio ao cliente</h2>
                {d.delivery.map((x, n) => (
                  <p key={n}>
                    {x.channel === 'email' ? 'E-mail' : 'WhatsApp'} para {x.to} · {formatDateTime(x.at)}{' '}
                    {x.actionUrl && (
                      <a className="text-brand-700 underline" href={x.actionUrl} target="_blank" rel="noreferrer">
                        abrir no WhatsApp
                      </a>
                    )}
                  </p>
                ))}
              </Card>
            )}
            <p className="text-xs text-fg-muted">
              <Link className="underline" to={docPath(d.id)}>
                Link desta nota
              </Link>{' '}
              · XML e DANFE ficam guardados por 5 anos.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="flex justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right">{children}</span>
    </p>
  );
}

function ReasonPanel({ title, hint, min, max, action, url, field, onDone, onClose }: {
  title: string;
  hint: string;
  min: number;
  max: number;
  action: string;
  url: string;
  field: string;
  onDone: (d: FiscalDocument) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const submit = useMutation({ mutationFn: () => api<FiscalDocument>(url, { method: 'POST', body: { [field]: text } }), onSuccess: onDone });
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <Field label="Texto" hint={`${hint} (${text.trim().length}/${max})`}>
        {(id) => <Textarea id={id} value={text} maxLength={max} onChange={(e) => setText(e.target.value)} autoFocus />}
      </Field>
      <ErrorMessage error={submit.error} />
      <div className="flex gap-2">
        <Button loading={submit.isPending} disabled={text.trim().length < min} onClick={() => submit.mutate()}>
          {action}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Voltar
        </Button>
      </div>
    </Card>
  );
}
