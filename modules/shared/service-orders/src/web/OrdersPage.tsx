import { api, useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Table, Th } from '@all/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { OrderSummary } from '../contracts';
import { newOrderPath, OrderRows, ordersKey, useWorkflows } from './shared';

const PAGE = 25;

export function OrdersPage() {
  const navigate = useNavigate();
  const canWrite = useCan('shared.service-orders.write');
  const workflows = useWorkflows();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const orders = useQuery({
    queryKey: [...ordersKey, { q, status, page }],
    queryFn: () => api<{ items: OrderSummary[]; total: number }>('/service-orders', { query: { q: q || undefined, status: status || undefined, limit: PAGE, offset: page * PAGE } }),
    placeholderData: keepPreviousData,
  });

  // Status de todos os fluxos, sem repetir (ex.: "Pronta" do fluxo padrão e da lavanderia).
  const statuses = [...new Map((workflows.data ?? []).flatMap((w) => w.statuses).map((s) => [s.key, s.label])).entries()];
  const pages = Math.ceil((orders.data?.total ?? 0) / PAGE);

  return (
    <>
      <PageHeader
        title="Ordens de serviço"
        actions={canWrite && <Button onClick={() => navigate(newOrderPath(workflows.data))}>Nova ordem</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          type="search"
          aria-label="Buscar"
          placeholder="Buscar por número ou cliente"
          className="max-w-xs"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <Select
          aria-label="Status"
          className="max-w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Todos os status</option>
          {statuses.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {orders.isPending ? (
          <Spinner />
        ) : orders.isError ? (
          <div className="p-4">
            <Alert>{orders.error.message}</Alert>
          </div>
        ) : orders.data.items.length === 0 ? (
          <EmptyState
            title={q || status ? 'Nenhuma ordem encontrada' : 'Nenhuma ordem de serviço ainda'}
            action={canWrite && !q && !status && <Button onClick={() => navigate(newOrderPath(workflows.data))}>Abrir a primeira</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Cliente</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th>Pagamento</Th>
                <Th>Previsão</Th>
              </tr>
            </thead>
            <tbody>
              <OrderRows orders={orders.data.items} workflows={workflows.data} />
            </tbody>
          </Table>
        )}
      </Card>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-fg-muted">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          Página {page + 1} de {pages}
          <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </>
  );
}
