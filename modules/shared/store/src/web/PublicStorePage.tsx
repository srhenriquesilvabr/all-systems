import { AddressFields, ApiError, type Address } from '@all/module-sdk/web';
import { Alert, Button, Card, Checkbox, Field, Input, Spinner, Textarea, applyBrand, brandPalette, cn, isHexColor } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import {
  brl,
  deliveryFeeFor,
  formatQuantity,
  fractionalUnits,
  fulfillmentLabel,
  lineCents,
  normalizePhone,
  paymentModeHint,
  paymentModeLabel,
  type Fulfillment,
  type PaymentMode,
  type PlacedOrder,
  type PublicProduct,
  type PublicStore,
} from '../contracts';

/** Página pública: sem login, fala direto com /api/public/store/<slug>. */
async function publicApi<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/public/store${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, data?.code, Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? 'Erro'), data);
  return data as T;
}

// ---- Carrinho (no navegador) ---------------------------------------------------------------------

type Cart = Record<string, number>;

/**
 * Carrinho por loja no localStorage. Sem acesso ao armazenamento (modo privado, bloqueio), vale só
 * enquanto a página estiver aberta.
 */
function useCart(slug: string) {
  const key = `all.store.cart.${slug}`;
  const [cart, setCart] = useState<Cart>(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(key) ?? '{}') as unknown;
      if (!raw || typeof raw !== 'object') return {};
      return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && v > 0)) as Cart;
    } catch {
      return {};
    }
  });
  const save = useCallback(
    (next: Cart) => {
      setCart(next);
      try {
        if (Object.keys(next).length) window.localStorage.setItem(key, JSON.stringify(next));
        else window.localStorage.removeItem(key);
      } catch {
        // Sem armazenamento: fica só na memória.
      }
    },
    [key],
  );
  return { cart, save };
}

const stepOf = (p: Pick<PublicProduct, 'unit'>) => (fractionalUnits.includes(p.unit) ? 0.1 : 1);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const qtyLabel = (q: number, p: Pick<PublicProduct, 'unit'>) => (fractionalUnits.includes(p.unit) ? formatQuantity(q, p.unit) : String(q));

/** Itens do carrinho que ainda existem na loja, com a quantidade dentro do disponível. */
function cartLines(cart: Cart, products: PublicProduct[]) {
  return Object.entries(cart).flatMap(([id, quantity]) => {
    const p = products.find((x) => x.id === id);
    if (!p || p.soldOut) return [];
    const q = p.maxQuantity === null ? quantity : Math.min(quantity, p.maxQuantity);
    return q > 0 ? [{ product: p, quantity: round3(q), cents: lineCents(q, p.finalPrice) }] : [];
  });
}

// ---- Página ---------------------------------------------------------------------------------------

/** Lojinha pública: /loja/:slug, /loja/:slug/produto/:productId, /loja/:slug/carrinho e /loja/:slug/finalizar. */
export function PublicStorePage() {
  const { slug = '', productId } = useParams<{ slug: string; productId?: string }>();
  const { pathname } = useLocation();
  const store = useQuery({ queryKey: ['public-store', slug], queryFn: () => publicApi<PublicStore>(`/${slug}`), retry: false, staleTime: 60_000 });
  const { cart, save } = useCart(slug);
  // Desde quando a pessoa está na loja (envio rápido demais é de robô; o autopreenchimento do checkout não conta).
  const openedAt = useRef(Date.now());
  useCompanyColor(store.data?.company.brandColor ?? null);
  useSeo(store.data, productId);

  if (store.isPending) return <Shell><Spinner /></Shell>;
  if (store.isError) {
    return (
      <Shell>
        <Alert>{store.error instanceof ApiError && store.error.status === 404 ? 'Esta loja não está disponível.' : 'Não foi possível carregar a loja. Tente de novo.'}</Alert>
      </Shell>
    );
  }
  const data = store.data;
  const lines = cartLines(cart, data.products);
  const count = lines.length;
  const view = pathname.endsWith('/carrinho') ? 'cart' : pathname.endsWith('/finalizar') ? 'checkout' : productId ? 'product' : 'catalog';

  const setQty = (p: PublicProduct, q: number) => {
    const next = { ...cart };
    const clamped = p.maxQuantity === null ? q : Math.min(q, p.maxQuantity);
    if (clamped <= 0) delete next[p.id];
    else next[p.id] = round3(clamped);
    save(next);
  };

  return (
    <Shell store={data} cartCount={count}>
      {!data.open && <Alert tone="info">{data.pausedMessage}</Alert>}
      {view === 'catalog' && <Catalog store={data} cart={cart} setQty={setQty} />}
      {view === 'product' && <ProductView store={data} productId={productId!} cart={cart} setQty={setQty} />}
      {view === 'cart' && <CartView store={data} lines={lines} setQty={setQty} />}
      {view === 'checkout' && <Checkout store={data} lines={lines} startedAt={openedAt.current} onPlaced={() => save({})} />}
    </Shell>
  );
}

