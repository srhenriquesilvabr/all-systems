import { api, ApiError, formatDateTime, parseMoney, SpreadsheetImport, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { formatQuantity, stockMoveKinds, stockMoveLabel, unitLabel, units, type Product, type StockMove } from '../contracts';
import { brl, salesKey, useProducts } from './hooks';
import { productImportSpec } from './productImport';

const money = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','));

export function ProductsPage() {
  const [q, setQ] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const products = useProducts({ q: q.trim() || undefined, lowStock: lowStock || undefined });
  const canStock = useCan('shared.sales.stock');
  const canProducts = useCan('shared.sales.products');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [moving, setMoving] = useState<Product | null>(null);

  return (
    <>
      <PageHeader
        title="Produtos e estoque"
        description="Preços, códigos de barras e saldo de cada produto."
        actions={
          <>
            {canProducts && <SpreadsheetImport spec={productImportSpec(canStock)} onImported={() => queryClient.invalidateQueries({ queryKey: salesKey })} />}
            <Button onClick={() => setEditing('new')}>Novo produto</Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Input type="search" aria-label="Buscar produto" placeholder="Nome, código ou categoria" className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <Checkbox label="Só estoque baixo" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
      </div>
      <Card>
        {products.isPending ? (
          <Spinner />
        ) : products.isError ? (
          <div className="p-4">
            <Alert>{products.error.message}</Alert>
          </div>
        ) : products.data.length === 0 ? (
          <EmptyState title={q || lowStock ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'} action={!q && !lowStock && <Button onClick={() => setEditing('new')}>Cadastrar o primeiro</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>Código</Th>
                <Th className="text-right">Preço</Th>
                <Th className="text-right">Estoque</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {products.data.map((p) => {
                const low = p.trackStock && p.minStock != null && p.stock <= p.minStock;
                return (
                  <tr key={p.id}>
                    <Td>
                      <span className={p.active ? 'font-medium' : 'text-fg-subtle'}>{p.name}</span>
                      {p.category && <span className="ml-2 text-xs text-fg-muted">{p.category}</span>}
                      {!p.active && <Badge>Inativo</Badge>}
                    </Td>
                    <Td className="text-sm text-fg-muted tabular-nums">{p.barcode ?? p.sku ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {brl(p.price)}
                      <span className="text-xs text-fg-muted">/{p.unit}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {p.trackStock ? (
                        <span className={p.stock < 0 || low ? 'font-medium text-danger-600' : undefined}>{formatQuantity(p.stock, p.unit)}</span>
                      ) : (
                        <span className="text-fg-subtle">não controla</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {canStock && p.trackStock && (
                        <Button variant="ghost" size="sm" onClick={() => setMoving(p)}>
                          Estoque
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        Editar
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ProductModal product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {moving && <StockModal product={moving} onClose={() => setMoving(null)} />}
    </>
  );
}

function ProductModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: product?.name ?? '',
    barcode: product?.barcode ?? '',
    sku: product?.sku ?? '',
    category: product?.category ?? '',
    unit: product?.unit ?? 'un',
    price: money(product?.price),
    cost: money(product?.cost),
    minStock: product?.minStock != null ? String(product.minStock).replace('.', ',') : '',
    trackStock: product?.trackStock ?? true,
    active: product?.active ?? true,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(product ? `/sales/products/${product.id}` : '/sales/products', {
        method: product ? 'PATCH' : 'POST',
        body: {
          ...form,
          sku: form.sku || null,
          category: form.category || null,
          price: parseMoney(form.price),
          cost: form.cost ? parseMoney(form.cost) : null,
          minStock: form.minStock ? Number(form.minStock.replace(',', '.')) : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salesKey });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open
      title={product ? 'Editar produto' : 'Novo produto'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="sales-product-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="sales-product-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <Field label="Nome">{(id) => <Input id={id} required minLength={2} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código de barras (EAN)">{(id) => <Input id={id} inputMode="numeric" value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} />}</Field>
          <Field label="Código interno">{(id) => <Input id={id} value={form.sku} onChange={(e) => set({ sku: e.target.value })} />}</Field>
          <Field label="Categoria">{(id) => <Input id={id} value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder="Ex.: Pães" />}</Field>
          <Field label="Unidade">
            {(id) => (
              <Select id={id} value={form.unit} onChange={(e) => set({ unit: e.target.value as typeof form.unit })}>
                {units.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel[u]} ({u})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={`Preço de venda (R$/${form.unit})`}>{(id) => <Input id={id} inputMode="decimal" required value={form.price} onChange={(e) => set({ price: e.target.value })} placeholder="0,00" />}</Field>
          <Field label="Custo (R$)" hint="Atualizado nas entradas de compra.">
            {(id) => <Input id={id} inputMode="decimal" value={form.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="0,00" />}
          </Field>
          <Field label="Estoque mínimo" hint="Abaixo disso aparece em “estoque baixo”.">
            {(id) => <Input id={id} inputMode="decimal" value={form.minStock} onChange={(e) => set({ minStock: e.target.value })} disabled={!form.trackStock} />}
          </Field>
        </div>
        <Checkbox label="Controlar estoque" checked={form.trackStock} onChange={(e) => set({ trackStock: e.target.checked })} />
        <Checkbox label="Ativo (aparece no caixa)" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
      </form>
    </Modal>
  );
}

function StockModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const queryClient = useQueryClient();
  const moves = useQuery({ queryKey: [...salesKey, 'moves', product.id], queryFn: () => api<StockMove[]>(`/sales/products/${product.id}/moves`) });
  const [form, setForm] = useState({ kind: 'purchase' as (typeof stockMoveKinds)[number], quantity: '', unitCost: '', reason: '', occurredOn: today() });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api('/sales/stock-moves', {
        method: 'POST',
        body: {
          productId: product.id,
          kind: form.kind,
          quantity: Number(form.quantity.replace(',', '.')),
          unitCost: form.kind === 'purchase' && form.unitCost ? parseMoney(form.unitCost) : null,
          reason: form.reason || null,
          // Hoje = agora; outro dia registra o movimento naquela data (ex.: nota de compra antiga).
          occurredAt: form.occurredOn && form.occurredOn !== today() ? form.occurredOn : undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salesKey });
      setForm({ ...form, quantity: '', unitCost: '', reason: '' });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal open title={`Estoque: ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao lançar'}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Movimento">
            {(id) => (
              <Select id={id} value={form.kind} onChange={(e) => set({ kind: e.target.value as typeof form.kind })}>
                {stockMoveKinds.map((k) => (
                  <option key={k} value={k}>
                    {stockMoveLabel[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={form.kind === 'count' ? `Quantidade contada (${product.unit})` : `Quantidade (${product.unit})`}>
            {(id) => <Input id={id} inputMode="decimal" required value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />}
          </Field>
          {form.kind === 'purchase' && <Field label="Custo unitário (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.unitCost} onChange={(e) => set({ unitCost: e.target.value })} />}</Field>}
          <Field label="Observação">{(id) => <Input id={id} value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Nota fiscal, motivo…" />}</Field>
          <Field label="Data">{(id) => <Input id={id} type="date" max={today()} value={form.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />}</Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={save.isPending}>
            Lançar
          </Button>
        </div>
      </form>
      <h3 className="mb-2 mt-5 text-sm font-medium">Últimos movimentos</h3>
      {moves.isPending ? (
        <Spinner />
      ) : moves.isError ? (
        <Alert>{moves.error.message}</Alert>
      ) : moves.data.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhum movimento ainda.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {moves.data.map((m) => (
            <li key={m.id} className="flex justify-between gap-3 py-2">
              <span>
                {stockMoveLabel[m.kind]}
                {m.reason && <span className="text-fg-muted"> · {m.reason}</span>}
                <div className="text-xs text-fg-muted">
                  {formatDateTime(m.occurredAt)}
                  {m.userName && ` · ${m.userName}`}
                  {Math.abs(Date.parse(m.createdAt) - Date.parse(m.occurredAt)) > 3_600_000 && ` · lançado em ${formatDateTime(m.createdAt)}`}
                </div>
              </span>
              <span className="whitespace-nowrap text-right tabular-nums">
                <span className={m.quantity < 0 ? 'text-danger-600' : 'text-success-700'}>
                  {m.quantity > 0 ? '+' : ''}
                  {formatQuantity(m.quantity, product.unit)}
                </span>
                <div className="text-xs text-fg-muted">saldo {formatQuantity(m.balance, product.unit)}</div>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
