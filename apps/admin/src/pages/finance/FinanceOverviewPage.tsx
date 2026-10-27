import { api, formatMoney } from '@all/module-sdk/web';
import { Alert, Card, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { MonthlyChart } from './MonthlyChart';
import { accountTypeLabel, financeKey, monthLabel, periodRange, periods, useAccounts } from './shared';

interface Summary {
  realized: { income: number; expense: number };
  projected: { income: number; expense: number };
  overdue: { receivable: { total: number; count: number }; payable: { total: number; count: number } };
  months: { month: string; realizedIncome: number; realizedExpense: number; projectedIncome: number; projectedExpense: number }[];
  categories: { name: string; kind: 'income' | 'expense'; total: number }[];
}

export function FinanceOverviewPage() {
  const [periodKey, setPeriodKey] = useState<(typeof periods)[number]['key']>('6m');
  const range = periodRange(periods.find((p) => p.key === periodKey)!.months);
  const summary = useQuery({
    queryKey: [...financeKey, 'summary', range],
    queryFn: () => api<Summary>('/finance/summary', { query: range }),
    placeholderData: keepPreviousData,
  });
  const accounts = useAccounts();

  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Realizado = dinheiro que entrou ou saiu. Previsto = lançamentos em aberto com vencimento no período."
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

      {summary.isPending ? (
        <Spinner />
      ) : summary.isError ? (
        <Alert>{summary.error.message}</Alert>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Recebido" value={summary.data.realized.income} />
            <Stat label="Pago" value={summary.data.realized.expense} />
            <Stat label="Resultado" value={summary.data.realized.income - summary.data.realized.expense} emphasis />
            <Stat
              label="Vencidos"
              value={summary.data.overdue.receivable.total}
              detail={`a receber · ${formatMoney(summary.data.overdue.payable.total)} a pagar`}
              link={summary.data.overdue.receivable.count + summary.data.overdue.payable.count > 0 ? '/financeiro/lancamentos?status=overdue' : undefined}
            />
          </div>

          <Card className="p-5">
            <h2 className="mb-4 font-medium">Realizado por mês</h2>
            <MonthlyChart data={summary.data.months.map((m) => ({ month: m.month, income: m.realizedIncome, expense: m.realizedExpense }))} />
          </Card>

          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Mês</Th>
                  <Th className="text-right">Recebido</Th>
                  <Th className="text-right">Pago</Th>
                  <Th className="text-right">Resultado</Th>
                  <Th className="text-right">A receber</Th>
                  <Th className="text-right">A pagar</Th>
                </tr>
              </thead>
              <tbody>
                {summary.data.months.map((m) => (
                  <tr key={m.month}>
                    <Td className="first-letter:uppercase">{monthLabel(m.month)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(m.realizedIncome)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(m.realizedExpense)}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatMoney(m.realizedIncome - m.realizedExpense)}</Td>
                    <Td className="text-right tabular-nums text-fg-muted">{formatMoney(m.projectedIncome)}</Td>
                    <Td className="text-right tabular-nums text-fg-muted">{formatMoney(m.projectedExpense)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-3 font-medium">Por categoria (realizado)</h2>
              {summary.data.categories.length === 0 ? (
                <p className="text-sm text-fg-muted">Nenhum valor realizado no período.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {summary.data.categories.map((c) => (
                    <li key={`${c.kind}:${c.name}`} className="flex justify-between gap-2">
                      <span>
                        {c.name} <span className="text-fg-subtle">· {c.kind === 'income' ? 'receita' : 'despesa'}</span>
                      </span>
                      <span className="tabular-nums">{formatMoney(c.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 font-medium">Saldo das contas</h2>
              {accounts.data && (
                <ul className="space-y-1.5 text-sm">
                  {accounts.data
                    .filter((a) => a.active)
                    .map((a) => (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span>
                          {a.name} <span className="text-fg-subtle">· {accountTypeLabel[a.type]}</span>
                        </span>
                        <span className="font-medium tabular-nums">{formatMoney(a.balance)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, detail, emphasis, link }: { label: string; value: number; detail?: string; emphasis?: boolean; link?: string }) {
  const content = (
    <Card className="h-full p-5">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className={`mt-1 tabular-nums ${emphasis ? 'text-2xl font-semibold' : 'text-xl font-medium'}`}>{formatMoney(value)}</p>
      {detail && <p className="mt-1 text-xs text-fg-muted">{detail}</p>}
    </Card>
  );
  return link ? (
    <Link to={link} className="block hover:opacity-90">
      {content}
    </Link>
  ) : (
    content
  );
}