function Catalog({ store, cart, setQty }: { store: PublicStore; cart: Cart; setQty: (p: PublicProduct, q: number) => void }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const term = normalize(q);
  const shown = store.products.filter((p) => (!category || p.category === category) && (!term || normalize(`${p.title} ${p.description} ${p.category ?? ''}`).includes(term)));
  const featured = !term && !category ? shown.filter((p) => p.featured) : [];
  const rest = featured.length ? shown.filter((p) => !p.featured) : shown;

  return (
    <>
      {store.bannerUrl && <img src={store.bannerUrl} alt="" className="aspect-[3/1] w-full rounded-2xl object-cover" />}
      {store.welcome && <p className="whitespace-pre-wrap text-sm text-fg-muted">{store.welcome}</p>}
      <Input type="search" aria-label="Buscar produto" placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} />
      {store.categories.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Categorias">
          {[null, ...store.categories].map((c) => (
            <button
              key={c ?? 'all'}
              type="button"
              role="tab"
              aria-selected={category === c}
              onClick={() => setCategory(c)}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm', category === c ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface hover:border-brand-600')}
            >
              {c ?? 'Tudo'}
            </button>
          ))}
        </div>
      )}
      {featured.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Destaques</h2>
          <Grid products={featured} slug={store.slug} cart={cart} setQty={setQty} open={store.open} />
        </section>
      )}
      <section className="space-y-3">
        {featured.length > 0 && <h2 className="text-lg font-medium">{category ?? 'Todos os produtos'}</h2>}
        {rest.length ? (
          <Grid products={rest} slug={store.slug} cart={cart} setQty={setQty} open={store.open} />
        ) : (
          <p className="py-8 text-center text-sm text-fg-muted">{store.products.length ? 'Nenhum produto encontrado.' : 'Nenhum produto à venda no momento.'}</p>
        )}
      </section>
      {store.exchangePolicy && (
        <details className="rounded-2xl border border-line bg-surface p-4 text-sm">
          <summary className="cursor-pointer font-medium">Trocas e devoluções</summary>
          <p className="mt-2 whitespace-pre-wrap text-fg-muted">{store.exchangePolicy}</p>
        </details>
      )}
      <Fulfillments store={store} />
    </>
  );
}

function Fulfillments({ store }: { store: PublicStore }) {
  if (!store.pickup.enabled && !store.delivery.enabled) return null;
  return (
    <div className="space-y-1 text-sm text-fg-muted">
      {store.pickup.enabled && <p>Retirada: {[store.pickup.address, store.pickup.hours].filter(Boolean).join(' — ') || 'no local'}</p>}
      {store.delivery.enabled && (
        <p>
          Entrega
          {store.delivery.feeMode === 'fixed' ? (store.delivery.fixedFee > 0 ? `: taxa de ${brl(store.delivery.fixedFee)}` : ' grátis') : ': taxa conforme o bairro'}
          {store.delivery.minOrder > 0 && ` · pedido mínimo de ${brl(store.delivery.minOrder)}`}
          {store.delivery.eta && ` · ${store.delivery.eta}`}
        </p>
      )}
    </div>
  );
}

