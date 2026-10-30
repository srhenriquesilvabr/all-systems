import { FinancingPanel, ProposalList, useProposals } from '@all/banking/web';
import { api, ApiError, CustomerSearch, formatDateTime, formatMoney, parseMoney, useCan, useSession, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { dealStatuses, dealStatusLabel, lostReasonKeys, lostReasonLabel, type Deal, type DealsSummary, type DealStatus, type LostReasonKey, type Vehicle } from '../contracts';

const key = ['vehicles'] as const;
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
  const [sellerId, setSellerId] = useState('');
  const team = useTeam();
  const list = useQuery({
    queryKey: [...key, 'deals', { status, sellerId }],
    queryFn: () => api<Deal[]>('/vehicles/deals', { query: { status: status || undefined, sellerId: sellerId || undefined } }),
  });
  return (
    <>
      <PageHeader title="Negociações" description="Abra a negociação na página do veículo. O financiamento é simulado e enviado aos bancos parceiros." />
      <SellersSummary />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="Situação" className="max-w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          {dealStatuses.map((s) => (
            <option key={s} value={s}>
              {dealStatusLabel[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Vendedor" className="max-w-56" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
          <option value="">Todos os vendedores</option>
          {team.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
          <option value="none">Sem vendedor</option>
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
          <EmptyState title="Nenhuma negociação" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nº</Th>
                <Th>Cliente</Th>
                <Th>Veículo</Th>
                <Th>Vendedor</Th>
                <Th>Pagamento</Th>
                <Th className="text-right">Valor</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <Link to={`/veiculos/negociacoes/${d.id}`} className="font-medium text-brand-700 hover:underline">
                      nº {d.number}
                    </Link>
                  </Td>
                  <Td>{d.customer.name}</Td>
                  <Td>{d.vehicle.title}</Td>
                  <Td>{d.sellerName ?? '—'}</Td>
                  <Td>{d.paymentType === 'cash' ? 'À vista' : `Financiado ${formatMoney(d.financedAmount)}`}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(d.price - d.discount)}</Td>
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

/** Resumo do mês por vendedor e perdas por motivo (calculado na API). */
function SellersSummary() {
  const [month, setMonth] = useState(thisMonth());
  const summary = useQuery({ queryKey: [...key, 'deals-summary', month], queryFn: () => api<DealsSummary>('/vehicles/deals/summary', { query: monthBounds(month) }) });
  const lostTotal = summary.data?.lostByReason.reduce((n, r) => n + r.count, 0) ?? 0;
  return (
    <Card className="mb-4 p-4 text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Resultado por vendedor</span>
        <Input aria-label="Mês" type="month" className="max-w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      {summary.isPending ? (
        <Spinner />
      ) : summary.isError ? (
        <Alert>{summary.error.message}</Alert>
      ) : summary.data.sellers.length === 0 ? (
        <p className="text-fg-muted">Nada em aberto nem encerrado neste mês.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
          <Table>
            <thead>
              <tr>
                <Th>Vendedor</Th>
                <Th className="text-right">Em aberto</Th>
                <Th className="text-right">Vendidas</Th>
                <Th className="text-right">Valor vendido</Th>
                <Th className="text-right">Perdidas</Th>
              </tr>
            </thead>
            <tbody>
              {summary.data.sellers.map((s) => (
                <tr key={s.sellerId ?? 'none'}>
                  <Td>{s.sellerName ?? 'Sem vendedor'}</Td>
                  <Td className="text-right tabular-nums">{s.open}</Td>
                  <Td className="text-right tabular-nums">{s.won}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.wonValue)}</Td>
                  <Td className="text-right tabular-nums">{s.lost}</Td>
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
  const canWrite = useCan('vehicles.deals.write');
  const deal = useQuery({ queryKey: [...key, 'deal', id], queryFn: () => api<Deal>(`/vehicles/deals/${id}`) });
  const proposals = useProposals('vehicle_deal', id);
  const [editing, setEditing] = useState(false);
  const [losing, setLosing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [reasonKey, setReasonKey] = useState<LostReasonKey | ''>('');
  const [reason, setReason] = useState('');
  const close = useMutation({ mutationFn: () => api(`/vehicles/deals/${id}/close`, { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries() });
  const lose = useMutation({
    mutationFn: () => api(`/vehicles/deals/${id}/lose`, { method: 'POST', body: { reasonKey, reason: reason.trim() || null } }),
    onSuccess: () => {
      setLosing(false);
      queryClient.invalidateQueries();
    },
  });
  const loseReady = reasonKey !== '' && (reasonKey !== 'other' || reason.trim().length >= 3);
  const [plate, setPlate] = useState('');
  const fixPlate = useMutation({
    mutationFn: () => api(`/vehicles/deals/${id}/trade-plate`, { method: 'PATCH', body: { plate } }),
    onSuccess: () => {
      setPlate('');
      close.reset();
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (deal.isPending) return <Spinner />;
  if (deal.isError) return <Alert>{deal.error.message}</Alert>;
  const d = deal.data;
  const open = d.status !== 'closed' && d.status !== 'lost';
  const net = d.price - d.discount;
  const canClose = open && (d.paymentType === 'cash' || d.status === 'credit_approved');
  const contracted = proposals.data?.some((p) => p.status === 'contracted') ?? false;
  const plateTaken = close.error instanceof ApiError && close.error.code === 'TRADE_PLATE_TAKEN';

  return (
    <>
      <PageHeader
        title={`Negociação nº ${d.number}`}
        description={`${d.customer.name} · ${d.vehicle.title}${d.sellerName ? ` · ${d.sellerName}` : ''}`}
        actions={
          canWrite &&
          open && (
            <div className="flex gap-2">
              <Button variant="ghost" disabled={contracted} title={contracted ? 'Registre o distrato na proposta contratada antes' : undefined} onClick={() => setLosing(true)}>
                Perdida
              </Button>
              {['negotiating', 'credit_rejected'].includes(d.status) && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Alterar valores
                </Button>
              )}
              <Button disabled={!canClose} loading={close.isPending} onClick={() => close.mutate()}>
                Fechar venda
              </Button>
            </div>
          )
        }
      />
      {close.error && <Alert>{close.error instanceof ApiError ? close.error.message : 'Erro ao fechar'}</Alert>}
      {lose.error && <Alert>{lose.error instanceof ApiError ? lose.error.message : 'Erro'}</Alert>}
      {open && contracted && <Alert tone="info">Há contrato de financiamento assinado. Para marcar como perdida, combine o distrato com o banco e clique em "Registrar distrato" na proposta.</Alert>}
      {plateTaken && canWrite && (
        <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
          <Field label="Placa correta do carro da troca">{(fid) => <Input id={fid} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="ABC1D23" />}</Field>
          <Button variant="secondary" disabled={!plate} loading={fixPlate.isPending} onClick={() => fixPlate.mutate()}>
            Corrigir placa
          </Button>
          {fixPlate.error && <Alert>{fixPlate.error instanceof ApiError ? fixPlate.error.message : 'Erro ao salvar'}</Alert>}
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit space-y-2 p-5 text-sm">
          <Badge tone={dealTone[d.status]}>{dealStatusLabel[d.status]}</Badge>
          {(d.lostReasonKey || d.lostReason) && <p className="text-fg-muted">Motivo: {reasonText(d)}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-fg-muted">Vendedor</span>
            <span>
              {d.sellerName ?? '—'}
              {canWrite && open && (
                <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => setReassigning(true)}>
                  trocar
                </button>
              )}
            </span>
          </div>
          <Line label="Preço">{formatMoney(d.price)}</Line>
          {d.discount > 0 && <Line label="Desconto">-{formatMoney(d.discount)}</Line>}
          <Line label="Valor da venda" strong>
            {formatMoney(net)}
          </Line>
          {d.tradeIn && (
            <Line label={`Troca: ${d.tradeIn.brand} ${d.tradeIn.model} ${d.tradeIn.yearModel}${d.tradeIn.plate ? `, ${d.tradeIn.plate}` : ''}`}>-{formatMoney(d.tradeIn.value)}</Line>
          )}
          {d.paymentType === 'financing' ? (
            <>
              <Line label="Entrada">-{formatMoney(d.downPayment)}</Line>
              <Line label="A financiar" strong>
                {formatMoney(d.financedAmount)}
              </Line>
            </>
          ) : (
            <Line label="À vista" strong>
              {formatMoney(net - (d.tradeIn?.value ?? 0))}
            </Line>
          )}
          {d.notes && <p className="whitespace-pre-line pt-2 text-fg-muted">{d.notes}</p>}
          {d.closedAt && <p className="pt-2 text-fg-muted">Vendido em {formatDateTime(d.closedAt)}</p>}
          <Link to={`/veiculos/estoque/${d.vehicle.id}`} className="block pt-2 text-brand-700 hover:underline">
            Ver veículo
          </Link>
        </Card>
        <div className="min-w-0">
          {d.paymentType === 'financing' ? (
            open ? (
              <FinancingPanel
                product="vehicle_financing"
                amount={d.financedAmount}
                defaultTerm={48}
                terms={[12, 24, 36, 48, 60]}
                sourceType="vehicle_deal"
                sourceId={d.id}
                customerId={d.customer.id}
                applicant={{ name: d.customer.name, document: d.customer.document ?? '', email: d.customer.email, phone: d.customer.phone }}
                details={{ vehicle: d.vehicle.title, plate: d.vehicle.plate, saleValue: net, downPayment: d.downPayment }}
                disabled={d.status === 'credit_analysis' || d.status === 'credit_approved'}
              />
            ) : (
              <ProposalList proposals={proposals.data} loading={proposals.isPending} readOnly />
            )
          ) : (
            <Card className="p-5 text-sm text-fg-muted">Venda à vista: sem financiamento. Para financiar, altere a forma de pagamento.</Card>
          )}
        </div>
      </div>
      {editing && <DealModal deal={d} onClose={() => setEditing(false)} />}
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
            <Field label="Motivo" hint="O veículo volta a ficar disponível.">
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
      {reassigning && <SellerModal deal={d} onClose={() => setReassigning(false)} />}
    </>
  );
}

function SellerModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const queryClient = useQueryClient();
  const team = useTeam();
  const [sellerId, setSellerId] = useState(deal.sellerId ?? '');
  const save = useMutation({
    mutationFn: () => api<Deal>(`/vehicles/deals/${deal.id}/seller`, { method: 'PATCH', body: { sellerId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Trocar vendedor"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button disabled={!sellerId || sellerId === deal.sellerId} loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
      <Field label="Vendedor responsável">
        {(fid) => (
          <Select id={fid} value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
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

const money = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','));

export function DealModal({ vehicle, deal, onClose, onSaved }: { vehicle?: Vehicle; deal?: Deal; onClose: () => void; onSaved?: (d: Deal) => void }) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const { user } = useSession();
  const team = useTeam();
  const [form, setForm] = useState({
    // Nova negociação: quem está abrindo; na edição, o atual (vazio = mantém).
    sellerId: deal ? (deal.sellerId ?? '') : user.id,
    price: money(deal?.price ?? vehicle?.price),
    discount: money(deal?.discount ?? 0),
    paymentType: deal?.paymentType ?? 'financing',
    downPayment: money(deal?.downPayment ?? 0),
    hasTrade: !!deal?.tradeIn,
    tradeBrand: deal?.tradeIn?.brand ?? '',
    tradeModel: deal?.tradeIn?.model ?? '',
    tradeYear: String(deal?.tradeIn?.yearModel ?? ''),
    tradePlate: deal?.tradeIn?.plate ?? '',
    tradeValue: money(deal?.tradeIn?.value),
    notes: deal?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        price: parseMoney(form.price),
        discount: parseMoney(form.discount) || 0,
        paymentType: form.paymentType,
        downPayment: form.paymentType === 'financing' ? parseMoney(form.downPayment) || 0 : 0,
        tradeIn: form.hasTrade ? { brand: form.tradeBrand, model: form.tradeModel, yearModel: Number(form.tradeYear), plate: form.tradePlate || null, value: parseMoney(form.tradeValue) } : null,
        notes: form.notes || null,
        sellerId: form.sellerId || null,
      };
      return deal ? api<Deal>(`/vehicles/deals/${deal.id}`, { method: 'PATCH', body }) : api<Deal>('/vehicles/deals', { method: 'POST', body: { ...body, customerId: customer?.id, vehicleId: vehicle!.id } });
    },
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
  const needsCustomer = !deal && !customer;
  return (
    <Modal
      open
      title={deal ? 'Alterar valores' : 'Nova negociação'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="veh-deal-form" loading={save.isPending} disabled={needsCustomer}>
            Salvar
          </Button>
        </>
      }
    >
      {needsCustomer ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">Quem está comprando?</p>
          <CustomerSearch onSelect={setCustomer} />
        </div>
      ) : (
        <form id="veh-deal-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          {customer && (
            <p className="text-sm">
              Cliente: <span className="font-medium">{customer.name}</span>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preço (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.price} onChange={(e) => set({ price: e.target.value })} />}</Field>
            <Field label="Desconto (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.discount} onChange={(e) => set({ discount: e.target.value })} />}</Field>
            <Field label="Pagamento">
              {(id) => (
                <Select id={id} value={form.paymentType} onChange={(e) => set({ paymentType: e.target.value as 'cash' | 'financing' })}>
                  <option value="financing">Financiamento</option>
                  <option value="cash">À vista</option>
                </Select>
              )}
            </Field>
            {form.paymentType === 'financing' && <Field label="Entrada (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.downPayment} onChange={(e) => set({ downPayment: e.target.value })} />}</Field>}
            <Field label="Vendedor">
              {(id) => (
                <Select id={id} value={form.sellerId} onChange={(e) => set({ sellerId: e.target.value })}>
                  {deal && !deal.sellerId && <option value="">Sem vendedor</option>}
                  {team.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                  {/* Vendedor que saiu da equipe continua aparecendo até ser trocado. */}
                  {deal?.sellerId && team.data && !team.data.some((u) => u.id === deal.sellerId) && <option value={deal.sellerId}>{deal.sellerName ?? 'Atual'}</option>}
                </Select>
              )}
            </Field>
          </div>
          <Checkbox label="Tem carro na troca" checked={form.hasTrade} onChange={(e) => set({ hasTrade: e.target.checked })} />
          {form.hasTrade && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Marca">{(id) => <Input id={id} required value={form.tradeBrand} onChange={(e) => set({ tradeBrand: e.target.value })} />}</Field>
              <Field label="Modelo">{(id) => <Input id={id} required value={form.tradeModel} onChange={(e) => set({ tradeModel: e.target.value })} />}</Field>
              <Field label="Ano modelo">{(id) => <Input id={id} type="number" required value={form.tradeYear} onChange={(e) => set({ tradeYear: e.target.value })} />}</Field>
              <Field label="Placa">{(id) => <Input id={id} value={form.tradePlate} onChange={(e) => set({ tradePlate: e.target.value.toUpperCase() })} />}</Field>
              <Field label="Valor da troca (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.tradeValue} onChange={(e) => set({ tradeValue: e.target.value })} />}</Field>
            </div>
          )}
          <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        </form>
      )}
    </Modal>
  );
}

/** Aba "Veículos" na ficha do cliente. */
export function CustomerDealsTab({ customerId }: { customerId: string }) {
  const list = useQuery({ queryKey: [...key, 'deals', { customerId }], queryFn: () => api<Deal[]>('/vehicles/deals', { query: { customerId } }) });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  return (
    <Card>
      {list.data.length === 0 ? (
        <EmptyState title="Nenhuma negociação" />
      ) : (
        <ul className="divide-y divide-line text-sm">
          {list.data.map((d) => (
            <li key={d.id} className="flex justify-between gap-3 px-4 py-3">
              <Link to={`/veiculos/negociacoes/${d.id}`} className="text-brand-700 hover:underline">
                nº {d.number} · {d.vehicle.title}
              </Link>
              <Badge tone={dealTone[d.status]}>{dealStatusLabel[d.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
