import { api, ApiError, formatDate, formatDateTime, formatMoney, parseMoney, today, useCan } from '@all/module-sdk/web';
import type { Appointment } from '@all/scheduling';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { caseAreaLabel, caseRoleLabel, caseStatusLabel, cnjSegment, feeKindLabel, feeKinds, type CaseUpdate, type Deadline, type Fee, type LegalCase } from '../contracts';
import { DeadlineList } from './DeadlinesPage';
import { CaseModal, legalKey, statusTone, useTeam } from './shared';

export function CasePage() {
  const { id = '' } = useParams();
  const canWrite = useCan('legal.cases.write');
  const canFees = useCan('legal.fees.read');
  const c = useQuery({ queryKey: [...legalKey, 'case', id], queryFn: () => api<LegalCase>(`/legal/cases/${id}`) });
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('updates');

  if (c.isPending) return <Spinner />;
  if (c.isError) return <Alert>{c.error.message}</Alert>;
  const lc = c.data;
  const segment = lc.number ? cnjSegment[lc.number.split('.')[2] ?? ''] : undefined;
  const tabs = [
    { key: 'updates', label: 'Andamentos' },
    { key: 'deadlines', label: 'Prazos' },
    { key: 'hearings', label: 'Agenda' },
    ...(canFees ? [{ key: 'fees', label: 'Honorários' }] : []),
  ];

  return (
    <>
      <PageHeader
        title={lc.title}
        description={[lc.number ?? 'Sem número', segment].filter(Boolean).join(' · ')}
        actions={
          canWrite && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit space-y-3 p-5 text-sm">
          <Badge tone={statusTone[lc.status]}>{caseStatusLabel[lc.status]}</Badge>
          <Info label="Cliente">
            <Link to={`/clientes/${lc.customer.id}`} className="font-medium text-brand-700 hover:underline">
              {lc.customer.name}
            </Link>{' '}
            <span className="text-fg-muted">({caseRoleLabel[lc.role]})</span>
          </Info>
          <Info label="Área">{caseAreaLabel[lc.area]}</Info>
          {lc.court && <Info label="Vara / tribunal">{lc.court}</Info>}
          {lc.opposingParty && <Info label="Parte contrária">{lc.opposingParty}</Info>}
          {lc.claimValue != null && <Info label="Valor da causa">{formatMoney(lc.claimValue)}</Info>}
          <Info label="Responsável">{lc.responsible?.name ?? '—'}</Info>
          {lc.notes && (
            <Info label="Observações">
              <p className="whitespace-pre-line">{lc.notes}</p>
            </Info>
          )}
        </Card>
        <div className="min-w-0 space-y-4">
          <Tabs items={tabs} active={tab} onChange={setTab} />
          {tab === 'updates' && <UpdatesTab caseId={lc.id} />}
          {tab === 'deadlines' && <DeadlinesTab caseId={lc.id} />}
          {tab === 'hearings' && <HearingsTab legalCase={lc} />}
          {tab === 'fees' && <FeesTab caseId={lc.id} />}
        </div>
      </div>
      {editing && <CaseModal legalCase={lc} onClose={() => setEditing(false)} />}
    </>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function UpdatesTab({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const canWrite = useCan('legal.cases.write');
  const updates = useQuery({ queryKey: [...legalKey, 'updates', caseId], queryFn: () => api<CaseUpdate[]>(`/legal/cases/${caseId}/updates`) });
  const [occurredOn, setOccurredOn] = useState(today());
  const [description, setDescription] = useState('');
  const add = useMutation({
    mutationFn: () => api(`/legal/cases/${caseId}/updates`, { method: 'POST', body: { occurredOn, description } }),
    onSuccess: () => {
      setDescription('');
      queryClient.invalidateQueries({ queryKey: legalKey });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            {add.error && <Alert>{add.error instanceof ApiError ? add.error.message : 'Erro ao salvar'}</Alert>}
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <Field label="Data">{(id) => <Input id={id} type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />}</Field>
              <Field label="Andamento">{(id) => <Textarea id={id} rows={2} required minLength={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Juntada de contestação pela parte ré" />}</Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={add.isPending}>
                Registrar andamento
              </Button>
            </div>
          </form>
        </Card>
      )}
      {updates.isPending ? (
        <Spinner />
      ) : updates.isError ? (
        <Alert>{updates.error.message}</Alert>
      ) : updates.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum andamento registrado" />
        </Card>
      ) : (
        <ol className="space-y-2">
          {updates.data.map((u) => (
            <li key={u.id}>
              <Card className="p-4 text-sm">
                <div className="flex justify-between gap-3 text-xs text-fg-muted">
                  <span className="font-medium tabular-nums text-fg">{formatDate(u.occurredOn)}</span>
                  <span>{u.author ?? ''}</span>
                </div>
                <p className="mt-1 whitespace-pre-line">{u.description}</p>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DeadlinesTab({ caseId }: { caseId: string }) {
  const canWrite = useCan('legal.cases.write');
  const deadlines = useQuery({ queryKey: [...legalKey, 'deadlines', { caseId }], queryFn: () => api<Deadline[]>('/legal/deadlines', { query: { caseId } }) });
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAdding(true)}>
            Novo prazo
          </Button>
        </div>
      )}
      {deadlines.isPending ? <Spinner /> : deadlines.isError ? <Alert>{deadlines.error.message}</Alert> : <DeadlineList deadlines={deadlines.data} showCase={false} />}
      {adding && <DeadlineModal caseId={caseId} onClose={() => setAdding(false)} />}
    </div>
  );
}

function DeadlineModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const team = useTeam();
  const [form, setForm] = useState({ title: '', dueOn: '', alertDays: '3', assignedUserId: '', notes: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => api('/legal/deadlines', { method: 'POST', body: { ...form, caseId, alertDays: Number(form.alertDays), assignedUserId: form.assignedUserId || null, notes: form.notes || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: legalKey });
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
      title="Novo prazo"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="legal-deadline-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="legal-deadline-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <Field label="Prazo">{(id) => <Input id={id} required minLength={3} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Réplica à contestação" autoFocus />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vencimento">{(id) => <Input id={id} type="date" required value={form.dueOn} onChange={(e) => set({ dueOn: e.target.value })} />}</Field>
          <Field label="Avisar com antecedência">
            {(id) => (
              <Select id={id} value={form.alertDays} onChange={(e) => set({ alertDays: e.target.value })}>
                {[0, 1, 2, 3, 5, 7, 10, 15].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? 'No dia' : `${d} dia${d > 1 ? 's' : ''} antes`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Quem cuida" hint="Recebe o aviso por e-mail. Sem ninguém, avisa o responsável pelo processo.">
          {(id) => (
            <Select id={id} value={form.assignedUserId} onChange={(e) => set({ assignedUserId: e.target.value })}>
              <option value="">—</option>
              {team.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

/** Audiências e reuniões marcadas na agenda para este processo. */
function HearingsTab({ legalCase }: { legalCase: LegalCase }) {
  const list = useQuery({
    queryKey: ['scheduling', 'customer', legalCase.customer.id],
    queryFn: () => api<Appointment[]>('/scheduling/appointments', { query: { customerId: legalCase.customer.id } }),
  });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  const mine = list.data.filter((a) => a.subject?.type === 'legal_case' && a.subject.id === legalCase.id);
  return (
    <Card>
      {mine.length === 0 ? (
        <EmptyState title="Nada marcado para este processo" description='Marque audiências e reuniões pela Agenda e escolha o processo no campo "Processo".' />
      ) : (
        <ul className="divide-y divide-line text-sm">
          {mine.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-medium">{a.services.map((s) => s.name).join(', ')}</span>
                <span className="text-fg-muted"> · {a.resourceName}</span>
              </span>
              <span className="tabular-nums">{formatDateTime(a.startsAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FeesTab({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const canManage = useCan('legal.fees.manage');
  const fees = useQuery({ queryKey: [...legalKey, 'fees', caseId], queryFn: () => api<Fee[]>(`/legal/cases/${caseId}/fees`) });
  const [adding, setAdding] = useState(false);
  const [success, setSuccess] = useState<Fee | null>(null);
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/legal/fees/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: legalKey }),
  });
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAdding(true)}>
            Lançar honorários
          </Button>
        </div>
      )}
      {cancel.error && <Alert>{cancel.error instanceof ApiError ? cancel.error.message : 'Erro ao cancelar'}</Alert>}
      {fees.isPending ? (
        <Spinner />
      ) : fees.isError ? (
        <Alert>{fees.error.message}</Alert>
      ) : fees.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum honorário lançado" />
        </Card>
      ) : (
        fees.data.map((f) => (
          <Card key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <div className="font-medium">
                {feeKindLabel[f.kind]}
                {f.kind === 'success' && f.successPercent != null && ` · ${f.successPercent.toLocaleString('pt-BR')}%`}
                {f.kind !== 'success' && f.amount != null && ` · ${formatMoney(f.amount)}${f.kind === 'monthly' ? '/mês' : ''}${f.installments > 1 ? ` em ${f.installments}x` : ''}`}
              </div>
              {f.description && <div className="text-fg-muted">{f.description}</div>}
              <div className="mt-1 text-xs text-fg-muted">
                Lançado {formatMoney(f.receivable.total)} · recebido {formatMoney(f.receivable.paid)} · em aberto {formatMoney(f.receivable.open)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {f.status === 'cancelled' ? <Badge>Cancelado</Badge> : f.status === 'settled' ? <Badge tone="success">Êxito registrado</Badge> : null}
              {canManage && f.kind === 'success' && f.status === 'active' && (
                <Button size="sm" onClick={() => setSuccess(f)}>
                  Registrar êxito
                </Button>
              )}
              {canManage && f.status !== 'cancelled' && (
                <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === f.id} onClick={() => cancel.mutate(f.id)}>
                  Cancelar
                </Button>
              )}
            </div>
          </Card>
        ))
      )}
      <p className="text-xs text-fg-muted">As parcelas entram no financeiro como "a receber"; a baixa é feita lá.</p>
      {adding && <FeeModal caseId={caseId} onClose={() => setAdding(false)} />}
      {success && <SuccessModal fee={success} onClose={() => setSuccess(null)} />}
    </div>
  );
}

function FeeModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ kind: 'fixed' as (typeof feeKinds)[number], description: '', amount: '', installments: '1', firstDueOn: today(), successPercent: '30' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api('/legal/fees', {
        method: 'POST',
        body: {
          caseId,
          kind: form.kind,
          description: form.description || null,
          amount: form.kind === 'success' ? null : parseMoney(form.amount),
          installments: Number(form.installments),
          firstDueOn: form.kind === 'success' ? null : form.firstDueOn,
          successPercent: form.kind === 'success' ? Number(form.successPercent.replace(',', '.')) : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: legalKey });
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
      title="Lançar honorários"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="legal-fee-form" loading={save.isPending}>
            Lançar
          </Button>
        </>
      }
    >
      <form id="legal-fee-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={form.kind} onChange={(e) => set({ kind: e.target.value as typeof form.kind })}>
              {feeKinds.map((k) => (
                <option key={k} value={k}>
                  {feeKindLabel[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {form.kind === 'success' ? (
          <Field label="Percentual sobre o valor obtido (%)" hint="A parcela é lançada quando o êxito for registrado.">
            {(id) => <Input id={id} inputMode="decimal" required value={form.successPercent} onChange={(e) => set({ successPercent: e.target.value })} />}
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={form.kind === 'monthly' ? 'Valor mensal (R$)' : 'Valor total (R$)'}>
              {(id) => <Input id={id} inputMode="decimal" required value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0,00" />}
            </Field>
            <Field label={form.kind === 'monthly' ? 'Meses' : 'Parcelas'}>
              {(id) => <Input id={id} type="number" min={1} max={60} required value={form.installments} onChange={(e) => set({ installments: e.target.value })} />}
            </Field>
            <Field label="1º vencimento">{(id) => <Input id={id} type="date" required value={form.firstDueOn} onChange={(e) => set({ firstDueOn: e.target.value })} />}</Field>
          </div>
        )}
        <Field label="Descrição">{(id) => <Input id={id} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Ex.: Contrato de honorários de 10/03" />}</Field>
      </form>
    </Modal>
  );
}

function SuccessModal({ fee, onClose }: { fee: Fee; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [obtained, setObtained] = useState('');
  const [dueOn, setDueOn] = useState(today());
  const save = useMutation({
    mutationFn: () => api(`/legal/fees/${fee.id}/success`, { method: 'POST', body: { obtainedAmount: parseMoney(obtained), dueOn } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: legalKey });
      onClose();
    },
  });
  const value = parseMoney(obtained) || 0;
  return (
    <Modal
      open
      title="Registrar êxito"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!value} onClick={() => save.mutate()}>
            Lançar {formatMoney((value * (fee.successPercent ?? 0)) / 100)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor obtido para o cliente (R$)">{(id) => <Input id={id} inputMode="decimal" value={obtained} onChange={(e) => setObtained(e.target.value)} autoFocus />}</Field>
          <Field label="Vencimento">{(id) => <Input id={id} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}</Field>
        </div>
      </div>
    </Modal>
  );
}
