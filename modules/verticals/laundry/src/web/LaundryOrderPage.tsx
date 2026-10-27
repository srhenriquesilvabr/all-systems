import { api, apiUpload, ApiError, AuthImage, formatDateTime, formatMoney, useCan, formatPhone } from '@all/module-sdk/web';
import { ordersKey, PaymentBadge, PaymentModal, StatusBadge, Transitions, useWorkflows } from '@all/service-orders/web';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { pieceStatuses, pieceStatusLabel, type Piece, type PieceStatus } from '../contracts';
import { laundryKey, useLaundryOrder } from './hooks';
import { OrderLogisticsCard } from './OrderLogisticsCard';

export function LaundryOrderPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const workflows = useWorkflows();
  const detail = useLaundryOrder(id!);
  const canPay = useCan('shared.service-orders.payments');
  const [paying, setPaying] = useState(false);

  if (detail.isPending) return <Spinner />;
  if (detail.isError) return <Alert>{detail.error.message}</Alert>;
  const { order, pieces } = detail.data;
  const workflow = workflows.data?.find((w) => w.key === order.workflow);
  const balance = Math.round((order.total - order.paidAmount) * 100) / 100;
  const inProduction = order.status === 'received' || order.status === 'in_process';
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [...laundryKey, 'orders', order.id] });
    queryClient.invalidateQueries({ queryKey: ordersKey });
  };

  return (
    <>
      <PageHeader
        title={`Ordem nº ${order.number}`}
        description={`${order.customer.name} · recebida em ${formatDateTime(order.receivedAt)}${order.dueAt ? ` · previsão ${formatDateTime(order.dueAt)}` : ''}`}
        actions={
          <>
            <Link to={`/lavanderia/ordens/${order.id}/comprovante`}>
              <Button variant="secondary">Comprovante</Button>
            </Link>
            <Link to={`/lavanderia/ordens/${order.id}/etiquetas`}>
              <Button variant="secondary">Etiquetas</Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge workflows={workflows.data} workflow={order.workflow} status={order.status} />
        {/* A ordem também muda sozinha conforme as peças (ver quadro de produção). */}
        {workflow && <Transitions order={order} workflow={workflow} onChanged={refresh} hide={['in_process', 'ready']} />}
      </div>
      {order.cancelReason && (
        <div className="mb-4">
          <Alert>Cancelada: {order.cancelReason}</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {pieces.map((p) => (
            <PieceCard key={p.itemId} piece={p} editable={inProduction} onChanged={refresh} />
          ))}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Pagamento</h2>
              <PaymentBadge status={order.paymentStatus} />
            </div>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              {order.discount > 0 && (
                <>
                  <dt className="text-fg-muted">Desconto</dt>
                  <dd className="text-right tabular-nums">−{formatMoney(order.discount)}</dd>
                </>
              )}
              <dt className="text-fg-muted">Total</dt>
              <dd className="text-right tabular-nums">{formatMoney(order.total)}</dd>
              <dt className="text-fg-muted">Pago</dt>
              <dd className="text-right tabular-nums">{formatMoney(order.paidAmount)}</dd>
              <dt className="text-fg-muted">Em aberto</dt>
              <dd className="text-right font-medium tabular-nums">{formatMoney(balance)}</dd>
            </dl>
            {balance > 0 && order.status !== 'cancelled' && canPay && (
              <Button className="mt-4 w-full" onClick={() => setPaying(true)}>
                Registrar pagamento
              </Button>
            )}
          </Card>

          <OrderLogisticsCard order={order} onChanged={refresh} />

          <Card className="space-y-1 p-5 text-sm">
            <h2 className="mb-2 font-medium">Cliente</h2>
            <Link to={`/clientes/${order.customer.id}`} className="font-medium text-brand-700 hover:underline">
              {order.customer.name}
            </Link>
            <p className="text-fg-muted">{[formatPhone(order.customer.phone), order.customer.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}</p>
            {order.notesCustomer && <p className="whitespace-pre-line pt-2">{order.notesCustomer}</p>}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-medium">Histórico</h2>
            <ol className="space-y-2 text-sm">
              {order.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="tabular-nums text-fg-muted">{formatDateTime(h.createdAt)}</span>
                  <StatusBadge workflows={workflows.data} workflow={order.workflow} status={h.to} />
                  {h.userName && <span className="text-fg-muted">por {h.userName}</span>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {paying && (
        <PaymentModal
          order={order}
          balance={balance}
          onClose={() => {
            setPaying(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function PieceCard({ piece, editable, onChanged }: { piece: Piece; editable: boolean; onChanged: () => void }) {
  const canMove = useCan('laundry.orders.status');
  const fileInput = useRef<HTMLInputElement>(null);
  const [incident, setIncident] = useState(false);
  const move = useMutation({
    mutationFn: (status: PieceStatus) => api(`/laundry/pieces/${piece.itemId}/status`, { method: 'POST', body: { status } }),
    onSuccess: onChanged,
  });
  const upload = useMutation({ mutationFn: (file: File) => apiUpload(`/laundry/pieces/${piece.itemId}/photos`, 'photo', file), onSuccess: onChanged });
  const removePhoto = useMutation({
    mutationFn: (fileId: string) => api(`/laundry/pieces/${piece.itemId}/photos/${fileId}`, { method: 'DELETE' }),
    onSuccess: onChanged,
  });
  const error = move.error ?? upload.error ?? removePhoto.error;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold">{piece.tagCode}</p>
          <p className="font-medium">{piece.description}</p>
          <p className="text-sm text-fg-muted">
            {[piece.brand, piece.weightKg !== null ? `${piece.weightKg.toLocaleString('pt-BR')} kg` : null, piece.piecesCount > 1 ? `${piece.piecesCount} peças` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {piece.reworkCount > 0 && <Badge tone="warning">Retrabalho ×{piece.reworkCount}</Badge>}
          {editable && canMove ? (
            <Select
              aria-label={`Etapa da peça ${piece.tagCode}`}
              className="w-36"
              value={piece.status}
              disabled={move.isPending}
              onChange={(e) => move.mutate(e.target.value as PieceStatus)}
            >
              {pieceStatuses.map((s) => (
                <option key={s} value={s}>
                  {pieceStatusLabel[s]}
                </option>
              ))}
            </Select>
          ) : (
            <Badge tone={piece.status === 'ready' ? 'success' : 'neutral'}>{pieceStatusLabel[piece.status]}</Badge>
          )}
        </div>
      </div>

      {piece.intakeNotes && <p className="mt-2 text-sm">Avarias na entrada: {piece.intakeNotes}</p>}
      {piece.incidentNotes && (
        <div className="mt-2">
          <Alert>
            Ocorrência ({formatDateTime(piece.incidentAt!)}): {piece.incidentNotes}
          </Alert>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Alert>{error instanceof ApiError ? error.message : 'Erro'}</Alert>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {piece.photos.map((photo) => (
          <span key={photo.id} className="group relative">
            <AuthImage fileId={photo.id} alt={`Foto da peça ${piece.tagCode}`} className="size-16 rounded-md border border-line object-cover" />
            {canMove && (
              <button
                type="button"
                aria-label="Remover foto"
                className="absolute -right-1.5 -top-1.5 hidden size-5 rounded-full bg-danger-600 text-xs text-white group-hover:block"
                onClick={() => confirm('Remover esta foto?') && removePhoto.mutate(photo.id)}
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {canMove && (
          <>
            {/* Em celular, `capture` abre direto a câmera. */}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => fileInput.current?.click()}>
              Foto
            </Button>
            {editable && (
              <Button variant="ghost" size="sm" onClick={() => setIncident(true)}>
                Registrar ocorrência
              </Button>
            )}
          </>
        )}
      </div>

      {incident && (
        <IncidentModal
          piece={piece}
          onClose={() => setIncident(false)}
          onSaved={() => {
            setIncident(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function IncidentModal({ piece, onClose, onSaved }: { piece: Piece; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/laundry/pieces/${piece.itemId}/incident`, { method: 'POST', body: { notes } }),
    onSuccess: onSaved,
  });
  return (
    <Modal
      open
      title={`Ocorrência — ${piece.tagCode}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" loading={save.isPending} onClick={() => save.mutate()}>
            Registrar e avisar o cliente
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro'}</Alert>}
        <p className="text-sm text-fg-muted">O cliente recebe um e-mail com esta descrição. Se puder, anexe uma foto antes.</p>
        <Field label="O que aconteceu">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />}</Field>
      </div>
    </Modal>
  );
}
