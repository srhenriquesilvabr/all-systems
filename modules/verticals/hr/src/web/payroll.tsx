import { api, ApiError, formatDate, formatDateTime, formatMoney, parseMoney, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { payrollTypeLabel, type Payroll, type PayrollItem } from '../contracts';
import { hrKey } from './hrKey';

const competenceLabel = (c: string) => new Date(`${c}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const titleOf = (p: Pick<Payroll, 'type' | 'competence'>) =>
  p.type === 'monthly' ? competenceLabel(p.competence) : p.type === 'termination' ? `Rescisões de ${competenceLabel(p.competence)}` : `${payrollTypeLabel[p.type]} de ${p.competence.slice(0, 4)}`;
const num = (v: string) => Number(v.replace(',', '.')) || 0;
const money = (v: string) => parseMoney(v) || 0;

type PayrollSummary = Pick<Payroll, 'id' | 'competence' | 'type' | 'status' | 'closedAt' | 'totals'>;

export function PayrollsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canRun = useCan('hr.payroll');
  const list = useQuery({ queryKey: [...hrKey, 'payrolls'], queryFn: () => api<PayrollSummary[]>('/hr/payrolls') });
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));
  const [holidays, setHolidays] = useState('0');
  const [thirteenth, setThirteenth] = useState(false);
  const create = useMutation({
    mutationFn: () => api<Payroll>('/hr/payrolls', { method: 'POST', body: { competence, holidays: Number(holidays) || 0 } }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: hrKey });
      navigate(`/rh/folha/${p.id}`);
    },
  });
  return (
    <>
      <PageHeader
        title="Folha de pagamento"
        description="Folha mensal, 13º salário e rescisões. INSS, IRRF e FGTS pelas tabelas configuradas; ao fechar, os valores vão para o financeiro."
        actions={
          canRun && (
            <div className="flex flex-wrap gap-2">
              <Input type="month" aria-label="Competência" value={competence} onChange={(e) => setCompetence(e.target.value)} />
              <Input type="number" min={0} max={10} className="w-24" aria-label="Feriados em dias úteis" title="Feriados em dias úteis no mês (DSR)" value={holidays} onChange={(e) => setHolidays(e.target.value)} />
              <Button loading={create.isPending} onClick={() => create.mutate()}>
                Abrir folha
              </Button>
              <Button variant="secondary" onClick={() => setThirteenth(true)}>
                Calcular 13º
              </Button>
            </div>
          )
        }
      />
      {canRun && <p className="-mt-2 mb-4 text-xs text-fg-muted">O número ao lado da competência são os feriados em dias úteis do mês, usados no DSR sobre horas extras e comissões.</p>}
      {create.error && <Alert>{create.error instanceof ApiError ? create.error.message : 'Erro'}</Alert>}
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma folha ainda" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Folha</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Bruto</Th>
                <Th className="text-right">Líquido</Th>
                <Th className="text-right">FGTS</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/rh/folha/${p.id}`)}>
                  <Td className="font-medium capitalize">{titleOf(p)}</Td>
                  <Td>{payrollTypeLabel[p.type]}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.totals.gross)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.totals.net)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.totals.fgts)}</Td>
                  <Td>
                    {p.type === 'termination' ? (
                      <Badge tone="neutral">{p.totals.employees} lançadas</Badge>
                    ) : p.status === 'closed' ? (
                      <Badge tone="success">Fechada</Badge>
                    ) : (
                      <Badge tone="warning">Em aberto</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {thirteenth && <ThirteenthModal onClose={() => setThirteenth(false)} />}
    </>
  );
}

function ThirteenthModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const now = new Date();
  const [form, setForm] = useState({ year: String(now.getFullYear()), installment: now.getMonth() === 11 ? '2' : '1' });
  const create = useMutation({
    mutationFn: () => api<Payroll>('/hr/payrolls/thirteenth', { method: 'POST', body: { year: Number(form.year), installment: Number(form.installment) } }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: hrKey });
      navigate(`/rh/folha/${p.id}`);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <Modal
      open
      title="Calcular 13º salário"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="hr-13-form" loading={create.isPending}>
            Calcular
          </Button>
        </>
      }
    >
      <form id="hr-13-form" onSubmit={submit} className="space-y-4">
        {create.error && <Alert>{create.error instanceof ApiError ? create.error.message : 'Erro'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ano">{(id) => <Input id={id} type="number" min={2000} max={2100} required value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />}</Field>
          <Field label="Parcela">
            {(id) => (
              <Select id={id} value={form.installment} onChange={(e) => setForm({ ...form, installment: e.target.value })}>
                <option value="1">1ª parcela (adiantamento, até 30/11)</option>
                <option value="2">2ª parcela (até 20/12)</option>
              </Select>
            )}
          </Field>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
          <li>Avos: cada mês com 15 dias ou mais de trabalho conta (afastamento pelo INSS não conta).</li>
          <li>1ª parcela: metade de (salário + média das variáveis) ÷ 12 × avos, sem INSS nem IRRF; FGTS sobre o valor.</li>
          <li>2ª parcela: 13º integral com INSS e IRRF calculados em separado, menos a 1ª parcela; FGTS sobre a diferença.</li>
          <li>Médias de horas extras, comissões e DSR das folhas mensais fechadas do ano (até outubro na 1ª, até novembro na 2ª).</li>
          <li>Desligados no ano recebem o 13º no termo de rescisão e não entram aqui.</li>
        </ul>
      </form>
    </Modal>
  );
}

export function PayrollPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canRun = useCan('hr.payroll');
  const p = useQuery({ queryKey: [...hrKey, 'payroll', id], queryFn: () => api<Payroll>(`/hr/payrolls/${id}`) });
  const [editing, setEditing] = useState<PayrollItem | null>(null);
  const [slip, setSlip] = useState<PayrollItem | null>(null);
  const [holidays, setHolidays] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: hrKey });
  const close = useMutation({ mutationFn: () => api(`/hr/payrolls/${id}/close`, { method: 'POST' }), onSuccess: invalidate });
  const recalc = useMutation({
    mutationFn: () => api(`/hr/payrolls/${id}/recalculate`, { method: 'POST', body: holidays === null ? {} : { holidays: Number(holidays) || 0 } }),
    onSuccess: () => {
      setHolidays(null);
      invalidate();
    },
  });
  if (p.isPending) return <Spinner />;
  if (p.isError) return <Alert>{p.error.message}</Alert>;
  const payroll = p.data;
  const open = payroll.status === 'draft';
  const thirteenth = payroll.type === 'thirteenth_1' || payroll.type === 'thirteenth_2';
  const error = close.error ?? recalc.error;
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${payroll.type === 'monthly' ? 'Folha de ' : ''}${titleOf(payroll)}`}
          description={`${payrollTypeLabel[payroll.type]} · ${payroll.totals.employees} colaboradores · tabelas: ${payroll.tablesLabel}${payroll.closedAt && payroll.type !== 'termination' ? ` · fechada em ${formatDateTime(payroll.closedAt)}` : ''}`}
          actions={
            canRun &&
            open && (
              <Button loading={close.isPending} onClick={() => close.mutate()}>
                Fechar folha
              </Button>
            )
          }
        />
        {error && <Alert>{error instanceof ApiError ? error.message : 'Erro'}</Alert>}
        {payroll.type === 'monthly' && (
          <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
            <span className="text-fg-muted">
              Calendário do DSR: {payroll.calendar.workingDays} dias úteis e {payroll.calendar.restDays} de repouso ({payroll.calendar.sundays} domingos + {payroll.holidays} feriados).
            </span>
            {canRun && open && (
              <>
                <Input type="number" min={0} max={10} className="w-20" aria-label="Feriados em dias úteis" value={holidays ?? String(payroll.holidays)} onChange={(e) => setHolidays(e.target.value)} />
                <Button size="sm" variant="secondary" loading={recalc.isPending} onClick={() => recalc.mutate()}>
                  Recalcular
                </Button>
                <span className="text-xs text-fg-muted">Recalcular também aplica afastamentos e férias registrados depois de abrir a folha.</span>
              </>
            )}
          </div>
        )}
        {payroll.type === 'termination' && <Alert tone="info">Cada rescisão é lançada no financeiro ao ser confirmada. Abra o colaborador para ver e imprimir o termo.</Alert>}
        <div className="mb-4 grid gap-4 sm:grid-cols-5">
          {(
            [
              ['Bruto', payroll.totals.gross],
              ['INSS', payroll.totals.inss],
              ['IRRF', payroll.totals.irrf],
              ['Líquido', payroll.totals.net],
              [payroll.type === 'termination' ? 'FGTS + multa' : 'FGTS (empresa)', payroll.totals.fgts],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} className="p-4">
              <div className="text-xs text-fg-muted">{label}</div>
              <div className="font-display text-xl font-semibold tabular-nums">{formatMoney(value)}</div>
            </Card>
          ))}
        </div>
        {payroll.totals.maternity > 0 && (
          <Alert tone="info">Salário-maternidade pago no mês: {formatMoney(payroll.totals.maternity)} — a empresa deduz esse valor das contribuições devidas na DCTFWeb (informativo).</Alert>
        )}
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Colaborador</Th>
                {thirteenth ? (
                  <>
                    <Th className="text-right">Avos</Th>
                    <Th className="text-right">Média var.</Th>
                  </>
                ) : (
                  <Th className="text-right">Dias</Th>
                )}
                <Th className="text-right">Bruto</Th>
                <Th className="text-right">INSS</Th>
                <Th className="text-right">IRRF</Th>
                <Th className="text-right">{thirteenth ? 'Adiantamento' : 'Outros desc.'}</Th>
                <Th className="text-right">Líquido</Th>
                <Th className="text-right">FGTS</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {payroll.items.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <div className="font-medium">{i.employee.name}</div>
                    <div className="text-xs text-fg-muted">
                      {i.employee.position}
                      {i.employee.category === 'apprentice' && ' · aprendiz'}
                      {payroll.type === 'termination' && i.notes && ` · ${i.notes}`}
                    </div>
                  </Td>
                  {thirteenth ? (
                    <>
                      <Td className="text-right tabular-nums">{i.avos ?? '—'}/12</Td>
                      <Td className="text-right tabular-nums">{formatMoney(i.variableAverage ?? 0)}</Td>
                    </>
                  ) : (
                    <Td className="text-right tabular-nums">{i.salaryDays ?? i.daysWorked}</Td>
                  )}
                  <Td className="text-right tabular-nums">{formatMoney(i.gross)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.inss)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.irrf)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(thirteenth ? (i.advance ?? 0) : i.otherDeductions)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatMoney(i.net)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.fgts)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {payroll.type === 'termination' ? (
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/rh/colaboradores/${i.employee.id}`)}>
                        Ver termo
                      </Button>
                    ) : (
                      <>
                        {canRun && open && (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                            {thirteenth ? 'Ajustar' : 'Lançamentos'}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setSlip(i)}>
                          Holerite
                        </Button>
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      {editing && (thirteenth ? <ThirteenthItemModal payrollId={payroll.id} item={editing} onClose={() => setEditing(null)} /> : <ItemModal payroll={payroll} item={editing} onClose={() => setEditing(null)} />)}
      {slip && <PayslipModal payroll={payroll} item={slip} onClose={() => setSlip(null)} />}
      {slip && <PayslipPrint payroll={payroll} item={slip} />}
    </>
  );
}

