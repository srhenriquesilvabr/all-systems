import { api, ApiError, formatDate, formatDocument, formatMoney, parseMoney, today } from '@all/module-sdk/web';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  employeeCategoryLabel,
  noticeOptions,
  noticeTypeLabel,
  terminationTypeLabel,
  terminationTypes,
  type Employee,
  type NoticeType,
  type TerminationDetail,
  type TerminationType,
} from '../contracts';
import { hrKey } from './hrKey';
import { EmployerHeading } from './employers';

const optionalMoney = (v: string) => (v.trim() === '' ? undefined : parseMoney(v));

/** Rescisão em duas etapas: dados da saída → prévia do termo → confirmar. */
export function TerminationWizard({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    type: 'without_cause' as TerminationType,
    // Desligado sem termo: já traz a data que foi informada na edição.
    terminationDate: employee.terminationDate ?? today(),
    notice: 'indemnified' as NoticeType,
    salary: employee.salary.toFixed(2).replace('.', ','),
    variableAverage: '',
    fgtsBalance: '',
    otherEarnings: '',
    otherDeductions: '',
    notes: '',
  });
  const [preview, setPreview] = useState<TerminationDetail | null>(null);
  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setPreview(null);
  };
  const body = () => ({
    type: form.type,
    terminationDate: form.terminationDate,
    notice: form.notice,
    salary: optionalMoney(form.salary),
    variableAverage: optionalMoney(form.variableAverage),
    fgtsBalance: optionalMoney(form.fgtsBalance),
    otherEarnings: optionalMoney(form.otherEarnings) ?? 0,
    otherDeductions: optionalMoney(form.otherDeductions) ?? 0,
    notes: form.notes || null,
  });
  const calc = useMutation({
    mutationFn: () => api<TerminationDetail>(`/hr/employees/${employee.id}/termination/preview`, { method: 'POST', body: body() }),
    onSuccess: setPreview,
  });
  const confirm = useMutation({
    mutationFn: () => api<TerminationDetail>(`/hr/employees/${employee.id}/termination`, { method: 'POST', body: body() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKey });
      onClose();
    },
  });
  function submit(ev: FormEvent) {
    ev.preventDefault();
    calc.mutate();
  }
  const error = calc.error ?? confirm.error;
  return (
    <Modal
      open
      title={`Rescindir — ${employee.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {preview ? (
            <Button variant="danger" loading={confirm.isPending} onClick={() => confirm.mutate()}>
              Confirmar rescisão
            </Button>
          ) : (
            <Button type="submit" form="hr-termination-form" loading={calc.isPending}>
              Calcular prévia
            </Button>
          )}
        </>
      }
    >
      <form id="hr-termination-form" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error instanceof ApiError ? error.message : 'Erro'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de rescisão">
            {(id) => (
              <Select id={id} value={form.type} onChange={(e) => {
                const type = e.target.value as TerminationType;
                set({ type, notice: noticeOptions[type][0]! });
              }}>
                {terminationTypes.map((t) => (
                  <option key={t} value={t}>
                    {terminationTypeLabel[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Último dia trabalhado">{(id) => <Input id={id} type="date" required value={form.terminationDate} onChange={(e) => set({ terminationDate: e.target.value })} />}</Field>
          <Field label="Aviso prévio">
            {(id) => (
              <Select id={id} value={form.notice} onChange={(e) => set({ notice: e.target.value as NoticeType })} disabled={noticeOptions[form.type].length === 1}>
                {noticeOptions[form.type].map((n) => (
                  <option key={n} value={n}>
                    {noticeTypeLabel[n]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Último salário (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.salary} onChange={(e) => set({ salary: e.target.value })} />}</Field>
          <Field label="Média das variáveis (R$/mês)" hint="Vazio = média das folhas fechadas dos últimos 12 meses.">
            {(id) => <Input id={id} inputMode="decimal" value={form.variableAverage} onChange={(e) => set({ variableAverage: e.target.value })} />}
          </Field>
          <Field label="Saldo do FGTS (R$)" hint="Do extrato da Caixa. Vazio = estimado pelas folhas registradas.">
            {(id) => <Input id={id} inputMode="decimal" value={form.fgtsBalance} onChange={(e) => set({ fgtsBalance: e.target.value })} />}
          </Field>
          <Field label="Outros proventos do mês (R$)" hint="Horas extras, comissões do mês da saída.">
            {(id) => <Input id={id} inputMode="decimal" value={form.otherEarnings} onChange={(e) => set({ otherEarnings: e.target.value })} />}
          </Field>
          <Field label="Outros descontos (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.otherDeductions} onChange={(e) => set({ otherDeductions: e.target.value })} />}</Field>
        </div>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        {form.notice === 'worked' && <p className="text-xs text-fg-muted">Aviso trabalhado: informe como último dia o fim do aviso. Os dias de aviso além de 30 (proporcional) são indenizados.</p>}
      </form>
      {preview && (
        <div className="mt-6 border-t border-line pt-4">
          <h2 className="mb-3 font-medium">Prévia do termo</h2>
          <TerminationStatementView detail={preview} />
        </div>
      )}
    </Modal>
  );
}

/** Linhas do termo (proventos e descontos), bases, FGTS e avisos. */
export function TerminationStatementView({ detail: d }: { detail: TerminationDetail }) {
  const earnings = d.lines.filter((l) => l.kind === 'earning');
  const deductions = d.lines.filter((l) => l.kind === 'deduction');
  return (
    <div className="space-y-4 text-sm">
      {d.warnings.length > 0 && (
        <Alert tone="info">
          <ul className="list-disc pl-4">
            {d.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Info label="Tipo">{terminationTypeLabel[d.type]}</Info>
        <Info label="Aviso prévio">
          {noticeTypeLabel[d.notice]}
          {d.noticeDays > 0 && ` · direito a ${d.noticeDays} dias (${d.yearsOfService} ${d.yearsOfService === 1 ? 'ano' : 'anos'} completos)`}
        </Info>
        <Info label="Admissão">{formatDate(d.admissionDate)}</Info>
        <Info label="Afastamento">
          {formatDate(d.terminationDate)}
          {d.projectedEnd !== d.terminationDate && ` · projeção do aviso até ${formatDate(d.projectedEnd)}`}
        </Info>
        <Info label="Remuneração para cálculo">
          {formatMoney(d.remuneration)}
          {d.variableAverage > 0 && ` (salário ${formatMoney(d.salary)} + média ${formatMoney(d.variableAverage)})`}
        </Info>
        <Info label="Pagamento até">{formatDate(d.payBy)} (art. 477 §6º)</Info>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-muted">
            <th className="py-1 font-normal">Verba</th>
            <th className="py-1 font-normal">Ref.</th>
            <th className="py-1 text-right font-normal">Proventos</th>
            <th className="py-1 text-right font-normal">Descontos</th>
          </tr>
        </thead>
        <tbody>
          {[...earnings, ...deductions].map((l) => (
            <tr key={`${l.code}-${l.label}-${l.reference}`}>
              <td className="py-1">{l.label}</td>
              <td className="py-1 text-fg-muted">{l.reference}</td>
              <td className="py-1 text-right tabular-nums">{l.kind === 'earning' ? formatMoney(l.amount) : ''}</td>
              <td className="py-1 text-right tabular-nums">{l.kind === 'deduction' ? formatMoney(l.amount) : ''}</td>
            </tr>
          ))}
          <tr className="border-t border-line">
            <td className="py-1" colSpan={2}>
              Totais
            </td>
            <td className="py-1 text-right tabular-nums">{formatMoney(d.earnings)}</td>
            <td className="py-1 text-right tabular-nums">{formatMoney(d.deductions)}</td>
          </tr>
          <tr className="font-medium">
            <td className="py-1" colSpan={2}>
              Líquido a receber
            </td>
            <td colSpan={2} className="py-1 text-right tabular-nums">
              {formatMoney(d.net)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-fg-muted">
        Bases — INSS: {formatMoney(d.bases.inssSalary)} (mês) e {formatMoney(d.bases.inssThirteenth)} (13º) · IRRF: {formatMoney(d.bases.irrfSalary)} (mês) e {formatMoney(d.bases.irrfThirteenth)} (13º) · FGTS:{' '}
        {formatMoney(d.bases.fgts)}. Aviso indenizado, férias indenizadas + 1/3 e indenizações não têm INSS nem IRRF.
      </p>
      <div className="rounded-md border border-line p-3">
        <div className="mb-1 font-medium">FGTS (guia do FGTS Digital, paga pela empresa)</div>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Info label={`Depósito rescisório (${Math.round(d.fgts.rate * 100)}%)`}>{formatMoney(d.fgts.deposit)}</Info>
          <Info label={`Saldo para a multa (${d.fgts.balanceSource === 'informed' ? 'extrato' : 'estimado'})`}>{formatMoney(d.fgts.balance)}</Info>
          <Info label={`Multa rescisória (${Math.round(d.fgts.fineRate * 100)}%)`}>{formatMoney(d.fgts.fine)}</Info>
          <Info label="Total da guia">{formatMoney(d.fgts.total)}</Info>
        </div>
      </div>
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

/** Termo registrado, com impressão. */
export function TerminationModal({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [...hrKey, 'termination', employeeId], queryFn: () => api<TerminationDetail>(`/hr/employees/${employeeId}/termination`) });
  return (
    <>
      <Modal
        open
        title="Termo de rescisão"
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
            <Button onClick={() => window.print()} disabled={!q.data}>
              Imprimir
            </Button>
          </>
        }
      >
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{q.error.message}</Alert> : <TerminationStatementView detail={q.data} />}
      </Modal>
      {q.data && <TerminationPrint detail={q.data} />}
    </>
  );
}

/** Versão para impressão (termo de rescisão resumido, no espírito do TRCT). */
export function TerminationPrint({ detail: d }: { detail: TerminationDetail }) {
  const earnings = d.lines.filter((l) => l.kind === 'earning');
  const deductions = d.lines.filter((l) => l.kind === 'deduction');
  return (
    <div className="hidden text-black print:block">
      <EmployerHeading employer={d.employee.employer ?? null} />
      <p className="mb-3 text-sm font-medium">Termo de rescisão do contrato de trabalho (resumo)</p>
      <table className="mb-3 w-full text-xs">
        <tbody>
          <tr>
            <td className="py-0.5">
              Empregado: <b>{d.employee.name}</b> · CPF {formatDocument(d.employee.cpf)} · {d.employee.position}
              {d.employee.category === 'apprentice' && ` · ${employeeCategoryLabel.apprentice}`}
            </td>
          </tr>
          <tr>
            <td className="py-0.5">
              Admissão {formatDate(d.admissionDate)} · Afastamento {formatDate(d.terminationDate)}
              {d.projectedEnd !== d.terminationDate && ` · Data projetada do aviso ${formatDate(d.projectedEnd)}`}
            </td>
          </tr>
          <tr>
            <td className="py-0.5">
              Causa: {terminationTypeLabel[d.type]} · Aviso prévio: {noticeTypeLabel[d.notice]}
              {d.noticeDays > 0 && ` (${d.noticeDays} dias)`} · Remuneração para fins rescisórios {formatMoney(d.remuneration)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <PrintColumn title="Verbas rescisórias" rows={earnings} total={d.earnings} />
        <PrintColumn title="Deduções" rows={deductions} total={d.deductions} />
      </div>
      <p className="mt-2 border-t border-black pt-1 text-sm font-bold">Valor líquido: {formatMoney(d.net)}</p>
      <p className="mt-2 text-xs">
        FGTS: depósito rescisório {formatMoney(d.fgts.deposit)} · multa {Math.round(d.fgts.fineRate * 100)}% {formatMoney(d.fgts.fine)} (sobre saldo de {formatMoney(d.fgts.balance)}) · recolhimento pela empresa até {formatDate(d.payBy)}.
      </p>
      <p className="mt-1 text-[10px]">Documento de conferência gerado pelo sistema; não substitui o TRCT oficial nem os eventos do eSocial.</p>
      <div className="mt-12 grid grid-cols-2 gap-8 text-center text-xs">
        <p className="border-t border-black pt-1">Empregador</p>
        <p className="border-t border-black pt-1">Empregado</p>
      </div>
    </div>
  );
}

function PrintColumn({ title, rows, total }: { title: string; rows: TerminationDetail['lines']; total: number }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="py-0.5">{title}</th>
          <th className="py-0.5 text-right">Valor</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={`${l.code}-${l.label}-${l.reference}`}>
            <td className="py-0.5">
              {l.code} {l.label}
              {l.reference && ` (${l.reference})`}
            </td>
            <td className="py-0.5 text-right tabular-nums">{formatMoney(l.amount)}</td>
          </tr>
        ))}
        <tr className="border-t border-black font-medium">
          <td className="py-0.5">Total</td>
          <td className="py-0.5 text-right tabular-nums">{formatMoney(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
