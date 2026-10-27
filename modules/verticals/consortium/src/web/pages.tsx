import { api, ApiError, CustomerSearch, formatDate, formatMoney, parseMoney, useCan, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { assetTypeLabel, assetTypes, quotaStatuses, quotaStatusLabel, type Assembly, type Plan, type Quota, type QuotaStatus } from '../contracts';

const key = ['consortium'] as const;
const quotaTone: Record<QuotaStatus, 'brand' | 'success' | 'warning' | 'danger' | 'neutral'> = { proposal: 'warning', active: 'brand', contemplated: 'success', rejected: 'danger', cancelled: 'neutral' };
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

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
  const [form, setForm] = useState({ document: '', birthDate: '', monthlyIncome: '', dueDay: '10' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const sell = useMutation({
    mutationFn: () =>
      api<Quota>('/consortium/quotas', {
        method: 'POST',
        body: {
          customerId: customer?.id,
          planId: plan.id,
          dueDay: Number(form.dueDay),
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
          </div>
          <p className="text-xs text-fg-muted">A adesão vai para a administradora; grupo e número da cota chegam quando ela aceitar.</p>
        </form>
      )}
    </Modal>
  );
}

export function QuotasPage() {
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: [...key, 'quotas', { status }], queryFn: () => api<Quota[]>('/consortium/quotas', { query: { status: status || undefined } }) });
  return (
    <>
      <PageHeader title="Cotas vendidas" description="Adesões enviadas às administradoras e a situação de cada cota." />
      <div className="mb-4">
        <Select aria-label="Situação" className="max-w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          {quotaStatuses.map((s) => (
            <option key={s} value={s}>
              {quotaStatusLabel[s]}
            </option>
          ))}
        </Select>
      </div>
      <Card>{list.isPending ? <Spinner /> : list.isError ? <Alert>{list.error.message}</Alert> : <QuotasTable quotas={list.data} />}</Card>
    </>
  );
}

function QuotasTable({ quotas, showCustomer = true }: { quotas: Quota[]; showCustomer?: boolean }) {
  if (!quotas.length) return <EmptyState title="Nenhuma cota" />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Nº</Th>
          {showCustomer && <Th>Cliente</Th>}
          <Th>Plano</Th>
          <Th>Grupo / cota</Th>
          <Th className="text-right">Parcela</Th>
          <Th>Situação</Th>
        </tr>
      </thead>
      <tbody>
        {quotas.map((q) => (
          <tr key={q.id}>
            <Td className="tabular-nums">{q.number}</Td>
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
  );
}

export function AssembliesPage() {
  const canManage = useCan('consortium.manage');
  const list = useQuery({ queryKey: [...key, 'assemblies'], queryFn: () => api<Assembly[]>('/consortium/assemblies') });
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader title="Assembleias" description="Lance o resultado de cada assembleia: as cotas da carteira contempladas são marcadas e o cliente é avisado." actions={canManage && <Button onClick={() => setAdding(true)}>Lançar resultado</Button>} />
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <Alert>{list.error.message}</Alert>
      ) : list.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma assembleia lançada" />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.map((a) => (
            <Card key={a.id} className="p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">
                  Grupo {a.groupCode} · {formatDate(a.heldOn)}
                </span>
                <span className="text-fg-muted">
                  Sorteio: {a.drawn.join(', ') || '—'} · Lance: {a.bids.map((b) => `${b.quotaNumber} (${pct(b.percent)})`).join(', ') || '—'}
                </span>
              </div>
              {a.ourWinners.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {a.ourWinners.map((w) => (
                    <li key={w.quotaId}>
                      <Badge tone="success">Contemplada</Badge> {w.customer} — cota {w.quotaNumber} ({w.type === 'draw' ? 'sorteio' : 'lance'})
                    </li>
                  ))}
                </ul>
              )}
              {a.notes && <p className="mt-2 text-fg-muted">{a.notes}</p>}
            </Card>
          ))}
        </div>
      )}
      {adding && <AssemblyModal onClose={() => setAdding(false)} />}
    </>
  );
}

function AssemblyModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ groupCode: '', heldOn: new Date().toISOString().slice(0, 10), drawn: '', bids: '', notes: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const split = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () =>
      api('/consortium/assemblies', {
        method: 'POST',
        body: {
          groupCode: form.groupCode,
          heldOn: form.heldOn,
          drawn: split(form.drawn),
          // "045:32,5" = cota 045 com lance de 32,5%.
          bids: split(form.bids).map((b) => {
            const [quotaNumber, percent] = b.split(':');
            return { quotaNumber, percent: Number((percent ?? '0').replace(',', '.')) };
          }),
          notes: form.notes || null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
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
      title="Resultado da assembleia"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="cons-assembly-form" loading={save.isPending}>
            Lançar
          </Button>
        </>
      }
    >
      <form id="cons-assembly-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao lançar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grupo">{(id) => <Input id={id} required value={form.groupCode} onChange={(e) => set({ groupCode: e.target.value.toUpperCase() })} autoFocus />}</Field>
          <Field label="Data">{(id) => <Input id={id} type="date" required value={form.heldOn} onChange={(e) => set({ heldOn: e.target.value })} />}</Field>
        </div>
        <Field label="Cotas sorteadas" hint="Separe por vírgula. Ex.: 012, 145">
          {(id) => <Input id={id} value={form.drawn} onChange={(e) => set({ drawn: e.target.value })} />}
        </Field>
        <Field label="Lances vencedores" hint="cota:percentual, separados por vírgula. Ex.: 045:32,5, 210:28">
          {(id) => <Input id={id} value={form.bids} onChange={(e) => set({ bids: e.target.value })} />}
        </Field>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
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
