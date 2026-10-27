import { FinancingPanel, ProposalList, useProposals } from '@all/banking/web';
import { api, ApiError, CustomerSearch, formatDateTime, formatMoney, parseMoney, useCan, useSession, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { dealStatuses, dealStatusLabel, lostReasonKeys, lostReasonLabel, MAX_LTV, type Deal, type DealsSummary, type DealStatus, type LostReasonKey, type Property } from '../contracts';

const key = ['real-estate'] as const;
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
const monthBounds = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return { from: `${ym}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
const reasonText = (d: Pick<Deal, 'lostReasonKey' | 'lostReason'>) =>
  [d.lostReasonKey ? lostReasonLabel[d.lostReasonKey] : null, d.lostReason].filter(Boolean).join(' — ');

function useTeam() {
  return useQuery({ queryKey: [...key, 'team'], queryFn: () => api<{ id: string; name: string }[]>('/users/team'), staleTime: 5 * 60_000 });
}
export const dealTone: Record<DealStatus, 'brand' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  negotiating: 'brand',
  credit_analysis: 'warning',
  credit_approved: 'success',
  credit_rejected: 'danger',
  closed: 'success',
  lost: 'neutral',
};

export function DealsPage() {
  const [status, setStatus] = useState('');
  const [brokerId, setBrokerId] = useState('');
  const team = useTeam();
  const list = useQuery({
    queryKey: [...key, 'deals', { status, brokerId }],
    queryFn: () => api<Deal[]>('/real-estate/deals', { query: { status: status || undefined, brokerId: brokerId || undefined } }),
  });
  return (
    <>
      <PageHeader title="Propostas de compra" description="Abra a proposta na página do imóvel. O financiamento habitacional é simulado e enviado aos bancos parceiros." />
      <BrokersSummary />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="Situação" className="max-w-60" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          {dealStatuses.map((s) => (
            <option key={s} value={s}>
              {dealStatusLabel[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Corretor" className="max-w-60" value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
          <option value="">Todos os corretores</option>
          {team.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
          <option value="none">Sem corretor</option>
        </Select>
      </div>
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma proposta" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Comprador</Th>
                <Th>Imóvel</Th>
                <Th>Corretor</Th>
                <Th className="text-right">Proposta</Th>
                <Th className="text-right">Comissão</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <Link to={`/imoveis/propostas/${d.id}`} className="font-medium text-brand-700 hover:underline">
                      nº {d.number}
                    </Link>
                  </Td>
                  <Td>{d.customer.name}</Td>
                  <Td>
                    Cód. {d.property.code} · {d.property.title}
                  </Td>
                  <Td>{d.brokerName ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(d.price)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(d.commission)}</Td>
                  <Td>
                    <Badge tone={dealTone[d.status]}>{dealStatusLabel[d.status]}</Badge>
                    {d.status === 'lost' && (d.lostReasonKey || d.lostReason) && <div className="text-xs text-fg-muted">{reasonText(d)}</div>}
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

/** Resumo do mês por corretor e perdas por motivo (calculado na API). */
function BrokersSummary() {
  const [month, setMonth] = useState(thisMonth());
  const summary = useQuery({ queryKey: [...key, 'deals-summary', month], queryFn: () => api<DealsSummary>('/real-estate/deals/summary', { query: monthBounds(month) }) });
  const lostTotal = summary.data?.lostByReason.reduce((n, r) => n + r.count, 0) ?? 0;
  return (
    <Card className="mb-4 p-4 text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Resultado por corretor</span>
        <Input aria-label="Mês" type="month" className="max-w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      {summary.isPending ? (
        <Spinner />
      ) : summary.isError ? (
        <Alert>{summary.error.message}</Alert>
      ) : summary.data.brokers.length === 0 ? (
        <p className="text-fg-muted">Nada em aberto nem encerrado neste mês.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
          <Table>
            <thead>
              <tr>
                <Th>Corretor</Th>
                <Th className="text-right">Em aberto</Th>
                <Th className="text-right">Vendidas</Th>
                <Th className="text-right">Valor vendido</Th>
                <Th className="text-right">Comissão</Th>
                <Th className="text-right">Perdidas</Th>
              </tr>
            </thead>
            <tbody>
              {summary.data.brokers.map((b) => (
                <tr key={b.brokerId ?? 'none'}>
                  <Td>{b.brokerName ?? 'Sem corretor'}</Td>
                  <Td className="text-right tabular-nums">{b.open}</Td>
                  <Td className="text-right tabular-nums">{b.won}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(b.wonValue)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(b.wonCommission)}</Td>
                  <Td className="text-right tabular-nums">{b.lost}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div>
            <p className="mb-2 font-medium">Perdas por motivo</p>
            {lostTotal === 0 ? (
              <p className="text-fg-muted">Nenhuma perda no mês.</p>
            ) : (
              <ul className="space-y-1">
                {summary.data.lostByReason.map((r) => (
                  <li key={r.reasonKey ?? 'none'} className="flex justify-between gap-3">
                    <span className="text-fg-muted">{r.reasonKey ? lostReasonLabel[r.reasonKey] : 'Sem motivo padronizado'}</span>
                    <span className="tabular-nums">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function DealPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const canWrite = useCan('real_estate.deals.write');
  const deal = useQuery({ queryKey: [...key, 'deal', id], queryFn: () => api<Deal>(`/real-estate/deals/${id}`) });
  const proposals = useProposals('real_estate_deal', id);
  const [losing, setLosing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [reasonKey, setReasonKey] = useState<LostReasonKey | ''>('');
  const [reason, setReason] = useState('');
  const close = useMutation({ mutationFn: () => api(`/real-estate/deals/${id}/close`, { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries() });
  const lose = useMutation({
    mutationFn: () => api(`/real-estate/deals/${id}/lose`, { method: 'POST', body: { reasonKey, reason: reason.trim() || null } }),
    onSuccess: () => {
      setLosing(false);
      queryClient.invalidateQueries();
    },
  });
  const loseReady = reasonKey !== '' && (reasonKey !== 'other' || reason.trim().length >= 3);
  if (deal.isPending) return <Spinner />;
  if (deal.isError) return <Alert>{deal.error.message}</Alert>;
  const d = deal.data;
  const open = d.status !== 'closed' && d.status !== 'lost';
  const canClose = open && (d.paymentType === 'cash' || d.status === 'credit_approved');
  return (
    <>
      <PageHeader
        title={`Proposta nº ${d.number}`}
        description={`${d.customer.name} · Cód. ${d.property.code} — ${d.property.title}`}
        actions={
          canWrite &&
          open && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setLosing(true)}>
                Perdida
              </Button>
              <Button disabled={!canClose} loading={close.isPending} onClick={() => close.mutate()}>
                Fechar venda
              </Button>
            </div>
          )
        }
      />
      {close.error && <Alert>{close.error instanceof ApiError ? close.error.message : 'Erro ao fechar'}</Alert>}
      {lose.error && <Alert>{lose.error instanceof ApiError ? lose.error.message : 'Erro'}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit space-y-2 p-5 text-sm">
          <Badge tone={dealTone[d.status]}>{dealStatusLabel[d.status]}</Badge>
          {(d.lostReasonKey || d.lostReason) && <p className="text-fg-muted">Motivo: {reasonText(d)}</p>}
          <p className="text-fg-muted">{d.property.address}</p>
          {d.property.askingPrice != null && <Line label="Pedido pelo proprietário">{formatMoney(d.property.askingPrice)}</Line>}
          <Line label="Proposta" strong>
            {formatMoney(d.price)}
          </Line>
          {d.paymentType === 'financing' ? (
            <>
              <Line label="Entrada">{formatMoney(d.downPayment)}</Line>
              {d.fgtsAmount > 0 && <Line label="FGTS">{formatMoney(d.fgtsAmount)}</Line>}
              <Line label="A financiar" strong>
                {formatMoney(d.financedAmount)}
              </Line>
            </>
          ) : (
            <Line label="Pagamento">À vista</Line>
          )}
          <Line label={`Comissão (${d.commissionPercent.toLocaleString('pt-BR')}%)`}>{formatMoney(d.commission)}</Line>
          <p className="pt-2 text-fg-muted">
            Corretor(a): {d.brokerName ?? '—'}
            {canWrite && open && (
              <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => setReassigning(true)}>
                trocar
              </button>
            )}
          </p>
          {d.closedAt && <p className="text-fg-muted">Vendido em {formatDateTime(d.closedAt)}</p>}
          <Link to={`/imoveis/${d.property.id}`} className="block pt-2 text-brand-700 hover:underline">
            Ver imóvel
          </Link>
        </Card>
        <div className="min-w-0">
          {d.paymentType === 'financing' ? (
            open ? (
              <FinancingPanel
                product="real_estate_financing"
                amount={d.financedAmount}
                defaultTerm={360}
                terms={[120, 180, 240, 300, 360, 420]}
                sourceType="real_estate_deal"
                sourceId={d.id}
                customerId={d.customer.id}
                applicant={{ name: d.customer.name, document: d.customer.document ?? '', email: d.customer.email, phone: d.customer.phone }}
                details={{ propertyCode: d.property.code, address: d.property.address, price: d.price, downPayment: d.downPayment, fgts: d.fgtsAmount }}
                disabled={d.status === 'credit_analysis' || d.status === 'credit_approved'}
              />
            ) : (
              <ProposalList proposals={proposals.data} loading={proposals.isPending} />
            )
          ) : (
            <Card className="p-5 text-sm text-fg-muted">Compra à vista: sem financiamento.</Card>
          )}
        </div>
      </div>
      {losing && (
        <Modal
          open
          title="Marcar como perdida"
          onClose={() => setLosing(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLosing(false)}>
                Voltar
              </Button>
              <Button variant="danger" disabled={!loseReady} loading={lose.isPending} onClick={() => lose.mutate()}>
                Confirmar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Motivo" hint="O imóvel volta a ficar disponível.">
              {(fid) => (
                <Select id={fid} value={reasonKey} onChange={(e) => setReasonKey(e.target.value as LostReasonKey | '')} autoFocus>
                  <option value="">Escolha…</option>
                  {lostReasonKeys.map((k) => (
                    <option key={k} value={k}>
                      {lostReasonLabel[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={reasonKey === 'other' ? 'Detalhes' : 'Detalhes (opcional)'}>{(fid) => <Input id={fid} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          </div>
        </Modal>
      )}
      {reassigning && <BrokerModal deal={d} onClose={() => setReassigning(false)} />}
    </>
  );
}

function BrokerModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const queryClient = useQueryClient();
  const team = useTeam();
  const [brokerId, setBrokerId] = useState(deal.brokerId ?? '');
  const save = useMutation({
    mutationFn: () => api<Deal>(`/real-estate/deals/${deal.id}/broker`, { method: 'PATCH', body: { brokerId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Trocar corretor"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button disabled={!brokerId || brokerId === deal.brokerId} loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
      <Field label="Corretor responsável">
        {(fid) => (
          <Select id={fid} value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
            <option value="">Escolha…</option>
            {team.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}

function Line({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-medium' : ''}`}>
      <span className={strong ? '' : 'text-fg-muted'}>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

export function DealModal({ property, onClose, onSaved }: { property: Property; onClose: () => void; onSaved?: (d: Deal) => void }) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const { user } = useSession();
  const team = useTeam();
  const [form, setForm] = useState({
    brokerId: user.id,
    price: property.salePrice ? property.salePrice.toFixed(2).replace('.', ',') : '',
    paymentType: property.financeable ? 'financing' : 'cash',
    downPayment: '',
    fgtsAmount: '',
    commissionPercent: '6',
    notes: '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const price = parseMoney(form.price) || 0;
  const own = (parseMoney(form.downPayment) || 0) + (parseMoney(form.fgtsAmount) || 0);
  const minOwn = price * (1 - MAX_LTV);
  const save = useMutation({
    mutationFn: () =>
      api<Deal>('/real-estate/deals', {
        method: 'POST',
        body: {
          customerId: customer?.id,
          propertyId: property.id,
          price,
          paymentType: form.paymentType,
          downPayment: parseMoney(form.downPayment) || 0,
          fgtsAmount: form.paymentType === 'financing' ? parseMoney(form.fgtsAmount) || 0 : 0,
          commissionPercent: Number(form.commissionPercent.replace(',', '.')),
          notes: form.notes || null,
          brokerId: form.brokerId || null,
        },
      }),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: key });
      onSaved?.(d);
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Modal
      open
      title="Nova proposta de compra"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="re-deal-form" loading={save.isPending} disabled={!customer}>
            Registrar proposta
          </Button>
        </>
      }
    >
      {!customer ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">Quem está comprando?</p>
          <CustomerSearch onSelect={setCustomer} />
        </div>
      ) : (
        <form id="re-deal-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          <p className="text-sm">
            Comprador: <span className="font-medium">{customer.name}</span>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Valor da proposta (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.price} onChange={(e) => set({ price: e.target.value })} />}</Field>
            <Field label="Pagamento">
              {(id) => (
                <Select id={id} value={form.paymentType} onChange={(e) => set({ paymentType: e.target.value })}>
                  {property.financeable && <option value="financing">Financiamento habitacional</option>}
                  <option value="cash">À vista</option>
                </Select>
              )}
            </Field>
            <Field label="Entrada (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.downPayment} onChange={(e) => set({ downPayment: e.target.value })} />}</Field>
            {form.paymentType === 'financing' && <Field label="FGTS (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.fgtsAmount} onChange={(e) => set({ fgtsAmount: e.target.value })} />}</Field>}
            <Field label="Comissão (%)">{(id) => <Input id={id} inputMode="decimal" value={form.commissionPercent} onChange={(e) => set({ commissionPercent: e.target.value })} />}</Field>
            <Field label="Corretor(a)">
              {(id) => (
                <Select id={id} value={form.brokerId} onChange={(e) => set({ brokerId: e.target.value })}>
                  {team.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {form.paymentType === 'financing' && price > 0 && (
            <p className={own < minOwn ? 'text-sm text-danger-600' : 'text-sm text-fg-muted'}>
              Entrada + FGTS: {formatMoney(own)} (mínimo {formatMoney(minOwn)}, {Math.round((1 - MAX_LTV) * 100)}%). A financiar: {formatMoney(Math.max(price - own, 0))}.
            </p>
          )}
          <Field label="Condições e observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        </form>
      )}
    </Modal>
  );
}

/** Aba "Imóveis" na ficha do cliente: propostas como comprador. */
export function CustomerDealsTab({ customerId }: { customerId: string }) {
  const list = useQuery({ queryKey: [...key, 'deals', { customerId }], queryFn: () => api<Deal[]>('/real-estate/deals', { query: { customerId } }) });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  return (
    <Card>
      {list.data.length === 0 ? (
        <EmptyState title="Nenhuma proposta de compra" />
      ) : (
        <ul className="divide-y divide-line text-sm">
          {list.data.map((d) => (
            <li key={d.id} className="flex justify-between gap-3 px-4 py-3">
              <Link to={`/imoveis/propostas/${d.id}`} className="text-brand-700 hover:underline">
                nº {d.number} · {d.property.title}
              </Link>
              <Badge tone={dealTone[d.status]}>{dealStatusLabel[d.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
