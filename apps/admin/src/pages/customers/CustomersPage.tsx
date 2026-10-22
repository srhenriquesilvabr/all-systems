import { api, useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Input, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CustomerForm } from './CustomerForm';
import { formatDocument, formatPhone } from './format';
import type { Customer } from './types';

const PAGE = 25;

export function CustomersPage() {
  const navigate = useNavigate();
  const canWrite = useCan('core.customers.write');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const creating = params.get('novo') === '1';

  const customers = useQuery({
    queryKey: ['customers', 'list', { q, page }],
    queryFn: () => api<{ items: Customer[]; total: number }>('/customers', { query: { q: q || undefined, limit: PAGE, offset: page * PAGE } }),
    placeholderData: keepPreviousData,
  });
  const pages = Math.ceil((customers.data?.total ?? 0) / PAGE);
  const openForm = (open: boolean) => setParams(open ? { novo: '1' } : {}, { replace: true });

  return (
    <>
      <PageHeader
        title="Clientes"
        description={customers.data ? `${customers.data.total} cadastro(s)` : undefined}
        actions={canWrite && <Button onClick={() => openForm(true)}>Novo cliente</Button>}
      />
      <Input
        type="search"
        aria-label="Buscar clientes"
        placeholder="Buscar por nome, e-mail, CPF/CNPJ ou telefone"
        className="mb-4 max-w-md"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
      />

      <Card>
        {customers.isPending ? (
          <Spinner />
        ) : customers.isError ? (
          <div className="p-4">
            <Alert>{customers.error.message}</Alert>
          </div>
        ) : customers.data.items.length === 0 ? (
          <EmptyState
            title={q ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
            action={canWrite && !q && <Button onClick={() => openForm(true)}>Cadastrar o primeiro</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>CPF/CNPJ</Th>
                <Th>Telefone</Th>
                <Th>E-mail</Th>
              </tr>
            </thead>
            <tbody>
              {customers.data.items.map((c) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <Td>
                    <Link to={`/clientes/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.name}
                    </Link>
                  </Td>
                  <Td className="tabular-nums text-fg-muted">{formatDocument(c.document) || '—'}</Td>
                  <Td className="tabular-nums text-fg-muted">{formatPhone(c.phone) || '—'}</Td>
                  <Td className="text-fg-muted">{c.email ?? '—'}</Td>
                </tr>
              ))}
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

      {creating && canWrite && <CustomerForm onClose={() => openForm(false)} onSaved={(c) => navigate(`/clientes/${c.id}`)} />}
    </>
  );
}
