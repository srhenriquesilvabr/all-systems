import { api, ApiError, CustomerSearch, parseMoney, useSession, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, Modal, Select } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatQuantity, fractionalUnits, salePaymentLabel, salePaymentMethods, type Product, type Sale, type SalePaymentMethod } from '../contracts';
import { brl, salesKey, useProducts, useSalesSettings } from './hooks';

interface CartLine {
  product: Product;
  quantity: number;
}

const cents = (n: number) => Math.round(n * 100);
const lineCents = (l: CartLine) => Math.round(l.quantity * cents(l.product.price));

/**
 * Frente de caixa. O campo de busca aceita leitor de código de barras (digita e dá Enter):
 * código exato entra direto no carrinho; produto por peso pede a quantidade.
 */
export function PosPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const search = useProducts({ q: q.trim() || undefined, active: true }, q.trim().length >= 2);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [discount, setDiscount] = useState('');
  const [weighing, setWeighing] = useState<Product | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const subtotal = cart.reduce((sum, l) => sum + lineCents(l), 0);
  const discountCents = Math.min(cents(parseMoney(discount) || 0), subtotal);
  const total = subtotal - discountCents;

  function add(product: Product, quantity = 1) {
    setCart((current) => {
      const existing = current.find((l) => l.product.id === product.id);
      if (existing) return current.map((l) => (l === existing ? { ...l, quantity: Math.round((l.quantity + quantity) * 1000) / 1000 } : l));
      return [...current, { product, quantity }];
    });
    setQ('');
    searchRef.current?.focus();
  }

  function choose(product: Product) {
    if (fractionalUnits.includes(product.unit)) setWeighing(product);
    else add(product);
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = q.trim();
    const results = search.data ?? [];
    const exact = results.find((p) => p.barcode === term || p.sku === term);
    if (exact) choose(exact);
    else if (results.length === 1) choose(results[0]!);
  }

  function reset() {
    setCart([]);
    setCustomer(null);
    setDiscount('');
    setDone(null);
    searchRef.current?.focus();
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] print:hidden">
        <div className="min-w-0 space-y-4">
          <div className="relative">
            <Input
              ref={searchRef}
              type="search"
              aria-label="Buscar produto"
              placeholder="Código de barras, código ou nome do produto"
              className="h-12 text-base"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              autoFocus
            />
            {q.trim().length >= 2 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                {search.data?.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted" onClick={() => choose(p)}>
                      <span>
                        <span className="font-medium">{p.name}</span>
                        {p.barcode && <span className="ml-2 text-xs text-fg-muted">{p.barcode}</span>}
                      </span>
                      <span className="whitespace-nowrap tabular-nums">
                        {brl(p.price)}
                        <span className="text-xs text-fg-muted">/{p.unit}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {search.data?.length === 0 && <li className="px-4 py-3 text-sm text-fg-muted">Nenhum produto encontrado.</li>}
              </ul>
            )}
          </div>
          <Card>
            {cart.length === 0 ? (
              <p className="px-5 py-16 text-center text-fg-muted">Passe o código de barras ou busque o produto para começar.</p>
            ) : (
              <ul className="divide-y divide-line">
                {cart.map((l) => (
                  <li key={l.product.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{l.product.name}</div>
                      <div className="text-xs text-fg-muted tabular-nums">
                        {brl(l.product.price)}/{l.product.unit}
                      </div>
                    </div>
                    <Input
                      aria-label={`Quantidade de ${l.product.name}`}
                      inputMode="decimal"
                      className="w-24 text-right tabular-nums"
                      value={String(l.quantity).replace('.', ',')}
                      onChange={(e) => {
                        const value = Number(e.target.value.replace(',', '.'));
                        if (!Number.isNaN(value)) setCart(cart.map((x) => (x === l ? { ...x, quantity: value } : x)));
                      }}
                    />
                    <div className="w-24 text-right font-medium tabular-nums">{brl(lineCents(l) / 100)}</div>
                    <Button variant="ghost" size="sm" aria-label={`Remover ${l.product.name}`} onClick={() => setCart(cart.filter((x) => x !== l))}>
                      ✕
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit space-y-4 p-5 lg:sticky lg:top-6">
          <div className="text-sm">
            {customer ? (
              <div className="flex items-center justify-between gap-2">
                <span>
                  Cliente: <span className="font-medium">{customer.name}</span>
                </span>
                <button type="button" className="text-brand-700 hover:underline" onClick={() => setCustomer(null)}>
                  remover
                </button>
              </div>
            ) : (
              <button type="button" className="text-brand-700 hover:underline" onClick={() => setPickingCustomer(true)}>
                + Identificar cliente
              </button>
            )}
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">Subtotal</dt>
              <dd className="tabular-nums">{brl(subtotal / 100)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-fg-muted">Desconto</dt>
              <dd>
                <Input aria-label="Desconto" inputMode="decimal" className="h-8 w-28 text-right tabular-nums" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </dd>
            </div>
          </dl>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-medium">Total</span>
            <span className="font-display text-3xl font-semibold tabular-nums">{brl(total / 100)}</span>
          </div>
          <Button className="h-12 w-full text-base" disabled={!cart.length || cart.some((l) => !(l.quantity > 0))} onClick={() => setPaying(true)}>
            Receber
          </Button>
          {cart.length > 0 && (
            <Button variant="ghost" className="w-full" onClick={reset}>
              Cancelar venda
            </Button>
          )}
        </Card>
      </div>

      {pickingCustomer && (
        <Modal open title="Identificar cliente" onClose={() => setPickingCustomer(false)}>
          <CustomerSearch
            onSelect={(c) => {
              setCustomer(c);
              setPickingCustomer(false);
            }}
          />
        </Modal>
      )}
      {weighing && (
        <WeightModal
          product={weighing}
          onClose={() => setWeighing(null)}
          onConfirm={(quantity) => {
            add(weighing, quantity);
            setWeighing(null);
          }}
        />
      )}
      {paying && (
        <PaymentModal
          totalCents={total}
          hasCustomer={!!customer}
          onClose={() => setPaying(false)}
          onPay={(payments) =>
            api<Sale>('/sales', {
              method: 'POST',
              body: { customerId: customer?.id ?? null, items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })), discount: discountCents / 100, payments },
            }).then((sale) => {
              queryClient.invalidateQueries({ queryKey: salesKey });
              setPaying(false);
              setDone(sale);
            })
          }
        />
      )}
      {done && <DoneModal sale={done} onNext={reset} />}
      {done && <Receipt sale={done} />}
    </>
  );
}

function WeightModal({ product, onClose, onConfirm }: { product: Product; onClose: () => void; onConfirm: (q: number) => void }) {
  const [value, setValue] = useState('');
  const quantity = Number(value.replace(',', '.'));
  const valid = quantity > 0;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) onConfirm(Math.round(quantity * 1000) / 1000);
  }
  return (
    <Modal
      open
      title={product.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="pos-weight-form" disabled={!valid}>
            Adicionar
          </Button>
        </>
      }
    >
      <form id="pos-weight-form" onSubmit={submit} className="space-y-3">
        <Field label={`Quantidade (${product.unit})`} hint={valid ? `${brl((Math.round(quantity * cents(product.price))) / 100)}` : `${brl(product.price)} o ${product.unit}`}>
          {(id) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,000" autoFocus />}
        </Field>
      </form>
    </Modal>
  );
}

function PaymentModal({ totalCents, hasCustomer, onClose, onPay }: { totalCents: number; hasCustomer: boolean; onClose: () => void; onPay: (p: { method: SalePaymentMethod; amount: number }[]) => Promise<void> }) {
  const [lines, setLines] = useState<{ method: SalePaymentMethod; amount: string }[]>([{ method: 'cash', amount: (totalCents / 100).toFixed(2).replace('.', ',') }]);
  const pay = useMutation({ mutationFn: () => onPay(lines.map((l) => ({ method: l.method, amount: parseMoney(l.amount) }))) });
  const paid = lines.reduce((sum, l) => sum + cents(parseMoney(l.amount) || 0), 0);
  const remaining = totalCents - paid;
  const cash = lines.filter((l) => l.method === 'cash').reduce((sum, l) => sum + cents(parseMoney(l.amount) || 0), 0);
  const change = paid > totalCents ? paid - totalCents : 0;
  const invalid = remaining > 0 || change > cash || (lines.some((l) => l.method === 'on_account') && !hasCustomer);
  const methods = useMemo(() => salePaymentMethods.filter((m) => m !== 'on_account' || hasCustomer), [hasCustomer]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!invalid) pay.mutate();
  }

  return (
    <Modal
      open
      title={`Receber ${brl(totalCents / 100)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="pos-pay-form" loading={pay.isPending} disabled={invalid}>
            Concluir venda
          </Button>
        </>
      }
    >
      <form id="pos-pay-form" onSubmit={submit} className="space-y-3">
        {pay.error && <Alert>{pay.error instanceof ApiError ? pay.error.message : 'Erro ao concluir a venda'}</Alert>}
        <div className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={lines.length === 1 && lines[0]!.method === m ? 'primary' : 'secondary'}
              onClick={() => setLines([{ method: m, amount: (totalCents / 100).toFixed(2).replace('.', ',') }])}
            >
              {salePaymentLabel[m]}
            </Button>
          ))}
        </div>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Select aria-label="Forma de pagamento" className="flex-1" value={l.method} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, method: e.target.value as SalePaymentMethod } : x)))}>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {salePaymentLabel[m]}
                </option>
              ))}
            </Select>
            <Input
              aria-label={l.method === 'cash' ? 'Valor recebido' : 'Valor'}
              inputMode="decimal"
              className="w-32 text-right tabular-nums"
              value={l.amount}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
              autoFocus={i === lines.length - 1}
            />
            {lines.length > 1 && (
              <Button type="button" variant="ghost" size="sm" aria-label="Remover pagamento" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                ✕
              </Button>
            )}
          </div>
        ))}
        {remaining > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-fg-muted">Falta {brl(remaining / 100)}</span>
            {lines.length < 5 && (
              <button type="button" className="text-brand-700 hover:underline" onClick={() => setLines([...lines, { method: 'pix', amount: (remaining / 100).toFixed(2).replace('.', ',') }])}>
                + Outra forma de pagamento
              </button>
            )}
          </div>
        )}
        {change > 0 && (
          <div className={change > cash ? 'text-sm text-danger-600' : 'rounded-xl bg-muted px-4 py-3'}>
            {change > cash ? 'Só pagamento em dinheiro pode ter troco.' : (
              <div className="flex items-baseline justify-between">
                <span>Troco</span>
                <span className="font-display text-2xl font-semibold tabular-nums">{brl(change / 100)}</span>
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}

function DoneModal({ sale, onNext }: { sale: Sale; onNext: () => void }) {
  return (
    <Modal
      open
      title={`Venda #${sale.number} concluída`}
      onClose={onNext}
      footer={
        <>
          <Button variant="secondary" onClick={() => window.print()}>
            Imprimir cupom
          </Button>
          <Button onClick={onNext} autoFocus>
            Nova venda
          </Button>
        </>
      }
    >
      <div className="space-y-1 text-center">
        <div className="font-display text-3xl font-semibold tabular-nums">{brl(sale.total)}</div>
        {sale.change > 0 && <div className="text-lg">Troco: {brl(sale.change)}</div>}
      </div>
    </Modal>
  );
}

/** Cupom para impressora térmica (80 mm). Não é documento fiscal. */
function Receipt({ sale }: { sale: Sale }) {
  const { tenant } = useSession();
  const settings = useSalesSettings();
  return (
    <div className="hidden w-[72mm] font-mono text-[11px] leading-snug text-black print:block">
      <div className="text-center font-bold">{tenant.name}</div>
      <div className="text-center">Venda #{sale.number} · {new Date(sale.createdAt).toLocaleString('pt-BR')}</div>
      <div className="my-1 border-t border-dashed border-black" />
      {sale.items.map((i) => (
        <div key={i.productId}>
          <div>{i.name}</div>
          <div className="flex justify-between">
            <span>
              {formatQuantity(i.quantity, i.unit)} x {brl(i.unitPrice)}
            </span>
            <span>{brl(i.total)}</span>
          </div>
        </div>
      ))}
      <div className="my-1 border-t border-dashed border-black" />
      {sale.discount > 0 && (
        <div className="flex justify-between">
          <span>Desconto</span>
          <span>-{brl(sale.discount)}</span>
        </div>
      )}
      <div className="flex justify-between font-bold">
        <span>TOTAL</span>
        <span>{brl(sale.total)}</span>
      </div>
      {sale.payments.map((p) => (
        <div key={p.method} className="flex justify-between">
          <span>{salePaymentLabel[p.method]}</span>
          <span>{brl(p.amount + (p.method === 'cash' ? sale.change : 0))}</span>
        </div>
      ))}
      {sale.change > 0 && (
        <div className="flex justify-between">
          <span>Troco</span>
          <span>{brl(sale.change)}</span>
        </div>
      )}
      {sale.customer && <div className="mt-1">Cliente: {sale.customer.name}</div>}
      <div className="my-1 border-t border-dashed border-black" />
      <div className="text-center">{settings.data?.receiptFooter ?? 'Obrigado pela preferência!'}</div>
      <div className="text-center">Não é documento fiscal</div>
    </div>
  );
}
