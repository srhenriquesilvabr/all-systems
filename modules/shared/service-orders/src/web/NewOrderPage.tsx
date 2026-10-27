import { api, ApiError, formatMoney, parseMoney, formatPhone, CustomerSearch, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, PageHeader, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { createOrderInput, type OrderDetail } from '../contracts';
import { ordersKey } from './shared';

interface ItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

const emptyItem = (): ItemDraft => ({ description: '', quantity: '1', unitPrice: '' });

export function NewOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [picked, setPicked] = useState<CustomerOption | null | undefined>(undefined);
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [discount, setDiscount] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [notesCustomer, setNotesCustomer] = useState('');
  const [notesInternal, setNotesInternal] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  // Vindo da ficha do cliente: já chega com ele selecionado (até o usuário trocar).
  const preselected = params.get('cliente');
  const pre = useQuery({
    queryKey: ['customers', preselected],
    queryFn: () => api<CustomerOption>(`/customers/${preselected}`),
    enabled: !!preselected,
  });
  const customer = picked === undefined ? (pre.data ?? null) : picked;
  const setCustomer = setPicked;

  const lines = items.map((i) => ({ description: i.description, quantity: parseMoney(i.quantity), unitPrice: parseMoney(i.unitPrice) }));
  const subtotal = lines.reduce((sum, l) => sum + (Number.isFinite(l.quantity * l.unitPrice) ? Math.round(l.quantity * l.unitPrice * 100) : 0), 0) / 100;
  const discountValue = parseMoney(discount) || 0;

  const create = useMutation({
    mutationFn: (body: unknown) => api<OrderDetail>('/service-orders', { method: 'POST', body }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ordersKey });
      navigate(`/ordens/${order.id}`, { replace: true });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createOrderInput.safeParse({
      customerId: customer?.id ?? '',
      items: lines,
      discount: discountValue,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      notesCustomer: notesCustomer || null,
      notesInternal: notesInternal || null,
    });
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((i) => i.message))]);
      return;
    }
    setErrors([]);
    create.mutate({ ...parsed.data, dueAt: parsed.data.dueAt?.toISOString() ?? null });
  }

  const updateItem = (index: number, patch: Partial<ItemDraft>) => setItems(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  return (
    <>
      <PageHeader title="Nova ordem de serviço" />
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
              <Button variant="secondary" size="sm" onClick={() => setCustomer(null)}>
                Trocar
              </Button>
            </div>
          ) : (
            <CustomerSearch onSelect={setCustomer} />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-medium">Itens</h2>
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-[1fr_5rem_7rem_auto] items-end gap-2">
                <Field label={index === 0 ? 'Descrição' : ''}>
                  {(id) => (
                    <Input id={id} aria-label="Descrição" value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} placeholder="Ex.: Camisa social" />
                  )}
                </Field>
                <Field label={index === 0 ? 'Qtd.' : ''}>
                  {(id) => <Input id={id} aria-label="Quantidade" inputMode="decimal" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} />}
                </Field>
                <Field label={index === 0 ? 'Preço (R$)' : ''}>
                  {(id) => <Input id={id} aria-label="Preço unitário" inputMode="decimal" value={item.unitPrice} onChange={(e) => updateItem(index, { unitPrice: e.target.value })} placeholder="0,00" />}
                </Field>
                <Button variant="ghost" size="sm" aria-label="Remover item" disabled={items.length === 1} onClick={() => setItems(items.filter((_, i) => i !== index))}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setItems([...items, emptyItem()])}>
            Adicionar item
          </Button>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Desconto (R$)">{(id) => <Input id={id} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />}</Field>
            <div className="self-end text-right">
              <p className="text-sm text-fg-muted">Subtotal {formatMoney(subtotal)}</p>
              <p className="text-xl font-semibold tabular-nums">Total {formatMoney(Math.max(subtotal - discountValue, 0))}</p>
            </div>
          </div>
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Previsão de entrega">{(id) => <Input id={id} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}</Field>
          <div />
          <Field label="Observações para o cliente" hint="Aparecem no comprovante.">
            {(id) => <Textarea id={id} value={notesCustomer} onChange={(e) => setNotesCustomer(e.target.value)} />}
          </Field>
          <Field label="Observações internas" hint="Só a equipe vê.">
            {(id) => <Textarea id={id} value={notesInternal} onChange={(e) => setNotesInternal(e.target.value)} />}
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
