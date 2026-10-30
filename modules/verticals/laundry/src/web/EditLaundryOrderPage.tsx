import { api, ApiError, formatMoney, parseMoney } from '@all/module-sdk/web';
import { ordersKey } from '@all/service-orders/web';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { pieceStatusLabel, pricingUnitLabel, type LaundryService, type Piece } from '../contracts';
import { laundryKey, useGarmentTypes, useLaundryOrder, useServices, type LaundryOrderDetail } from './hooks';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Erro ao salvar' : '');
const pad = (n: number) => String(n).padStart(2, '0');
/** Valor de um input datetime-local no horário deste aparelho. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Editar a ordem aberta, na própria página. O que cada situação permite é conferido também pela API. */
export function EditLaundryOrderPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useLaundryOrder(id!);
  if (detail.isPending) return <Spinner />;
  if (detail.isError) return <Alert>{detail.error.message}</Alert>;
  // A chave remonta o formulário quando a ordem recarrega de outra situação.
  return <EditForm key={detail.data.order.status} detail={detail.data} />;
}

function EditForm({ detail }: { detail: LaundryOrderDetail }) {
  const { order, pieces } = detail;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dueAt, setDueAt] = useState(order.dueAt ? toLocalInput(order.dueAt) : '');
  const [discount, setDiscount] = useState(order.discount.toFixed(2).replace('.', ','));
  const [notesCustomer, setNotesCustomer] = useState(order.notesCustomer ?? '');
  const [notesInternal, setNotesInternal] = useState(order.notesInternal ?? '');

  const closed = order.status === 'delivered' || order.status === 'cancelled';
  const outForDelivery = order.status === 'out_for_delivery';
  const inProduction = order.status === 'received' || order.status === 'in_process';
  const back = `/lavanderia/ordens/${order.id}`;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [...laundryKey, 'orders', order.id] });
    queryClient.invalidateQueries({ queryKey: [...laundryKey, 'production'] });
    queryClient.invalidateQueries({ queryKey: ordersKey });
  };

  const save = useMutation({
    mutationFn: () =>
      api(`/laundry/orders/${order.id}`, {
        method: 'PATCH',
        body: {
          notesCustomer: notesCustomer || null,
          notesInternal: notesInternal || null,
          // Com a ordem em rota, valor e prazo ficam parados.
          ...(outForDelivery ? {} : { discount: parseMoney(discount) || 0, dueAt: dueAt ? new Date(dueAt).toISOString() : null }),
        },
      }),
    onSuccess: () => {
      refresh();
      navigate(back);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  if (closed) {
    return (
      <>
        <PageHeader title={`Ordem nº ${order.number}`} />
        <Alert>Esta ordem já foi encerrada e não pode mais ser alterada.</Alert>
        <Link to={back} className="mt-4 inline-block text-brand-700 hover:underline">
          Voltar para a ordem
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Editar ordem nº ${order.number}`} description={order.customer.name} />
      <form onSubmit={submit} className="space-y-6">
        {save.error && <Alert>{errorText(save.error)}</Alert>}
        {outForDelivery && <Alert tone="info">A ordem saiu para entrega: só as observações podem mudar. Para mexer em prazo ou valor, volte a ordem para “Pronta”.</Alert>}
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Previsão de entrega" hint="O vencimento do valor a receber acompanha a previsão.">
            {(id) => <Input id={id} type="datetime-local" disabled={outForDelivery} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
          </Field>
          <Field label="Desconto (R$)" hint={`Itens: ${formatMoney(order.subtotal)} · pago: ${formatMoney(order.paidAmount)}. O total não pode ficar abaixo do que já foi pago.`}>
            {(id) => <Input id={id} inputMode="decimal" disabled={outForDelivery} value={discount} onChange={(e) => setDiscount(e.target.value)} />}
          </Field>
          <Field label="Observações para o cliente" hint="Saem no comprovante.">
            {(id) => <Textarea id={id} rows={3} value={notesCustomer} onChange={(e) => setNotesCustomer(e.target.value)} />}
          </Field>
          <Field label="Observação interna" hint="Só a equipe vê. Não sai no comprovante nem nos avisos.">
            {(id) => <Textarea id={id} rows={3} value={notesInternal} onChange={(e) => setNotesInternal(e.target.value)} />}
          </Field>
        </Card>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(back)}>
            Voltar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>

      <h2 className="mb-3 mt-8 font-medium">Peças</h2>
      <div className="space-y-3">
        {pieces.map((p) => (
          <PieceEditor key={p.itemId} orderId={order.id} piece={p} canRemove={inProduction && pieces.length > 1} editable={!outForDelivery} onChanged={refresh} />
        ))}
      </div>
      {inProduction ? (
        <AddPieces orderId={order.id} onChanged={refresh} />
      ) : (
        <p className="mt-3 text-sm text-fg-muted">Peças só entram ou saem enquanto a ordem está Recebida ou Em produção.</p>
      )}
    </>
  );
}

function PieceEditor({ orderId, piece, canRemove, editable, onChanged }: { orderId: string; piece: Piece; canRemove: boolean; editable: boolean; onChanged: () => void }) {
  const [color, setColor] = useState(piece.color ?? '');
  const [brand, setBrand] = useState(piece.brand ?? '');
  const [intakeNotes, setIntakeNotes] = useState(piece.intakeNotes ?? '');
  const dirty = color !== (piece.color ?? '') || brand !== (piece.brand ?? '') || intakeNotes !== (piece.intakeNotes ?? '');
  const save = useMutation({
    mutationFn: () => api(`/laundry/pieces/${piece.itemId}`, { method: 'PATCH', body: { color: color || null, brand: brand || null, intakeNotes: intakeNotes || null } }),
    onSuccess: onChanged,
  });
  const remove = useMutation({ mutationFn: () => api(`/laundry/orders/${orderId}/pieces/${piece.itemId}`, { method: 'DELETE' }), onSuccess: onChanged });
  // Só sai a peça que ainda não começou: a API confere de novo.
  const removable = canRemove && piece.status === 'received' && piece.reworkCount === 0 && !piece.incidentAt;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-mono text-sm font-semibold">{piece.tagCode}</span> <span className="font-medium">{piece.description}</span>
        </p>
        <span className="text-sm text-fg-muted">{pieceStatusLabel[piece.status]}</span>
      </div>
      {(save.error || remove.error) && <Alert>{errorText(save.error ?? remove.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <Input aria-label={`Cor da peça ${piece.tagCode}`} placeholder="Cor" disabled={!editable} value={color} onChange={(e) => setColor(e.target.value)} />
        <Input aria-label={`Marca da peça ${piece.tagCode}`} placeholder="Marca" disabled={!editable} value={brand} onChange={(e) => setBrand(e.target.value)} />
        <Input aria-label={`Avarias da peça ${piece.tagCode}`} placeholder="Avarias que já tinha na entrada" disabled={!editable} value={intakeNotes} onChange={(e) => setIntakeNotes(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button size="sm" variant="secondary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Salvar peça
          </Button>
        )}
        {removable && (
          <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => confirm(`Tirar a peça ${piece.tagCode} da ordem? O valor sai do total.`) && remove.mutate()}>
            Tirar da ordem
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Incluir peças numa ordem que está na produção: mesma lógica do balcão, uma linha por vez. */
function AddPieces({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const services = useServices();
  const garments = useGarmentTypes();
  const active: LaundryService[] = services.data?.filter((s) => s.active) ?? [];
  const [serviceId, setServiceId] = useState('');
  const [garmentTypeId, setGarmentTypeId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [measure, setMeasure] = useState('');
  const service = active.find((s) => s.id === serviceId);
  const byMeasure = service && service.pricingUnit !== 'piece';
  const add = useMutation({
    mutationFn: () =>
      api(`/laundry/orders/${orderId}/pieces`, {
        method: 'POST',
        body: {
          lines: [
            {
              serviceId,
              garmentTypeId: garmentTypeId || null,
              quantity: Number(quantity) || 1,
              weightKg: service?.pricingUnit === 'kg' ? parseMoney(measure) || null : null,
              areaSqm: service?.pricingUnit === 'sqm' ? parseMoney(measure) || null : null,
            },
          ],
        },
      }),
    onSuccess: () => {
      setQuantity('1');
      setMeasure('');
      onChanged();
    },
  });

  return (
    <Card className="mt-4 space-y-3 p-4">
      <h3 className="font-medium">Incluir peças</h3>
      {add.error && <Alert>{errorText(add.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1.2fr_5rem_6rem] sm:items-end">
        <Field label="Serviço">
          {(id) => (
            <Select id={id} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Escolha</option>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {formatMoney(s.basePrice)} {pricingUnitLabel[s.pricingUnit]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tipo de peça">
          {(id) => (
            <Select id={id} value={garmentTypeId} onChange={(e) => setGarmentTypeId(e.target.value)}>
              <option value="">{byMeasure ? 'Várias' : 'Escolha'}</option>
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
        <Field label="Peças">{(id) => <Input id={id} type="number" min={1} max={200} value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
        {byMeasure && <Field label={service.pricingUnit === 'kg' ? 'Peso (kg)' : 'Área (m²)'}>{(id) => <Input id={id} inputMode="decimal" value={measure} onChange={(e) => setMeasure(e.target.value)} />}</Field>}
      </div>
      <Button size="sm" variant="secondary" disabled={!serviceId} loading={add.isPending} onClick={() => add.mutate()}>
        Incluir
      </Button>
    </Card>
  );
}
