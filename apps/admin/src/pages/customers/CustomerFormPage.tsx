import { api } from '@all/module-sdk/web';
import { Alert, PageHeader, Spinner } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { CustomerForm } from './CustomerForm';
import type { CustomerDetail } from './types';

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

export function NewCustomerPage() {
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl">
      <BackLink to="/clientes" label="Clientes" />
      <PageHeader title="Novo cliente" />
      <CustomerForm onCancel={() => navigate('/clientes')} onSaved={(c) => navigate(`/clientes/${c.id}`)} />
    </div>
  );
}

export function EditCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const customer = useQuery({ queryKey: ['customers', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`) });

  if (customer.isPending) return <Spinner />;
  if (customer.isError) return <Alert>{customer.error.message}</Alert>;
  const back = `/clientes/${id}`;
  return (
    <div className="max-w-3xl">
      <BackLink to={back} label={customer.data.name} />
      <PageHeader title="Editar cliente" />
      <CustomerForm customer={customer.data} onCancel={() => navigate(back)} onSaved={() => navigate(back)} />
    </div>
  );
}
