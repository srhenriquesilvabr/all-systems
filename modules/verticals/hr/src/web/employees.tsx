import { api, ApiError, formatDate, formatMoney, parseMoney, SpreadsheetImport, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { employeeCategoryLabel, employeeStatusLabel, leaveTypeLabel, leaveTypes, terminationTypeLabel, vacationPay, type Employee, type Leave, type LeaveType, type Vacation } from '../contracts';
import { employeeImportSpec } from './employeeImport';
import { hrKey } from './hrKey';
import { TerminationModal, TerminationWizard } from './termination';

export { hrKey };
const cpfMask = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

export function EmployeesPage() {
  const canManage = useCan('hr.manage');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: [...hrKey, 'employees', status], queryFn: () => api<Employee[]>('/hr/employees', { query: { status: status || undefined } }) });
  return (
    <>
      <PageHeader
        title="Colaboradores"
        description="Dados de admissão, salário e saldo de férias."
        actions={
          canManage && (
            <>
              <SpreadsheetImport spec={employeeImportSpec} onImported={() => queryClient.invalidateQueries({ queryKey: hrKey })} />
              <Button onClick={() => setCreating(true)}>Admitir colaborador</Button>
            </>
          )
        }
      />
      <div className="mb-4">
        <Select aria-label="Situação" className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Ativos</option>
          <option value="on_leave">Afastados</option>
          <option value="terminated">Desligados</option>
          <option value="">Todos</option>
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
          <EmptyState title="Nenhum colaborador" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Cargo</Th>
                <Th>Admissão</Th>
                <Th className="text-right">Salário</Th>
                <Th>Férias</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/rh/colaboradores/${e.id}`)}>
                  <Td className="font-medium">{e.name}</Td>
                  <Td>
                    {e.position}
                    {e.department && <span className="text-fg-muted"> · {e.department}</span>}
                  </Td>
                  <Td className="tabular-nums">{formatDate(e.admissionDate)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(e.salary)}</Td>
                  <Td>{e.overdueVacation ? <Badge tone="danger">Vencidas</Badge> : e.vacationBalance > 0 ? <Badge tone="warning">{e.vacationBalance} dias</Badge> : <span className="text-fg-subtle">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {creating && <EmployeeModal employee={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/rh/colaboradores/${id}`)} />}
    </>
  );
}

