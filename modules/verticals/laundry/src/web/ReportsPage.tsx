import { api, formatDateTime, formatMoney, today } from '@all/module-sdk/web';
import { Alert, Card, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatServiceQuantity, type LaundryReport } from '../contracts';

const periods = [
  { key: 'today', label: 'Hoje', days: 0 },
  { key: '7d', label: 'Últimos 7 dias', days: 6 },
  { key: '30d', label: 'Últimos 30 dias', days: 29 },
  { key: '90d', label: 'Últimos 90 dias', days: 89 },
] as const;

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function LaundryReportsPage() {
  const [periodKey, setPeriodKey] = useState<(typeof periods)[number]['key']>('7d');
  const range = { from: daysAgo(periods.find((p) => p.key === periodKey)!.days), to: today() };
  const report = useQuery({
    queryKey: ['laundry', 'reports', range],
    queryFn: () => api<LaundryReport>('/laundry/reports', { query: range }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Relatórios da lavanderia"
        description="Prazo, produção e qualidade."
        actions={
          <Select aria-label="Período" value={periodKey} onChange={(e) => setPeriodKey(e.target.value as typeof periodKey)}>
            {periods.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        }
      />
      {report.isPending ? (
        <Spinner />
      ) : report.isError ? (
        <Alert>{report.error.message}</Alert>
      ) : (
        <Report r={report.data} />
      )}
    </>
  );
}

function Report({ r }: { r: LaundryReport }) {
  const onTimePct = r.delivered.withDueDate ? Math.round((r.delivered.onTime / r.delivered.withDueDate) * 100) : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Entregues no prazo" value={onTimePct === null ? '—' : `${onTimePct}%`} detail={`${r.delivered.onTime} de ${r.delivered.withDueDate} com previsão`} />
        <Stat label="Ordens entregues" value={String(r.delivered.total)} detail={r.delivered.avgHours === null ? undefined : `${r.delivered.avgHours.toLocaleString('pt-BR')} h em média`} />
        <Stat label="Peças prontas" value={String(r.piecesReady)} />
        <Stat label="Retrabalhos" value={String(r.reworks)} />
        <Stat label="Ocorrências" value={String(r.incidents)} />
      </div>

      <Card>
        <h2 className="px-4 pt-4 font-medium">Ordens atrasadas agora</h2>
        {r.overdueOpen.length === 0 ? (
          <EmptyState title="Nenhuma ordem atrasada" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ordem</Th>
                <Th>Cliente</Th>
                <Th>Status</Th>
                <Th>Previsão</Th>
              </tr>
            </thead>
            <tbody>
              {r.overdueOpen.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link to={`/lavanderia/ordens/${o.id}`} className="font-medium text-brand-700 hover:underline">
                      nº {o.number}
                    </Link>
                  </Td>
                  <Td>{o.customerName}</Td>
                  <Td>{o.status}</Td>
                  <Td className="font-medium text-danger-700">{formatDateTime(o.dueAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="px-4 pt-4 font-medium">Valor contratado por serviço</h2>
          <p className="px-4 text-xs text-fg-muted">Soma dos itens das ordens abertas no período, exceto canceladas, antes do desconto da ordem. Não é o que entrou no caixa: para isso, use o Financeiro.</p>
          {r.byService.length === 0 ? (
            <EmptyState title="Nenhuma ordem no período" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Serviço</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th className="text-right">Contratado</Th>
                </tr>
              </thead>
              <tbody>
                {r.byService.map((s) => (
                  <tr key={`${s.serviceName}-${s.unit}`}>
                    <Td>{s.serviceName}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{formatServiceQuantity(s.quantity, s.unit)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(s.contracted)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <h2 className="px-4 pt-4 font-medium">Movimentações por pessoa</h2>
          <p className="px-4 text-xs text-fg-muted">Peças movidas entre etapas no período.</p>
          {r.byOperator.length === 0 ? (
            <EmptyState title="Nenhuma movimentação no período" />
          ) : (
            <Table>
              <tbody>
                {r.byOperator.map((o) => (
                  <tr key={o.userName}>
                    <Td>{o.userName}</Td>
                    <Td className="text-right tabular-nums">{o.moves}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-fg-muted">{detail}</p>}
    </Card>
  );
}
