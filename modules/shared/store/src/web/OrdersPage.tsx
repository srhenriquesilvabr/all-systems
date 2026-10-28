import { AddressFields, api, ApiError, CustomerSearch, formatDateTime, formatPhone, parseMoney, useCan, type Address } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  brl,
  effectivePrice,
  formatAddress,
  formatQuantity,
  fractionalUnits,
  fulfillmentLabel,
  lineCents,
  orderStatusLabel,
  paymentModeLabel,
  salePaymentLabel,
  salePaymentMethods,
  type Fulfillment,
  type Order,
  type OrderStatus,
  type SalePaymentMethod,
  type StoreProduct,
} from '../contracts';
import { storeKey, useStoreOrder, useStoreOrders, useStoreProducts, useStoreStatus } from './hooks';

const statusTone: Record<OrderStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'brand'> = {
  new: 'warning',
  confirmed: 'brand',
  preparing: 'brand',
  ready: 'success',
  dispatched: 'success',
  completed: 'neutral',
  cancelled: 'danger',
};

export const StatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={statusTone[status]}>{orderStatusLabel[status]}</Badge>;

const tabs: { key: OrderStatus | 'open' | 'all'; label: string }[] = [
  { key: 'open', label: 'Em andamento' },
  { key: 'new', label: 'Novos' },
  { key: 'completed', label: 'Concluídos' },
  { key: 'cancelled', label: 'Cancelados' },
  { key: 'all', label: 'Todos' },
];