export function EmployeePage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const canManage = useCan('hr.manage');
  const canPayroll = useCan('hr.payroll');
  const emp = useQuery({ queryKey: [...hrKey, 'employee', id], queryFn: () => api<Employee>(`/hr/employees/${id}`) });
  const vacations = useQuery({ queryKey: [...hrKey, 'vacations', id], queryFn: () => api<Vacation[]>(`/hr/employees/${id}/vacations`) });
  const [editing, setEditing] = useState(false);
  const leaves = useQuery({ queryKey: [...hrKey, 'leaves', id], queryFn: () => api<Leave[]>(`/hr/employees/${id}/leaves`) });
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [addingLeave, setAddingLeave] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [showTermination, setShowTermination] = useState(false);
  const removeLeave = useMutation({ mutationFn: (lid: string) => api(`/hr/leaves/${lid}`, { method: 'DELETE' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: hrKey }) });
  const cancel = useMutation({ mutationFn: (vid: string) => api(`/hr/vacations/${vid}/cancel`, { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: hrKey }) });
  if (emp.isPending) return <Spinner />;
  if (emp.isError) return <Alert>{emp.error.message}</Alert>;
  const e = emp.data;
  return (
    <>
      <div className="print:hidden">
      <PageHeader
        title={e.name}
        description={`${e.position}${e.department ? ` · ${e.department}` : ''} · ${employeeStatusLabel[e.status]}${e.category === 'apprentice' ? ' · aprendiz' : ''}`}
        actions={
          <div className="flex gap-2">
            {e.termination && (
              <Button variant="secondary" onClick={() => setShowTermination(true)}>
                Termo de rescisão
              </Button>
            )}
            {canPayroll && !e.termination && e.status !== 'terminated' && (
              <Button variant="danger" onClick={() => setTerminating(true)}>
                Rescindir
              </Button>
            )}
            {canManage && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit space-y-2 p-5 text-sm">
          <Info label="CPF">{cpfMask(e.cpf)}</Info>
          <Info label="Admissão">{formatDate(e.admissionDate)}</Info>
          {e.experienceEnd && <Info label="Fim da experiência">{formatDate(e.experienceEnd)}</Info>}
          {e.terminationDate && (
            <Info label="Desligamento">
              {formatDate(e.terminationDate)}
              {e.termination && <span className="text-fg-muted"> · {terminationTypeLabel[e.termination.type]}</span>}
            </Info>
          )}
          <Info label="Categoria">{employeeCategoryLabel[e.category]}</Info>
          <Info label="Salário">{formatMoney(e.salary)}</Info>
          <Info label="Jornada">{e.weeklyHours}h semanais</Info>
          <Info label="Dependentes (IR)">{e.dependents}</Info>
          {e.email && <Info label="E-mail">{e.email}</Info>}
          {e.phone && <Info label="Telefone">{e.phone}</Info>}
          {e.pixKey && <Info label="Chave Pix">{e.pixKey}</Info>}
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="border-b border-line px-4 py-3 font-medium">Períodos aquisitivos</h2>
            {cancel.error && <Alert>{cancel.error instanceof ApiError ? cancel.error.message : 'Erro'}</Alert>}
            <Table>
              <thead>
                <tr>
                  <Th>Período</Th>
                  <Th>Conceder até</Th>
                  <Th className="text-right">Saldo</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {[...e.periods].reverse().map((p) => (
                  <tr key={p.start}>
                    <Td className="tabular-nums">
                      {formatDate(p.start)} a {formatDate(p.end)}
                    </Td>
                    <Td className="tabular-nums">{p.earned ? formatDate(p.grantDeadline) : 'em aquisição'}</Td>
                    <Td className="text-right">{p.overdue ? <Badge tone="danger">{p.balance} dias vencidos</Badge> : p.earned ? `${p.balance} dias` : '—'}</Td>
                    <Td className="text-right">
                      {canManage && p.earned && p.balance >= 5 && (
                        <Button size="sm" variant="secondary" onClick={() => setScheduling(p.start)}>
                          Marcar férias
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <h2 className="border-b border-line px-4 py-3 font-medium">Férias marcadas</h2>
            {!vacations.data?.length ? (
              <p className="px-4 py-6 text-sm text-fg-muted">Nenhuma.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {vacations.data.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex-1">
                      <div className={v.status === 'cancelled' ? 'text-fg-subtle line-through' : 'font-medium'}>
                        {formatDate(v.startOn)} a {formatDate(v.endOn)} ({v.days} dias{v.soldDays ? ` + ${v.soldDays} vendidos` : ''}) {v.status === 'taken' && <Badge tone="success">Gozadas</Badge>}
                      </div>
                      <div className="text-xs text-fg-muted">
                        {formatMoney(v.pay.vacation + v.pay.allowance)} · pagar até {formatDate(v.payBy)}
                      </div>
                    </div>
                    {canManage && v.status === 'scheduled' && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(v.id)}>
                        Cancelar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-medium">Afastamentos</h2>
              {canManage && e.status !== 'terminated' && (
                <Button size="sm" variant="secondary" onClick={() => setAddingLeave(true)}>
                  Registrar afastamento
                </Button>
              )}
            </div>
            {removeLeave.error && <Alert>{removeLeave.error instanceof ApiError ? removeLeave.error.message : 'Erro'}</Alert>}
            {!leaves.data?.length ? (
              <p className="px-4 py-6 text-sm text-fg-muted">Nenhum.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {leaves.data.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex-1">
                      <div className="font-medium">
                        {leaveTypeLabel[l.type]} · {formatDate(l.startOn)} a {formatDate(l.endOn)} ({l.days} dias)
                      </div>
                      <div className="text-xs text-fg-muted">
                        {l.type === 'maternity'
                          ? 'Salário-maternidade pago pela empresa e compensado nas contribuições (DCTFWeb).'
                          : l.inssDays > 0
                            ? `${l.companyDays} dias pagos pela empresa · ${l.inssDays} dias pelo INSS (fora da folha)`
                            : 'Pago pela empresa (até 15 dias).'}
                        {l.notes && ` · ${l.notes}`}
                      </div>
                    </div>
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => removeLeave.mutate(l.id)}>
                        Excluir
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      </div>
      {editing && <EmployeeModal employee={e} onClose={() => setEditing(false)} />}
      {scheduling && <VacationModal employee={e} periodStart={scheduling} onClose={() => setScheduling(null)} />}
      {addingLeave && <LeaveModal employee={e} onClose={() => setAddingLeave(false)} />}
      {terminating && <TerminationWizard employee={e} onClose={() => setTerminating(false)} />}
      {showTermination && <TerminationModal employeeId={e.id} onClose={() => setShowTermination(false)} />}
    </>
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

function EmployeeModal({ employee, onClose, onSaved }: { employee: Employee | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: employee?.name ?? '',
    cpf: employee?.cpf ?? '',
    birthDate: employee?.birthDate ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    position: employee?.position ?? '',
    department: employee?.department ?? '',
    admissionDate: employee?.admissionDate ?? '',
    salary: employee ? employee.salary.toFixed(2).replace('.', ',') : '',
    weeklyHours: String(employee?.weeklyHours ?? 44),
    dependents: String(employee?.dependents ?? 0),
    category: employee?.category ?? 'employee',
    experienceEnd: employee?.experienceEnd ?? '',
    status: employee?.status ?? 'active',
    terminationDate: employee?.terminationDate ?? '',
    pixKey: employee?.pixKey ?? '',
    notes: employee?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>(employee ? `/hr/employees/${employee.id}` : '/hr/employees', {
        method: employee ? 'PATCH' : 'POST',
        body: {
          ...form,
          birthDate: form.birthDate || null,
          email: form.email || null,
          phone: form.phone || null,
          department: form.department || null,
          salary: parseMoney(form.salary),
          weeklyHours: Number(form.weeklyHours),
          dependents: Number(form.dependents),
          terminationDate: form.terminationDate || null,
          experienceEnd: form.experienceEnd || null,
          pixKey: form.pixKey || null,
          notes: form.notes || null,
        },
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: hrKey });
      onSaved?.(r.id);
      onClose();
    },
  });
  function submit(ev: FormEvent) {
    ev.preventDefault();
    save.mutate();
  }
  return (
    <Modal
      open
      title={employee ? 'Editar colaborador' : 'Admitir colaborador'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="hr-employee-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="hr-employee-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Nome completo">{(id) => <Input id={id} required value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />}</Field>
          </div>
          <Field label="CPF">{(id) => <Input id={id} required inputMode="numeric" value={form.cpf} onChange={(e) => set({ cpf: e.target.value })} />}</Field>
          <Field label="Nascimento">{(id) => <Input id={id} type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />}</Field>
          <Field label="Cargo">{(id) => <Input id={id} required value={form.position} onChange={(e) => set({ position: e.target.value })} />}</Field>
          <Field label="Setor">{(id) => <Input id={id} value={form.department} onChange={(e) => set({ department: e.target.value })} />}</Field>
          <Field label="Admissão">{(id) => <Input id={id} type="date" required value={form.admissionDate} onChange={(e) => set({ admissionDate: e.target.value })} />}</Field>
          <Field label="Salário (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.salary} onChange={(e) => set({ salary: e.target.value })} />}</Field>
          <Field label="Jornada semanal (h)">{(id) => <Input id={id} type="number" min={1} max={44} value={form.weeklyHours} onChange={(e) => set({ weeklyHours: e.target.value })} />}</Field>
          <Field label="Dependentes para IR">{(id) => <Input id={id} type="number" min={0} value={form.dependents} onChange={(e) => set({ dependents: e.target.value })} />}</Field>
          <Field label="Categoria" hint="Aprendiz recolhe FGTS de 2%.">
            {(id) => (
              <Select id={id} value={form.category} onChange={(e) => set({ category: e.target.value as typeof form.category })}>
                {Object.entries(employeeCategoryLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Fim da experiência" hint="Vazio se não houver contrato de experiência.">
            {(id) => <Input id={id} type="date" value={form.experienceEnd} onChange={(e) => set({ experienceEnd: e.target.value })} />}
          </Field>
          <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
          <Field label="Telefone">{(id) => <Input id={id} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
          <Field label="Chave Pix (salário)">{(id) => <Input id={id} value={form.pixKey} onChange={(e) => set({ pixKey: e.target.value })} />}</Field>
          {employee && (
            <Field label="Situação">
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}>
                  {Object.entries(employeeStatusLabel).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {form.status === 'terminated' && <Field label="Data do desligamento">{(id) => <Input id={id} type="date" required value={form.terminationDate} onChange={(e) => set({ terminationDate: e.target.value })} />}</Field>}
        </div>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

function VacationModal({ employee, periodStart, onClose }: { employee: Employee; periodStart: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const balance = employee.periods.find((p) => p.start === periodStart)?.balance ?? 0;
  const [form, setForm] = useState({ startOn: '', days: String(Math.min(30, balance)), soldDays: '0' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const pay = vacationPay(employee.salary, Number(form.days) || 0, Number(form.soldDays) || 0);
  const save = useMutation({
    mutationFn: () => api('/hr/vacations', { method: 'POST', body: { employeeId: employee.id, periodStart, startOn: form.startOn, days: Number(form.days), soldDays: Number(form.soldDays) } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKey });
      onClose();
    },
  });
  function submit(ev: FormEvent) {
    ev.preventDefault();
    save.mutate();
  }
  return (
    <Modal
      open
      title="Marcar férias"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="hr-vacation-form" loading={save.isPending}>
            Marcar
          </Button>
        </>
      }
    >
      <form id="hr-vacation-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro'}</Alert>}
        <p className="text-sm text-fg-muted">
          Período aquisitivo a partir de {formatDate(periodStart)} · saldo de {balance} dias. Mínimo de 5 dias por período; até 10 dias podem ser vendidos.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Início">{(id) => <Input id={id} type="date" required value={form.startOn} onChange={(e) => set({ startOn: e.target.value })} />}</Field>
          <Field label="Dias">{(id) => <Input id={id} type="number" min={5} max={30} required value={form.days} onChange={(e) => set({ days: e.target.value })} />}</Field>
          <Field label="Dias vendidos">{(id) => <Input id={id} type="number" min={0} max={10} value={form.soldDays} onChange={(e) => set({ soldDays: e.target.value })} />}</Field>
        </div>
        <p className="text-sm">
          A pagar: <span className="font-medium tabular-nums">{formatMoney(pay.vacation + pay.allowance)}</span> (férias + 1/3{pay.allowance ? ' + abono' : ''}), até 2 dias antes do início.
        </p>
      </form>
    </Modal>
  );
}


function LeaveModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ type: 'sick' as LeaveType, startOn: '', endOn: '', notes: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => api('/hr/leaves', { method: 'POST', body: { employeeId: employee.id, type: form.type, startOn: form.startOn, endOn: form.endOn || null, notes: form.notes || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKey });
      onClose();
    },
  });
  function submit(ev: FormEvent) {
    ev.preventDefault();
    save.mutate();
  }
  return (
    <Modal
      open
      title="Registrar afastamento"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="hr-leave-form" loading={save.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="hr-leave-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={form.type} onChange={(e) => set({ type: e.target.value as LeaveType })}>
                {leaveTypes.map((t) => (
                  <option key={t} value={t}>
                    {leaveTypeLabel[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Início">{(id) => <Input id={id} type="date" required value={form.startOn} onChange={(e) => set({ startOn: e.target.value })} />}</Field>
          <Field label="Fim" hint={form.type === 'maternity' ? 'Vazio = 120 dias.' : undefined}>
            {(id) => <Input id={id} type="date" required={form.type === 'sick'} value={form.endOn} onChange={(e) => set({ endOn: e.target.value })} />}
          </Field>
        </div>
        <Field label="Observações">{(id) => <Input id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        <p className="text-sm text-fg-muted">
          {form.type === 'sick'
            ? 'Doença: a empresa paga os primeiros 15 dias; do 16º em diante paga o INSS e os dias saem da folha.'
            : 'Maternidade: a empresa paga o salário-maternidade na folha e deduz o valor das contribuições (informativo na folha).'}{' '}
          A folha do mês considera o afastamento ao ser aberta ou recalculada.
        </p>
      </form>
    </Modal>
  );
}
