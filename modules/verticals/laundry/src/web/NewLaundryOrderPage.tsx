import { api, ApiError, formatMoney, parseMoney, formatPhone } from '@all/module-sdk/web';
import { CustomerSearch, ordersKey, type CustomerOption } from '@all/service-orders/web';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Textarea } from '@all/ui';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { laundryOrderInput, pricingUnitLabel, type LaundryService } from '../contracts';
import { laundryKey, useGarmentTypes, useServices, type LaundryOrderDetail } from './hooks';

interface LineDraft {
  serviceId: string;
  garmentTypeId: string;
  quantity: string;
  measure: string;
  color: string;
  brand: string;
  intakeNotes: string;
  showDetails: boolean;
}

const emptyLine = (serviceId = ''): LineDraft => ({
  serviceId,
  garmentTypeId: '',
  quantity: '1',
  measure: '',
  color: '',
  brand: '',
  intakeNotes: '',
  showDetails: false,
});

/** Balcão: recebe as peças do cliente e abre a ordem, já com etiquetas para imprimir. */
export function NewLaundryOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const services = useServices();
  const garments = useGarmentTypes();
  const activeServices = services.data?.filter((s) => s.active) ?? [];

  const preselected = params.get('cliente');
  const pre = useQuery({ queryKey: ['customers', preselected], queryFn: () => api<CustomerOption>(`/customers/${preselected}`), enabled: !!preselected });
  const [picked, setPicked] = useState<CustomerOption | null | undefined>(undefined);
  const customer = picked === undefined ? (pre.data ?? null) : picked;

  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [discount, setDiscount] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [notesCustomer, setNotesCustomer] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  // Preços por tipo de peça dos serviços escolhidos, para a estimativa.
  const usedServices = [...new Set(lines.map((l) => l.serviceId).filter(Boolean))];
  const prices = useQueries({
    queries: usedServices.map((id) => ({
      queryKey: [...laundryKey, 'prices', id],
      queryFn: () => api<{ garmentTypeId: string; price: number }[]>(`/laundry/services/${id}/prices`),
    })),
  });
  const priceOf = (service: LaundryService, garmentTypeId: string) => {
    const table = prices[usedServices.indexOf(service.id)]?.data;
    return table?.find((p) => p.garmentTypeId === garmentTypeId)?.price ?? service.basePrice;
  };
  const lineTotal = (l: LineDraft) => {
    const service = activeServices.find((s) => s.id === l.serviceId);
    if (!service) return 0;
    if (service.pricingUnit === 'piece') return (Number(l.quantity) || 0) * priceOf(service, l.garmentTypeId);
    return (parseMoney(l.measure) || 0) * service.basePrice;
  };
  const subtotal = lines.reduce((sum, l) => sum + Math.round(lineTotal(l) * 100), 0) / 100;
  const discountValue = parseMoney(discount) || 0;
  const pieceCount = lines.reduce((sum, l) => {
    const service = activeServices.find((s) => s.id === l.serviceId);
    return sum + (service?.pricingUnit === 'piece' ? Number(l.quantity) || 0 : 1);
  }, 0);

  const create = useMutation({
    mutationFn: (body: unknown) => api<LaundryOrderDetail>('/laundry/orders', { method: 'POST', body }),
    onSuccess: ({ order }) => {
      queryClient.invalidateQueries({ queryKey: ordersKey });
      queryClient.invalidateQueries({ queryKey: [...laundryKey, 'production'] });
      navigate(`/lavanderia/ordens/${order.id}`, { replace: true });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = laundryOrderInput.safeParse({
      customerId: customer?.id ?? '',
      discount: discountValue,
      dueAt: dueAt ? new Date(dueAt) : null,
      notesCustomer: notesCustomer || null,
      lines: lines.map((l) => {
        const unit = activeServices.find((s) => s.id === l.serviceId)?.pricingUnit;
        return {
          serviceId: l.serviceId,
          garmentTypeId: l.garmentTypeId || null,
          quantity: Number(l.quantity) || 1,
          weightKg: unit === 'kg' ? parseMoney(l.measure) || null : null,
          areaSqm: unit === 'sqm' ? parseMoney(l.measure) || null : null,
          color: l.color || null,
          brand: l.brand || null,
          intakeNotes: l.intakeNotes || null,
        };
      }),
    });
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((i) => i.message))]);
      return;
    }
    setErrors([]);
    create.mutate({ ...parsed.data, dueAt: parsed.data.dueAt?.toISOString() ?? null });
  }

  const update = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <>
      <PageHeader title="Balcão — nova ordem" description="Cada peça recebe uma etiqueta. Anote avarias que a peça já tem: isso protege a lavanderia." />
      <form onSubmit={submit} className="space-y-6">
        {(errors.length > 0 || create.error) && (
          <Alert>{errors.length ? errors.join(' · ') : create.error instanceof ApiError ? create.error.message : 'Erro ao salvar'}</Alert>
        )}

        <Card className="p-5">
          <h2 className="mb-4 font-medium">Cliente</h2>
          {customer ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{customer.name}</p>
                <p className="text-sm text-fg-muted">{[formatPhone(customer.phone), customer.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setPicked(null)}>
                Trocar
              </Button>
            </div>
          ) : (
            <CustomerSearch onSelect={setPicked} />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-medium">Peças</h2>
          <div className="space-y-4">
            {lines.map((line, i) => {
              const service = activeServices.find((s) => s.id === line.serviceId);
              const byWeight = service && service.pricingUnit !== 'piece';
              return (
                <div key={i} className="rounded-md border border-line p-3">
                  <div className="grid gap-3 sm:grid-cols-[1.4fr_1.2fr_5rem_6rem_auto] sm:items-end">
                    <Field label="Serviço">
                      {(id) => (
                        <Select id={id} value={line.serviceId} onChange={(e) => update(i, { serviceId: e.target.value })}>
                          <option value="">Escolha</option>
                          {activeServices.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} · {formatMoney(s.basePrice)} {pricingUnitLabel[s.pricingUnit]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Tipo de peça">
                      {(id) => (
                        <Select id={id} value={line.garmentTypeId} onChange={(e) => update(i, { garmentTypeId: e.target.value })}>
                          <option value="">{byWeight ? 'Várias' : 'Escolha'}</option>
                          {garments.data
                            ?.filter((g) => g.active)
                            .map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Peças">
                      {(id) => <Input id={id} type="number" min={1} max={200} value={line.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />}
                    </Field>
                    {byWeight ? (
                      <Field label={service.pricingUnit === 'kg' ? 'Peso (kg)' : 'Área (m²)'}>
                        {(id) => <Input id={id} inputMode="decimal" value={line.measure} onChange={(e) => update(i, { measure: e.target.value })} placeholder="0,0" />}
                      </Field>
                    ) : (
                      <div className="pb-2 text-right text-sm tabular-nums text-fg-muted">{formatMoney(lineTotal(line))}</div>
                    )}
                    <Button variant="ghost" size="sm" aria-label="Remover linha" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>
                      ✕
                    </Button>
                  </div>

                  {line.showDetails ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
                      <Input aria-label="Cor" placeholder="Cor" value={line.color} onChange={(e) => update(i, { color: e.target.value })} />
                      <Input aria-label="Marca" placeholder="Marca" value={line.brand} onChange={(e) => update(i, { brand: e.target.value })} />
                      <Input
                        aria-label="Avarias que a peça já tem"
                        placeholder="Avarias que já tem (mancha, rasgo, botão faltando…)"
                        value={line.intakeNotes}
                        onChange={(e) => update(i, { intakeNotes: e.target.value })}
                      />
                    </div>
                  ) : (
                    <button type="button" className="mt-2 text-sm text-brand-700 hover:underline" onClick={() => update(i, { showDetails: true })}>
                      + cor, marca e avarias
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setLines([...lines, emptyLine(lines[lines.length - 1]?.serviceId)])}>
            Adicionar peças
          </Button>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Desconto (R$)">{(id) => <Input id={id} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />}</Field>
            <div className="self-end text-right">
              <p className="text-sm text-fg-muted">
                {pieceCount} etiqueta{pieceCount === 1 ? '' : 's'} · subtotal estimado {formatMoney(subtotal)}
              </p>
              <p className="text-xl font-semibold tabular-nums">Total {formatMoney(Math.max(subtotal - discountValue, 0))}</p>
            </div>
          </div>
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Previsão de entrega" hint="Em branco: calculada pelo maior prazo entre os serviços.">
            {(id) => <Input id={id} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
          </Field>
          <Field label="Observações para o cliente" hint="Saem no comprovante.">
            {(id) => <Textarea id={id} value={notesCustomer} onChange={(e) => setNotesCustomer(e.target.value)} />}
          </Field>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Abrir ordem
          </Button>
        </div>
      </form>
    </>
  );
}
