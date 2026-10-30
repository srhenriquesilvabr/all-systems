import { employeeStatusLabel, hrKey, payrollTypeLabel, useEmployers, type Employee, type Employer, type Payroll } from '@all/hr/web';
import { api, ApiError, formatDate, formatDocument, formatMoney, formatPhone, parseMoney, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { feeFor, feeModeLabel, feeModes, feeSummary, type ClientFee, type FeeEntry, type FeeMode } from '../contracts';

const hrcKey = ['hr_consulting'] as const;
const competenceLabel = (c: string) => new Date(`${c}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const payrollTitle = (p: Pick<Payroll, 'type' | 'competence'>) =>
  p.type === 'monthly' ? competenceLabel(p.competence) : p.type === 'termination' ? `Rescisões de ${competenceLabel(p.competence)}` : `${payrollTypeLabel[p.type]} de ${p.competence.slice(0, 4)}`;

type PayrollSummary = Pick<Payroll, 'id' | 'competence' | 'type' | 'status' | 'closedAt' | 'totals'>;
interface CustomerDetail {
  id: string;
  type: 'person' | 'company';
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: { street?: string; number?: string; complement?: string; district?: string; city?: string; state?: string; zip?: string } | null;
  notes: string | null;
}

function useFees() {
  return useQuery({ queryKey: [...hrcKey, 'fees'], queryFn: () => api<ClientFee[]>('/hr-consulting/clients') });
}

/** Empresas atendidas: os clientes do tipo empresa, com o quadro ativo, a última folha e o honorário. */
export function ClientsPage() {
  const navigate = useNavigate();
  const canCreate = useCan('core.customers.write');
  const employers = useEmployers();
  const fees = useFees();
  const [q, setQ] = useState('');
  const [view, setView] = useState<'served' | 'others'>('served');
  const feeOf = (id: string) => fees.data?.find((f) => f.customerId === id) ?? null;
  const all = [...(employers.data?.items ?? [])].sort((a, b) => b.activeEmployees - a.activeEmployees || a.name.localeCompare(b.name, 'pt-BR'));
  // Atendida: tem quadro ativo, folha ou honorário combinado. Os demais clientes empresa ficam a um clique, para começar a atender.
  const isServed = (c: Employer) => c.activeEmployees > 0 || !!c.lastPayroll || (feeOf(c.id)?.feeMode ?? 'none') !== 'none';
  const servedAll = all.filter(isServed);
  const othersAll = all.filter((c) => !isServed(c));
  const term = q.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const matches = (c: Employer) => !term || c.name.toLowerCase().includes(term) || (digits.length >= 3 && !!c.document?.includes(digits));
  // Quem nunca atendeu ninguém cai direto na lista completa: a tela vazia esconderia os clientes.
  const showOthers = view === 'others' || servedAll.length === 0;
  // A busca procura em todos os clientes empresa, atendidos ou não.
  const items = term ? all.filter(matches) : showOthers ? othersAll : servedAll;
  const served = all.filter((c) => c.activeEmployees > 0);
  const monthly = served.reduce((s, c) => s + feeOfMonth(feeOf(c.id), c.activeEmployees), 0);
  return (
    <>
      <PageHeader
        title="Empresas atendidas"
        description={
          employers.data
            ? `${served.length} empresas com colaboradores ativos · ${served.reduce((s, c) => s + c.activeEmployees, 0)} colaboradores${monthly > 0 ? ` · honorários estimados de ${formatMoney(monthly)} por mês` : ''}`
            : 'Clientes do tipo empresa: colaboradores, folhas e honorários de cada uma.'
        }
        actions={
          canCreate && (
            <Button onClick={() => navigate(`/clientes/novo?tipo=empresa&volta=${encodeURIComponent('/consultoria-rh/empresas/{id}')}`)} variant="secondary">
              Cadastrar empresa
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input aria-label="Buscar empresa" placeholder="Buscar por nome ou CNPJ" className="max-w-80" value={q} onChange={(e) => setQ(e.target.value)} />
        {servedAll.length > 0 && othersAll.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setView(view === 'served' ? 'others' : 'served')}>
            {view === 'served' ? `Outros clientes empresa (${othersAll.length})` : `Voltar às atendidas (${servedAll.length})`}
          </Button>
        )}
      </div>
      {showOthers && othersAll.length > 0 && <p className="mb-3 text-sm text-fg-muted">Clientes do tipo empresa que ainda não têm colaboradores, folha nem honorário. Abra um deles para começar a atender.</p>}
      <Card>
        {employers.isPending ? (
          <Spinner />
        ) : employers.isError ? (
          <div className="p-4">
            <Alert>{employers.error.message}</Alert>
          </div>
        ) : !employers.data.enabled ? (
          <div className="p-4">
            <Alert tone="info">O ramo Consultoria de RH não está ativo nesta empresa.</Alert>
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={term ? 'Nenhuma empresa encontrada' : 'Nenhuma empresa cadastrada'} description="As empresas atendidas são os clientes do tipo empresa (pessoa jurídica)." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Empresa</Th>
                <Th className="text-right">Colaboradores ativos</Th>
                <Th>Última folha</Th>
                <Th>Honorário</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/consultoria-rh/empresas/${c.id}`)}>
                  <Td>
                    <div className="font-medium">{c.name}</div>
                    {c.document && <div className="text-xs text-fg-muted tabular-nums">{formatDocument(c.document)}</div>}
                  </Td>
                  <Td className="text-right tabular-nums">{c.activeEmployees || <span className="text-fg-subtle">—</span>}</Td>
                  <Td>{c.lastPayroll ? <LastPayroll p={c.lastPayroll} /> : <span className="text-fg-subtle">—</span>}</Td>
                  <Td>{feeSummary(feeOf(c.id), formatMoney)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/** Honorário mensal estimado pelo quadro ativo (o lançado usa os colaboradores da folha). */
const feeOfMonth = (fee: ClientFee | null, employees: number) => (fee ? feeFor(fee, employees) : 0);

function LastPayroll({ p }: { p: NonNullable<Employer['lastPayroll']> }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="capitalize">{payrollTitle(p)}</span>
      {p.type !== 'termination' && (p.status === 'closed' ? <Badge tone="success">Fechada</Badge> : <Badge tone="warning">Em aberto</Badge>)}
    </span>
  );
}