function Grid({ products, slug, cart, setQty, open }: { products: PublicProduct[]; slug: string; cart: Cart; setQty: (p: PublicProduct, q: number) => void; open: boolean }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {products.map((p) => (
        <li key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
          <Link to={`/loja/${slug}/produto/${p.id}`} className="block">
            <Photo src={p.photos[0]} alt={p.title} className="aspect-square w-full" />
            <div className="space-y-1 p-3">
              <span className="line-clamp-2 text-sm font-medium">{p.title}</span>
              <Price product={p} />
            </div>
          </Link>
          <div className="mt-auto px-3 pb-3">
            <AddButton product={p} quantity={cart[p.id] ?? 0} setQty={setQty} disabled={!open} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Price({ product: p, big }: { product: PublicProduct; big?: boolean }) {
  const unit = p.unit === 'un' ? '' : `/${p.unit}`;
  return (
    <span className={cn('block tabular-nums', big ? 'text-xl' : 'text-sm')}>
      {p.finalPrice < p.price && <span className="mr-1 text-xs text-fg-muted line-through">{brl(p.price)}</span>}
      <span className={cn('font-medium', p.finalPrice < p.price && 'text-success-700')}>{brl(p.finalPrice)}</span>
      <span className="text-xs text-fg-muted">{unit}</span>
      {p.soldOut && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-fg-muted">Esgotado</span>}
    </span>
  );
}

function Photo({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  return src ? (
    <img src={src} alt={alt} loading="lazy" className={cn('bg-muted object-cover', className)} />
  ) : (
    <span className={cn('flex items-center justify-center bg-muted text-3xl text-fg-subtle', className)} aria-hidden>
      🛍
    </span>
  );
}

function AddButton({ product: p, quantity, setQty, disabled }: { product: PublicProduct; quantity: number; setQty: (p: PublicProduct, q: number) => void; disabled?: boolean }) {
  const step = stepOf(p);
  if (p.soldOut) return <span className="block py-1.5 text-center text-sm text-fg-muted">Esgotado</span>;
  if (!quantity) {
    return (
      <Button size="sm" className="w-full" disabled={disabled} onClick={() => setQty(p, step)}>
        Adicionar
      </Button>
    );
  }
  const atMax = p.maxQuantity !== null && quantity + step > p.maxQuantity + 1e-9;
  return (
    <div className="flex items-center justify-between rounded-full border border-line">
      <button type="button" className="h-8 w-9 rounded-full text-lg hover:bg-muted" aria-label={`Diminuir ${p.title}`} onClick={() => setQty(p, round3(quantity - step))}>
        −
      </button>
      <span className="text-sm tabular-nums" aria-live="polite">
        {qtyLabel(quantity, p)}
      </span>
      <button type="button" className="h-8 w-9 rounded-full text-lg hover:bg-muted disabled:opacity-40" aria-label={`Aumentar ${p.title}`} disabled={atMax || disabled} onClick={() => setQty(p, round3(quantity + step))}>
        +
      </button>
    </div>
  );
}

function ProductView({ store, productId, cart, setQty }: { store: PublicStore; productId: string; cart: Cart; setQty: (p: PublicProduct, q: number) => void }) {
  const p = store.products.find((x) => x.id === productId);
  const [index, setIndex] = useState(0);
  if (!p) {
    return (
      <>
        <Alert>Este produto não está mais à venda.</Alert>
        <BackLink slug={store.slug} />
      </>
    );
  }
  const photos = p.photos;
  return (
    <>
      <BackLink slug={store.slug} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Photo src={photos[index]} alt={p.title} className="aspect-square w-full rounded-2xl" />
          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {photos.map((src, i) => (
                <button key={src} type="button" onClick={() => setIndex(i)} aria-label={`Foto ${i + 1}`} className={cn('size-16 shrink-0 overflow-hidden rounded-xl border-2', i === index ? 'border-brand-600' : 'border-transparent')}>
                  <img src={src} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          {p.category && <p className="text-xs uppercase tracking-wide text-fg-muted">{p.category}</p>}
          <h2 className="font-display text-2xl font-medium">{p.title}</h2>
          <Price product={p} big />
          {p.promoUntil && <p className="text-xs text-fg-muted">Promoção válida até {p.promoUntil.split('-').reverse().join('/')}.</p>}
          {p.description && <p className="whitespace-pre-wrap text-sm">{p.description}</p>}
          <div className="max-w-xs">
            <AddButton product={p} quantity={cart[p.id] ?? 0} setQty={setQty} disabled={!store.open} />
          </div>
          {(cart[p.id] ?? 0) > 0 && (
            <Link to={`/loja/${store.slug}/carrinho`} className="inline-block text-sm text-brand-700 underline">
              Ver o carrinho
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

type Line = ReturnType<typeof cartLines>[number];

function CartView({ store, lines, setQty }: { store: PublicStore; lines: Line[]; setQty: (p: PublicProduct, q: number) => void }) {
  const subtotal = lines.reduce((s, l) => s + l.cents, 0) / 100;
  return (
    <>
      <BackLink slug={store.slug} label="Continuar comprando" />
      <h2 className="font-display text-2xl font-medium">Carrinho</h2>
      {lines.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">Seu carrinho está vazio.</p>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {lines.map((l) => (
              <li key={l.product.id} className="flex items-center gap-3 p-3">
                <Photo src={l.product.photos[0]} alt="" className="size-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.product.title}</span>
                  <span className="text-xs text-fg-muted">{brl(l.product.finalPrice)}{l.product.unit === 'un' ? '' : `/${l.product.unit}`}</span>
                </div>
                <div className="w-28">
                  <AddButton product={l.product} quantity={l.quantity} setQty={setQty} />
                </div>
                <span className="w-20 text-right text-sm tabular-nums">{brl(l.cents / 100)}</span>
              </li>
            ))}
          </ul>
          <p className="text-right">
            Produtos: <strong className="tabular-nums">{brl(subtotal)}</strong>
          </p>
          {store.open ? (
            <Link to={`/loja/${store.slug}/finalizar`} className="flex h-11 items-center justify-center rounded-full bg-brand-600 font-medium text-white hover:bg-ink">
              Finalizar pedido
            </Link>
          ) : (
            <Alert tone="info">{store.pausedMessage}</Alert>
          )}
        </>
      )}
    </>
  );
}

function Checkout({ store, lines, startedAt, onPlaced }: { store: PublicStore; lines: Line[]; startedAt: number; onPlaced: () => void }) {
  const queryClient = useQueryClient();
  const fulfillments = (['pickup', 'delivery'] as const).filter((f) => store[f].enabled);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '', website: '' });
  const [fulfillment, setFulfillment] = useState<Fulfillment>(fulfillments[0] ?? 'pickup');
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(store.paymentModes[0] ?? null);
  const [address, setAddress] = useState<Address>({});
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  const subtotal = lines.reduce((s, l) => s + l.cents, 0) / 100;
  const fee = fulfillment === 'delivery' ? deliveryFeeFor(store.delivery, address.district) : 0;
  const belowMin = fulfillment === 'delivery' && subtotal < store.delivery.minOrder;

  const place = useMutation({
    mutationFn: () =>
      publicApi<PlacedOrder>(`/${store.slug}/orders`, {
        method: 'POST',
        body: {
          name: form.name,
          phone: form.phone,
          email: form.email || null,
          fulfillment,
          address:
            fulfillment === 'delivery'
              ? { zip: address.zip || null, street: address.street ?? '', number: address.number ?? '', complement: address.complement || null, district: address.district ?? '', city: address.city ?? '', state: address.state || null }
              : null,
          notes: form.notes || null,
          items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          paymentMode,
          consent,
          consentVersion: store.consent.version,
          website: form.website,
          startedAt,
        },
      }),
    onSuccess: (r) => {
      onPlaced();
      if (r.next?.kind === 'redirect') window.location.assign(r.next.url);
    },
    onError: (err) => {
      // Estoque ou preço mudou: recarrega a vitrine para o carrinho se ajustar.
      if (err instanceof ApiError && (err.code === 'OUT_OF_STOCK' || err.code === 'PRODUCT_UNAVAILABLE' || err.code === 'CONSENT_OUTDATED')) {
        void queryClient.invalidateQueries({ queryKey: ['public-store', store.slug] });
      }
    },
  });

  if (place.data) return <Placed store={store} result={place.data} />;
  if (!lines.length) {
    return (
      <>
        <p className="py-8 text-center text-sm text-fg-muted">Seu carrinho está vazio.</p>
        <BackLink slug={store.slug} label="Ver produtos" />
      </>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!normalizePhone(form.phone)) return setError('Informe o celular com DDD');
    if (!paymentMode) return setError('Escolha como finalizar o pedido');
    if (fulfillment === 'delivery' && fee === null) return setError('Ainda não entregamos neste bairro. Escolha a retirada ou fale com a loja.');
    if (belowMin) return setError(`O pedido mínimo para entrega é ${brl(store.delivery.minOrder)}`);
    place.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Link to={`/loja/${store.slug}/carrinho`} className="text-sm text-fg-muted hover:text-fg">
        ← Voltar ao carrinho
      </Link>
      <h2 className="font-display text-2xl font-medium">Finalizar pedido</h2>
      {(error ?? place.error) && <Alert>{error ?? (place.error instanceof ApiError ? place.error.message : 'Não foi possível enviar o pedido. Tente de novo.')}</Alert>}
      {!store.open && <Alert tone="info">{store.pausedMessage}</Alert>}

      <Card className="space-y-4 p-5">
        <h3 className="font-medium">Seus dados</h3>
        <Field label="Nome">{(id) => <Input id={id} required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Celular (com DDD)">{(id) => <Input id={id} type="tel" required autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
          <Field label="E-mail (opcional)">{(id) => <Input id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />}</Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-medium">Como receber</h3>
        <Choices
          name="fulfillment"
          value={fulfillment}
          onChange={(v) => setFulfillment(v as Fulfillment)}
          options={fulfillments.map((f) => ({
            value: f,
            label: fulfillmentLabel[f],
            hint: f === 'pickup' ? [store.pickup.address, store.pickup.hours].filter(Boolean).join(' — ') : [store.delivery.eta, store.delivery.minOrder > 0 ? `pedido mínimo ${brl(store.delivery.minOrder)}` : ''].filter(Boolean).join(' · '),
          }))}
        />
        {fulfillment === 'delivery' && (
          <>
            <AddressFields value={address} onChange={setAddress} cepPath={(cep) => `/public/store/${store.slug}/cep/${cep}`} />
            {address.district && fee === null && <p className="text-sm text-danger-600">Ainda não entregamos neste bairro.</p>}
            {store.delivery.feeMode === 'district' && (
              <p className="text-xs text-fg-muted">Bairros atendidos: {store.delivery.districts.map((d) => d.name).join(', ')}.</p>
            )}
          </>
        )}
        <Field label="Observações (opcional)">{(id) => <Textarea id={id} rows={2} maxLength={500} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ponto de referência, sabor, horário…" />}</Field>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-medium">Pagamento</h3>
        {store.paymentModes.length ? (
          <Choices name="payment" value={paymentMode ?? ''} onChange={(v) => setPaymentMode(v as PaymentMode)} options={store.paymentModes.map((m) => ({ value: m, label: paymentModeLabel[m], hint: paymentModeHint[m] }))} />
        ) : (
          <Alert tone="info">A loja não está aceitando pedidos pelo site agora.</Alert>
        )}
      </Card>

      <Card className="space-y-2 p-5 text-sm">
        {lines.map((l) => (
          <p key={l.product.id} className="flex justify-between gap-3">
            <span>
              {qtyLabel(l.quantity, l.product)} × {l.product.title}
            </span>
            <span className="tabular-nums">{brl(l.cents / 100)}</span>
          </p>
        ))}
        {fulfillment === 'delivery' && (
          <p className="flex justify-between gap-3 text-fg-muted">
            <span>Entrega</span>
            <span className="tabular-nums">{fee === null ? '—' : fee > 0 ? brl(fee) : 'grátis'}</span>
          </p>
        )}
        <p className="flex justify-between gap-3 border-t border-line pt-2 text-base font-medium">
          <span>Total</span>
          <span className="tabular-nums">{brl(subtotal + (fee ?? 0))}</span>
        </p>
      </Card>

      {/* Armadilha para robôs: escondido de pessoas e de leitores de tela. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Site
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
        </label>
      </div>
      <div className="rounded-xl border border-line bg-muted/40 p-3 text-xs leading-relaxed text-fg-muted">{store.consent.text}</div>
      <Checkbox required label="Li e concordo com o uso dos meus dados descrito acima." checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      <Button type="submit" className="h-11 w-full" loading={place.isPending} disabled={!consent || !store.open || !paymentMode}>
        {paymentMode === 'whatsapp' ? 'Enviar pedido e abrir o WhatsApp' : 'Enviar pedido'}
      </Button>
    </form>
  );
}

function Placed({ store, result }: { store: PublicStore; result: PlacedOrder }) {
  const next = result.next;
  return (
    <Card className="space-y-4 p-6 text-center">
      <p className="font-display text-2xl font-medium">Pedido enviado!</p>
      {result.order ? (
        <p className="text-fg-muted">
          Seu pedido nº <strong className="text-fg">{result.order.number}</strong> ({brl(result.order.total)}) foi recebido pela loja {store.company.name}.
        </p>
      ) : (
        <p className="text-fg-muted">Recebemos seu pedido.</p>
      )}
      {next?.kind === 'whatsapp' ? (
        <>
          <p className="text-sm text-fg-muted">Para combinar o pagamento, envie o resumo do pedido para a loja pelo WhatsApp:</p>
          <a href={next.url} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center rounded-full bg-[#1f8f4e] px-6 font-medium text-white hover:opacity-90">
            Abrir o WhatsApp da loja
          </a>
        </>
      ) : (
        <p className="text-sm text-fg-muted">A loja vai confirmar o pedido e avisar você pelo telefone ou e-mail informados.</p>
      )}
      <div>
        <BackLink slug={store.slug} label="Voltar à loja" />
      </div>
    </Card>
  );
}

function Choices({ name, value, onChange, options }: { name: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; hint?: string }[] }) {
  return (
    <div className="space-y-2" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3', value === o.value ? 'border-brand-600 bg-brand-50' : 'border-line')}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1" />
          <span>
            <span className="block text-sm font-medium">{o.label}</span>
            {o.hint && <span className="block text-xs text-fg-muted">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

const BackLink = ({ slug, label = '← Todos os produtos' }: { slug: string; label?: string }) => (
  <Link to={`/loja/${slug}`} className="text-sm text-fg-muted hover:text-fg">
    {label.startsWith('←') ? label : `← ${label}`}
  </Link>
);

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Cor da empresa nesta página (mesma regra do agendamento online). */
function useCompanyColor(color: string | null) {
  useEffect(() => {
    if (!color || !isHexColor(color)) return;
    applyBrand(brandPalette(color), { id: 'brand-public', root: ':root:root:root' });
    return () => applyBrand(null, { id: 'brand-public' });
  }, [color]);
}

/** Título e descrição da página (buscadores e prévia de links que executam JavaScript). */
function useSeo(store: PublicStore | undefined, productId: string | undefined) {
  const product = useMemo(() => (productId ? store?.products.find((p) => p.id === productId) : undefined), [store, productId]);
  useEffect(() => {
    if (!store) return;
    const previous = document.title;
    document.title = product ? `${product.title} · ${store.company.name}` : `${store.company.name} · Loja online`;
    const description = (product?.description || store.welcome || `Compre online na ${store.company.name}.`).replace(/\s+/g, ' ').slice(0, 160);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    const previousContent = meta.content;
    meta.content = description;
    return () => {
      document.title = previous;
      if (created) meta!.remove();
      else meta!.content = previousContent;
    };
  }, [store, product]);
}

function Shell({ store, cartCount = 0, children }: { store?: PublicStore; cartCount?: number; children: ReactNode }) {
  const company = store?.company;
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b-4 border-brand-600 bg-ink px-4 py-3 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {store ? (
            <Link to={`/loja/${store.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
              {company?.logoUrl && (
                <span className="flex h-12 max-w-[7rem] shrink-0 items-center justify-center rounded-xl bg-white p-1.5">
                  <img src={company.logoUrl} alt={`Logo de ${company.name}`} className="max-h-full max-w-full object-contain" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block text-xs text-ink-fg-muted">Loja online</span>
                <span className="block truncate font-display text-xl font-medium">{company?.name}</span>
              </span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {store && (
            <Link to={`/loja/${store.slug}/carrinho`} className="relative inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/20" aria-label={`Carrinho, ${cartCount} ${cartCount === 1 ? 'produto' : 'produtos'}`}>
              Carrinho
              {cartCount > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs">{cartCount}</span>}
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">{children}</main>
      <footer className="pb-8 text-center text-xs text-fg-muted">
        Loja por <span className="font-display font-semibold">palmer</span>
        <span className="font-display font-light text-brand-600">tech</span>
      </footer>
    </div>
  );
}
