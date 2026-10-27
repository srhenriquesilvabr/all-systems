import { api, ApiError, formatDateTime, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { salePaymentLabel, type CashRegister, type RegisterSessionSummary, type SalesSettings } from '../contracts';
import { brl, registersKey, useRegisters, useRegisterSession, useSalesSettings } from './hooks';
import { ClosingReport, DifferenceBadge, SessionDetails } from './registers';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Histórico de sessões de caixa (abertura, fechamento, quebra/sobra), com filtros. */
export function RegistersPage() {
  const navigate = useNavigate();
  const registers = useRegisters();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [registerId, setRegisterId] = useState('');
  const [status, setStatus] = useState<'' | 'open' | 'closed'>('');
  const [withDifference, setWithDifference] = useState(false);
  const [managing, setManaging] = useState(false);
  const query = { from, to, registerId: registerId || undefined, status: status || undefined, withDifference: withDifference || undefined, limit: 200 };
  const list = useQuery({
    queryKey: [...registersKey, 'sessions', query],
    queryFn: () => api<RegisterSessionSummary[]>('/sales/registers/sessions', { query }),
  });

  return (
    <>
      <PageHeader
        title="Caixas"
        description="Aberturas e fechamentos do caixa, sangrias, suprimentos e diferenças."
        actions={
          <Button variant="secondary" onClick={() => setManaging(true)}>
            Gerenciar caixas
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="date" aria-label="De" className="w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-fg-muted">a</span>
        <Input type="date" aria-label="Até" className="w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        <Select aria-label="Caixa" className="w-auto" value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
          <option value="">Todos os caixas</option>
          {registers.data?.registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Situação" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Abertos e fechados</option>
          <option value="open">Abertos</option>
          <option value="closed">Fechados</option>
        </Select>
        <Checkbox label="Só com quebra ou sobra" checked={withDifference} onChange={(e) => setWithDifference(e.target.checked)} />
      </div>
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma sessão de caixa no período" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Caixa</Th>
                <Th>Abertura</Th>
                <Th>Fechamento</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">Dinheiro esperado</Th>
                <Th className="text-right">Diferença</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/caixas/${s.id}`)}>
                  <Td className="tabular-nums">#{s.number}</Td>
                  <Td>{s.register.name}</Td>
                  <Td className="whitespace-nowrap">
                    {formatDateTime(s.openedAt)}
                    {s.openedByName && <div className="text-xs text-fg-muted">{s.openedByName}</div>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {s.closedAt ? (
                      <>
                        {formatDateTime(s.closedAt)}
                        {s.closedByName && <div className="text-xs text-fg-muted">{s.closedByName}</div>}
                      </>
                    ) : (
                      <Badge tone="brand">Aberto</Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {brl(s.salesTotal)}
                    <div className="text-xs text-fg-muted">{s.salesCount} vendas</div>
                  </Td>
                  <Td className="text-right tabular-nums">{brl(s.expectedCash)}</Td>
                  <Td className="text-right">
                    <DifferenceBadge value={s.cashDifference} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {managing && registers.data && <ManageRegistersModal registers={registers.data.registers} onClose={() => setManaging(false)} />}
    </>
  );
}

/** Cadastro dos caixas (nome, ativo) e a exigência de caixa aberto para vender. */
function ManageRegistersModal({ registers, onClose }: { registers: CashRegister[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const canCreate = useCan('shared.sales.register');
  const canSettings = useCan('core.access.settings');
  const settings = useSalesSettings();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: registersKey });
  const create = useMutation({
    mutationFn: () => api('/sales/registers', { method: 'POST', body: { name } }),
    onSuccess: () => {
      setName('');
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; name?: string; active?: boolean }) => api(`/sales/registers/${v.id}`, { method: 'PATCH', body: { name: v.name, active: v.active } }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const require = useMutation({
    mutationFn: (value: boolean) => api('/modules/shared.sales/settings', { method: 'PUT', body: { ...(settings.data as SalesSettings), requireRegisterSession: value } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules', 'shared.sales', 'settings'] });
      refresh();
    },
  });
  const error = create.error ?? update.error ?? require.error;

  return (
    <Modal open title="Gerenciar caixas" onClose={onClose}>
      <div className="space-y-5 text-sm">
        {error && <Alert>{error instanceof ApiError ? error.message : 'Erro ao salvar'}</Alert>}
        {canSettings && settings.data && (
          <Card className="p-4">
            <Checkbox
              label={
                <>
                  <span className="font-medium">Exigir caixa aberto para vender</span>
                  <span className="block text-fg-muted">O PDV só vende com uma sessão de caixa aberta no computador, e toda venda entra no fechamento.</span>
                </>
              }
              checked={settings.data.requireRegisterSession}
              disabled={require.isPending}
              onChange={(e) => require.mutate(e.target.checked)}
            />
          </Card>
        )}
        <ul className="divide-y divide-line">
          {registers.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              {editing?.id === r.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editing.name.trim().length >= 2) update.mutate({ id: r.id, name: editing.name });
                  }}
                >
                  <Input aria-label="Nome do caixa" value={editing.name} maxLength={40} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} autoFocus />
                  <Button type="submit" size="sm" loading={update.isPending}>
                    Salvar
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </form>
              ) : (
                <>
                  <span>
                    <span className={r.active ? 'font-medium' : 'text-fg-subtle line-through'}>{r.name}</span> {r.openSession && <Badge tone="brand">Aberto</Badge>}
                  </span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ id: r.id, name: r.name })}>
                      Renomear
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!!r.openSession} onClick={() => update.mutate({ id: r.id, active: !r.active })}>
                      {r.active ? 'Desativar' : 'Reativar'}
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
          {registers.length === 0 && <li className="py-2 text-fg-muted">Nenhum caixa cadastrado.</li>}
        </ul>
        {canCreate && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2) create.mutate();
            }}
          >
            <Input aria-label="Novo caixa" placeholder='Novo caixa, ex.: "Caixa 2"' value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>
              Adicionar
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}

/** Uma sessão de caixa: totais conferidos, sangrias/suprimentos, vendas e o relatório para reimprimir. */
export function RegisterSessionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const session = useRegisterSession(id);

  if (session.isPending) return <Spinner />;
  if (session.isError) return <Alert>{session.error.message}</Alert>;
  const s = session.data;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${s.register.name} · sessão #${s.number}`}
          description={s.status === 'open' ? 'Caixa aberto: os valores mudam a cada venda.' : 'Caixa fechado: os valores não mudam mais.'}
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => navigate('/caixas')}>
                Voltar
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                {s.status === 'open' ? 'Imprimir parcial' : 'Imprimir fechamento'}
              </Button>
            </div>
          }
        />
        <div className="space-y-6">
          <SessionDetails session={s} />
          <Card>
            <h2 className="px-5 pt-4 font-medium">Vendas</h2>
            {s.sales.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-muted">Nenhuma venda nesta sessão.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Nº</Th>
                    <Th>Quando</Th>
                    <Th>Pagamento</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.sales.map((sale) => (
                    <tr key={sale.id}>
                      <Td className="tabular-nums">#{sale.number}</Td>
                      <Td className="whitespace-nowrap tabular-nums">{formatDateTime(sale.soldAt)}</Td>
                      <Td>{sale.payments.map((p) => `${salePaymentLabel[p.method]} ${brl(p.amount)}`).join(' + ')}</Td>
                      <Td className="text-right tabular-nums">
                        {sale.status === 'cancelled' ? (
                          <>
                            <span className="text-fg-subtle line-through">{brl(sale.total)}</span> <Badge>Cancelada</Badge>
                          </>
                        ) : (
                          brl(sale.total)
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
      <ClosingReport session={s} />
    </>
  );
}