/** Ficha da empresa atendida (rota própria). */
export function ClientPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const employers = useEmployers();
  const employer = employers.data?.items.find((e) => e.id === id);
  // Empresa recém-cadastrada ainda não está na lista guardada no navegador.
  const stale = !!employers.data && !employer;
  const { refetch } = employers;
  useEffect(() => {
    if (stale) void refetch();
  }, [stale, refetch]);
  if (employers.isPending || (stale && employers.isFetching)) return <Spinner />;
  if (employers.isError) return <Alert>{employers.error.message}</Alert>;
  if (!employer) return <Alert>Empresa não encontrada entre os clientes do tipo empresa.</Alert>;
  return (
    <>
      <PageHeader
        title={employer.name}
        description={[employer.document && `CNPJ ${formatDocument(employer.document)}`, `${employer.activeEmployees} colaboradores ativos`].filter(Boolean).join(' · ')}
        actions={
          <Button variant="ghost" onClick={() => navigate('/consultoria-rh/empresas')}>
            Voltar
          </Button>
        }
      />
      <ClientPanel employer={employer} />
    </>
  );
}

/** Aba "RH" na ficha do cliente (só para clientes do tipo empresa). */
export function ClientTab({ customerId }: { customerId: string }) {
  const employers = useEmployers();
  const employer = employers.data?.items.find((e) => e.id === customerId);
  if (employers.isPending) return <Spinner />;
  if (!employer) return <p className="p-4 text-sm text-fg-muted">Só clientes do tipo empresa podem ter colaboradores e folhas.</p>;
  return <ClientPanel employer={employer} />;
}

