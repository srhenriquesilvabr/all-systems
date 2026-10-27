import { api, formatDateTime, formatMoney } from '@all/module-sdk/web';
import { Badge } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { paymentStatusLabel, type OrderSummary, type ServiceOrderWorkflow } from '../contracts';

export const ordersKey = ['service-orders'];

export function useWorkflows() {
  return useQuery({
    queryKey: ['service-orders', 'workflows'],
    queryFn: () => api<ServiceOrderWorkflow[]>('/service-orders/workflows'),
    staleTime: Infinity,
  });
}

export function StatusBadge({ workflows, workflow, status }: { workflows?: ServiceOrderWorkflow[]; workflow: string; status: string }) {
  const meta = workflows?.find((w) => w.key === workflow)?.statuses.find((s) => s.key === status);
  return <Badge tone={meta?.tone ?? 'neutral'}>{meta?.label ?? status}</Badge>;
}

export function PaymentBadge({ status }: { status: OrderSummary['paymentStatus'] }) {
  const tone = status === 'paid' ? 'success' : status === 'partial' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{paymentStatusLabel[status]}</Badge>;
}

/** Linhas de ordens usadas na lista geral e na aba do cliente. */
export function OrderRows({ orders, workflows, showCustomer = true }: { orders: OrderSummary[]; workflows?: ServiceOrderWorkflow[]; showCustomer?: boolean }) {
  return (
    <>
      {orders.map((o) => (
        <tr key={o.id} className="hover:bg-muted/50">
          <td className="border-b border-line px-4 py-3">
            <Link to={orderPath(workflows, o)} className="font-medium text-brand-700 hover:underline">
              nº {o.number}
            </Link>
          </td>
          {showCustomer && <td className="border-b border-line px-4 py-3">{o.customer.name}</td>}
          <td className="border-b border-line px-4 py-3">
            <StatusBadge workflows={workflows} workflow={o.workflow} status={o.status} />
          </td>
          <td className="border-b border-line px-4 py-3 text-right tabular-nums">{formatMoney(o.total)}</td>
          <td className="border-b border-line px-4 py-3">
            <PaymentBadge status={o.paymentStatus} />
          </td>
          <td className="border-b border-line px-4 py-3 text-fg-muted">{o.dueAt ? formatDateTime(o.dueAt) : '—'}</td>
        </tr>
      ))}
    </>
  );
}

/** Tela de detalhe da ordem: a da vertical, se o fluxo tiver uma; senão a genérica. */
export function orderPath(workflows: ServiceOrderWorkflow[] | undefined, order: { id: string; workflow: string }) {
  const custom = workflows?.find((w) => w.key === order.workflow)?.detailPath;
  return custom ? custom.replace(':id', order.id) : `/ordens/${order.id}`;
}

/** Tela de nova ordem: a da vertical contratada (ex.: balcão da lavanderia) ou a genérica. */
export function newOrderPath(workflows: ServiceOrderWorkflow[] | undefined) {
  return workflows?.find((w) => w.newPath)?.newPath ?? '/ordens/nova';
}
