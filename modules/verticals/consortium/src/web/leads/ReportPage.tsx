import { api, formatMoney } from '@all/module-sdk/web';
import { Alert, Card, Input, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ConversionRow, LeadsReport } from '../../contracts';
import { leadsKey } from './common';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Conversão dos leads criados no período: por origem, por vendedor e por campanha. */
export function LeadsReportPage() {
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today());
  const report = useQuery({ queryKey: [...leadsKey, 'report', from, to], queryFn: () => api<LeadsReport>('/consortium/leads-report', { query: { from, to } }), enabled: !!from && !!to && from <= to });
  return (
    <>
      <PageHeader title="Conversão de leads" description="Dos leads recebidos no período: quantos foram atendidos, viraram proposta e venda (cota aceita), e o crédito vendido." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input aria-label="De" type="date" className="max-w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input aria-label="Até" type="date" className="max-w-44" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <Alert>{report.error.message}</Alert>
      ) : (
        <div className="space-y-6">
          <Card className="flex flex-wrap gap-8 p-5">
            <Stat label="Leads" value={report.data.totals.total} />
            <Stat label="Atendidos" value={report.data.totals.contacted} />
            <Stat label="Propostas" value={report.data.totals.proposals} />
            <Stat label="Vendas" value={report.data.totals.won} />
            <Stat label="Conversão" value={`${report.data.totals.conversion.toLocaleString('pt-BR')}%`} />
            <Stat label="Crédito vendido" value={formatMoney(report.data.totals.wonCredit)} />
          </Card>
          <Section title="Por origem" rows={report.data.bySource} />
          <Section title="Por vendedor" rows={report.data.bySeller} />
          <Section title="Por campanha" rows={report.data.byCampaign} />
          {report.data.lostReasons.length > 0 && (
            <Card className="p-5 text-sm">
              <h2 className="mb-2 font-medium">Motivos de perda</h2>
              <ul className="space-y-1">
                {report.data.lostReasons.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-4">
                    <span>{r.reason}</span>
                    <span className="tabular-nums">{r.count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: ConversionRow[] }) {
  return (
    <div>
      <h2 className="mb-2 font-medium">{title}</h2>
      <Card>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-fg-muted">Nenhum lead no período.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th />
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Atendidos</Th>
                <Th className="text-right">Propostas</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">Perdidos</Th>
                <Th className="text-right">Conversão</Th>
                <Th className="text-right">Crédito vendido</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <Td>{r.label}</Td>
                  <Td className="text-right tabular-nums">{r.total}</Td>
                  <Td className="text-right tabular-nums">{r.contacted}</Td>
                  <Td className="text-right tabular-nums">{r.proposals}</Td>
                  <Td className="text-right tabular-nums">{r.won}</Td>
                  <Td className="text-right tabular-nums">{r.lost}</Td>
                  <Td className="text-right tabular-nums">{r.conversion.toLocaleString('pt-BR')}%</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.wonCredit)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
