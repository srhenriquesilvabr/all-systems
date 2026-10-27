import { api, ApiError, formatDateTime, formatMoney, parseMoney, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Payroll, PayrollItem } from '../contracts';
import { hrKey } from './employees';

const competenceLabel = (c: string) => new Date(`${c}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

export function PayrollsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canRun = useCan('hr.payroll');
  const list = useQuery({ queryKey: [...hrKey, 'payrolls'], queryFn: () => api<(Pick<Payroll, 'id' | 'competence' | 'status' | 'closedAt' | 'totals'>)[]>('/hr/payrolls') });
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));
  const create = useMutation({
    mutationFn: () => api<Payroll>('/hr/payrolls', { method: 'POST', body: { competence } }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: hrKey });
      navigate(`/rh/folha/${p.id}`);
    },
  });
  return (
    <>
      <PageHeader
        title="Folha de pagamento"
        description="INSS, IRRF e FGTS calculados pelas tabelas configuradas. Ao fechar, os valores vão para o financeiro."
        actions={
          canRun && (
            <div className="flex gap-2">
              <Input type="month" aria-label="Competência" value={competence} onChange={(e) => setCompetence(e.target.value)} />
              <Button loading={create.isPending} onClick={() => create.mutate()}>
                Abrir folha
              </Button>
            </div>
          )
        }
      />
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
                <Th>Competência</Th>
                <Th className="text-right">Bruto</Th>
                <Th className="text-right">Líquido</Th>
                <Th className="text-right">FGTS</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/rh/folha/${p.id}`)}>
                  <Td className="font-medium capitalize">{competenceLabel(p.competence)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.totals.gross)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.totals.net)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.totals.fgts)}</Td>
                  <Td>{p.status === 'closed' ? <Badge tone="success">Fechada</Badge> : <Badge tone="warning">Em aberto</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export function PayrollPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const canRun = useCan('hr.payroll');
  const p = useQuery({ queryKey: [...hrKey, 'payroll', id], queryFn: () => api<Payroll>(`/hr/payrolls/${id}`) });
  const [editing, setEditing] = useState<PayrollItem | null>(null);
  const [slip, setSlip] = useState<PayrollItem | null>(null);
  const close = useMutation({ mutationFn: () => api(`/hr/payrolls/${id}/close`, { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: hrKey }) });
  if (p.isPending) return <Spinner />;
  if (p.isError) return <Alert>{p.error.message}</Alert>;
  const payroll = p.data;
  const open = payroll.status === 'draft';
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Folha de ${competenceLabel(payroll.competence)}`}
          description={`${payroll.totals.employees} colaboradores · tabelas: ${payroll.tablesLabel}${payroll.closedAt ? ` · fechada em ${formatDateTime(payroll.closedAt)}` : ''}`}
          actions={
            canRun &&
            open && (
              <Button loading={close.isPending} onClick={() => close.mutate()}>
                Fechar folha
              </Button>
            )
          }
        />
        {close.error && <Alert>{close.error instanceof ApiError ? close.error.message : 'Erro ao fechar'}</Alert>}
        <div className="mb-4 grid gap-4 sm:grid-cols-5">
          {(
            [
              ['Bruto', payroll.totals.gross],
              ['INSS', payroll.totals.inss],
              ['IRRF', payroll.totals.irrf],
              ['Líquido', payroll.totals.net],
              ['FGTS (empresa)', payroll.totals.fgts],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} className="p-4">
              <div className="text-xs text-fg-muted">{label}</div>
              <div className="font-display text-xl font-semibold tabular-nums">{formatMoney(value)}</div>
            </Card>
          ))}
        </div>
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Colaborador</Th>
                <Th className="text-right">Dias</Th>
                <Th className="text-right">Bruto</Th>
                <Th className="text-right">INSS</Th>
                <Th className="text-right">IRRF</Th>
                <Th className="text-right">Outros desc.</Th>
                <Th className="text-right">Líquido</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {payroll.items.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <div className="font-medium">{i.employee.name}</div>
                    <div className="text-xs text-fg-muted">{i.employee.position}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{i.daysWorked}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.gross)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.inss)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.irrf)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.otherDeductions)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatMoney(i.net)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {canRun && open && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                        Lançamentos
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setSlip(i)}>
                      Holerite
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      {editing && <ItemModal payrollId={payroll.id} item={editing} onClose={() => setEditing(null)} />}
      {slip && <PayslipModal payroll={payroll} item={slip} onClose={() => setSlip(null)} />}
      {slip && <PayslipPrint payroll={payroll} item={slip} />}
    </>
  );
}

function ItemModal({ payrollId, item, onClose }: { payrollId: string; item: PayrollItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    daysWorked: String(item.daysWorked),
    overtime50Hours: String(item.overtime50Hours).replace('.', ','),
    overtime100Hours: String(item.overtime100Hours).replace('.', ','),
    otherEarnings: item.otherEarnings.toFixed(2).replace('.', ','),
    otherDeductions: item.otherDeductions.toFixed(2).replace('.', ','),
    notes: item.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const n = (v: string) => Number(v.replace(',', '.')) || 0;
  const save = useMutation({
    mutationFn: () =>
      api(`/hr/payrolls/${payrollId}/items/${item.id}`, {
        method: 'PATCH',
        body: { daysWorked: Number(form.daysWorked), overtime50Hours: n(form.overtime50Hours), overtime100Hours: n(form.overtime100Hours), otherEarnings: parseMoney(form.otherEarnings) || 0, otherDeductions: parseMoney(form.otherDeductions) || 0, notes: form.notes || null },
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
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Dias trabalhados">{(id) => <Input id={id} type="number" min={0} max={30} value={form.daysWorked} onChange={(e) => set({ daysWorked: e.target.value })} />}</Field>
          <Field label="Horas extras 50%">{(id) => <Input id={id} inputMode="decimal" value={form.overtime50Hours} onChange={(e) => set({ overtime50Hours: e.target.value })} />}</Field>
          <Field label="Horas extras 100%">{(id) => <Input id={id} inputMode="decimal" value={form.overtime100Hours} onChange={(e) => set({ overtime100Hours: e.target.value })} />}</Field>
          <Field label="Outros proventos (R$)" hint="Comissões, adicionais, DSR.">
            {(id) => <Input id={id} inputMode="decimal" value={form.otherEarnings} onChange={(e) => set({ otherEarnings: e.target.value })} />}
          </Field>
          <Field label="Outros descontos (R$)" hint="Vale-transporte, adiantamento, faltas.">
            {(id) => <Input id={id} inputMode="decimal" value={form.otherDeductions} onChange={(e) => set({ otherDeductions: e.target.value })} />}
          </Field>
        </div>
        <Field label="Observações">{(id) => <Input id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

function PayslipLines({ item }: { item: PayrollItem }) {
  const rows: [string, number, 'p' | 'd'][] = [
    [`Salário (${item.daysWorked} dias)`, item.baseSalary, 'p'],
    ...(item.overtime > 0 ? ([['Horas extras', item.overtime, 'p']] as [string, number, 'p'][]) : []),
    ...(item.otherEarnings > 0 ? ([['Outros proventos', item.otherEarnings, 'p']] as [string, number, 'p'][]) : []),
    ['INSS', item.inss, 'd'],
    ['IRRF', item.irrf, 'd'],
    ...(item.otherDeductions > 0 ? ([['Outros descontos', item.otherDeductions, 'd']] as [string, number, 'd'][]) : []),
  ];
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
      <p className="mb-3 text-sm capitalize text-fg-muted">{competenceLabel(payroll.competence)}</p>
      <PayslipLines item={item} />
      <p className="mt-3 text-xs text-fg-muted">
        Base IRRF {formatMoney(item.irrfBase)}
        {item.irrfReduction > 0 && ` · redução legal ${formatMoney(item.irrfReduction)}`} · FGTS do mês {formatMoney(item.fgts)}
      </p>
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
        Recibo de pagamento de salário · <span className="capitalize">{competenceLabel(payroll.competence)}</span>
      </p>
      <p className="mb-2 text-sm">
        {item.employee.name} · CPF {item.employee.cpf} · {item.employee.position}
      </p>
      <PayslipLines item={item} />
      <p className="mt-2 text-xs">
        Base INSS {formatMoney(item.gross)} · Base IRRF {formatMoney(item.irrfBase)} · FGTS {formatMoney(item.fgts)}
      </p>
      <p className="mt-12 border-t border-black pt-1 text-center text-xs">Assinatura do colaborador</p>
    </div>
  );
}
