import { api, ApiError, formatDate, formatDateTime, formatMoney, formatPhone, parseMoney, PixCharge, today, useCan } from '@all/module-sdk/web';
import { brl, registersKey, useDeviceRegister, useRegisters } from '@all/sales/web';
import { ordersKey, paymentMethodLabel, paymentMethods, PaymentBadge, StatusBadge, Transitions, useWorkflows, type PaymentMethod } from '@all/service-orders/web';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { BakeryOrder } from '../contracts';

const errorText = (e: unknown, fallback = 'Erro ao salvar') => (e instanceof ApiError ? e.message : fallback);
const localFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });

/** Encomenda: itens com a escrita do bolo, retirada editável e sinal que pode entrar no caixa. */
export function BakeryOrderPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const workflows = useWorkflows();
  const canPay = useCan('shared.service-orders.payments');
  const canWrite = useCan('shared.service-orders.write');
  const key = [...ordersKey, 'bakery', 'order', id];
  const detail = useQuery({ queryKey: key, queryFn: () => api<BakeryOrder>(`/bakery/orders/${id}`) });
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  if (detail.isPending) return <Spinner />;
  if (detail.isError) return <Alert>{detail.error.message}</Alert>;
  const { order, items } = detail.data;
  const workflow = workflows.data?.find((w) => w.key === order.workflow);
  const balance = Math.round((order.total - order.paidAmount) * 100) / 100;
  const closed = order.status === 'delivered' || order.status === 'cancelled';
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ordersKey });
    queryClient.invalidateQueries({ queryKey: registersKey });
  };

  return (
    <>
      <PageHeader
        title={`Encomenda nº ${order.number}`}
        description={`Pedida em ${formatDateTime(order.receivedAt)}${order.dueAt ? ` · retirada ${formatDateTime(order.dueAt)}` : ''}`}
        actions={
          canWrite && !closed && !editing ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Editar retirada e escrita
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge workflows={workflows.data} workflow={order.workflow} status={order.status} />
        {workflow && <Transitions order={order} workflow={workflow} onChanged={refresh} />}
      </div>
      {order.cancelReason && (
        <div className="mb-4">
          <Alert>Cancelada: {order.cancelReason}</Alert>
        </div>
      )}
      {editing && <EditCard detail={detail.data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}

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
                {order.items.map((i) => {
                  const extra = items.find((x) => x.id === i.id);
                  return (
                    <tr key={i.id}>
                      <Td>
                        {i.description}
                        {extra?.inscription && <div className="text-sm text-fg-muted">Escrever: “{extra.inscription}”</div>}
                        {extra?.stockMovedAt && (
                          <div className="mt-1">
                            <Badge>Estoque baixado</Badge>
                          </div>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">{i.quantity.toLocaleString('pt-BR')}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(i.unitPrice)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(i.total)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="space-y-1 px-4 py-3 text-right text-sm">
              {order.discount > 0 && <div className="text-fg-muted">Desconto −{formatMoney(order.discount)}</div>}
              <div className="text-lg font-semibold">Total {formatMoney(order.total)}</div>
            </div>
          </Card>

          {(order.notesCustomer || order.notesInternal) && (
            <Card className="space-y-3 p-5 text-sm">
              {order.notesCustomer && (
                <div>
                  <p className="font-medium">Observações para o cliente</p>
                  <p className="whitespace-pre-line text-fg-muted">{order.notesCustomer}</p>
                </div>
              )}
              {order.notesInternal && (
                <div>
                  <p className="font-medium">Observações internas (produção)</p>
                  <p className="whitespace-pre-line text-fg-muted">{order.notesInternal}</p>
                </div>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 font-medium">Histórico</h2>
            <ol className="space-y-2 text-sm">
              {order.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="tabular-nums text-fg-muted">{formatDateTime(h.createdAt)}</span>
                  <StatusBadge workflows={workflows.data} workflow={order.workflow} status={h.to} />
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
            <Link to={`/clientes/${order.customer.id}`} className="font-medium text-brand-700 hover:underline">
              {order.customer.name}
            </Link>
            <p className="text-sm text-fg-muted">{[formatPhone(order.customer.phone), order.customer.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}</p>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Pagamento</h2>
              <PaymentBadge status={order.paymentStatus} />
            </div>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-fg-muted">Pago</dt>
              <dd className="text-right tabular-nums">{formatMoney(order.paidAmount)}</dd>
              <dt className="text-fg-muted">Em aberto</dt>
              <dd className="text-right font-medium tabular-nums">{formatMoney(balance)}</dd>
            </dl>
            {order.payments.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="text-fg-muted">
                      {formatDate(p.paidAt)} · {paymentMethodLabel[p.method]}
                    </span>
                    <span className="tabular-nums">{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {balance > 0 && order.status !== 'cancelled' && canPay && !paying && (
              <Button className="mt-4 w-full" onClick={() => setPaying(true)}>
                Registrar pagamento
              </Button>
            )}
            {paying && <PaymentForm detail={detail.data} balance={balance} onClose={() => setPaying(false)} onPaid={() => { setPaying(false); refresh(); }} />}
          </Card>
        </div>
      </div>
    </>
  );
}

function EditCard({ detail, onClose, onSaved }: { detail: BakeryOrder; onClose: () => void; onSaved: () => void }) {
  const { order, items } = detail;
  const due = order.dueAt ? new Date(order.dueAt) : null;
  const [date, setDate] = useState(due ? localFmt.format(due) : today());
  const [time, setTime] = useState(due ? timeFmt.format(due) : '09:00');
  const [notesCustomer, setNotesCustomer] = useState(order.notesCustomer ?? '');
  const [notesInternal, setNotesInternal] = useState(order.notesInternal ?? '');
  const [inscriptions, setInscriptions] = useState<Record<string, string>>(Object.fromEntries(items.map((i) => [i.id, i.inscription ?? ''])));
  const save = useMutation({
    mutationFn: () =>
      api(`/bakery/orders/${order.id}`, {
        method: 'PATCH',
        body: {
          dueAt: new Date(`${date}T${time}:00-03:00`).toISOString(),
          notesCustomer: notesCustomer || null,
          notesInternal: notesInternal || null,
          inscriptions: items.filter((i) => (inscriptions[i.id] ?? '') !== (i.inscription ?? '')).map((i) => ({ itemId: i.id, inscription: inscriptions[i.id] || null })),
        },
      }),
    onSuccess: onSaved,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card className="mb-4 p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-medium">Editar encomenda</h2>
        {save.error && <Alert>{errorText(save.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-[12rem_8rem]">
          <Field label="Retirada">{(id) => <Input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Horário">{(id) => <Input id={id} type="time" required value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
        <p className="text-sm text-fg-muted">A encomenda passa para a Produção do dia da nova data, e o vencimento do valor em aberto acompanha. O cliente não é avisado automaticamente: combine a mudança com ele.</p>
        {order.items.map((i) => (
          <Field key={i.id} label={`Escrita — ${i.description}`} hint="Deixe em branco se o item não leva escrita.">
            {(id) => <Input id={id} maxLength={200} value={inscriptions[i.id] ?? ''} onChange={(e) => setInscriptions({ ...inscriptions, [i.id]: e.target.value })} />}
          </Field>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Observações para o cliente">{(id) => <Textarea id={id} rows={3} value={notesCustomer} onChange={(e) => setNotesCustomer(e.target.value)} />}</Field>
          <Field label="Observações internas (produção)">{(id) => <Textarea id={id} rows={3} value={notesInternal} onChange={(e) => setNotesInternal(e.target.value)} />}</Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Pagamento na própria página. Em dinheiro, com caixa aberto neste computador, já vem para entrar no caixa. */
function PaymentForm({ detail, balance, onClose, onPaid }: { detail: BakeryOrder; balance: number; onClose: () => void; onPaid: () => void }) {
  const { order } = detail;
  const accounts = useQuery({ queryKey: ['service-orders', 'payment-accounts'], queryFn: () => api<{ id: string; name: string }[]>('/service-orders/payment-accounts') });
  const registers = useRegisters();
  const [registerId] = useDeviceRegister();
  const register = registers.data?.registers.find((r) => r.id === registerId && r.active && r.openSession);
  const [amount, setAmount] = useState(balance.toFixed(2).replace('.', ','));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [accountId, setAccountId] = useState('');
  const [paidAt, setPaidAt] = useState(today());
  const [toDrawer, setToDrawer] = useState(true);
  const inDrawer = !!register && toDrawer && paidAt === today();
  const pay = useMutation({
    mutationFn: () =>
      api(`/bakery/orders/${order.id}/payments`, {
        method: 'POST',
        body: { amount: parseMoney(amount), method, accountId: accountId || accounts.data?.[0]?.id, paidAt, registerId: inDrawer ? register.id : null },
      }),
    onSuccess: onPaid,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    pay.mutate();
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-4">
      {pay.error && <Alert>{errorText(pay.error, 'Erro ao registrar')}</Alert>}
      <Field label="Valor (R$)" hint={`Em aberto: ${brl(balance)}. Para um sinal, digite só o valor recebido.`}>
        {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="Data">{(id) => <Input id={id} type="date" max={today()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}</Field>
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
      {register && paidAt === today() ? (
        <Checkbox label={`Entrar no ${register.name} (aberto neste computador)`} checked={toDrawer} onChange={(e) => setToDrawer(e.target.checked)} />
      ) : (
        <p className="text-sm text-fg-muted">Sem caixa aberto neste computador: o pagamento vai só para o financeiro e não entra na conferência da gaveta.</p>
      )}
      {!(inDrawer && method === 'cash') && (
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
      )}
      {inDrawer && method === 'cash' && <p className="text-sm text-fg-muted">O dinheiro entra na conta Caixa e na conferência do fechamento. No financeiro é um lançamento só.</p>}
      {method === 'pix' && <PixCharge amount={parseMoney(amount)} reference={`OS${order.number}`} />}
      <div className="flex gap-2">
        <Button type="submit" loading={pay.isPending}>
          Registrar
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