function ClientPanel({ employer }: { employer: Employer }) {
  const navigate = useNavigate();
  const canManage = useCan('hr.manage');
  const canRun = useCan('hr.payroll');
  const canFees = useCan('hr_consulting.fees.manage');
  const canFeeEntries = useCan('hr.read');
  const canCustomers = useCan('core.customers.read');
  const id = employer.id;
  const [editingFee, setEditingFee] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [feeAction, setFeeAction] = useState<{ entry: FeeEntry; mode: 'correct' | 'cancel' } | null>(null);
  const employees = useQuery({ queryKey: [...hrKey, 'employees', '', id], queryFn: () => api<Employee[]>('/hr/employees', { query: { employer: id } }) });
  const payrolls = useQuery({ queryKey: [...hrKey, 'payrolls', id], queryFn: () => api<PayrollSummary[]>('/hr/payrolls', { query: { employer: id } }) });
  const customer = useQuery({ queryKey: ['customers', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`), enabled: canCustomers });
  const fees = useFees();
  const fee = fees.data?.find((f) => f.customerId === id) ?? null;
  // Rota própria, com hr.read: o Analista de DP acompanha os honorários sem ter acesso ao financeiro.
  const entries = useQuery({ queryKey: [...hrcKey, 'entries', id], queryFn: () => api<FeeEntry[]>(`/hr-consulting/clients/${id}/fee-entries`), enabled: canFeeEntries });
  const allFeeEntries = entries.data ?? [];
  const cancelledCount = allFeeEntries.filter((e) => e.status === 'cancelled').length;
  const feeEntries = allFeeEntries.filter((e) => showCancelled || e.status !== 'cancelled');
  const list = employees.data ?? [];
  const active = list.filter((e) => e.status !== 'terminated');
  const shown = showAll ? list : active;
  const c = customer.data;
  const address = c?.address ? [[c.address.street, c.address.number].filter(Boolean).join(', '), c.address.district, [c.address.city, c.address.state].filter(Boolean).join('/')].filter(Boolean).join(' · ') : '';

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-4">
        <Card className="space-y-2 p-5 text-sm">
          <h2 className="font-medium">Contato</h2>
          {employer.document && <Info label="CNPJ">{formatDocument(employer.document)}</Info>}
          {(c?.email ?? employer.email) && <Info label="E-mail">{c?.email ?? employer.email}</Info>}
          {(c?.phone ?? employer.phone) && <Info label="Telefone">{formatPhone(c?.phone ?? employer.phone)}</Info>}
          {address && <Info label="Endereço">{address}</Info>}
          {c?.notes && <Info label="Observações">{c.notes}</Info>}
          {canCustomers && (
            <Link to={`/clientes/${id}`} className="block text-brand-700 hover:underline">
              Cadastro do cliente
            </Link>
          )}
        </Card>
        <Card className="space-y-2 p-5 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Honorários</h2>
            {canFees && (
              <Button size="sm" variant="secondary" onClick={() => setEditingFee(true)}>
                {fee ? 'Editar' : 'Configurar'}
              </Button>
            )}
          </div>
          {!fee || fee.feeMode === 'none' ? (
            <p className="text-fg-muted">Sem honorário automático: fechar a folha não lança receita.</p>
          ) : (
            <>
              <Info label="Folha mensal">{feeSummary(fee, formatMoney)}</Info>
              <Info label="Vencimento">dia {fee.feeDueDay} do mês seguinte à competência</Info>
              <Info label="13º salário">{fee.thirteenthFee ? 'cobra na 2ª parcela (mesma regra)' : 'não cobra'}</Info>
              {fee.notes && <Info label="Observações">{fee.notes}</Info>}
            </>
          )}
          {fee && fee.terminationFee > 0 && <Info label="Por rescisão">{formatMoney(fee.terminationFee)}</Info>}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="font-medium">Colaboradores</h2>
            <div className="flex flex-wrap gap-2">
              {list.length > active.length && (
                <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Só ativos' : `Ver desligados (${list.length - active.length})`}
                </Button>
              )}
              {canManage && (
                <Button size="sm" variant="secondary" onClick={() => navigate(`/rh/colaboradores?empresa=${id}`)}>
                  Admitir / importar
                </Button>
              )}
            </div>
          </div>
          {employees.isPending ? (
            <Spinner />
          ) : employees.isError ? (
            <div className="p-4">
              <Alert>{employees.error.message}</Alert>
            </div>
          ) : !shown.length ? (
            <p className="px-4 py-6 text-sm text-fg-muted">Nenhum colaborador{showAll ? '' : ' ativo'}.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Cargo</Th>
                  <Th>Admissão</Th>
                  <Th className="text-right">Salário</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/rh/colaboradores/${e.id}`)}>
                    <Td className="font-medium">{e.name}</Td>
                    <Td>{e.position}</Td>
                    <Td className="tabular-nums">{formatDate(e.admissionDate)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(e.salary)}</Td>
                    <Td>{e.status === 'active' ? <Badge tone="success">Ativo</Badge> : <Badge tone={e.status === 'terminated' ? 'neutral' : 'warning'}>{employeeStatusLabel[e.status]}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="font-medium">Folhas</h2>
            {canRun && (
              <Button size="sm" variant="secondary" onClick={() => navigate(`/rh/folha?empresa=${id}`)}>
                Abrir folha / 13º
              </Button>
            )}
          </div>
          {payrolls.isPending ? (
            <Spinner />
          ) : !payrolls.data?.length ? (
            <p className="px-4 py-6 text-sm text-fg-muted">Nenhuma folha ainda.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Folha</Th>
                  <Th className="text-right">Colaboradores</Th>
                  <Th className="text-right">Bruto</Th>
                  <Th className="text-right">Líquido</Th>
                  <Th className="text-right">FGTS</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {payrolls.data.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/rh/folha/${p.id}`)}>
                    <Td className="font-medium capitalize">{payrollTitle(p)}</Td>
                    <Td className="text-right tabular-nums">{p.totals.employees}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.totals.gross)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.totals.net)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.totals.fgts)}</Td>
                    <Td>{p.type === 'termination' ? <Badge tone="neutral">{p.totals.employees} lançadas</Badge> : p.status === 'closed' ? <Badge tone="success">Fechada</Badge> : <Badge tone="warning">Em aberto</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {canFeeEntries && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="font-medium">Honorários lançados</h2>
              {cancelledCount > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowCancelled(!showCancelled)}>
                  {showCancelled ? 'Ocultar cancelados' : `Ver cancelados (${cancelledCount})`}
                </Button>
              )}
            </div>
            {feeAction && <FeeActionPanel key={`${feeAction.entry.id}-${feeAction.mode}`} entry={feeAction.entry} mode={feeAction.mode} onClose={() => setFeeAction(null)} />}
            {entries.isPending ? (
              <Spinner />
            ) : entries.isError ? (
              <div className="p-4">
                <Alert>{entries.error.message}</Alert>
              </div>
            ) : !feeEntries.length ? (
              <p className="px-4 py-6 text-sm text-fg-muted">Nenhum honorário lançado. Eles entram no financeiro ao fechar as folhas desta empresa.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {feeEntries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex-1">
                      <div className={e.status === 'cancelled' ? 'text-fg-subtle line-through' : undefined}>{e.description}</div>
                      <div className="text-xs text-fg-muted">
                        vence {formatDate(e.dueDate)}
                        {e.paidAt && ` · recebido em ${formatDate(e.paidAt)}`}
                      </div>
                    </div>
                    <span className="tabular-nums">{formatMoney(e.amount)}</span>
                    {e.status === 'paid' ? <Badge tone="success">Recebido</Badge> : e.status === 'cancelled' ? <Badge tone="neutral">Cancelado</Badge> : <Badge tone="warning">A receber</Badge>}
                    {canFees && e.status === 'pending' && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setFeeAction({ entry: e, mode: 'correct' })}>
                          Corrigir
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setFeeAction({ entry: e, mode: 'cancel' })}>
                          Cancelar
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canFees && feeEntries.some((e) => e.status === 'paid') && <p className="border-t border-line px-4 py-2 text-xs text-fg-muted">Honorário já recebido: estorne a baixa em Lançamentos antes de corrigir ou cancelar.</p>}
          </Card>
        )}
      </div>
      {editingFee && <FeeModal customerId={id} name={employer.name} fee={fee} onClose={() => setEditingFee(false)} />}
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-fg-muted">{label}</div>
      <div>{children}</div>
    </div>
  );
}

const moneyText = (v: number | undefined) => (v ? v.toFixed(2).replace('.', ',') : '');

/** Corrigir ou cancelar um honorário em aberto, na própria ficha. O motivo fica na auditoria. */
function FeeActionPanel({ entry, mode, onClose }: { entry: FeeEntry; mode: 'correct' | 'cancel'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(moneyText(entry.amount));
  const [dueDate, setDueDate] = useState(entry.dueDate);
  const [reason, setReason] = useState('');
  const correcting = mode === 'correct';
  const run = useMutation({
    mutationFn: () =>
      correcting
        ? api(`/hr-consulting/fee-entries/${entry.id}`, { method: 'PATCH', body: { amount: parseMoney(amount), dueDate, reason } })
        : api(`/hr-consulting/fee-entries/${entry.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrcKey });
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    run.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-3 border-b border-line bg-muted/50 p-4 text-sm">
      <p className="font-medium">
        {correcting ? 'Corrigir honorário' : 'Cancelar honorário'} · {entry.description}
      </p>
      {run.error && <Alert>{run.error instanceof ApiError ? run.error.message : 'Não foi possível concluir'}</Alert>}
      {correcting && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valor (R$)">{(fid) => <Input id={fid} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Vencimento">{(fid) => <Input id={fid} type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        </div>
      )}
      <Field label="Motivo">{(fid) => <Textarea id={fid} rows={2} required value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
      {!correcting && <p className="text-xs text-fg-muted">O lançamento continua no financeiro como cancelado. Fechar a mesma folha de novo só lança outro honorário se ela for reaberta.</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Voltar
        </Button>
        <Button type="submit" variant={correcting ? 'primary' : 'danger'} loading={run.isPending} disabled={reason.trim().length < 3}>
          {correcting ? 'Salvar correção' : 'Cancelar honorário'}
        </Button>
      </div>
    </form>
  );
}

function FeeModal({ customerId, name, fee, onClose }: { customerId: string; name: string; fee: ClientFee | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    feeMode: (fee?.feeMode ?? 'per_employee') as FeeMode,
    feeAmount: moneyText(fee?.feeAmount),
    feeDueDay: String(fee?.feeDueDay ?? 10),
    thirteenthFee: fee?.thirteenthFee ?? false,
    terminationFee: moneyText(fee?.terminationFee),
    notes: fee?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(`/hr-consulting/clients/${customerId}`, {
        method: 'PUT',
        body: {
          feeMode: form.feeMode,
          feeAmount: form.feeMode === 'none' ? 0 : parseMoney(form.feeAmount) || 0,
          feeDueDay: Number(form.feeDueDay) || 10,
          thirteenthFee: form.thirteenthFee,
          terminationFee: parseMoney(form.terminationFee) || 0,
          notes: form.notes || null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrcKey });
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
      title={`Honorários — ${name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="hrc-fee-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="hrc-fee-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cobrança">
            {(fid) => (
              <Select id={fid} value={form.feeMode} onChange={(e) => set({ feeMode: e.target.value as FeeMode })}>
                {feeModes.map((m) => (
                  <option key={m} value={m}>
                    {feeModeLabel[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {form.feeMode !== 'none' && (
            <Field label={form.feeMode === 'per_employee' ? 'Valor por colaborador (R$)' : 'Valor por folha (R$)'}>
              {(fid) => <Input id={fid} inputMode="decimal" required value={form.feeAmount} onChange={(e) => set({ feeAmount: e.target.value })} />}
            </Field>
          )}
          <Field label="Vencimento (dia do mês seguinte)">
            {(fid) => <Input id={fid} type="number" min={1} max={28} value={form.feeDueDay} onChange={(e) => set({ feeDueDay: e.target.value })} />}
          </Field>
          <Field label="Por rescisão (R$)" hint="Vazio = não cobra.">
            {(fid) => <Input id={fid} inputMode="decimal" value={form.terminationFee} onChange={(e) => set({ terminationFee: e.target.value })} />}
          </Field>
        </div>
        {form.feeMode !== 'none' && <Checkbox label="Cobrar também na folha do 13º (2ª parcela)" checked={form.thirteenthFee} onChange={(e) => set({ thirteenthFee: e.target.checked })} />}
        <Field label="Observações">{(fid) => <Textarea id={fid} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        <p className="text-sm text-fg-muted">
          O honorário entra no financeiro como receita a receber desta empresa quando a folha é fechada. Salários e guias são pagos pela empresa e não passam pelo financeiro da consultoria.
        </p>
      </form>
    </Modal>
  );
}
