import { api } from '@all/module-sdk/web';
import { Alert, PageHeader, Spinner } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
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

/**
 * ?tipo=empresa abre o formulário como Empresa. ?volta= é para onde voltar (só caminhos internos), e
 * o {id} nele vira o id do cliente criado: quem veio de Empresas atendidas volta para a ficha da empresa.
 */
export function NewCustomerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const company = params.get('tipo') === 'empresa';
  const back = params.get('volta');
  const safeBack = back?.startsWith('/') && !back.startsWith('//') ? back : null;
  const backTo = safeBack ? safeBack.replace('{id}', '').replace(/\/$/, '') : '/clientes';
  return (
    <div className="max-w-3xl">
      <BackLink to={backTo} label={safeBack ? 'Voltar' : 'Clientes'} />
      <PageHeader title={company ? 'Nova empresa' : 'Novo cliente'} />
      <CustomerForm
        initialType={company ? 'company' : 'person'}
        onCancel={() => navigate(backTo)}
        onSaved={(c) => navigate(safeBack?.includes('{id}') ? safeBack.replace('{id}', c.id) : `/clientes/${c.id}`)}
      />
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