function ItemModal({ payroll, item, onClose }: { payroll: Payroll; item: PayrollItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    daysWorked: String(item.daysWorked),
    overtime50Hours: String(item.overtime50Hours).replace('.', ','),
    overtime100Hours: String(item.overtime100Hours).replace('.', ','),
    commissions: (item.commissions ?? 0).toFixed(2).replace('.', ','),
    otherEarnings: item.otherEarnings.toFixed(2).replace('.', ','),
    otherDeductions: item.otherDeductions.toFixed(2).replace('.', ','),
    absences: String(item.absences ?? 0),
    dsrLostDays: String(item.dsrLostDays ?? 0),
    notes: item.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(`/hr/payrolls/${payroll.id}/items/${item.id}`, {
        method: 'PATCH',
        body: {
          daysWorked: Number(form.daysWorked),
          overtime50Hours: num(form.overtime50Hours),
          overtime100Hours: num(form.overtime100Hours),
          commissions: money(form.commissions),
          otherEarnings: money(form.otherEarnings),
          otherDeductions: money(form.otherDeductions),
          absences: Number(form.absences) || 0,
          dsrLostDays: Number(form.dsrLostDays) || 0,
          notes: form.notes || null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKey });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  const auto = [
    (item.inssLeaveDays ?? 0) > 0 && `${item.inssLeaveDays} dias de afastamento pagos pelo INSS`,
    (item.maternityDays ?? 0) > 0 && `${item.maternityDays} dias de licença-maternidade`,
    (item.vacationDays ?? 0) > 0 && `${item.vacationDays} dias de férias`,
  ].filter(Boolean);
  return (
    <Modal
      open
      title={`Lançamentos — ${item.employee.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="hr-item-form" loading={save.isPending}>
            Recalcular
          </Button>
        </>
      }
    >
      <form id="hr-item-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro'}</Alert>}
        {auto.length > 0 && <Alert tone="info">Descontados dos dias de salário automaticamente: {auto.join(', ')}.</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Dias de contrato no mês" hint="Admissão ou saída no mês.">
            {(id) => <Input id={id} type="number" min={0} max={30} value={form.daysWorked} onChange={(e) => set({ daysWorked: e.target.value })} />}
          </Field>
          <Field label="Horas extras 50%">{(id) => <Input id={id} inputMode="decimal" value={form.overtime50Hours} onChange={(e) => set({ overtime50Hours: e.target.value })} />}</Field>
          <Field label="Horas extras 100%">{(id) => <Input id={id} inputMode="decimal" value={form.overtime100Hours} onChange={(e) => set({ overtime100Hours: e.target.value })} />}</Field>
          <Field label="Comissões (R$)" hint="Geram DSR e entram nas médias.">
            {(id) => <Input id={id} inputMode="decimal" value={form.commissions} onChange={(e) => set({ commissions: e.target.value })} />}
          </Field>
          <Field label="Faltas injustificadas (dias)">{(id) => <Input id={id} type="number" min={0} max={30} value={form.absences} onChange={(e) => set({ absences: e.target.value })} />}</Field>
          <Field label="DSR perdidos" hint={`Um por semana com falta (até ${payroll.calendar.restDays}).`}>
            {(id) => <Input id={id} type="number" min={0} max={payroll.calendar.restDays} value={form.dsrLostDays} onChange={(e) => set({ dsrLostDays: e.target.value })} />}
          </Field>
          <Field label="Outros proventos (R$)" hint="Adicionais que não geram DSR aqui.">
            {(id) => <Input id={id} inputMode="decimal" value={form.otherEarnings} onChange={(e) => set({ otherEarnings: e.target.value })} />}
          </Field>
          <Field label="Outros descontos (R$)" hint="Vale-transporte, adiantamento.">
            {(id) => <Input id={id} inputMode="decimal" value={form.otherDeductions} onChange={(e) => set({ otherDeductions: e.target.value })} />}
          </Field>
        </div>
        <Field label="Observações">{(id) => <Input id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

function ThirteenthItemModal({ payrollId, item, onClose }: { payrollId: string; item: PayrollItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ avos: String(item.avos ?? 12), variableAverage: (item.variableAverage ?? 0).toFixed(2).replace('.', ','), notes: item.notes ?? '' });
  const save = useMutation({
    mutationFn: () => api(`/hr/payrolls/${payrollId}/thirteenth-items/${item.id}`, { method: 'PATCH', body: { avos: Number(form.avos), variableAverage: money(form.variableAverage), notes: form.notes || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKey });
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
      title={`13º — ${item.employee.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="hr-13-item-form" loading={save.isPending}>
            Recalcular
          </Button>
        </>
      }
    >
      <form id="hr-13-item-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Avos (meses com 15+ dias)">{(id) => <Input id={id} type="number" min={0} max={12} value={form.avos} onChange={(e) => setForm({ ...form, avos: e.target.value })} />}</Field>
          <Field label="Média das variáveis (R$/mês)" hint="Horas extras, comissões e DSR do ano.">
            {(id) => <Input id={id} inputMode="decimal" value={form.variableAverage} onChange={(e) => setForm({ ...form, variableAverage: e.target.value })} />}
          </Field>
        </div>
        <Field label="Observações">{(id) => <Input id={id} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

type Row = [string, number, 'p' | 'd'];

function payslipRows(item: PayrollItem): Row[] {
  if (item.installment) {
    const rows: Row[] = [[`13º salário${item.installment === 1 ? ' — adiantamento (1ª parcela)' : ''} (${item.avos}/12)`, item.gross, 'p']];
    if (item.installment === 2) {
      rows.push(['INSS sobre 13º', item.inss, 'd'], ['IRRF sobre 13º', item.irrf, 'd']);
      if ((item.advance ?? 0) > 0) rows.push(['Adiantamento de 13º (1ª parcela)', item.advance!, 'd']);
    }
    return rows;
  }
  const opt = (cond: boolean, row: Row): Row[] => (cond ? [row] : []);
  return [
    [`Salário (${item.salaryDays ?? item.daysWorked} dias)`, item.baseSalary, 'p'],
    ...opt((item.maternity ?? 0) > 0, [`Salário-maternidade (${item.maternityDays} dias)`, item.maternity ?? 0, 'p']),
    ...opt((item.vacation ?? 0) > 0, [`Férias gozadas no mês + 1/3 (${item.vacationDays} dias)`, item.vacation ?? 0, 'p']),
    ...opt(item.overtime > 0, ['Horas extras', item.overtime, 'p']),
    ...opt((item.commissions ?? 0) > 0, ['Comissões', item.commissions ?? 0, 'p']),
    ...opt((item.dsr ?? 0) > 0, ['DSR sobre horas extras e comissões', item.dsr ?? 0, 'p']),
    ...opt(item.otherEarnings > 0, ['Outros proventos', item.otherEarnings, 'p']),
    ...opt((item.absenceDeduction ?? 0) > 0, [`Faltas (${item.absences ?? 0} dias) e DSR perdido (${item.dsrLostDays ?? 0})`, item.absenceDeduction ?? 0, 'd']),
    ...opt((item.vacation ?? 0) > 0, ['Férias já pagas no recibo de férias', item.vacation ?? 0, 'd']),
    ['INSS', item.inss, 'd'],
    ['IRRF', item.irrf, 'd'],
    ...opt(item.otherDeductions > 0, ['Outros descontos', item.otherDeductions, 'd']),
  ];
}

function PayslipLines({ item }: { item: PayrollItem }) {
  const rows = payslipRows(item);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs text-fg-muted">
          <th className="py-1 font-normal">Descrição</th>
          <th className="py-1 text-right font-normal">Proventos</th>
          <th className="py-1 text-right font-normal">Descontos</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value, kind]) => (
          <tr key={label}>
            <td className="py-1">{label}</td>
            <td className="py-1 text-right tabular-nums">{kind === 'p' ? formatMoney(value) : ''}</td>
            <td className="py-1 text-right tabular-nums">{kind === 'd' ? formatMoney(value) : ''}</td>
          </tr>
        ))}
        <tr className="border-t border-line font-medium">
          <td className="py-1">Líquido a receber</td>
          <td colSpan={2} className="py-1 text-right tabular-nums">
            {formatMoney(item.net)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function VacationReceipts({ item }: { item: PayrollItem }) {
  if (!item.vacationReceipts?.length) return null;
  return (
    <p className="mt-2 text-xs">
      Férias pagas neste mês (recibo de férias, lançado à parte):{' '}
      {item.vacationReceipts.map((r) => `${formatMoney(r.amount)} em ${formatDate(r.payBy)} (${r.days} dias a partir de ${formatDate(r.startOn)}${r.soldDays ? ` + ${r.soldDays} vendidos` : ''})`).join('; ')}.
    </p>
  );
}

function PayslipModal({ payroll, item, onClose }: { payroll: Payroll; item: PayrollItem; onClose: () => void }) {
  return (
    <Modal
      open
      title={`Holerite — ${item.employee.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => window.print()}>Imprimir</Button>
        </>
      }
    >
      <p className="mb-3 text-sm capitalize text-fg-muted">{titleOf(payroll)}</p>
      <PayslipLines item={item} />
      <p className="mt-3 text-xs text-fg-muted">
        Base INSS {formatMoney(item.gross)} · Base IRRF {formatMoney(item.irrfBase)}
        {item.irrfReduction > 0 && ` · redução legal ${formatMoney(item.irrfReduction)}`} · FGTS {formatMoney(item.fgts)}
        {item.fgtsRate !== undefined && ` (${Math.round(item.fgtsRate * 100)}%)`}
      </p>
      <VacationReceipts item={item} />
    </Modal>
  );
}

/** Versão para impressão (o modal não imprime). */
function PayslipPrint({ payroll, item }: { payroll: Payroll; item: PayrollItem }) {
  const { tenant } = useSession();
  return (
    <div className="hidden text-black print:block">
      <h1 className="text-lg font-bold">{tenant.name}</h1>
      <p className="mb-4 text-sm">
        {item.installment ? 'Recibo de 13º salário' : 'Recibo de pagamento de salário'} · <span className="capitalize">{titleOf(payroll)}</span>
      </p>
      <p className="mb-2 text-sm">
        {item.employee.name} · CPF {item.employee.cpf} · {item.employee.position}
      </p>
      <PayslipLines item={item} />
      <p className="mt-2 text-xs">
        Base INSS {formatMoney(item.gross)} · Base IRRF {formatMoney(item.irrfBase)} · FGTS {formatMoney(item.fgts)}
      </p>
      <VacationReceipts item={item} />
      <p className="mt-12 border-t border-black pt-1 text-center text-xs">Assinatura do colaborador</p>
    </div>
  );
}
