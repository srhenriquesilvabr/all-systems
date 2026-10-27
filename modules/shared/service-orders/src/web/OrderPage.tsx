import { api, ApiError, formatDate, formatDateTime, formatMoney, parseMoney, today, useCan, formatPhone, PixCharge } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { paymentMethodLabel, paymentMethods, type OrderDetail, type PaymentMethod, type ServiceOrderWorkflow } from '../contracts';
import { orderPath, ordersKey, PaymentBadge, StatusBadge, useWorkflows } from './shared';

export function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const workflows = useWorkflows();
  const order = useQuery({ queryKey: [...ordersKey, id], queryFn: () => api<OrderDetail>(`/service-orders/${id}`) });
  const [paying, setPaying] = useState(false);
  const canPay = useCan('shared.service-orders.payments');

  if (order.isPending) return <Spinner />;
  if (order.isError) return <Alert>{order.error.message}</Alert>;
  const o = order.data;
  const workflow = workflows.data?.find((w) => w.key === o.workflow);
  // Ordens de vertical com tela própria (ex.: lavanderia) abrem lá.
  if (workflow?.detailPath) return <Navigate to={orderPath(workflows.data, o)} replace />;
  const balance = Math.round((o.total - o.paidAmount) * 100) / 100;
  const cancelled = workflow?.statuses.find((s) => s.key === o.status)?.cancelled;

  return (
    <>
      <PageHeader
        title={`Ordem nº ${o.number}`}
        description={`Aberta em ${formatDateTime(o.createdAt)}${o.dueAt ? ` · previsão ${formatDateTime(o.dueAt)}` : ''}`}
        actions={<StatusBadge workflows={workflows.data} workflow={o.workflow} status={o.status} />}
      />

      {workflow && (
        <div className="mb-4">
          <Transitions order={o} workflow={workflow} />
        </div>
      )}
      {o.cancelReason && (
        <div className="mb-4">
          <Alert>Cancelada: {o.cancelReason}</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th className="text-right">Qtd.</Th>
                  <Th className="text-right">Preço</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.description}</Td>
                    <Td className="text-right tabular-nums">{i.quantity.toLocaleString('pt-BR')}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(i.unitPrice)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(i.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="space-y-1 px-4 py-3 text-right text-sm">
              {o.discount > 0 && (
                <>
                  <div className="text-fg-muted">Subtotal {formatMoney(o.subtotal)}</div>
                  <div className="text-fg-muted">Desconto −{formatMoney(o.discount)}</div>
                </>
              )}
              <div className="text-lg font-semibold">Total {formatMoney(o.total)}</div>
            </dl>
          </Card>

          {(o.notesCustomer || o.notesInternal) && (
            <Card className="space-y-3 p-5 text-sm">
              {o.notesCustomer && (
                <div>
                  <p className="font-medium">Observações para o cliente</p>
                  <p className="whitespace-pre-line text-fg-muted">{o.notesCustomer}</p>
                </div>
              )}
              {o.notesInternal && (
                <div>
                  <p className="font-medium">Observações internas</p>
                  <p className="whitespace-pre-line text-fg-muted">{o.notesInternal}</p>
                </div>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 font-medium">Histórico</h2>
            <ol className="space-y-2 text-sm">
              {o.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="tabular-nums text-fg-muted">{formatDateTime(h.createdAt)}</span>
                  <StatusBadge workflows={workflows.data} workflow={o.workflow} status={h.to} />
                  {h.userName && <span className="text-fg-muted">por {h.userName}</span>}
                  {h.reason && <span className="text-fg-muted">— {h.reason}</span>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-2 font-medium">Cliente</h2>
            <Link to={`/clientes/${o.customer.id}`} className="font-medium text-brand-700 hover:underline">
              {o.customer.name}
            </Link>
            <p className="text-sm text-fg-muted">{[formatPhone(o.customer.phone), o.customer.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}</p>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Pagamento</h2>
              <PaymentBadge status={o.paymentStatus} />
            </div>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-fg-muted">Pago</dt>
              <dd className="text-right tabular-nums">{formatMoney(o.paidAmount)}</dd>
              <dt className="text-fg-muted">Em aberto</dt>
              <dd className="text-right font-medium tabular-nums">{formatMoney(balance)}</dd>
            </dl>
            {o.payments.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="text-fg-muted">
                      {formatDate(p.paidAt)} · {paymentMethodLabel[p.method]}
                    </span>
                    <span className="tabular-nums">{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {balance > 0 && !cancelled && canPay && (
              <Button className="mt-4 w-full" onClick={() => setPaying(true)}>
                Registrar pagamento
              </Button>
            )}
          </Card>
        </div>
      </div>

      {paying && <PaymentModal order={o} balance={balance} onClose={() => setPaying(false)} />}
    </>
  );
}

/** Botões de mudança de status. `hide`: status que a vertical muda sozinha (não aparecem como botão). */
export function Transitions({
  order,
  workflow,
  onChanged,
  hide = [],
}: {
  order: OrderDetail;
  workflow: ServiceOrderWorkflow;
  onChanged?: () => void;
  hide?: string[];
}) {
  const canChange = useCan('shared.service-orders.status');
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const move = useMutation({
    mutationFn: (body: { to: string; reason?: string }) => api<OrderDetail>(`/service-orders/${order.id}/transition`, { method: 'POST', body }),
    onSuccess: (updated) => {
      queryClient.setQueryData([...ordersKey, order.id], updated);
      queryClient.invalidateQueries({ queryKey: ordersKey });
      setCancelling(null);
      onChanged?.();
    },
  });

  const targets = (workflow.transitions[order.status] ?? [])
    .filter((key) => !hide.includes(key))
    .map((key) => workflow.statuses.find((s) => s.key === key)!);
  if (!canChange || targets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {move.error && !cancelling && <Alert>{move.error instanceof ApiError ? move.error.message : 'Erro ao mudar o status'}</Alert>}
      {targets.map((s) =>
        s.cancelled ? (
          <Button key={s.key} variant="ghost" onClick={() => setCancelling(s.key)}>
            Cancelar ordem
          </Button>
        ) : (
          <Button key={s.key} variant="secondary" loading={move.isPending && move.variables?.to === s.key} onClick={() => move.mutate({ to: s.key })}>
            Marcar como “{s.label}”
          </Button>
        ),
      )}

      <Modal
        open={!!cancelling}
        title="Cancelar ordem"
        onClose={() => setCancelling(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              Voltar
            </Button>
            <Button variant="danger" loading={move.isPending} onClick={() => move.mutate({ to: cancelling!, reason })}>
              Cancelar ordem
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {move.error && <Alert>{move.error instanceof ApiError ? move.error.message : 'Erro ao cancelar'}</Alert>}
          <p className="text-sm text-fg-muted">O valor em aberto sai do contas a receber. Pagamentos já feitos continuam registrados: se houver devolução, lance no financeiro.</p>
          <Field label="Motivo">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
        </div>
      </Modal>
    </div>
  );
}

export function PaymentModal({ order, balance, onClose }: { order: OrderDetail; balance: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: ['service-orders', 'payment-accounts'],
    queryFn: () => api<{ id: string; name: string }[]>('/service-orders/payment-accounts'),
  });
  const [amount, setAmount] = useState(balance.toFixed(2).replace('.', ','));
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [accountId, setAccountId] = useState('');
  const [paidAt, setPaidAt] = useState(today());

  const pay = useMutation({
    mutationFn: () =>
      api<OrderDetail>(`/service-orders/${order.id}/payments`, {
        method: 'POST',
        body: { amount: parseMoney(amount), method, accountId: accountId || accounts.data?.[0]?.id, paidAt },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData([...ordersKey, order.id], updated);
      queryClient.invalidateQueries({ queryKey: ordersKey });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    pay.mutate();
  }

  return (
    <Modal
      open
      title="Registrar pagamento"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="payment-form" loading={pay.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="space-y-4">
        {pay.error && <Alert>{pay.error instanceof ApiError ? pay.error.message : 'Erro ao registrar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor (R$)" hint={`Em aberto: ${formatMoney(balance)}`}>
            {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label="Data">{(id) => <Input id={id} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}</Field>
          <Field label="Forma de pagamento">
            {(id) => (
              <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {paymentMethods.map((m) => (
                  <option key={m} value={m}>
                    {paymentMethodLabel[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Conta">
            {(id) => (
              <Select id={id} value={accountId || accounts.data?.[0]?.id || ''} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {method === 'pix' && <PixCharge amount={parseMoney(amount)} reference={`OS${order.number}`} />}
      </form>
    </Modal>
  );
}
