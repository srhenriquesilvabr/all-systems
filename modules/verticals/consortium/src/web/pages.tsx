import { api, ApiError, CustomerSearch, formatDate, formatMoney, parseMoney, useCan, useSession, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { assetTypeLabel, assetTypes, quotaStatuses, quotaStatusLabel, type Plan, type Quota, type QuotasSummary } from '../contracts';
import { key, pct, quotaTone, useTeam } from './common';
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
const monthBounds = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return { from: `${ym}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};


/** Simulador: compara planos das administradoras pela parcela e pelo custo total. */
export function SimulatorPage() {
  const queryClient = useQueryClient();
  const canManage = useCan('consortium.manage');
  const canSell = useCan('consortium.sell');
  const [assetType, setAssetType] = useState('vehicle');
  const [credit, setCredit] = useState('');
  const value = parseMoney(credit) || 0;
  const plans = useQuery({
    queryKey: [...key, 'plans', assetType, value],
    queryFn: () => api<Plan[]>('/consortium/plans', { query: { assetType: assetType || undefined, minCredit: value ? Math.round(value * 0.8) : undefined, maxCredit: value ? Math.round(value * 1.25) : undefined } }),
  });
  const sync = useMutation({ mutationFn: () => api('/consortium/plans/sync', { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: key }) });
  const [selling, setSelling] = useState<Plan | null>(null);

  return (
    <>
      <PageHeader
        title="Simulador de consórcio"
        description="Sem juros: a parcela é o crédito mais taxa de administração, fundo de reserva e seguro, dividido pelo prazo."
        actions={
          canManage && (
            <Button variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>
              Atualizar planos das administradoras
            </Button>
          )
        }
      />
      {sync.error && <Alert>{sync.error instanceof ApiError ? sync.error.message : 'Erro ao sincronizar'}</Alert>}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="Tipo de bem" className="max-w-48" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
          <option value="">Todos os bens</option>
          {assetTypes.map((t) => (
            <option key={t} value={t}>
              {assetTypeLabel[t]}
            </option>
          ))}
        </Select>
        <Input aria-label="Crédito desejado" inputMode="decimal" placeholder="Crédito desejado (R$)" className="max-w-56" value={credit} onChange={(e) => setCredit(e.target.value)} />
      </div>
      <Card>
        {plans.isPending ? (
          <Spinner />
        ) : plans.isError ? (
          <div className="p-4">
            <Alert>{plans.error.message}</Alert>
          </div>
        ) : plans.data.length === 0 ? (
          <EmptyState title="Nenhum plano" description={canManage ? 'Use "Atualizar planos das administradoras" para buscar a oferta atual.' : 'Peça à gestão para atualizar os planos.'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Plano</Th>
                <Th className="text-right">Crédito</Th>
                <Th className="text-right">Prazo</Th>
                <Th className="text-right">Taxa adm.</Th>
                <Th className="text-right">Parcela</Th>
                <Th className="text-right">Custo total</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {plans.data.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-fg-muted">
                      {p.institution} · {assetTypeLabel[p.assetType]}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.creditValue)}</Td>
                  <Td className="text-right tabular-nums">{p.termMonths} meses</Td>
                  <Td className="text-right tabular-nums">{pct(p.adminFeePercent)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatMoney(p.installment)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.totalCost)}</Td>
                  <Td className="text-right">
                    {canSell && (
                      <Button size="sm" onClick={() => setSelling(p)}>
                        Vender cota
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {selling && <SellModal plan={selling} onClose={() => setSelling(null)} />}
    </>
  );
}

function SellModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const { user } = useSession();
  const team = useTeam();
  const [form, setForm] = useState({ document: '', birthDate: '', monthlyIncome: '', dueDay: '10', sellerId: user.id });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const sell = useMutation({
    mutationFn: () =>
      api<Quota>('/consortium/quotas', {
        method: 'POST',
        body: {
          customerId: customer?.id,
          planId: plan.id,
          dueDay: Number(form.dueDay),
          sellerId: form.sellerId || null,
          applicant: {
            name: customer?.name,
            document: form.document,
            birthDate: form.birthDate || null,
            monthlyIncome: form.monthlyIncome ? parseMoney(form.monthlyIncome) : null,
            email: customer?.email ?? null,
            phone: customer?.phone ?? null,
          },
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    sell.mutate();
  }
  return (
    <Modal
      open
      title={`Vender cota — ${plan.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cons-sell-form" loading={sell.isPending} disabled={!customer}>
            Enviar adesão
          </Button>
        </>
      }
    >
      {!customer ? (
        <CustomerSearch onSelect={setCustomer} />
      ) : (
        <form id="cons-sell-form" onSubmit={submit} className="space-y-4">
          {sell.error && <Alert>{sell.error instanceof ApiError ? sell.error.message : 'Erro ao enviar'}</Alert>}
          <p className="text-sm">
            {customer.name} · crédito {formatMoney(plan.creditValue)} em {plan.termMonths}x de {formatMoney(plan.installment)} ({plan.institution})
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CPF ou CNPJ">{(id) => <Input id={id} required value={form.document} onChange={(e) => set({ document: e.target.value })} />}</Field>
            <Field label="Nascimento">{(id) => <Input id={id} type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />}</Field>
            <Field label="Renda mensal (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.monthlyIncome} onChange={(e) => set({ monthlyIncome: e.target.value })} />}</Field>
            <Field label="Dia de vencimento">{(id) => <Input id={id} type="number" min={1} max={28} value={form.dueDay} onChange={(e) => set({ dueDay: e.target.value })} />}</Field>
            <Field label="Vendedor">
              {(id) => (
                <Select id={id} value={form.sellerId} onChange={(e) => set({ sellerId: e.target.value })}>
                  {team.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <p className="text-xs text-fg-muted">A adesão vai para a administradora; grupo e número da cota chegam quando ela aceitar.</p>
        </form>
      )}
    </Modal>
  );
}

export function QuotasPage() {
  const [status, setStatus] = useState('');
  const [sellerId, setSellerId] = useState('');
  const team = useTeam();
  const list = useQuery({
    queryKey: [...key, 'quotas', { status, sellerId }],
    queryFn: () => api<Quota[]>('/consortium/quotas', { query: { status: status || undefined, sellerId: sellerId || undefined } }),
  });
  return (
    <>
      <PageHeader title="Cotas vendidas" description="Adesões enviadas às administradoras e a situação de cada cota." />
      <SellersSummary />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="Situação" className="max-w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          {quotaStatuses.map((s) => (
            <option key={s} value={s}>
              {quotaStatusLabel[s]}
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
      <Card>{list.isPending ? <Spinner /> : list.isError ? <Alert>{list.error.message}</Alert> : <QuotasTable quotas={list.data} />}</Card>
    </>
  );
}

/** Cotas vendidas no mês por vendedor (calculado na API). */
function SellersSummary() {
  const [month, setMonth] = useState(thisMonth());
  const summary = useQuery({ queryKey: [...key, 'quotas-summary', month], queryFn: () => api<QuotasSummary>('/consortium/quotas/summary', { query: monthBounds(month) }) });
  return (
    <Card className="mb-4 p-4 text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Vendas do mês por vendedor</span>
        <Input aria-label="Mês" type="month" className="max-w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      {summary.isPending ? (
        <Spinner />
      ) : summary.isError ? (
        <Alert>{summary.error.message}</Alert>
      ) : summary.data.sellers.length === 0 ? (
        <p className="text-fg-muted">Nenhuma cota vendida neste mês.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Vendedor</Th>
              <Th className="text-right">Em análise</Th>
              <Th className="text-right">Aceitas</Th>
              <Th className="text-right">Crédito vendido</Th>
              <Th className="text-right">Recusadas / canceladas</Th>
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
      )}
    </Card>
  );
}

function QuotasTable({ quotas, showCustomer = true }: { quotas: Quota[]; showCustomer?: boolean }) {
  const canManage = useCan('consortium.manage');
  const [reassigning, setReassigning] = useState<Quota | null>(null);
  if (!quotas.length) return <EmptyState title="Nenhuma cota" />;
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Nº</Th>
            {showCustomer && <Th>Cliente</Th>}
            <Th>Plano</Th>
            <Th>Grupo / cota</Th>
            <Th>Vendedor</Th>
            <Th className="text-right">Parcela</Th>
            <Th>Situação</Th>
          </tr>
        </thead>
        <tbody>
          {quotas.map((q) => (
            <tr key={q.id}>
              <Td className="tabular-nums">
                <Link to={`/consorcio/cotas/${q.id}`} className="text-brand-700 hover:underline">
                  {q.number}
                </Link>
              </Td>
              {showCustomer && (
                <Td>
                  <Link to={`/clientes/${q.customer.id}`} className="text-brand-700 hover:underline">
                    {q.customer.name}
                  </Link>
                </Td>
              )}
              <Td>
                {q.plan.name}
                <div className="text-xs text-fg-muted">
                  {q.plan.institution} · {formatMoney(q.plan.creditValue)}
                </div>
              </Td>
              <Td className="tabular-nums">{q.groupCode ? `${q.groupCode} / ${q.quotaNumber}` : '—'}</Td>
              <Td>
                {q.sellerName ?? '—'}
                {canManage && q.status !== 'rejected' && q.status !== 'cancelled' && (
                  <button type="button" className="ml-2 text-xs text-brand-700 hover:underline" onClick={() => setReassigning(q)}>
                    trocar
                  </button>
                )}
              </Td>
              <Td className="text-right tabular-nums">{formatMoney(q.plan.installment)}</Td>
              <Td>
                <Badge tone={quotaTone[q.status]}>{quotaStatusLabel[q.status]}</Badge>
                {q.contemplatedOn && (
                  <div className="text-xs text-fg-muted">
                    {q.contemplationType === 'draw' ? 'Sorteio' : `Lance ${pct(q.bidPercent ?? 0)}`} em {formatDate(q.contemplatedOn)}
                  </div>
                )}
                {q.statusMessage && <div className="text-xs text-fg-muted">{q.statusMessage}</div>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {reassigning && <SellerModal quota={reassigning} onClose={() => setReassigning(null)} />}
    </>
  );
}

function SellerModal({ quota, onClose }: { quota: Quota; onClose: () => void }) {
  const queryClient = useQueryClient();
  const team = useTeam();
  const [sellerId, setSellerId] = useState(quota.sellerId ?? '');
  const save = useMutation({
    mutationFn: () => api<Quota>(`/consortium/quotas/${quota.id}/seller`, { method: 'PATCH', body: { sellerId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  return (
    <Modal
      open
      title={`Trocar vendedor — cota nº ${quota.number}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button disabled={!sellerId || sellerId === quota.sellerId} loading={save.isPending} onClick={() => save.mutate()}>
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

/** Aba "Consórcio" na ficha do cliente. */
export function CustomerQuotasTab({ customerId }: { customerId: string }) {
  const list = useQuery({ queryKey: [...key, 'quotas', { customerId }], queryFn: () => api<Quota[]>('/consortium/quotas', { query: { customerId } }) });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  return (
    <Card>
      <QuotasTable quotas={list.data} showCustomer={false} />
    </Card>
  );
}
