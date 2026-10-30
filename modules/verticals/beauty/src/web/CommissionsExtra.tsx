import { api, ApiError, formatDate, formatMoney, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CommissionPayout, CommissionReport, MyCommission } from '../contracts';

export const periods = [
  { key: 'month', label: 'Este mês' },
  { key: 'last', label: 'Mês passado' },
  { key: '15d', label: 'Últimos 15 dias' },
] as const;
export type PeriodKey = (typeof periods)[number]['key'];

export function rangeOf(key: PeriodKey) {
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (key === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today() };
  if (key === 'last') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14)), to: today() };
}

export function PeriodSelect({ value, onChange }: { value: PeriodKey; onChange: (v: PeriodKey) => void }) {
  return (
    <Select aria-label="Período" value={value} onChange={(e) => onChange(e.target.value as PeriodKey)}>
      {periods.map((p) => (
        <option key={p.key} value={p.key}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Lança no financeiro, como despesa a pagar, o que ainda não foi lançado do período. Fica na própria
 * página. O servidor só pega linhas sem lançamento, então repetir o período não duplica.
 */
export function PayoutsCard({ range, report }: { range: { from: string; to: string }; report: CommissionReport | undefined }) {
  const queryClient = useQueryClient();
  const canManage = useCan('beauty.commissions.manage');
  const payouts = useQuery({ queryKey: ['beauty', 'payouts', range], queryFn: () => api<CommissionPayout[]>('/beauty/commissions/payouts', { query: range }) });
  const [launching, setLaunching] = useState(false);
  const [dueDate, setDueDate] = useState(today());
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['beauty'] });
  const launch = useMutation({
    mutationFn: () => api('/beauty/commissions/payouts', { method: 'POST', body: { ...range, dueDate } }),
    onSuccess: () => {
      setLaunching(false);
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/beauty/commissions/payouts/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      setCancelling(null);
      setReason('');
      refresh();
    },
  });
  const toLaunch = report?.professionals.reduce((sum, p) => sum + p.toLaunch, 0) ?? 0;
  const error = launch.error ?? cancel.error;

  return (
    <Card className="mt-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">Lançamentos no financeiro</h2>
          <p className="text-sm text-fg-muted">
            A lançar neste período: <span className="font-medium tabular-nums text-fg">{formatMoney(toLaunch)}</span>
          </p>
        </div>
        {canManage && toLaunch > 0 && !launching && (
          <Button size="sm" onClick={() => setLaunching(true)}>
            Lançar no financeiro
          </Button>
        )}
      </div>
      {error && <Alert>{error instanceof ApiError ? error.message : 'Erro ao lançar'}</Alert>}
      {launching && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
          <Field label="Vencimento">{(id) => <Input id={id} type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
          <Button size="sm" loading={launch.isPending} disabled={!dueDate} onClick={() => launch.mutate()}>
            Lançar {formatMoney(toLaunch)}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLaunching(false)}>
            Voltar
          </Button>
          <p className="w-full text-xs text-fg-muted">Uma despesa a pagar por profissional. Só entra o que ainda não foi lançado.</p>
        </div>
      )}
      {payouts.isError ? (
        <Alert>{payouts.error.message}</Alert>
      ) : (
        !!payouts.data?.length && (
          <ul className="divide-y divide-line text-sm">
            {payouts.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{p.resourceName}</span>
                  <span className="text-fg-muted">
                    {' '}
                    · {formatDate(p.from)} a {formatDate(p.to)} · vence {formatDate(p.dueDate)}
                  </span>
                  {p.cancelReason && <span className="block text-xs text-fg-muted">Motivo: {p.cancelReason}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(p.amount)}</span>
                  {p.status === 'cancelled' ? <Badge>Cancelado</Badge> : p.paid ? <Badge tone="success">Pago</Badge> : <Badge tone="warning">A pagar</Badge>}
                  {canManage && p.status === 'open' && !p.paid && cancelling !== p.id && (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(p.id)}>
                      Cancelar
                    </Button>
                  )}
                </span>
                {cancelling === p.id && (
                  <div className="flex w-full flex-wrap items-end gap-2">
                    <Field label="Motivo do cancelamento">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
                    <Button size="sm" variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate(p.id)}>
                      Cancelar lançamento
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(null)}>
                      Voltar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </Card>
  );
}

/** Visão do próprio profissional: só os atendimentos dele, com o percentual gravado em cada um. */
export function MyCommissionPage() {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('month');
  const range = rangeOf(periodKey);
  const mine = useQuery({
    queryKey: ['beauty', 'mine', range],
    queryFn: () => api<MyCommission>('/beauty/commissions/mine', { query: range }),
    placeholderData: keepPreviousData,
  });
  const summary = mine.data?.professionals ?? [];
  const lines = summary.flatMap((p) => p.lines);
  const total = summary.reduce((sum, p) => sum + p.commission, 0);
  return (
    <>
      <PageHeader title="Minha comissão" description="Sobre os seus atendimentos concluídos no período." actions={<PeriodSelect value={periodKey} onChange={setPeriodKey} />} />
      <Card>
        {mine.isPending ? (
          <Spinner />
        ) : mine.isError ? (
          <div className="p-4">
            <Alert>{mine.error.message}</Alert>
          </div>
        ) : !mine.data.linked ? (
          <EmptyState title="Seu acesso não está ligado a um profissional da agenda" description="Peça a quem configura a agenda para ligar o seu usuário ao seu cadastro de profissional." />
        ) : lines.length === 0 ? (
          <EmptyState title="Nenhum atendimento concluído no período" />
        ) : (
          <>
            <p className="p-4 text-sm">
              Comissão no período: <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Dia</Th>
                  <Th>Cliente</Th>
                  <Th>Serviço</Th>
                  <Th className="text-right">%</Th>
                  <Th className="text-right">Comissão</Th>
                  <Th>Financeiro</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <Td className="tabular-nums">{formatDate(l.date)}</Td>
                    <Td>{l.customer}</Td>
                    <Td>
                      {l.service} <span className="text-fg-muted">({formatMoney(l.price)})</span>
                    </Td>
                    <Td className="text-right tabular-nums">{l.rate.toLocaleString('pt-BR')}%</Td>
                    <Td className="text-right tabular-nums">{formatMoney(l.commission)}</Td>
                    <Td>{l.launched ? <Badge tone="success">Lançada</Badge> : <span className="text-fg-subtle">A lançar</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Card>
    </>
  );
}
