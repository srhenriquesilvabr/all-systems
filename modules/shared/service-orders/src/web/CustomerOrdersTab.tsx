import { api, useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Spinner, Table, Th } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { OrderSummary } from '../contracts';
import { newOrderPath, OrderRows, ordersKey, useWorkflows } from './shared';

/** Aba "Ordens de serviço" na ficha do cliente. */
export function CustomerOrdersTab({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const canWrite = useCan('shared.service-orders.write');
  const workflows = useWorkflows();
  const orders = useQuery({
    queryKey: [...ordersKey, { customerId }],
    queryFn: () => api<{ items: OrderSummary[]; total: number }>('/service-orders', { query: { customerId, limit: 50 } }),
  });
  const newOrder = canWrite && <Button onClick={() => navigate(`${newOrderPath(workflows.data)}?cliente=${customerId}`)}>Nova ordem</Button>;

  if (orders.isPending) return <Spinner />;
  if (orders.isError) return <Alert>{orders.error.message}</Alert>;
  if (orders.data.items.length === 0) return <EmptyState title="Nenhuma ordem de serviço deste cliente" action={newOrder} />;

  return (
    <>
      {newOrder && <div className="mb-3 flex justify-end">{newOrder}</div>}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Nº</Th>
              <Th>Entrada</Th>
              <Th>Status</Th>
              <Th className="text-right">Total</Th>
              <Th>Pagamento</Th>
              <Th>Previsão</Th>
            </tr>
          </thead>
          <tbody>
            <OrderRows orders={orders.data.items} workflows={workflows.data} showCustomer={false} />
          </tbody>
        </Table>
      </Card>
    </>
  );
}
