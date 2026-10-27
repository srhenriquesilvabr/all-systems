import { formatDateTime, formatMoney, useSession, formatPhone } from '@all/module-sdk/web';
import { Alert, Button, QrCode, Spinner } from '@all/ui';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useLaundryOrder } from './hooks';

/** Barra só de tela: na impressão, aparece apenas o conteúdo. */
function PrintToolbar({ orderId, children }: { orderId: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link to={`/lavanderia/ordens/${orderId}`} className="text-sm text-brand-700 hover:underline">
        ← Voltar para a ordem
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-sm text-fg-muted">{children}</span>
        <Button onClick={() => window.print()}>Imprimir</Button>
      </div>
    </div>
  );
}

/** Etiquetas para prender nas peças: o QR leva o código da etiqueta (lido no quadro de produção). */
export function PrintLabelsPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useLaundryOrder(id!);
  if (detail.isPending) return <Spinner />;
  if (detail.isError) return <Alert>{detail.error.message}</Alert>;
  const { order, pieces } = detail.data;
  const firstName = order.customer.name.split(' ')[0];

  return (
    <>
      <PrintToolbar orderId={order.id}>{pieces.length} etiqueta(s), 6 × 3,5 cm</PrintToolbar>
      <div className="flex flex-wrap gap-2 print:gap-1">
        {pieces.map((p) => (
          <div key={p.itemId} className="flex h-[3.5cm] w-[6cm] break-inside-avoid items-center gap-2 border border-dashed border-fg-subtle bg-white p-2 text-black">
            <QrCode value={p.tagCode} size={88} label={`Etiqueta ${p.tagCode}`} />
            <div className="min-w-0 text-[11px] leading-tight">
              <p className="font-mono text-base font-bold">{p.tagCode}</p>
              <p className="truncate font-medium">{firstName}</p>
              <p className="line-clamp-2">{p.description}</p>
              {order.dueAt && <p className="mt-0.5">Entrega {formatDateTime(order.dueAt)}</p>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Comprovante entregue ao cliente no balcão. */
export function PrintReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const detail = useLaundryOrder(id!);
  if (detail.isPending) return <Spinner />;
  if (detail.isError) return <Alert>{detail.error.message}</Alert>;
  const { order, pieces } = detail.data;
  const balance = order.total - order.paidAmount;

  return (
    <>
      <PrintToolbar orderId={order.id}>Formato de cupom (80 mm) ou A4</PrintToolbar>
      <div className="mx-auto max-w-[80mm] bg-white p-3 font-mono text-[12px] leading-snug text-black">
        <p className="text-center text-sm font-bold">{session.tenant.name}</p>
        <p className="mt-2 text-center text-base font-bold">ORDEM Nº {order.number}</p>
        <p className="text-center">{formatDateTime(order.createdAt)}</p>
        <hr className="my-2 border-dashed border-black" />
        <p>Cliente: {order.customer.name}</p>
        {order.customer.phone && <p>Tel.: {formatPhone(order.customer.phone)}</p>}
        {order.dueAt && <p className="font-bold">Previsão: {formatDateTime(order.dueAt)}</p>}
        <hr className="my-2 border-dashed border-black" />
        {order.items.map((item, i) => (
          <div key={item.id} className="flex justify-between gap-2">
            <span>
              {pieces[i]?.tagCode} {item.description}
            </span>
            <span className="whitespace-nowrap">{formatMoney(item.total)}</span>
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        {order.discount > 0 && (
          <div className="flex justify-between">
            <span>Desconto</span>
            <span>−{formatMoney(order.discount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold">
          <span>TOTAL</span>
          <span>{formatMoney(order.total)}</span>
        </div>
        <div className="flex justify-between">
          <span>Pago</span>
          <span>{formatMoney(order.paidAmount)}</span>
        </div>
        <div className="flex justify-between font-bold">
          <span>A PAGAR</span>
          <span>{formatMoney(balance)}</span>
        </div>
        {pieces.some((p) => p.intakeNotes) && (
          <>
            <hr className="my-2 border-dashed border-black" />
            <p className="font-bold">Avarias constatadas na entrada:</p>
            {pieces
              .filter((p) => p.intakeNotes)
              .map((p) => (
                <p key={p.itemId}>
                  {p.tagCode}: {p.intakeNotes}
                </p>
              ))}
          </>
        )}
        {order.notesCustomer && (
          <>
            <hr className="my-2 border-dashed border-black" />
            <p className="whitespace-pre-line">{order.notesCustomer}</p>
          </>
        )}
        <div className="mt-3 flex justify-center">
          <QrCode value={`OS ${order.number}`} size={96} label={`Ordem ${order.number}`} />
        </div>
        <p className="mt-1 text-center">Apresente este comprovante na retirada.</p>
      </div>
    </>
  );
}
