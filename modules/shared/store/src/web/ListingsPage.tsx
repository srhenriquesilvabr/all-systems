import { api, ApiError, apiUpload, AuthImage, parseMoney, SpreadsheetImport, today, useCan, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { brl, effectivePrice, formatQuantity, type StoreProduct } from '../contracts';
import { moneyText, storeKey, useStoreCategories, useStoreProducts, useStoreStatus } from './hooks';

const MAX_PHOTOS = 8;

/** Anúncios: cada produto do PDV pode ir para a loja com texto, fotos, categoria e promoção. */
export function ListingsPage() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'listed' | 'unlisted'>('all');
  const products = useStoreProducts({ q: q.trim() || undefined, listed: filter === 'all' ? undefined : filter === 'listed' });
  const status = useStoreStatus();
  const queryClient = useQueryClient();
  // Retrato do produto ao abrir: o painel não fecha se o filtro deixar de mostrá-lo (ex.: ganhou anúncio).
  const [editing, setEditing] = useState<StoreProduct | null>(null);

  return (
    <>
      <PageHeader
        title="Anúncios da loja"
        description="Escolha os produtos do PDV que aparecem na loja online. Preço e estoque vêm do PDV."
        actions={
          <>
            <SpreadsheetImport spec={listingImportSpec} onImported={() => queryClient.invalidateQueries({ queryKey: storeKey })} />
            {status.data?.publicUrl && (
              <a href={status.data.publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-line px-5 text-sm font-medium hover:border-fg">
                Ver a loja
              </a>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input type="search" aria-label="Buscar produto" placeholder="Nome, código ou categoria" className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <div role="radiogroup" aria-label="Filtrar" className="flex gap-1 text-sm">
          {(
            [
              ['all', 'Todos'],
              ['listed', 'Com anúncio'],
              ['unlisted', 'Sem anúncio'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1.5 ${filter === key ? 'bg-brand-50 font-medium text-brand-700' : 'text-fg-muted hover:bg-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Card>
        {products.isPending ? (
          <Spinner />
        ) : products.isError ? (
          <div className="p-4">
            <Alert>{products.error.message}</Alert>
          </div>
        ) : products.data.length === 0 ? (
          <EmptyState title={q ? 'Nenhum produto encontrado' : 'Nenhum produto no PDV'} description="Os anúncios partem do cadastro de produtos do PDV (Produtos e estoque)." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>Categoria na loja</Th>
                <Th className="text-right">Preço</Th>
                <Th className="text-right">Disponível</Th>
                <Th>Loja</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {products.data.map((p) => (
                <ProductRow key={p.productId} product={p} onEdit={() => setEditing(p)} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ListingPanel product={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProductRow({ product: p, onEdit }: { product: StoreProduct; onEdit: () => void }) {
  const l = p.listing;
  const final = l ? effectivePrice(p.price, l) : p.price;
  return (
    <tr>
      <Td>
        <div className="flex items-center gap-3">
          {l?.photos[0] ? (
            <AuthImage fileId={l.photos[0].fileId} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="size-10 shrink-0 rounded-lg bg-muted" aria-hidden />
          )}
          <div className="min-w-0">
            <span className={p.active ? 'font-medium' : 'text-fg-subtle'}>{l?.title || p.name}</span>
            {l?.title && <span className="block text-xs text-fg-muted">PDV: {p.name}</span>}
            {!p.active && <Badge tone="warning">Inativo no PDV</Badge>}
          </div>
        </div>
      </Td>
      <Td className="text-sm text-fg-muted">{l?.category || p.category || '—'}</Td>
      <Td className="whitespace-nowrap text-right tabular-nums">
        {final < p.price ? (
          <>
            <span className="text-xs text-fg-muted line-through">{brl(p.price)}</span> <span className="font-medium text-success-700">{brl(final)}</span>
          </>
        ) : (
          brl(p.price)
        )}
        <span className="text-xs text-fg-muted">/{p.unit}</span>
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums">
        {p.available === null ? (
          <span className="text-fg-subtle">não controla</span>
        ) : (
          <span className={p.available <= 0 ? 'font-medium text-danger-600' : undefined}>
            {formatQuantity(p.available, p.unit)}
            {p.reserved > 0 && <span className="block text-xs font-normal text-fg-muted">{formatQuantity(p.reserved, p.unit)} reservado</span>}
          </span>
        )}
      </Td>
      <Td>
        {l?.visible ? <Badge tone="success">Publicado</Badge> : l ? <Badge>Rascunho</Badge> : <span className="text-sm text-fg-subtle">—</span>}
        {l?.featured && (
          <span className="ml-1">
            <Badge tone="brand">Destaque</Badge>
          </span>
        )}
      </Td>
      <Td className="text-right">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {l ? 'Editar' : 'Anunciar'}
        </Button>
      </Td>
    </tr>
  );
}

/** Cadastro do anúncio, aberto na própria página: textos, promoção e galeria de fotos. */
function ListingPanel({ product, onClose }: { product: StoreProduct; onClose: () => void }) {
  const queryClient = useQueryClient();
  const categories = useStoreCategories();
  const listId = useId();
  const l = product.listing;
  const [form, setForm] = useState({
    visible: l?.visible ?? product.active,
    title: l?.title ?? '',
    description: l?.description ?? '',
    category: l?.category ?? '',
    featured: l?.featured ?? false,
    promoPrice: moneyText(l?.promoPrice),
    promoUntil: l?.promoUntil ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const refresh = () => queryClient.invalidateQueries({ queryKey: storeKey });

  const save = useMutation({
    mutationFn: () => {
      const promo = form.promoPrice.trim() ? parseMoney(form.promoPrice) : null;
      if (promo !== null && Number.isNaN(promo)) throw new Error('Preço promocional inválido');
      return api(`/store/listings/${product.productId}`, {
        method: 'PUT',
        body: {
          visible: form.visible,
          title: form.title.trim() || null,
          description: form.description,
          category: form.category.trim() || null,
          featured: form.featured,
          promoPrice: promo,
          promoUntil: promo === null ? null : form.promoUntil || null,
        },
      });
    },
    onSuccess: () => {
      refresh();
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
      title={l ? `Anúncio: ${l.title || product.name}` : `Anunciar ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="store-listing-form" loading={save.isPending}>
            Salvar anúncio
          </Button>
        </>
      }
    >
      <form id="store-listing-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError || save.error instanceof Error ? save.error.message : 'Erro ao salvar'}</Alert>}
        <p className="text-sm text-fg-muted">
          Preço no PDV: <strong className="text-fg">{brl(product.price)}</strong>/{product.unit} ·{' '}
          {product.available === null ? 'não controla estoque' : `disponível: ${formatQuantity(product.available, product.unit)}`}
        </p>
        <Checkbox label="Publicado na loja" checked={form.visible} onChange={(e) => set({ visible: e.target.checked })} disabled={!product.active} />
        {!product.active && <Alert tone="info">Este produto está inativo no PDV: ative-o em Produtos e estoque para publicar.</Alert>}
        <Field label="Título na loja" hint="Vazio = nome do produto no PDV.">
          {(id) => <Input id={id} maxLength={120} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={product.name} />}
        </Field>
        <Field label="Descrição">
          {(id) => <Textarea id={id} rows={4} maxLength={3000} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Ingredientes, tamanho, sabores, como conservar…" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria na loja" hint="Vazio = categoria do PDV.">
            {(id) => (
              <>
                <Input id={id} list={listId} maxLength={60} value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder={product.category ?? 'Ex.: Doces'} />
                <datalist id={listId}>
                  {(categories.data ?? []).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Destaque (aparece primeiro)" checked={form.featured} onChange={(e) => set({ featured: e.target.checked })} />
          </div>
          <Field label="Preço promocional (R$)" hint={`Menor que ${brl(product.price)}. Vazio = sem promoção.`}>
            {(id) => <Input id={id} inputMode="decimal" value={form.promoPrice} onChange={(e) => set({ promoPrice: e.target.value })} placeholder="0,00" />}
          </Field>
          <Field label="Promoção válida até" hint="Inclusive. Vazio = sem prazo.">
            {(id) => <Input id={id} type="date" min={today()} value={form.promoUntil} onChange={(e) => set({ promoUntil: e.target.value })} disabled={!form.promoPrice.trim()} />}
          </Field>
        </div>
      </form>
      <Photos product={product} onChanged={refresh} />
    </Modal>
  );
}

/** Galeria do anúncio: enviar várias, mudar a ordem (a primeira é a capa) e remover. */
function Photos({ product, onChanged }: { product: StoreProduct; onChanged: () => void }) {
  const [photos, setPhotos] = useState(product.listing?.photos.map((p) => p.fileId) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/store/listings/${product.productId}/photos`;

  async function run(fn: () => Promise<StoreProduct>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await fn();
      setPhotos(updated.listing?.photos.map((p) => p.fileId) ?? []);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar a foto');
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    if (photos.length + files.length > MAX_PHOTOS) return setError(`Cada anúncio pode ter até ${MAX_PHOTOS} fotos`);
    await run(async () => {
      let last: StoreProduct | null = null;
      for (const file of files) last = await apiUpload<StoreProduct>(base, 'photo', file);
      return last!;
    });
  }

  function move(index: number, delta: number) {
    const next = [...photos];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    void run(() => api<StoreProduct>(`${base}/order`, { method: 'PUT', body: { fileIds: next } }));
  }

  return (
    <section className="mt-6 space-y-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Fotos</h2>
        <label className={`inline-flex h-8 cursor-pointer items-center rounded-full border border-line px-3.5 text-sm font-medium hover:border-fg ${busy || photos.length >= MAX_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}>
          {busy ? 'Enviando…' : 'Adicionar fotos'}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={upload} disabled={busy || photos.length >= MAX_PHOTOS} />
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      {photos.length === 0 ? (
        <p className="text-sm text-fg-muted">Sem fotos ainda. JPG, PNG ou WebP, até 5 MB cada; a primeira é a capa.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((fileId, i) => (
            <li key={fileId} className="space-y-1">
              <AuthImage fileId={fileId} alt={`Foto ${i + 1}`} className="aspect-square w-full rounded-xl object-cover" />
              <div className="flex items-center justify-between gap-1 text-xs">
                <span className="text-fg-muted">{i === 0 ? 'Capa' : `${i + 1}ª`}</span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="sm" aria-label="Mover para a esquerda" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    ←
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Mover para a direita" disabled={busy || i === photos.length - 1} onClick={() => move(i, 1)}>
                    →
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Remover foto" disabled={busy} onClick={() => run(() => api<StoreProduct>(`${base}/${fileId}`, { method: 'DELETE' }))}>
                    ✕
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Planilha ---------------------------------------------------------------------------------------

const importColumns: ImportColumn[] = [
  { key: 'product', label: 'Produto (código de barras, código interno ou nome)', required: true, example: 'Bolo de cenoura', hint: 'Como está no PDV (Produtos e estoque)' },
  { key: 'visible', label: 'Publicado', type: 'boolean', example: 'Sim', hint: 'Sim ou Não (vazio = Sim)' },
  { key: 'title', label: 'Título na loja', example: 'Bolo de cenoura com cobertura de chocolate', hint: 'Vazio = nome do PDV' },
  { key: 'description', label: 'Descrição', example: 'Fatia generosa, feito no dia.' },
  { key: 'category', label: 'Categoria na loja', example: 'Bolos', hint: 'Vazio = categoria do PDV' },
  { key: 'featured', label: 'Destaque', type: 'boolean', example: 'Não', hint: 'Sim ou Não (vazio = Não)' },
  { key: 'promoPrice', label: 'Preço promocional (R$)', type: 'money', example: '9,90', hint: 'Menor que o preço do PDV' },
  { key: 'promoUntil', label: 'Promoção até', type: 'date', example: '31/12/2026' },
];

/** Planilha de anúncios: cada linha publica (ou atualiza) o anúncio de um produto do PDV. */
const listingImportSpec: ImportSpec = {
  entity: 'anúncios',
  fileName: 'anuncios-da-loja',
  columns: importColumns,
  create: (row: ImportRow) => {
    const text = (k: string) => (row[k] === null || row[k] === undefined ? null : String(row[k]));
    return api('/store/listings/import', {
      method: 'POST',
      body: {
        product: text('product'),
        visible: (row.visible as boolean | null) ?? true,
        title: text('title'),
        description: text('description') ?? '',
        category: text('category'),
        featured: (row.featured as boolean | null) ?? false,
        promoPrice: row.promoPrice ?? null,
        promoUntil: row.promoPrice != null ? (row.promoUntil ?? null) : null,
      },
    });
  },
};
