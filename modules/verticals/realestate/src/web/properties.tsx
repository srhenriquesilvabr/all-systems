import { api, ApiError, apiUpload, AuthImage, CustomerSearch, formatMoney, parseMoney, SpreadsheetImport, useCan, type CustomerOption } from '@all/module-sdk/web';
import type { SubjectValue } from '@all/scheduling/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { addressOf, dealStatusLabel, propertyStatuses, propertyStatusLabel, propertyTypeLabel, propertyTypes, purposeLabel, type Deal, type Property } from '../contracts';
import { DealModal, dealTone } from './deals';
import { propertyImportSpec } from './propertyImport';

export const reKey = ['real-estate'] as const;
const statusTone = { available: 'success', reserved: 'warning', sold: 'neutral', rented: 'neutral', inactive: 'neutral' } as const;

const features = (p: Property) =>
  [p.areaM2 ? `${p.areaM2.toLocaleString('pt-BR')} m²` : null, p.bedrooms ? `${p.bedrooms} quarto${p.bedrooms > 1 ? 's' : ''}` : null, p.parking ? `${p.parking} vaga${p.parking > 1 ? 's' : ''}` : null]
    .filter(Boolean)
    .join(' · ');

export function PropertiesPage() {
  const canWrite = useCan('real_estate.properties.write');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('available');
  const [type, setType] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: [...reKey, 'properties', { q, status, type, bedrooms }],
    queryFn: () => api<Property[]>('/real-estate/properties', { query: { q: q || undefined, status: status || undefined, type: type || undefined, minBedrooms: bedrooms || undefined } }),
  });
  return (
    <>
      <PageHeader
        title="Imóveis"
        description="Carteira de imóveis captados, com fotos e preço por m²."
        actions={
          canWrite && (
            <>
              <SpreadsheetImport spec={propertyImportSpec()} onImported={() => queryClient.invalidateQueries({ queryKey: reKey })} />
              <Button onClick={() => setCreating(true)}>Captar imóvel</Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" aria-label="Buscar" placeholder="Código, bairro, cidade ou rua" className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Tipo" className="max-w-48" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos os tipos</option>
          {propertyTypes.map((t) => (
            <option key={t} value={t}>
              {propertyTypeLabel[t]}
            </option>
          ))}
        </Select>
        <Select aria-label="Quartos" className="max-w-36" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)}>
          <option value="">Quartos</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}+ quartos
            </option>
          ))}
        </Select>
        <Select aria-label="Situação" className="max-w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          {propertyStatuses.map((s) => (
            <option key={s} value={s}>
              {propertyStatusLabel[s]}
            </option>
          ))}
        </Select>
      </div>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <Alert>{list.error.message}</Alert>
      ) : list.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum imóvel" action={canWrite && <Button onClick={() => setCreating(true)}>Captar imóvel</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((p) => (
            <Link key={p.id} to={`/imoveis/${p.id}`} className="overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-fg">
              <div className="aspect-[16/10] bg-muted">
                {p.photos[0] ? <AuthImage fileId={p.photos[0].id} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-fg-subtle">Sem foto</div>}
              </div>
              <div className="space-y-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{p.title}</span>
                  <Badge tone={statusTone[p.status]}>{propertyStatusLabel[p.status]}</Badge>
                </div>
                <div className="text-sm text-fg-muted">
                  Cód. {p.code} · {p.district}, {p.city}
                </div>
                <div className="text-sm text-fg-muted">{features(p)}</div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="font-display text-xl font-semibold tabular-nums">{p.salePrice ? formatMoney(p.salePrice) : `${formatMoney(p.rentPrice ?? 0)}/mês`}</span>
                  {p.pricePerM2 && <span className="text-xs text-fg-muted">{formatMoney(p.pricePerM2)}/m²</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <PropertyModal property={null} onClose={() => setCreating(false)} onSaved={(p) => navigate(`/imoveis/${p.id}`)} />}
    </>
  );
}