/** Pedidos da loja: os que chegam pela vitrine e os lançados pela equipe. */
export function OrdersPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]['key']>('open');
  const [q, setQ] = useState('');
  const orders = useStoreOrders({ status: tab === 'all' ? undefined : tab, q: q.trim() || undefined });
  const status = useStoreStatus();
  const canManage = useCan('store.orders.manage');
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Pedidos da loja"
        description={status.data ? (status.data.open ? 'Loja aberta, recebendo pedidos.' : 'Loja pausada: a vitrine não aceita pedidos agora.') : undefined}
        actions={
          <>
            {status.data?.publicUrl && (
              <a href={status.data.publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-line px-5 text-sm font-medium hover:border-fg">
                Ver a loja
              </a>
            )}
            {canManage && <Button onClick={() => navigate('/lojinha/pedidos/novo')}>Lançar pedido</Button>}
          </>
        }
      />
      <Tabs items={tabs} active={tab} onChange={(k) => setTab(k as typeof tab)} />
      <Input type="search" aria-label="Buscar pedido" placeholder="Nº do pedido, nome ou telefone" className="mb-4 max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card>
        {orders.isPending ? (
          <Spinner />
        ) : orders.isError ? (
          <div className="p-4">
            <Alert>{orders.error.message}</Alert>
          </div>
        ) : orders.data.length === 0 ? (
          <EmptyState title="Nenhum pedido aqui" description={tab === 'open' ? 'Os pedidos da vitrine aparecem aqui assim que chegam.' : undefined} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Cliente</Th>
                <Th>Entrega</Th>
                <Th className="text-right">Total</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/lojinha/pedidos/${o.id}`)}>
                  <Td className="tabular-nums">
                    <Link to={`/lojinha/pedidos/${o.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      #{o.number}
                    </Link>
                    <span className="block text-xs text-fg-muted">{formatDateTime(o.createdAt)}</span>
                  </Td>
                  <Td>
                    {o.customerName}
                    <span className="block text-xs text-fg-muted">{formatPhone(o.customerPhone)}</span>
                  </Td>
                  <Td className="text-sm">
                    {fulfillmentLabel[o.fulfillment]}
                    <span className="block text-xs text-fg-muted">
                      {o.itemsCount} {o.itemsCount === 1 ? 'item' : 'itens'} · {o.source === 'admin' ? 'lançado pela equipe' : 'loja online'}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{brl(o.total)}</Td>
                  <Td>
                    <StatusBadge status={o.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

const nextLabel: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Confirmar pedido',
  preparing: 'Em preparo',
  ready: 'Pronto para retirada',
  dispatched: 'Saiu para entrega',
};

interface RegistersOverview {
  requireSession: boolean;
  registers: { id: string; name: string; active: boolean; openSession: { id: string } | null }[];
}

/** Pedido: itens, cliente, entrega, histórico e as ações do fluxo, tudo na própria página. */
export function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useStoreOrder(id);
  const queryClient = useQueryClient();
  const canManage = useCan('store.orders.manage');
  const canCancel = useCan('store.orders.cancel');
  const [panel, setPanel] = useState<'complete' | 'cancel' | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const onSaved = (o: Order) => {
    queryClient.setQueryData([...storeKey, 'order', id], o);
    queryClient.invalidateQueries({ queryKey: [...storeKey, 'orders'] });
    setWarnings(o.warnings ?? []);
    setPanel(null);
  };
  const advance = useMutation({
    mutationFn: (status: OrderStatus) => api<Order>(`/store/orders/${id}/status`, { method: 'POST', body: { status } }),
    onSuccess: onSaved,
  });

  if (order.isPending) return <Spinner />;
  if (order.isError) return <Alert>{order.error.message}</Alert>;
  const o = order.data;
  const closed = o.status === 'completed' || o.status === 'cancelled';
  const whatsapp = o.customerPhone ? `https://wa.me/${o.customerPhone.replace(/\D/g, '')}` : null;

  return (
    <>
      <Link to="/lojinha/pedidos" className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← Pedidos da loja
      </Link>
      <PageHeader title={`Pedido nº ${o.number}`} description={`${o.source === 'admin' ? 'Lançado pela equipe' : 'Loja online'} em ${formatDateTime(o.createdAt)}`} actions={<StatusBadge status={o.status} />} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {advance.error && <Alert>{advance.error instanceof ApiError ? advance.error.message : 'Erro ao atualizar'}</Alert>}
          {warnings.map((w) => (
            <Alert key={w} tone="info">
              {w}
            </Alert>
          ))}
          {!closed && canManage && panel === null && (
            <div className="flex flex-wrap gap-2">
              {o.next.map((s, i) => (
                <Button key={s} variant={i === 0 ? 'primary' : 'secondary'} loading={advance.isPending && advance.variables === s} disabled={advance.isPending} onClick={() => advance.mutate(s)}>
                  {nextLabel[s] ?? orderStatusLabel[s]}
                  {s === 'confirmed' ? ' (reserva o estoque)' : ''}
                </Button>
              ))}
              <Button variant="secondary" onClick={() => setPanel('complete')}>
                Concluir (vira venda)
              </Button>
              {canCancel && (
                <Button variant="ghost" onClick={() => setPanel('cancel')}>
                  Cancelar pedido
                </Button>
              )}
            </div>
          )}
          {panel === 'complete' && <CompleteForm order={o} onDone={onSaved} onClose={() => setPanel(null)} />}
          {panel === 'cancel' && <CancelForm order={o} onDone={onSaved} onClose={() => setPanel(null)} />}

          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="text-right">Qtd.</Th>
                  <Th className="text-right">Preço</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.productId}>
                    <Td>{i.name}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(i.quantity, i.unit)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {i.unitPrice < i.regularPrice && <span className="mr-1 text-xs text-fg-muted line-through">{brl(i.regularPrice)}</span>}
                      {brl(i.unitPrice)}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{brl(i.total)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                {o.deliveryFee > 0 && (
                  <>
                    <tr>
                      <Td colSpan={3} className="text-right text-fg-muted">
                        Produtos
                      </Td>
                      <Td className="text-right tabular-nums">{brl(o.subtotal)}</Td>
                    </tr>
                    <tr>
                      <Td colSpan={3} className="text-right text-fg-muted">
                        Taxa de entrega
                      </Td>
                      <Td className="text-right tabular-nums">{brl(o.deliveryFee)}</Td>
                    </tr>
                  </>
                )}
                <tr>
                  <Td colSpan={3} className="text-right font-medium">
                    Total
                  </Td>
                  <Td className="text-right font-medium tabular-nums">{brl(o.total)}</Td>
                </tr>
              </tfoot>
            </Table>
          </Card>
          {o.notes && (
            <Card className="p-4 text-sm">
              <span className="text-fg-muted">Observações do cliente:</span>
              <p className="mt-1 whitespace-pre-wrap">{o.notes}</p>
            </Card>
          )}
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Histórico</h2>
            <ol className="space-y-2 text-sm">
              {o.events.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2">
                  <span>{e.text}</span>
                  <span className="text-xs text-fg-muted">
                    {formatDateTime(e.createdAt)}
                    {e.userName && ` · ${e.userName}`}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="space-y-2 p-4 text-sm">
            <h2 className="font-medium">Cliente</h2>
            <p>
              {o.customer ? (
                <Link to={`/clientes/${o.customer.id}`} className="text-brand-700 hover:underline">
                  {o.customerName}
                </Link>
              ) : (
                o.customerName
              )}
            </p>
            {o.customerPhone && (
              <p>
                {formatPhone(o.customerPhone)}
                {whatsapp && (
                  <a href={whatsapp} target="_blank" rel="noreferrer" className="ml-2 text-brand-700 hover:underline">
                    WhatsApp
                  </a>
                )}
              </p>
            )}
            {o.customerEmail && <p className="break-all">{o.customerEmail}</p>}
            {!o.customer && !closed && <p className="text-xs text-fg-muted">O cadastro do cliente é ligado (ou criado pelo telefone/e-mail) ao confirmar o pedido.</p>}
          </Card>
          <Card className="space-y-2 p-4 text-sm">
            <h2 className="font-medium">{fulfillmentLabel[o.fulfillment]}</h2>
            {o.address && <p>{formatAddress(o.address)}</p>}
            <p className="text-fg-muted">{paymentModeLabel[o.paymentMode]}</p>
            {o.paymentStatus === 'paid' && <Badge tone="success">Pago{o.paymentMethod ? ` · ${salePaymentLabel[o.paymentMethod]}` : ''}</Badge>}
            {o.saleNumber && <p>Venda nº {o.saleNumber} (em Vendas)</p>}
            {o.cancelReason && <p className="text-danger-700">Motivo do cancelamento: {o.cancelReason}</p>}
          </Card>
          {o.consent && (
            <Card className="p-4 text-xs text-fg-muted">
              Consentimento LGPD aceito em {formatDateTime(o.consent.acceptedAt)} (versão {o.consent.version}).
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function CompleteForm({ order, onDone, onClose }: { order: Order; onDone: (o: Order) => void; onClose: () => void }) {
  const [method, setMethod] = useState<SalePaymentMethod>(order.paymentMethod ?? 'pix');
  const [registerId, setRegisterId] = useState('');
  // Caixas do PDV (só para quem pode vender); se a empresa exige caixa aberto, a venda entra num deles.
  const registers = useQuery({ queryKey: ['sales', 'registers'], queryFn: () => api<RegistersOverview>('/sales/registers'), retry: false });
  const open = registers.data?.registers.filter((r) => r.active && r.openSession) ?? [];
  const complete = useMutation({
    mutationFn: () => api<Order>(`/store/orders/${order.id}/complete`, { method: 'POST', body: { paymentMethod: method, registerId: registerId || null } }),
    onSuccess: onDone,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    complete.mutate();
  }
  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-medium">Concluir o pedido</h2>
        <p className="text-sm text-fg-muted">
          Vira uma venda no PDV com os preços do pedido ({brl(order.subtotal)}), baixa o estoque e lança no financeiro.
          {order.deliveryFee > 0 && ` A taxa de entrega (${brl(order.deliveryFee)}) entra como receita separada.`}
        </p>
        {complete.error && <Alert>{complete.error instanceof ApiError ? complete.error.message : 'Erro ao concluir'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Como o cliente pagou">
            {(id) => (
              <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as SalePaymentMethod)}>
                {salePaymentMethods.map((m) => (
                  <option key={m} value={m}>
                    {salePaymentLabel[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {(open.length > 0 || registers.data?.requireSession) && (
            <Field label="Caixa" hint={registers.data?.requireSession ? 'A empresa exige caixa aberto para vender.' : 'Opcional: a venda entra no fechamento deste caixa.'}>
              {(id) => (
                <Select id={id} value={registerId} onChange={(e) => setRegisterId(e.target.value)} required={registers.data?.requireSession}>
                  <option value="">{registers.data?.requireSession ? 'Escolha' : 'Sem caixa'}</option>
                  {open.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" loading={complete.isPending}>
            Concluir e registrar a venda
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CancelForm({ order, onDone, onClose }: { order: Order; onDone: (o: Order) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useMutation({ mutationFn: () => api<Order>(`/store/orders/${order.id}/cancel`, { method: 'POST', body: { reason } }), onSuccess: onDone });
  function submit(e: FormEvent) {
    e.preventDefault();
    cancel.mutate();
  }
  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-medium">Cancelar o pedido nº {order.number}</h2>
        {cancel.error && <Alert>{cancel.error instanceof ApiError ? cancel.error.message : 'Erro ao cancelar'}</Alert>}
        <Field label="Motivo" hint="O cliente recebe o motivo no aviso de cancelamento (se as notificações estiverem ativas).">
          {(id) => <Textarea id={id} rows={2} required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" variant="danger" loading={cancel.isPending}>
            Cancelar pedido
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---- Lançar pedido (telefone, balcão, redes sociais) ------------------------------------------------

interface Line {
  product: StoreProduct;
  quantity: string;
}

export function NewOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', fulfillment: 'pickup' as Fulfillment, notes: '', paymentMode: 'on_delivery' as 'whatsapp' | 'on_delivery' });
  const [address, setAddress] = useState<Address>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const products = useStoreProducts({ q: q.trim() || undefined });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const qty = (l: Line) => parseMoney(l.quantity);
  const total = lines.reduce((sum, l) => sum + (Number.isNaN(qty(l)) ? 0 : lineCents(qty(l), effectivePrice(l.product.price, l.product.listing ?? { promoPrice: null, promoUntil: null }))), 0) / 100;

  const save = useMutation({
    mutationFn: () =>
      api<Order>('/store/orders', {
        method: 'POST',
        body: {
          ...form,
          email: form.email || null,
          notes: form.notes || null,
          customerId,
          address: form.fulfillment === 'delivery' ? { ...address, zip: address.zip || null, complement: address.complement || null, state: address.state || null } : null,
          items: lines.map((l) => ({ productId: l.product.productId, quantity: qty(l) })),
        },
      }),
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: [...storeKey, 'orders'] });
      navigate(`/lojinha/pedidos/${o.id}`);
    },
  });

  function add(p: StoreProduct) {
    if (!lines.some((l) => l.product.productId === p.productId)) setLines([...lines, { product: p, quantity: '1' }]);
    setQ('');
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <>
      <Link to="/lojinha/pedidos" className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← Pedidos da loja
      </Link>
      <PageHeader title="Lançar pedido" description="Pedido recebido por telefone, no balcão ou pelas redes sociais. Entra como novo, no mesmo fluxo da loja online." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao lançar o pedido'}</Alert>}
        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Cliente</h2>
          <CustomerSearch
            autoFocus={false}
            onSelect={(c) => {
              setCustomerId(c.id);
              set({ name: c.name, phone: formatPhone(c.phone), email: c.email ?? '' });
            }}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome">{(id) => <Input id={id} required minLength={2} value={form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
            <Field label="Celular (com DDD)">{(id) => <Input id={id} type="tel" required value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
            <Field label="E-mail (opcional)">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
          </div>
          {customerId && (
            <p className="text-xs text-fg-muted">
              Ligado ao cadastro do cliente.{' '}
              <button type="button" className="text-brand-700 hover:underline" onClick={() => setCustomerId(null)}>
                Desligar
              </button>
            </p>
          )}
        </Card>
        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Produtos</h2>
          <Input type="search" aria-label="Buscar produto" placeholder="Buscar produto pelo nome ou código" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim().length >= 2 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {(products.data ?? [])
                .filter((p) => p.active)
                .slice(0, 8)
                .map((p) => (
                  <li key={p.productId}>
                    <button type="button" className="flex w-full justify-between px-3 py-2 text-left hover:bg-muted" onClick={() => add(p)}>
                      <span>{p.listing?.title || p.name}</span>
                      <span className="text-sm text-fg-muted">{brl(effectivePrice(p.price, p.listing ?? { promoPrice: null, promoUntil: null }))}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {lines.length > 0 && (
            <ul className="divide-y divide-line">
              {lines.map((l, i) => (
                <li key={l.product.productId} className="flex items-center gap-3 py-2">
                  <span className="flex-1">{l.product.listing?.title || l.product.name}</span>
                  <Input
                    aria-label={`Quantidade de ${l.product.name}`}
                    inputMode="decimal"
                    className="w-24"
                    value={l.quantity}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                  />
                  <span className="w-10 text-sm text-fg-muted">{fractionalUnits.includes(l.product.unit) ? l.product.unit : 'un'}</span>
                  <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-right text-sm">
            Produtos: <strong>{brl(total)}</strong>
          </p>
        </Card>
        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Entrega e pagamento</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Forma de entrega">
              {(id) => (
                <Select id={id} value={form.fulfillment} onChange={(e) => set({ fulfillment: e.target.value as Fulfillment })}>
                  <option value="pickup">{fulfillmentLabel.pickup}</option>
                  <option value="delivery">{fulfillmentLabel.delivery}</option>
                </Select>
              )}
            </Field>
            <Field label="Pagamento">
              {(id) => (
                <Select id={id} value={form.paymentMode} onChange={(e) => set({ paymentMode: e.target.value as typeof form.paymentMode })}>
                  <option value="on_delivery">{paymentModeLabel.on_delivery}</option>
                  <option value="whatsapp">Combinado pelo WhatsApp</option>
                </Select>
              )}
            </Field>
          </div>
          {form.fulfillment === 'delivery' && <AddressFields value={address} onChange={setAddress} />}
          <Field label="Observações">{(id) => <Textarea id={id} rows={2} maxLength={500} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        </Card>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate('/lojinha/pedidos')}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!lines.length}>
            Lançar pedido
          </Button>
        </div>
      </form>
    </>
  );
}
