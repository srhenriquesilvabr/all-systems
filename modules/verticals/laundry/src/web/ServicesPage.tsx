import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { pricingUnitLabel, pricingUnits, serviceInput, type LaundryService, type PricingUnit, type ServiceInput } from '../contracts';
import { GarmentTypesTab, PricesModal } from './CatalogExtras';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const KEY = ['laundry', 'services'];

export function ServicesPage() {
  const query = useQuery({ queryKey: KEY, queryFn: () => api<LaundryService[]>('/laundry/services') });
  const [editing, setEditing] = useState<LaundryService | 'new' | null>(null);
  const [pricing, setPricing] = useState<LaundryService | null>(null);
  const [tab, setTab] = useState('services');

  return (
    <>
      <PageHeader
        title="Serviços e preços"
        description="O que a lavanderia oferece, como cobra e em quanto tempo entrega."
        actions={tab === 'services' && <Button onClick={() => setEditing('new')}>Novo serviço</Button>}
      />
      <Tabs
        items={[
          { key: 'services', label: 'Serviços' },
          { key: 'garments', label: 'Tipos de peça' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'garments' ? (
        <GarmentTypesTab />
      ) : (
        <Card>
          {query.isPending ? (
            <Spinner />
          ) : query.isError ? (
            <div className="p-4">
              <Alert>Não foi possível carregar os serviços: {query.error.message}</Alert>
            </div>
          ) : query.data.length === 0 ? (
            <EmptyState
              title="Nenhum serviço cadastrado"
              description="Cadastre serviços como “Lavar e passar” ou “Lavagem a seco” para usá-los nas ordens de serviço."
              action={<Button onClick={() => setEditing('new')}>Cadastrar o primeiro</Button>}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Serviço</Th>
                  <Th>Cobrança</Th>
                  <Th className="text-right">Preço</Th>
                  <Th className="text-right">Prazo</Th>
                  <Th>Situação</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {query.data.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.name}</Td>
                    <Td>{pricingUnitLabel[s.pricingUnit]}</Td>
                    <Td className="text-right tabular-nums">{brl.format(s.basePrice)}</Td>
                    <Td className="text-right tabular-nums">{formatHours(s.turnaroundHours)}</Td>
                    <Td>{s.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {s.pricingUnit === 'piece' && (
                        <Button variant="ghost" size="sm" onClick={() => setPricing(s)}>
                          Preço por peça
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Editar
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {editing && <ServiceForm service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {pricing && <PricesModal service={pricing} onClose={() => setPricing(null)} />}
    </>
  );
}

function ServiceForm({ service, onClose }: { service: LaundryService | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: service?.name ?? '',
    pricingUnit: service?.pricingUnit ?? ('piece' as PricingUnit),
    basePrice: service ? String(service.basePrice) : '',
    turnaroundHours: String(service?.turnaroundHours ?? 48),
    active: service?.active ?? true,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ServiceInput, string>>>({});

  const save = useMutation({
    mutationFn: (body: ServiceInput) =>
      service
        ? api(`/laundry/services/${service.id}`, { method: 'PATCH', body })
        : api('/laundry/services', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = serviceInput.safeParse({ ...form, basePrice: form.basePrice.replace(',', '.') });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <Modal
      open
      title={service ? 'Editar serviço' : 'Novo serviço'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="service-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <Field label="Nome" error={errors.name}>
          {(id) => (
            <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lavar e passar" autoFocus />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cobrança" error={errors.pricingUnit}>
            {(id) => (
              <Select id={id} value={form.pricingUnit} onChange={(e) => setForm({ ...form, pricingUnit: e.target.value as PricingUnit })}>
                {pricingUnits.map((u) => (
                  <option key={u} value={u}>
                    {pricingUnitLabel[u]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Preço (R$)" error={errors.basePrice}>
            {(id) => (
              <Input id={id} inputMode="decimal" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} placeholder="12,90" />
            )}
          </Field>
        </div>
        <Field label="Prazo de entrega (horas)" hint="Usado para calcular a previsão de entrega da ordem." error={errors.turnaroundHours}>
          {(id) => (
            <Input id={id} type="number" min={1} value={form.turnaroundHours} onChange={(e) => setForm({ ...form, turnaroundHours: e.target.value })} />
          )}
        </Field>
        <Checkbox label="Serviço ativo (aparece ao abrir ordens)" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </form>
    </Modal>
  );
}

function formatHours(h: number) {
  return h % 24 === 0 ? `${h / 24} ${h === 24 ? 'dia' : 'dias'}` : `${h} h`;
}
