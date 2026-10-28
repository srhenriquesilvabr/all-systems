import { api, apiDownload, formatMoney } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { docStatusLabel, docTypeLabel, docTypeShort, docTypes, type FiscalReport } from '../contracts';
import { ErrorMessage, fiscalKey } from './shared';

function lastMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(first), to: iso(last) };
}

/** Para o contador: totais do período (por tipo e situação), planilha e XMLs em lote. */
export function ReportsPage() {
  const [period, setPeriod] = useState({ ...lastMonth(), type: '', environment: '' });
  const query = { from: period.from, to: period.to, type: period.type || undefined, environment: period.environment || undefined };
  const report = useQuery({ queryKey: [...fiscalKey, 'report', period], queryFn: () => api<FiscalReport>('/fiscal/reports/summary', { query }), enabled: !!period.from && !!period.to });
  const csv = useMutation({ mutationFn: () => apiDownload('/fiscal/reports/spreadsheet', `notas-fiscais-${period.from}-a-${period.to}.csv`, { query }) });
  const zip = useMutation({ mutationFn: () => apiDownload('/fiscal/reports/xml-zip', `notas-fiscais-${period.from}-a-${period.to}.zip`, { query }) });
  const t = report.data?.totals;

  return (
    <>
      <PageHeader
        title="Relatórios fiscais"
        description="Notas por período com os impostos destacados, a planilha e os XMLs para o contador. Os valores são os informados nas notas; a apuração é do contador."
        actions={
          <>
            <Button variant="secondary" loading={csv.isPending} onClick={() => csv.mutate()}>
              Planilha (CSV)
            </Button>
            <Button loading={zip.isPending} onClick={() => zip.mutate()}>
              XMLs (ZIP)
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <ErrorMessage error={csv.error ?? zip.error} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="De">{(id) => <Input id={id} type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />}</Field>
          <Field label="Até">{(id) => <Input id={id} type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />}</Field>
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={period.type} onChange={(e) => setPeriod({ ...period, type: e.target.value })}>
                <option value="">Todos</option>
                {docTypes.map((d) => (
                  <option key={d} value={d}>
                    {docTypeLabel[d]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Ambiente">
            {(id) => (
              <Select id={id} value={period.environment} onChange={(e) => setPeriod({ ...period, environment: e.target.value })}>
                <option value="">O atual</option>
                <option value="production">Produção</option>
                <option value="homologation">Homologação</option>
              </Select>
            )}
          </Field>
        </div>

        {report.isPending ? (
          <Spinner />
        ) : report.isError ? (
          <Alert>{report.error.message}</Alert>
        ) : (
          <>
            {t && (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Notas autorizadas" value={String(t.count)} />
                <Stat label="Valor autorizado" value={formatMoney(t.total)} />
                <Stat label="ISS (retido)" value={`${formatMoney(t.iss)} (${formatMoney(t.issWithheld)})`} />
                <Stat label="ICMS" value={formatMoney(t.icms)} />
                <Stat label="PIS + COFINS" value={formatMoney(t.pis + t.cofins)} />
                <Stat label="IBS / CBS" value={`${formatMoney(t.ibs)} / ${formatMoney(t.cbs)}`} />
              </div>
            )}
            <Card>
              {report.data.rows.length === 0 ? (
                <EmptyState title="Nenhuma nota no período" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Tipo</Th>
                      <Th>Situação</Th>
                      <Th className="text-right">Notas</Th>
                      <Th className="text-right">Valor</Th>
                      <Th className="text-right">ISS</Th>
                      <Th className="text-right">ICMS</Th>
                      <Th className="text-right">PIS/COFINS</Th>
                      <Th className="text-right">Retenções</Th>
                      <Th className="text-right">IBS/CBS</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.rows.map((r) => (
                      <tr key={`${r.type}-${r.status}`}>
                        <Td>{docTypeShort[r.type]}</Td>
                        <Td>{docStatusLabel[r.status]}</Td>
                        <Td className="text-right tabular-nums">{r.count}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.total)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.iss)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.icms)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.pis + r.cofins)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.retentions)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.ibs + r.cbs)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            {report.data.gaps.length > 0 && (
              <Alert>
                Números pulados (inutilize em Notas fiscais → Numeração):{' '}
                {report.data.gaps.map((g) => `${docTypeShort[g.type]} série ${g.series}: ${g.numbers.join(', ')}`).join('; ')}
              </Alert>
            )}
            <p className="text-xs text-fg-muted">Canceladas aparecem na lista, mas não somam nos totais. O ZIP traz o XML de cada nota (e o do cancelamento) e a planilha.</p>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </Card>
  );
}
