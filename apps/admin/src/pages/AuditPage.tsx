import { api } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { auditActionLabel, auditDataLabel } from './auditLabels';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  data: unknown;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

interface FilterOptions {
  actions: string[];
  users: { id: string; name: string; email: string }[];
}

const PAGE = 50;
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const emptyFilters = { from: '', to: '', userId: '', action: '', q: '' };

const showValue = (v: unknown): string => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<typeof filters>) => setFilters({ ...filters, ...patch });
  const query = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')) as Record<string, string>, [filters]);
  const options = useQuery({ queryKey: ['audit', 'filters'], queryFn: () => api<FilterOptions>('/audit/filters') });
  const log = useInfiniteQuery({
    queryKey: ['audit', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<AuditEntry[]>('/audit', { query: { ...query, limit: PAGE, before: pageParam } }),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.createdAt : undefined),
    placeholderData: keepPreviousData,
  });
  const entries = log.data?.pages.flat() ?? [];
  const actions = useMemo(
    () => (options.data?.actions ?? []).map((a) => ({ code: a, label: auditActionLabel(a) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [options.data],
  );
  const filtered = Object.keys(query).length > 0;

  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê e quando nesta empresa." />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="De">{(id) => <Input id={id} type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />}</Field>
          <Field label="Até">{(id) => <Input id={id} type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />}</Field>
          <Field label="Usuário">
            {(id) => (
              <Select id={id} value={filters.userId} onChange={(e) => set({ userId: e.target.value })}>
                <option value="">Todos</option>
                <option value="system">Sistema (ações automáticas)</option>
                {options.data?.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Ação">
            {(id) => (
              <Select id={id} value={filters.action} onChange={(e) => set({ action: e.target.value })}>
                <option value="">Todas</option>
                {actions.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Busca" hint="Procura nos detalhes, como um nome ou um motivo.">
            {(id) => <Input id={id} type="search" maxLength={100} value={filters.q} onChange={(e) => set({ q: e.target.value })} />}
          </Field>
        </div>
        {filtered && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => setFilters(emptyFilters)}>
              Limpar filtros
            </Button>
          </div>
        )}
      </Card>
      <Card>
        {log.isPending ? (
          <Spinner />
        ) : log.isError ? (
          <div className="p-4"><Alert>{log.error.message}</Alert></div>
        ) : entries.length === 0 ? (
          <EmptyState title={filtered ? 'Nenhum registro com estes filtros' : 'Nenhum registro ainda'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quando</Th>
                <Th>Quem</Th>
                <Th>Ação</Th>
                <Th>IP</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <Td className="whitespace-nowrap tabular-nums text-fg-muted">{dateTime.format(new Date(e.createdAt))}</Td>
                    <Td>{e.user ? e.user.name : <span className="text-fg-muted">Sistema</span>}</Td>
                    <Td>{auditActionLabel(e.action)}</Td>
                    <Td className="text-fg-muted">{e.ip ?? '—'}</Td>
                    <Td className="text-right">
                      {isDetail(e.data) && (
                        <Button variant="ghost" size="sm" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                          {open === e.id ? 'Ocultar' : 'Detalhes'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                  {open === e.id && isDetail(e.data) && (
                    <tr>
                      <Td colSpan={5} className="bg-muted/50 text-sm">
                        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_1fr]">
                          {Object.entries(e.data).map(([k, v]) => (
                            <Fragment key={k}>
                              <dt className="text-fg-muted">{auditDataLabel(k)}</dt>
                              <dd className="break-words">{showValue(v)}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      </Td>
                    </tr>
                  )}
                </Fragment>
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

const isDetail = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0;
