import { api, ApiError, formatDateTime, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatQuantity, salePaymentLabel, type Sale, type SalesSummary } from '../contracts';
import { brl, salesKey } from './hooks';

/** Vendas do período: fechamento (por forma de pagamento), mais vendidos e a lista, com cancelamento. */
export function SalesPage() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const summary = useQuery({ queryKey: [...salesKey, 'summary', from, to], queryFn: () => api<SalesSummary>('/sales/summary', { query: { from, to } }) });
  const list = useQuery({ queryKey: [...salesKey, 'list', from, to], queryFn: () => api<Sale[]>('/sales', { query: { from, to, limit: 200 } }) });
  const [open, setOpen] = useState<Sale | null>(null);

  return (
    <>
      <PageHeader
        title="Vendas"
        description="Fechamento do caixa e histórico de vendas."
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="De" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-fg-muted">a</span>
            <Input type="date" aria-label="Até" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        }
      />
      {summary.isError && <Alert>{summary.error.message}</Alert>}
      {summary.data && (
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-3">
            <Stat label="Vendido" value={brl(summary.data.total)} />
            <Stat label="Vendas" value={String(summary.data.count)} />
            <Stat label="Ticket médio" value={brl(summary.data.averageTicket)} />
          </div>
          <Card className="p-5">
            <h2 className="mb-3 font-medium">Por forma de pagamento</h2>
            {summary.data.byMethod.length === 0 ? (
              <p className="text-sm text-fg-muted">Sem vendas no período.</p>
            ) : (
              <Meters rows={summary.data.byMethod.map((m) => ({ key: m.method, label: salePaymentLabel[m.method], value: m.amount, text: brl(m.amount) }))} />
            )}
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h2 className="mb-3 font-medium">Mais vendidos</h2>
            {summary.data.topProducts.length === 0 ? (
              <p className="text-sm text-fg-muted">Sem vendas no período.</p>
            ) : (
              <Meters rows={summary.data.topProducts.map((p) => ({ key: p.productId, label: p.name, value: p.total, text: brl(p.total) }))} />
            )}
          </Card>
        </div>
      )}
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma venda no período" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Quando</Th>
                <Th>Cliente</Th>
                <Th>Pagamento</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(s)}>
                  <Td className="tabular-nums">#{s.number}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{formatDateTime(s.soldAt)}</Td>
                  <Td>{s.customer?.name ?? <span className="text-fg-subtle">—</span>}</Td>
                  <Td>{s.payments.map((p) => salePaymentLabel[p.method]).join(' + ')}</Td>
                  <Td className="text-right tabular-nums">
                    {s.status === 'cancelled' ? (
                      <>
                        <span className="text-fg-subtle line-through">{brl(s.total)}</span> <Badge>Cancelada</Badge>
                      </>
                    ) : (
                      brl(s.total)
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {open && <SaleModal sale={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-sm text-fg-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

/** Barras horizontais de uma série só (magnitude), com o valor escrito ao lado. */
function Meters({ rows }: { rows: { key: string; label: string; value: number; text: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0.01);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex justify-between gap-3">
            <span className="truncate">{r.label}</span>
            <span className="tabular-nums">{r.text}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SaleModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const queryClient = useQueryClient();
  const canCancel = useCan('shared.sales.cancel');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api(`/sales/${sale.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salesKey });
      onClose();
    },
  });
  return (
    <Modal
      open
      title={`Venda #${sale.number}`}
      onClose={onClose}
      footer={
        canCancel && sale.status === 'completed' ? (
          cancelling ? (
            <>
              <Button variant="secondary" onClick={() => setCancelling(false)}>
                Voltar
              </Button>
              <Button variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate()}>
                Confirmar cancelamento
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setCancelling(true)}>
              Cancelar venda
            </Button>
          )
        ) : undefined
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-fg-muted">
          {formatDateTime(sale.soldAt)}
          {sale.sellerName && ` · ${sale.sellerName}`}
          {sale.customer && ` · ${sale.customer.name}`}
          {Math.abs(Date.parse(sale.createdAt) - Date.parse(sale.soldAt)) > 3_600_000 && ` · lançada em ${formatDateTime(sale.createdAt)}`}
        </p>
        {sale.status === 'cancelled' && <Alert tone="info">Cancelada: {sale.cancelReason}</Alert>}
        <ul className="divide-y divide-line">
          {sale.items.map((i) => (
            <li key={i.productId} className="flex justify-between gap-3 py-1.5">
              <span>
                {i.name}
                <span className="text-fg-muted">
                  {' '}
                  · {formatQuantity(i.quantity, i.unit)} × {brl(i.unitPrice)}
                </span>
              </span>
              <span className="tabular-nums">{brl(i.total)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-line pt-2">
          {sale.discount > 0 && (
            <div className="flex justify-between">
              <span>Desconto</span>
              <span className="tabular-nums">-{brl(sale.discount)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span className="tabular-nums">{brl(sale.total)}</span>
          </div>
          {sale.payments.map((p) => (
            <div key={p.method} className="flex justify-between text-fg-muted">
              <span>{salePaymentLabel[p.method]}</span>
              <span className="tabular-nums">{brl(p.amount)}</span>
            </div>
          ))}
        </div>
        {cancelling && (
          <>
            {cancel.error && <Alert>{cancel.error instanceof ApiError ? cancel.error.message : 'Erro ao cancelar'}</Alert>}
            <p className="text-fg-muted">Os produtos voltam ao estoque e os lançamentos da venda são estornados no financeiro.</p>
            <Field label="Motivo">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
          </>
        )}
      </div>
    </Modal>
  );
}
