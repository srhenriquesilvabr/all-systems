import { api, ApiError, apiUpload, AuthImage, formatMoney, parseMoney, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { dealStatusLabel, fuelLabel, transmissionLabel, vehicleKindLabel, vehicleKinds, vehicleStatuses, vehicleStatusLabel, vehicleTitle, type Deal, type FipePrice, type Vehicle } from '../contracts';
import { DealModal, dealTone } from './deals';

export const vehiclesKey = ['vehicles'] as const;
export const statusTone = { available: 'success', reserved: 'warning', sold: 'neutral', inactive: 'neutral' } as const;
const km = (n: number) => `${n.toLocaleString('pt-BR')} km`;

export function StockPage() {
  const canWrite = useCan('vehicles.stock.write');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('available');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const list = useQuery({ queryKey: [...vehiclesKey, 'stock', { q, status }], queryFn: () => api<Vehicle[]>('/vehicles/stock', { query: { q: q || undefined, status: status || undefined } }) });

  return (
    <>
      <PageHeader title="Estoque" description="Veículos à venda, com fotos, preço e referência FIPE." actions={canWrite && <Button onClick={() => setCreating(true)}>Novo veículo</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" aria-label="Buscar" placeholder="Marca, modelo ou placa" className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Situação" className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          {vehicleStatuses.map((s) => (
            <option key={s} value={s}>
              {vehicleStatusLabel[s]}
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
          <EmptyState title="Nenhum veículo" action={canWrite && <Button onClick={() => setCreating(true)}>Cadastrar veículo</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((v) => (
            <Link key={v.id} to={`/veiculos/estoque/${v.id}`} className="overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-fg">
              <div className="aspect-[16/10] bg-muted">
                {v.photos[0] ? <AuthImage fileId={v.photos[0].id} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-fg-subtle">Sem foto</div>}
              </div>
              <div className="space-y-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">
                    {v.brand} {v.model}
                  </span>
                  <Badge tone={statusTone[v.status]}>{vehicleStatusLabel[v.status]}</Badge>
                </div>
                <div className="text-sm text-fg-muted">
                  {[v.version, `${v.yearManufacture}/${v.yearModel}`, km(v.km)].filter(Boolean).join(' · ')}
                </div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="font-display text-xl font-semibold tabular-nums">{formatMoney(v.price)}</span>
                  {v.fipePrice != null && <span className="text-xs text-fg-muted">FIPE {formatMoney(v.fipePrice)}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <VehicleModal vehicle={null} onClose={() => setCreating(false)} onSaved={(v) => navigate(`/veiculos/estoque/${v.id}`)} />}
    </>
  );
}

export function VehiclePage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const canWrite = useCan('vehicles.stock.write');
  const canDeal = useCan('vehicles.deals.write');
  const v = useQuery({ queryKey: [...vehiclesKey, 'vehicle', id], queryFn: () => api<Vehicle>(`/vehicles/stock/${id}`) });
  const deals = useQuery({ queryKey: [...vehiclesKey, 'deals', { vehicleId: id }], queryFn: () => api<Deal[]>('/vehicles/deals', { query: { vehicleId: id } }) });
  const [editing, setEditing] = useState(false);
  const [dealing, setDealing] = useState(false);
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => apiUpload(`/vehicles/stock/${id}/photos`, 'photo', file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vehiclesKey }),
  });
  const remove = useMutation({
    mutationFn: (fileId: string) => api(`/vehicles/stock/${id}/photos/${fileId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vehiclesKey }),
  });

  if (v.isPending) return <Spinner />;
  if (v.isError) return <Alert>{v.error.message}</Alert>;
  const veh = v.data;
  const margin = veh.cost != null ? veh.price - veh.cost : null;

  return (
    <>
      <PageHeader
        title={vehicleTitle(veh)}
        description={[vehicleKindLabel[veh.kind], veh.plate, veh.color, `${veh.daysInStock} dias em estoque`].filter(Boolean).join(' · ')}
        actions={
          <div className="flex gap-2">
            {canWrite && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
            {canDeal && veh.status === 'available' && <Button onClick={() => setDealing(true)}>Nova negociação</Button>}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card className="p-4">
            {upload.error && <Alert>{upload.error instanceof ApiError ? upload.error.message : 'Erro ao enviar a foto'}</Alert>}
            {veh.photos.length === 0 ? (
              <p className="py-10 text-center text-sm text-fg-muted">Nenhuma foto ainda.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {veh.photos.map((p) => (
                  <div key={p.id} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                    <AuthImage fileId={p.id} alt="" className="h-full w-full object-cover" />
                    {canWrite && (
                      <button type="button" className="absolute right-1 top-1 hidden rounded-full bg-ink/70 px-2 text-xs text-white group-hover:block" onClick={() => remove.mutate(p.id)}>
                        Remover
                      </button>
                    )}
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
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Negociações deste veículo</h2>
            {deals.data?.length ? (
              <ul className="divide-y divide-line text-sm">
                {deals.data.map((d) => (
                  <li key={d.id} className="flex justify-between gap-3 py-2">
                    <Link to={`/veiculos/negociacoes/${d.id}`} className="text-brand-700 hover:underline">
                      nº {d.number} · {d.customer.name}
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
          <Badge tone={statusTone[veh.status]}>{vehicleStatusLabel[veh.status]}</Badge>
          <div className="font-display text-3xl font-semibold tabular-nums">{formatMoney(veh.price)}</div>
          {veh.fipePrice != null && (
            <p className="text-fg-muted">
              FIPE {veh.fipeCode}: {formatMoney(veh.fipePrice)} ({veh.price >= veh.fipePrice ? '+' : ''}
              {(((veh.price - veh.fipePrice) / veh.fipePrice) * 100).toFixed(1).replace('.', ',')}%)
            </p>
          )}
          {veh.cost != null && (
            <p className="text-fg-muted">
              Custo {formatMoney(veh.cost)} · margem {formatMoney(margin!)}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-2 pt-2">
            <Item label="Quilometragem">{km(veh.km)}</Item>
            <Item label="Câmbio">{transmissionLabel[veh.transmission]}</Item>
            <Item label="Combustível">{fuelLabel[veh.fuel]}</Item>
            <Item label="Placa">{veh.plate ?? '—'}</Item>
          </dl>
          {veh.notes && <p className="whitespace-pre-line pt-2">{veh.notes}</p>}
        </Card>
      </div>
      {editing && <VehicleModal vehicle={veh} onClose={() => setEditing(false)} />}
      {dealing && <DealModal vehicle={veh} onClose={() => setDealing(false)} onSaved={(d) => navigate(`/veiculos/negociacoes/${d.id}`)} />}
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

function VehicleModal({ vehicle, onClose, onSaved }: { vehicle: Vehicle | null; onClose: () => void; onSaved?: (v: Vehicle) => void }) {
  const queryClient = useQueryClient();
  const year = new Date().getFullYear();
  const [form, setForm] = useState({
    kind: vehicle?.kind ?? 'car',
    brand: vehicle?.brand ?? '',
    model: vehicle?.model ?? '',
    version: vehicle?.version ?? '',
    yearManufacture: String(vehicle?.yearManufacture ?? year),
    yearModel: String(vehicle?.yearModel ?? year),
    plate: vehicle?.plate ?? '',
    color: vehicle?.color ?? '',
    km: String(vehicle?.km ?? 0),
    fuel: vehicle?.fuel ?? 'flex',
    transmission: vehicle?.transmission ?? 'manual',
    fipeCode: vehicle?.fipeCode ?? '',
    fipePrice: money(vehicle?.fipePrice),
    cost: money(vehicle?.cost),
    price: money(vehicle?.price),
    status: vehicle?.status ?? 'available',
    notes: vehicle?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const fipe = useMutation({
    mutationFn: () => api<FipePrice[]>(`/vehicles/fipe/${form.fipeCode}`),
    onSuccess: (rows) => {
      const match = rows.find((r) => r.anoModelo === Number(form.yearModel)) ?? rows[0];
      if (match) set({ fipePrice: match.valor.toFixed(2).replace('.', ','), brand: form.brand || match.marca, model: form.model || match.modelo });
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api<Vehicle>(vehicle ? `/vehicles/stock/${vehicle.id}` : '/vehicles/stock', {
        method: vehicle ? 'PATCH' : 'POST',
        body: {
          ...form,
          yearManufacture: Number(form.yearManufacture),
          yearModel: Number(form.yearModel),
          km: Number(form.km.replace(/\D/g, '')) || 0,
          version: form.version || null,
          color: form.color || null,
          fipePrice: form.fipePrice ? parseMoney(form.fipePrice) : null,
          cost: form.cost ? parseMoney(form.cost) : null,
          price: parseMoney(form.price),
          notes: form.notes || null,
        },
      }),
    onSuccess: (v) => {
      queryClient.invalidateQueries({ queryKey: vehiclesKey });
      onSaved?.(v);
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
      title={vehicle ? 'Editar veículo' : 'Novo veículo'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="veh-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="veh-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={form.kind} onChange={(e) => set({ kind: e.target.value as typeof form.kind })}>
                {vehicleKinds.map((k) => (
                  <option key={k} value={k}>
                    {vehicleKindLabel[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Marca">{(id) => <Input id={id} required value={form.brand} onChange={(e) => set({ brand: e.target.value })} />}</Field>
          <Field label="Modelo">{(id) => <Input id={id} required value={form.model} onChange={(e) => set({ model: e.target.value })} />}</Field>
          <div className="sm:col-span-3">
            <Field label="Versão">{(id) => <Input id={id} value={form.version} onChange={(e) => set({ version: e.target.value })} placeholder="Ex.: 1.0 Turbo Highline" />}</Field>
          </div>
          <Field label="Ano fabricação">{(id) => <Input id={id} type="number" required value={form.yearManufacture} onChange={(e) => set({ yearManufacture: e.target.value })} />}</Field>
          <Field label="Ano modelo">{(id) => <Input id={id} type="number" required value={form.yearModel} onChange={(e) => set({ yearModel: e.target.value })} />}</Field>
          <Field label="Placa">{(id) => <Input id={id} value={form.plate} onChange={(e) => set({ plate: e.target.value.toUpperCase() })} placeholder="ABC1D23" />}</Field>
          <Field label="Cor">{(id) => <Input id={id} value={form.color} onChange={(e) => set({ color: e.target.value })} />}</Field>
          <Field label="Quilometragem">{(id) => <Input id={id} inputMode="numeric" value={form.km} onChange={(e) => set({ km: e.target.value })} />}</Field>
          <Field label="Combustível">
            {(id) => (
              <Select id={id} value={form.fuel} onChange={(e) => set({ fuel: e.target.value as typeof form.fuel })}>
                {Object.entries(fuelLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Câmbio">
            {(id) => (
              <Select id={id} value={form.transmission} onChange={(e) => set({ transmission: e.target.value as typeof form.transmission })}>
                {Object.entries(transmissionLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Código FIPE">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} value={form.fipeCode} onChange={(e) => set({ fipeCode: e.target.value })} placeholder="000000-0" />
                <Button type="button" size="sm" variant="secondary" disabled={!/^\d{6}-\d$/.test(form.fipeCode)} loading={fipe.isPending} onClick={() => fipe.mutate()}>
                  Consultar
                </Button>
              </div>
            )}
          </Field>
          <Field label="Valor FIPE (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.fipePrice} onChange={(e) => set({ fipePrice: e.target.value })} />}</Field>
          <Field label="Custo (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.cost} onChange={(e) => set({ cost: e.target.value })} />}</Field>
          <Field label="Preço de venda (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.price} onChange={(e) => set({ price: e.target.value })} />}</Field>
          <Field label="Situação">
            {(id) => (
              <Select id={id} value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}>
                {vehicleStatuses.map((s) => (
                  <option key={s} value={s}>
                    {vehicleStatusLabel[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {fipe.error && <Alert>{fipe.error instanceof ApiError ? fipe.error.message : 'FIPE indisponível'}</Alert>}
        {fipe.data && fipe.data.length === 0 && <Alert tone="info">Código não encontrado na tabela FIPE.</Alert>}
        <Field label="Observações (opcionais, itens, revisões)">{(id) => <Textarea id={id} rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}