export function PropertyPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canWrite = useCan('real_estate.properties.write');
  const canDeal = useCan('real_estate.deals.write');
  const p = useQuery({ queryKey: [...reKey, 'property', id], queryFn: () => api<Property>(`/real-estate/properties/${id}`) });
  const deals = useQuery({ queryKey: [...reKey, 'deals', { propertyId: id }], queryFn: () => api<Deal[]>('/real-estate/deals', { query: { propertyId: id } }) });
  const [editing, setEditing] = useState(false);
  const [dealing, setDealing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({ mutationFn: (f: File) => apiUpload(`/real-estate/properties/${id}/photos`, 'photo', f), onSuccess: () => queryClient.invalidateQueries({ queryKey: reKey }) });
  if (p.isPending) return <Spinner />;
  if (p.isError) return <Alert>{p.error.message}</Alert>;
  const prop = p.data;
  return (
    <>
      <PageHeader
        title={prop.title}
        description={`Cód. ${prop.code} · ${propertyTypeLabel[prop.type]} · ${addressOf(prop)}`}
        actions={
          <div className="flex gap-2">
            {canWrite && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
            {canDeal && prop.status === 'available' && prop.purpose !== 'rent' && <Button onClick={() => setDealing(true)}>Nova proposta</Button>}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card className="p-4">
            {upload.error && <Alert>{upload.error instanceof ApiError ? upload.error.message : 'Erro ao enviar'}</Alert>}
            {prop.photos.length === 0 ? (
              <p className="py-10 text-center text-sm text-fg-muted">Nenhuma foto ainda.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {prop.photos.map((f) => (
                  <div key={f.id} className="aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                    <AuthImage fileId={f.id} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
            {canWrite && (
              <div className="mt-3">
                <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => fileInput.current?.click()}>
                  Adicionar foto
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload.mutate(f);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </Card>
          {prop.description && <Card className="whitespace-pre-line p-5 text-sm">{prop.description}</Card>}
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Propostas</h2>
            {deals.data?.length ? (
              <ul className="divide-y divide-line text-sm">
                {deals.data.map((d) => (
                  <li key={d.id} className="flex justify-between gap-3 py-2">
                    <Link to={`/imoveis/propostas/${d.id}`} className="text-brand-700 hover:underline">
                      nº {d.number} · {d.customer.name} · {formatMoney(d.price)}
                    </Link>
                    <Badge tone={dealTone[d.status]}>{dealStatusLabel[d.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Nenhuma.</p>
            )}
          </Card>
        </div>
        <Card className="h-fit space-y-3 p-5 text-sm">
          <Badge tone={statusTone[prop.status]}>{propertyStatusLabel[prop.status]}</Badge>
          {prop.salePrice != null && <div className="font-display text-3xl font-semibold tabular-nums">{formatMoney(prop.salePrice)}</div>}
          {prop.rentPrice != null && <div className="tabular-nums">Aluguel {formatMoney(prop.rentPrice)}/mês</div>}
          <dl className="grid grid-cols-2 gap-2 pt-2">
            <Item label="Finalidade">{purposeLabel[prop.purpose]}</Item>
            <Item label="Área">{prop.areaM2 ? `${prop.areaM2.toLocaleString('pt-BR')} m²` : '—'}</Item>
            <Item label="Quartos">{`${prop.bedrooms}${prop.suites ? ` (${prop.suites} suíte${prop.suites > 1 ? 's' : ''})` : ''}`}</Item>
            <Item label="Banheiros">{prop.bathrooms}</Item>
            <Item label="Vagas">{prop.parking}</Item>
            <Item label="Preço/m²">{prop.pricePerM2 ? formatMoney(prop.pricePerM2) : '—'}</Item>
            <Item label="Condomínio">{prop.condoFee ? formatMoney(prop.condoFee) : '—'}</Item>
            <Item label="IPTU (ano)">{prop.iptuYearly ? formatMoney(prop.iptuYearly) : '—'}</Item>
          </dl>
          <p>{prop.financeable ? 'Aceita financiamento' : 'Não aceita financiamento'}</p>
          <div className="pt-2">
            <div className="text-xs text-fg-muted">Proprietário</div>
            <Link to={`/clientes/${prop.owner.id}`} className="font-medium text-brand-700 hover:underline">
              {prop.owner.name}
            </Link>
          </div>
        </Card>
      </div>
      {editing && <PropertyModal property={prop} onClose={() => setEditing(false)} />}
      {dealing && <DealModal property={prop} onClose={() => setDealing(false)} onSaved={(d) => navigate(`/imoveis/propostas/${d.id}`)} />}
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const money = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','));

function PropertyModal({ property, onClose, onSaved }: { property: Property | null; onClose: () => void; onSaved?: (p: Property) => void }) {
  const queryClient = useQueryClient();
  const [owner, setOwner] = useState<{ id: string; name: string } | CustomerOption | null>(property?.owner ?? null);
  const [form, setForm] = useState({
    purpose: property?.purpose ?? 'sale',
    type: property?.type ?? 'apartment',
    title: property?.title ?? '',
    street: property?.street ?? '',
    number: property?.number ?? '',
    complement: property?.complement ?? '',
    district: property?.district ?? '',
    city: property?.city ?? '',
    state: property?.state ?? 'SC',
    zip: property?.zip ?? '',
    areaM2: property?.areaM2 != null ? String(property.areaM2).replace('.', ',') : '',
    bedrooms: String(property?.bedrooms ?? 0),
    suites: String(property?.suites ?? 0),
    bathrooms: String(property?.bathrooms ?? 1),
    parking: String(property?.parking ?? 0),
    salePrice: money(property?.salePrice),
    rentPrice: money(property?.rentPrice),
    condoFee: money(property?.condoFee),
    iptuYearly: money(property?.iptuYearly),
    financeable: property?.financeable ?? true,
    status: property?.status ?? 'available',
    description: property?.description ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const m = (v: string) => (v ? parseMoney(v) : null);
  const save = useMutation({
    mutationFn: () =>
      api<Property>(property ? `/real-estate/properties/${property.id}` : '/real-estate/properties', {
        method: property ? 'PATCH' : 'POST',
        body: {
          ...form,
          ownerId: owner?.id,
          number: form.number || null,
          complement: form.complement || null,
          areaM2: form.areaM2 ? Number(form.areaM2.replace(',', '.')) : null,
          bedrooms: Number(form.bedrooms),
          suites: Number(form.suites),
          bathrooms: Number(form.bathrooms),
          parking: Number(form.parking),
          salePrice: m(form.salePrice),
          rentPrice: m(form.rentPrice),
          condoFee: m(form.condoFee),
          iptuYearly: m(form.iptuYearly),
          description: form.description || null,
        },
      }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: reKey });
      onSaved?.(p);
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
      title={property ? 'Editar imóvel' : 'Captar imóvel'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="re-property-form" loading={save.isPending} disabled={!owner}>
            Salvar
          </Button>
        </>
      }
    >
      {!owner ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">Quem é o proprietário?</p>
          <CustomerSearch onSelect={setOwner} />
        </div>
      ) : (
        <form id="re-property-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          <p className="text-sm">
            Proprietário: <span className="font-medium">{owner.name}</span>
          </p>
          <Field label="Título do anúncio">{(id) => <Input id={id} required value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Apartamento 3 quartos com vista para o mar" autoFocus />}</Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Tipo">
              {(id) => (
                <Select id={id} value={form.type} onChange={(e) => set({ type: e.target.value as typeof form.type })}>
                  {propertyTypes.map((t) => (
                    <option key={t} value={t}>
                      {propertyTypeLabel[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Finalidade">
              {(id) => (
                <Select id={id} value={form.purpose} onChange={(e) => set({ purpose: e.target.value as typeof form.purpose })}>
                  {Object.entries(purposeLabel).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Situação">
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}>
                  {propertyStatuses.map((s) => (
                    <option key={s} value={s}>
                      {propertyStatusLabel[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Rua">{(id) => <Input id={id} required value={form.street} onChange={(e) => set({ street: e.target.value })} />}</Field>
            </div>
            <Field label="Número">{(id) => <Input id={id} value={form.number} onChange={(e) => set({ number: e.target.value })} />}</Field>
            <Field label="Bairro">{(id) => <Input id={id} required value={form.district} onChange={(e) => set({ district: e.target.value })} />}</Field>
            <Field label="Cidade">{(id) => <Input id={id} required value={form.city} onChange={(e) => set({ city: e.target.value })} />}</Field>
            <Field label="UF">{(id) => <Input id={id} required maxLength={2} value={form.state} onChange={(e) => set({ state: e.target.value.toUpperCase() })} />}</Field>
            <Field label="Área (m²)">{(id) => <Input id={id} inputMode="decimal" value={form.areaM2} onChange={(e) => set({ areaM2: e.target.value })} />}</Field>
            <Field label="Quartos">{(id) => <Input id={id} type="number" min={0} value={form.bedrooms} onChange={(e) => set({ bedrooms: e.target.value })} />}</Field>
            <Field label="Suítes">{(id) => <Input id={id} type="number" min={0} value={form.suites} onChange={(e) => set({ suites: e.target.value })} />}</Field>
            <Field label="Banheiros">{(id) => <Input id={id} type="number" min={0} value={form.bathrooms} onChange={(e) => set({ bathrooms: e.target.value })} />}</Field>
            <Field label="Vagas">{(id) => <Input id={id} type="number" min={0} value={form.parking} onChange={(e) => set({ parking: e.target.value })} />}</Field>
            {form.purpose !== 'rent' && <Field label="Preço de venda (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.salePrice} onChange={(e) => set({ salePrice: e.target.value })} />}</Field>}
            {form.purpose !== 'sale' && <Field label="Aluguel (R$/mês)">{(id) => <Input id={id} inputMode="decimal" required value={form.rentPrice} onChange={(e) => set({ rentPrice: e.target.value })} />}</Field>}
            <Field label="Condomínio (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.condoFee} onChange={(e) => set({ condoFee: e.target.value })} />}</Field>
            <Field label="IPTU anual (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.iptuYearly} onChange={(e) => set({ iptuYearly: e.target.value })} />}</Field>
          </div>
          <Checkbox label="Aceita financiamento bancário" checked={form.financeable} onChange={(e) => set({ financeable: e.target.checked })} />
          <Field label="Descrição">{(id) => <Textarea id={id} rows={4} value={form.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
        </form>
      )}
    </Modal>
  );
}

/** Escolha do imóvel no formulário de horário (visita). Lista os disponíveis. */
export function PropertyPicker({ value, onChange }: { customerId: string; value: SubjectValue | null; onChange: (v: SubjectValue | null) => void }) {
  const list = useQuery({ queryKey: [...reKey, 'properties', 'picker'], queryFn: () => api<Property[]>('/real-estate/properties', { query: { status: 'available' } }) });
  return (
    <Select
      aria-label="Imóvel"
      value={value?.id ?? ''}
      onChange={(e) => {
        const p = list.data?.find((x) => x.id === e.target.value);
        onChange(p ? { type: 're_property', id: p.id, label: `Cód. ${p.code} — ${p.title}` } : null);
      }}
    >
      <option value="">{list.isPending ? 'Carregando…' : 'Escolha o imóvel'}</option>
      {list.data?.map((p) => (
        <option key={p.id} value={p.id}>
          Cód. {p.code} — {p.title} ({p.district})
        </option>
      ))}
    </Select>
  );
}
