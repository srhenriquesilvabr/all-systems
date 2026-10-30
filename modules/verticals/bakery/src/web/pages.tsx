import { api, ApiError, CustomerSearch, parseMoney, today, useCan, type CustomerOption } from '@all/module-sdk/web';
import { brl, useProducts } from '@all/sales/web';
import type { OrderDetail, OrderSummary } from '@all/service-orders';
import { OrderRows, ordersKey, StatusBadge, useWorkflows } from '@all/service-orders/web';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { BAKERY_WORKFLOW, bakeryWorkflow, type ProductionPlan } from '../contracts';

const PAGE = 25;
const hour = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const tomorrow = () => {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function BakeryOrdersPage() {
  const navigate = useNavigate();
  const canWrite = useCan('shared.service-orders.write');
  const workflows = useWorkflows();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const orders = useQuery({
    queryKey: [...ordersKey, 'bakery', { status, q, page }],
    queryFn: () => api<{ items: OrderSummary[]; total: number }>('/service-orders', { query: { workflow: BAKERY_WORKFLOW, status: status || undefined, q: q || undefined, limit: PAGE, offset: page * PAGE } }),
    placeholderData: keepPreviousData,
  });
  const pages = Math.ceil((orders.data?.total ?? 0) / PAGE);

  return (
    <>
      <PageHeader
        title="Encomendas"
        description="Bolos, tortas e salgados sob encomenda. O cliente recebe aviso ao registrar e quando fica pronta."
        actions={canWrite && <Button onClick={() => navigate('/padaria/encomendas/nova')}>Nova encomenda</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          type="search"
          aria-label="Buscar"
          placeholder="Número ou cliente"
          className="max-w-xs"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <Select
          aria-label="Status"
          className="max-w-56"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Todas</option>
          {bakeryWorkflow.statuses.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {orders.isPending ? (
          <Spinner />
        ) : orders.isError ? (
          <div className="p-4">
            <Alert>{orders.error.message}</Alert>
          </div>
        ) : orders.data.items.length === 0 ? (
          <EmptyState title="Nenhuma encomenda" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Pedido em</Th>
                <Th>Cliente</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th>Pagamento</Th>
                <Th>Retirada</Th>
              </tr>
            </thead>
            <tbody>
              <OrderRows orders={orders.data.items} workflows={workflows.data} />
            </tbody>
          </Table>
        )}
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-fg-muted">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          Página {page + 1} de {pages}
          <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </>
  );
}

interface Line {
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  inscription: string;
}

export function NewBakeryOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState('09:00');
  // Encomenda antiga (migração de outro sistema): a data do pedido e a retirada podem estar no passado.
  const [pastOrder, setPastOrder] = useState(false);
  const [receivedAt, setReceivedAt] = useState(today());
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const products = useProducts({ q: q.trim() || undefined, active: true }, q.trim().length >= 2);
  const [discount, setDiscount] = useState('');
  const [notesCustomer, setNotesCustomer] = useState('');
  const [notesInternal, setNotesInternal] = useState('');
  const total = lines.reduce((sum, l) => sum + Math.round(Number(l.quantity.replace(',', '.')) * Math.round(parseMoney(l.unitPrice) * 100)), 0) - Math.round((parseMoney(discount) || 0) * 100);

  const save = useMutation({
    mutationFn: () =>
      api<OrderDetail>('/bakery/orders', {
        method: 'POST',
        body: {
          customerId: customer?.id,
          dueAt: new Date(`${date}T${time}:00-03:00`).toISOString(),
          receivedAt: pastOrder ? receivedAt : undefined,
          items: lines.map((l) => ({ productId: l.productId, description: l.description, quantity: Number(l.quantity.replace(',', '.')), unitPrice: parseMoney(l.unitPrice), inscription: l.inscription || null })),
          discount: parseMoney(discount) || 0,
          notesCustomer: notesCustomer || null,
          notesInternal: notesInternal || null,
        },
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ordersKey });
      navigate(`/padaria/encomendas/${order.id}`);
    },
  });
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <>
      <PageHeader title="Nova encomenda" description="Item do catálogo baixa o estoque quando a encomenda é retirada." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Cliente</h2>
            {customer ? (
              <p className="text-sm">
                <span className="font-medium">{customer.name}</span>
                <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => setCustomer(null)}>
                  trocar
                </button>
              </p>
            ) : (
              <CustomerSearch onSelect={setCustomer} />
            )}
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="font-medium">Itens</h2>
            <div className="relative">
              <Input type="search" aria-label="Buscar produto" placeholder="Buscar produto do catálogo" value={q} onChange={(e) => setQ(e.target.value)} />
              {q.trim().length >= 2 && (
                <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                  {products.data?.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="flex w-full justify-between px-3 py-2 text-left hover:bg-muted"
                        onClick={() => {
                          setLines([...lines, { productId: p.id, description: p.name, quantity: '1', unitPrice: p.price.toFixed(2).replace('.', ','), inscription: '' }]);
                          setQ('');
                        }}
                      >
                        <span>{p.name}</span>
                        <span className="tabular-nums text-fg-muted">
                          {brl(p.price)}/{p.unit}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {lines.map((l, i) => (
              <div key={i} className="space-y-2">
                <div className="grid grid-cols-[1fr_5rem_7rem_auto] items-end gap-2">
                  <Field label={i === 0 ? 'Descrição' : ''}>{(id) => <Input id={id} required value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />}</Field>
                  <Field label={i === 0 ? 'Qtd.' : ''}>{(id) => <Input id={id} inputMode="decimal" required className="text-right" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />}</Field>
                  <Field label={i === 0 ? 'Preço (R$)' : ''}>{(id) => <Input id={id} inputMode="decimal" required className="text-right" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />}</Field>
                  <Button type="button" variant="ghost" size="sm" aria-label="Remover item" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </div>
                <Input aria-label={`Escrita do item ${i + 1}`} maxLength={200} placeholder="Escrita no bolo (opcional). Ex.: Parabéns, Ana!" value={l.inscription} onChange={(e) => setLine(i, { inscription: e.target.value })} />
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setLines([...lines, { productId: null, description: '', quantity: '1', unitPrice: '', inscription: '' }])}>
              + Item sob medida
            </Button>
          </Card>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Observações para o cliente" hint="Ex.: sabor do recheio, ponto de retirada. A escrita do bolo tem campo próprio em cada item.">
              {(id) => <Textarea id={id} rows={3} value={notesCustomer} onChange={(e) => setNotesCustomer(e.target.value)} />}
            </Field>
            <Field label="Observações internas (produção)">{(id) => <Textarea id={id} rows={3} value={notesInternal} onChange={(e) => setNotesInternal(e.target.value)} />}</Field>
          </Card>
        </div>
        <Card className="h-fit space-y-4 p-5">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Retirada">
              {(id) => <Input id={id} type="date" required min={pastOrder && receivedAt < today() ? receivedAt : today()} value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="Horário">{(id) => <Input id={id} type="time" required value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
          </div>
          {pastOrder ? (
            <Field label="Pedido em" hint="Em data passada, o cliente não é avisado e a retirada pode ser no passado.">
              {(id) => <Input id={id} type="date" value={receivedAt} max={today()} onChange={(e) => setReceivedAt(e.target.value)} />}
            </Field>
          ) : (
            <button type="button" className="text-left text-sm text-brand-700 hover:underline" onClick={() => setPastOrder(true)}>
              Registrar encomenda antiga
            </button>
          )}
          <Field label="Desconto (R$)">{(id) => <Input id={id} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />}</Field>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-medium">Total</span>
            <span className="font-display text-2xl font-semibold tabular-nums">{brl(Math.max(total, 0) / 100)}</span>
          </div>
          <p className="text-xs text-fg-muted">O sinal, se houver, é lançado na encomenda depois de salvar (Registrar pagamento). Em dinheiro, ele pode entrar no caixa aberto.</p>
          <Button type="submit" className="w-full" loading={save.isPending} disabled={!customer || !lines.length}>
            Registrar encomenda
          </Button>
        </Card>
      </form>
    </>
  );
}

/** O que produzir no dia: soma dos itens de todas as encomendas a retirar, e a lista para conferir. */
export function ProductionPage() {
  const queryClient = useQueryClient();
  const canMove = useCan('shared.service-orders.status');
  const workflows = useWorkflows();
  const [date, setDate] = useState(today());
  const plan = useQuery({ queryKey: [...ordersKey, 'bakery', 'production', date], queryFn: () => api<ProductionPlan>('/bakery/production', { query: { date } }) });
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => api(`/service-orders/${id}/transition`, { method: 'POST', body: { to } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ordersKey }),
  });
  const next: Record<string, { to: string; label: string } | undefined> = {
    received: { to: 'in_production', label: 'Iniciar produção' },
    in_production: { to: 'ready', label: 'Pronta' },
  };

  return (
    <>
      <PageHeader
        title="Produção do dia"
        description="Encomendas com retirada na data. Ao marcar como pronta, o cliente é avisado."
        actions={
          <div className="flex gap-2 print:hidden">
            <Input type="date" aria-label="Data" value={date} onChange={(e) => setDate(e.target.value)} />
            <Button variant="secondary" onClick={() => window.print()}>
              Imprimir
            </Button>
          </div>
        }
      />
      {move.error && <Alert>{move.error instanceof ApiError ? move.error.message : 'Erro ao atualizar'}</Alert>}
      {plan.isPending ? (
        <Spinner />
      ) : plan.isError ? (
        <Alert>{plan.error.message}</Alert>
      ) : plan.data.orders.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma encomenda para retirar nesta data" />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <Card className="h-fit p-5">
            <h2 className="mb-3 font-medium">Total a produzir</h2>
            {plan.data.totals.length === 0 && <p className="text-sm text-fg-muted">Tudo pronto: nada a produzir nesta data.</p>}
            <ul className="divide-y divide-line text-sm">
              {plan.data.totals.map((t) => (
                <li key={t.description} className="flex justify-between gap-3 py-1.5">
                  <span>{t.description}</span>
                  <span className="font-medium tabular-nums">{t.quantity.toLocaleString('pt-BR')}</span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="space-y-3">
            {plan.data.orders.map((o) => (
              <Card key={o.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Link to={`/padaria/encomendas/${o.id}`} className="font-medium text-brand-700 hover:underline">
                      nº {o.number}
                    </Link>
                    <span>{o.customer}</span>
                    <StatusBadge workflows={workflows.data} workflow={BAKERY_WORKFLOW} status={o.status} />
                  </div>
                  <span className="tabular-nums text-fg-muted">{hour.format(new Date(o.dueAt))}</span>
                </div>
                <ul className="mt-2 list-inside list-disc">
                  {o.items.map((i, k) => (
                    <li key={k}>
                      {i.quantity.toLocaleString('pt-BR')} × {i.description}
                      {i.inscription && <div className="ml-5 font-medium">Escrever: “{i.inscription}”</div>}
                    </li>
                  ))}
                </ul>
                {o.notes && <p className="mt-2 text-fg-muted">{o.notes}</p>}
                {canMove && next[o.status] && (
                  <Button size="sm" className="mt-3 print:hidden" loading={move.isPending && move.variables?.id === o.id} onClick={() => move.mutate({ id: o.id, to: next[o.status]!.to })}>
                    {next[o.status]!.label}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
