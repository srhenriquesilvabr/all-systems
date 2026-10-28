import { api, CustomerSearch, formatMoney, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { rewardStatusLabel, type LeadListItem, type Referrer } from '../../contracts';
import { errorText, useTeam } from '../common';
import { leadsKey, rewardTone } from './common';

/** Indicação premiada: links por cliente ou vendedor, leads indicados e a situação das recompensas. */
export function ReferralsPage() {
  const queryClient = useQueryClient();
  const team = useTeam();
  const referrers = useQuery({ queryKey: [...leadsKey, 'referrers'], queryFn: () => api<Referrer[]>('/consortium/referrers') });
  const referred = useQuery({ queryKey: [...leadsKey, 'list', { source: 'referral' }], queryFn: () => api<LeadListItem[]>('/consortium/leads', { query: { source: 'referral' } }) });
  const [kind, setKind] = useState<'customer' | 'seller'>('customer');
  const [userId, setUserId] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: { kind: 'customer' | 'seller'; customerId?: string; userId?: string }) => api<Referrer>('/consortium/referrers', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadsKey }),
  });
  const toggle = useMutation({
    mutationFn: (r: Referrer) => api(`/consortium/referrers/${r.id}`, { method: 'PATCH', body: { active: !r.active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadsKey }),
  });
  async function copy(r: Referrer) {
    await navigator.clipboard?.writeText(r.url).catch(() => undefined);
    setCopied(r.id);
  }
  return (
    <>
      <PageHeader title="Indicações" description="Cada cliente ou vendedor ganha um link do simulador. Quem chega pelo link vira lead com a indicação registrada; a recompensa fica a pagar quando a cota é aceita." />
      <Card className="mb-4 space-y-3 p-5">
        <h2 className="font-medium">Novo link de indicação</h2>
        {create.error && <Alert>{errorText(create.error, 'Erro ao criar')}</Alert>}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Quem indica">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as 'customer' | 'seller')}>
                <option value="customer">Cliente da carteira</option>
                <option value="seller">Vendedor</option>
              </Select>
            )}
          </Field>
          {kind === 'seller' && (
            <>
              <Field label="Vendedor">
                {(id) => (
                  <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}>
                    <option value="">Escolha…</option>
                    {team.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button disabled={!userId} loading={create.isPending} onClick={() => create.mutate({ kind: 'seller', userId })}>
                Criar link
              </Button>
            </>
          )}
        </div>
        {kind === 'customer' && <CustomerSearch autoFocus={false} onSelect={(c: CustomerOption) => create.mutate({ kind: 'customer', customerId: c.id })} />}
      </Card>

      <Card className="mb-6">
        {referrers.isPending ? (
          <Spinner />
        ) : referrers.isError ? (
          <div className="p-4">
            <Alert>{referrers.error.message}</Alert>
          </div>
        ) : referrers.data.length === 0 ? (
          <EmptyState title="Nenhum link de indicação" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quem indica</Th>
                <Th>Link</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">Recompensas</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {referrers.data.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className={r.active ? 'font-medium' : 'text-fg-subtle'}>{r.name}</span>
                    <div className="text-xs text-fg-muted">{r.kind === 'customer' ? 'Cliente' : 'Vendedor'}</div>
                  </Td>
                  <Td className="max-w-72 text-xs">
                    <span className="break-all">{r.url}</span>
                    <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => copy(r)}>
                      {copied === r.id ? 'copiado' : 'copiar'}
                    </button>
                  </Td>
                  <Td className="text-right tabular-nums">{r.leads}</Td>
                  <Td className="text-right tabular-nums">{r.won}</Td>
                  <Td className="text-right text-sm">
                    {r.rewardsDue > 0 && <Badge tone="warning">{r.rewardsDue} a pagar</Badge>} {r.rewardsPaid > 0 && <Badge tone="success">{r.rewardsPaid} pagas</Badge>}
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === r.id} onClick={() => toggle.mutate(r)}>
                      {r.active ? 'Desativar' : 'Reativar'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <h2 className="mb-2 font-medium">Leads indicados</h2>
      <Card>
        {referred.isPending ? (
          <Spinner />
        ) : referred.isError ? (
          <div className="p-4">
            <Alert>{referred.error.message}</Alert>
          </div>
        ) : referred.data.length === 0 ? (
          <EmptyState title="Nenhum lead indicado ainda" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Lead</Th>
                <Th>Indicado por</Th>
                <Th>Recompensa</Th>
              </tr>
            </thead>
            <tbody>
              {referred.data.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <Link to={`/consorcio/leads/${l.id}`} className="text-brand-700 hover:underline">
                      {l.name}
                    </Link>
                  </Td>
                  <Td className="text-sm">{l.referrer?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={rewardTone[l.rewardStatus]}>{rewardStatusLabel[l.rewardStatus]}</Badge>
                    {l.rewardAmount != null && <span className="ml-2 text-sm tabular-nums">{formatMoney(l.rewardAmount)}</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
