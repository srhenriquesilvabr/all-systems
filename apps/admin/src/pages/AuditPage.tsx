import { api } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { useInfiniteQuery } from '@tanstack/react-query';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

const PAGE = 50;
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

const actionLabels: Record<string, string> = {
  'tenant.created': 'Empresa criada',
  'modules.enabled': 'Módulos ativados',
  'module.disabled': 'Módulo desativado',
  'user.invited': 'Usuário convidado',
  'user.updated': 'Usuário alterado',
  'role.created': 'Papel criado',
  'role.updated': 'Papel alterado',
  'role.deleted': 'Papel excluído',
  'laundry.service.created': 'Serviço de lavanderia criado',
  'laundry.service.updated': 'Serviço de lavanderia alterado',
  'customer.created': 'Cliente cadastrado',
  'customer.updated': 'Cliente alterado',
  'customer.exported': 'Dados de cliente exportados (LGPD)',
  'customer.anonymized': 'Cliente anonimizado (LGPD)',
  'custom_field.created': 'Campo de cliente criado',
  'custom_field.updated': 'Campo de cliente alterado',
  'custom_field.deleted': 'Campo de cliente excluído',
  'finance.entry.created': 'Lançamento criado',
  'finance.entry.updated': 'Lançamento alterado',
  'finance.entry.paid': 'Baixa de lançamento',
  'finance.entry.cancelled': 'Lançamento cancelado',
  'finance.account.created': 'Conta criada',
  'finance.account.updated': 'Conta alterada',
  'finance.category.created': 'Categoria criada',
  'finance.category.updated': 'Categoria alterada',
  'service_order.created': 'Ordem de serviço aberta',
  'service_order.updated': 'Ordem de serviço alterada',
  'service_order.status_changed': 'Status de ordem alterado',
  'service_order.payment': 'Pagamento de ordem',
  'notification.template.updated': 'Mensagem personalizada',
  'notification.template.reset': 'Mensagem restaurada ao padrão',
};

export function AuditPage() {
  const log = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<AuditEntry[]>('/audit', { query: { limit: PAGE, before: pageParam } }),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.createdAt : undefined),
  });
  const entries = log.data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê e quando nesta empresa." />
      <Card>
        {log.isPending ? (
          <Spinner />
        ) : log.isError ? (
          <div className="p-4"><Alert>{log.error.message}</Alert></div>
        ) : entries.length === 0 ? (
          <EmptyState title="Nenhum registro ainda" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quando</Th>
                <Th>Quem</Th>
                <Th>Ação</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap tabular-nums text-fg-muted">{dateTime.format(new Date(e.createdAt))}</Td>
                  <Td>{e.user ? e.user.name : <span className="text-fg-muted">Sistema</span>}</Td>
                  <Td>{actionLabels[e.action] ?? e.action}</Td>
                  <Td className="text-fg-muted">{e.ip ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {log.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" loading={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>
            Carregar mais
          </Button>
        </div>
      )}
    </>
  );
}
