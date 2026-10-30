import { api, ApiError, formatDateTime, formatMoney, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { proposalStatusLabel, type Applicant, type Offer, type Proposal, type ProposalStatus } from '../contracts';
import { bankingKey } from './ConnectionsPage';

const pct = (f: number) => `${(f * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const proposalTone: Record<ProposalStatus, 'neutral' | 'brand' | 'success' | 'danger' | 'warning'> = {
  submitted: 'brand',
  under_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  contracted: 'success',
};

export function useProposals(sourceType: string, sourceId: string) {
  return useQuery({
    queryKey: [...bankingKey, 'proposals', sourceType, sourceId],
    queryFn: () => api<Proposal[]>('/banking/proposals', { query: { sourceType, sourceId } }),
  });
}

/**
 * Financiamento de uma negociação (veículo ou imóvel): simula em todas as instituições, envia a
 * proposta na escolhida e acompanha o status. A vertical reage ao resultado pelo evento do módulo.
 */
export function FinancingPanel({
  product,
  amount,
  defaultTerm,
  terms,
  sourceType,
  sourceId,
  customerId,
  applicant,
  details,
  disabled,
}: {
  product: 'vehicle_financing' | 'real_estate_financing';
  amount: number;
  defaultTerm: number;
  terms: number[];
  sourceType: string;
  sourceId: string;
  customerId: string;
  applicant: Partial<Applicant>;
  details: Record<string, unknown>;
  disabled?: boolean;
}) {
  const canPropose = useCan('integration.banking.propose');
  const [term, setTerm] = useState(defaultTerm);
  const [system, setSystem] = useState<'price' | 'sac'>(product === 'real_estate_financing' ? 'sac' : 'price');
  const simulation = useQuery({
    queryKey: [...bankingKey, 'simulate', product, amount, term, system],
    queryFn: () => api<{ offers: Offer[]; failures: { institution: string; message: string }[] }>('/banking/simulate', { method: 'POST', body: { product, amount, termMonths: term, system } }),
    enabled: amount > 0,
  });
  const proposals = useProposals(sourceType, sourceId);
  const [sending, setSending] = useState<Offer | null>(null);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-fg-muted">Valor a financiar</div>
            <div className="font-display text-2xl font-semibold tabular-nums">{formatMoney(amount)}</div>
          </div>
          <div className="ml-auto flex gap-2">
            <Select aria-label="Prazo" value={String(term)} onChange={(e) => setTerm(Number(e.target.value))}>
              {terms.map((t) => (
                <option key={t} value={t}>
                  {t} meses
                </option>
              ))}
            </Select>
            <Select aria-label="Sistema de amortização" value={system} onChange={(e) => setSystem(e.target.value as 'price' | 'sac')}>
              <option value="price">Price (parcela fixa)</option>
              <option value="sac">SAC (parcela decrescente)</option>
            </Select>
          </div>
        </div>
        {amount <= 0 ? (
          <p className="text-sm text-fg-muted">Sem valor a financiar.</p>
        ) : simulation.isPending ? (
          <Spinner />
        ) : simulation.isError ? (
          <Alert>{simulation.error.message}</Alert>
        ) : simulation.data.offers.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhuma instituição ativa oferece este produto. Configure em Configurações → Bancos e financeiras.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Instituição</Th>
                <Th className="text-right">Parcela</Th>
                <Th className="text-right">Taxa</Th>
                <Th className="text-right">CET</Th>
                <Th className="text-right">Total</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {simulation.data.offers.map((o, i) => (
                <tr key={o.connectionId}>
                  <Td>
                    <span className="font-medium">{o.institution}</span> {i === 0 && <Badge tone="success">Menor parcela</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {formatMoney(o.firstInstallment)}
                    {o.system === 'sac' && <div className="text-xs text-fg-muted">até {formatMoney(o.lastInstallment)}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{pct(o.monthlyRate)} a.m.</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{pct(o.cetYearly)} a.a.</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{formatMoney(o.totalPaid)}</Td>
                  <Td className="text-right">
                    {canPropose && !disabled && (
                      <Button size="sm" onClick={() => setSending(o)}>
                        Enviar proposta
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {simulation.data?.failures.map((f) => (
          <p key={f.institution} className="mt-2 text-xs text-danger-600">
            {f.institution}: {f.message}
          </p>
        ))}
      </Card>
      <ProposalList proposals={proposals.data} loading={proposals.isPending} />
      {sending && (
        <ProposalModal
          offer={sending}
          product={product}
          sourceType={sourceType}
          sourceId={sourceId}
          customerId={customerId}
          applicant={applicant}
          details={details}
          system={system}
          onClose={() => setSending(null)}
        />
      )}
    </div>
  );
}

/** `readOnly`: a negociação já foi encerrada, a lista é só histórico. */
export function ProposalList({ proposals, loading, readOnly }: { proposals?: Proposal[]; loading?: boolean; readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const canPropose = useCan('integration.banking.propose');
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'refresh' | 'contracted' | 'cancelled' }) =>
      action === 'refresh' ? api(`/banking/proposals/${id}/refresh`, { method: 'POST' }) : api(`/banking/proposals/${id}/status`, { method: 'POST', body: { status: action } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const [answering, setAnswering] = useState<string | null>(null);
  const [rescinding, setRescinding] = useState<string | null>(null);
  if (loading) return <Spinner />;
  if (!proposals?.length) return null;
  return (
    <Card className="p-5">
      <h3 className="mb-3 font-medium">Propostas enviadas</h3>
      {act.error && <Alert>{act.error instanceof ApiError ? act.error.message : 'Erro'}</Alert>}
      <ul className="divide-y divide-line text-sm">
        {proposals.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.connection.name}</span>
                <Badge tone={proposalTone[p.status]}>{proposalStatusLabel[p.status]}</Badge>
                {p.connection.mode === 'manual' && <Badge>Manual</Badge>}
              </div>
              <div className="text-xs text-fg-muted">
                {formatMoney(p.amount)} em {p.termMonths}x{p.offer && ` · parcela ${formatMoney(p.offer.firstInstallment)}`} · {formatDateTime(p.createdAt)}
                {p.externalId && ` · protocolo ${p.externalId}`}
              </div>
              {p.statusMessage && <div className="text-xs">{p.statusMessage}</div>}
            </div>
            {canPropose && !readOnly && (
              <div className="flex gap-1">
                {p.connection.mode === 'manual' && ['submitted', 'under_review', 'approved'].includes(p.status) && (
                  <Button size="sm" variant="secondary" onClick={() => setAnswering(answering === p.id ? null : p.id)}>
                    Registrar resposta
                  </Button>
                )}
                {p.connection.mode !== 'manual' && (p.status === 'submitted' || p.status === 'under_review') && (
                  <Button size="sm" variant="secondary" loading={act.isPending && act.variables?.id === p.id} onClick={() => act.mutate({ id: p.id, action: 'refresh' })}>
                    Consultar status
                  </Button>
                )}
                {p.status === 'approved' && (
                  <Button size="sm" onClick={() => act.mutate({ id: p.id, action: 'contracted' })}>
                    Contrato assinado
                  </Button>
                )}
                {['submitted', 'under_review', 'approved'].includes(p.status) && (
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: p.id, action: 'cancelled' })}>
                    Cancelar
                  </Button>
                )}
                {p.status === 'contracted' && p.product !== 'consortium' && (
                  <Button size="sm" variant="ghost" onClick={() => setRescinding(rescinding === p.id ? null : p.id)}>
                    Registrar distrato
                  </Button>
                )}
              </div>
            )}
            {rescinding === p.id && (
              <div className="w-full">
                <RescindForm proposal={p} onDone={() => setRescinding(null)} />
              </div>
            )}
            {answering === p.id && (
              <div className="w-full">
                <ManualResponseForm proposal={p} onDone={() => setAnswering(null)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Contrato assinado que caiu: registra o distrato combinado com a instituição, com o motivo. */
function RescindForm({ proposal, onDone }: { proposal: Proposal; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/banking/proposals/${proposal.id}/status`, { method: 'POST', body: { status: 'cancelled', message: reason.trim() } }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onDone();
    },
  });
  return (
    <div className="mt-2 space-y-3 rounded-xl border border-line bg-muted/30 p-3">
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao registrar'}</Alert>}
      <p className="text-sm text-fg-muted">
        Este contrato foi assinado. Registre aqui só depois de combinar o distrato com {proposal.connection.name}: o sistema não cancela nada no banco, só anota. A negociação volta a poder ser alterada ou marcada como perdida.
      </p>
      <Field label="Motivo do distrato">{(id) => <Input id={id} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>
          Registrar distrato
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

/**
 * Resposta de uma instituição sem API (modo manual), registrada pela equipe na própria lista:
 * o que a administradora respondeu no portal, por e-mail ou por arquivo.
 */
export function ManualResponseForm({ proposal, onDone }: { proposal: Proposal; onDone: () => void }) {
  const queryClient = useQueryClient();
  const options = (proposal.status === 'approved' ? ['contracted', 'cancelled'] : ['under_review', 'approved', 'rejected', 'cancelled']).filter((s) => s !== proposal.status) as ProposalStatus[];
  const [form, setForm] = useState({ status: options[0]!, message: '', externalId: '', groupCode: '', quotaNumber: '', approvedAmount: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const consortium = proposal.product === 'consortium';
  const save = useMutation({
    mutationFn: () =>
      api(`/banking/proposals/${proposal.id}/manual`, {
        method: 'POST',
        body: {
          status: form.status,
          message: form.message || null,
          externalId: form.externalId || null,
          groupCode: form.groupCode || null,
          quotaNumber: form.quotaNumber || null,
          approvedAmount: form.approvedAmount ? Number(form.approvedAmount.replace(/\./g, '').replace(',', '.')) : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onDone();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <form onSubmit={submit} className="mt-2 grid gap-3 rounded-xl border border-line bg-muted/30 p-3 sm:grid-cols-2">
      {save.error && (
        <div className="sm:col-span-2">
          <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao registrar'}</Alert>
        </div>
      )}
      <Field label="Resposta da instituição">
        {(id) => (
          <Select id={id} value={form.status} onChange={(e) => set({ status: e.target.value as ProposalStatus })}>
            {options.map((s) => (
              <option key={s} value={s}>
                {proposalStatusLabel[s]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Protocolo na instituição">{(id) => <Input id={id} value={form.externalId} onChange={(e) => set({ externalId: e.target.value })} placeholder={proposal.externalId ?? ''} />}</Field>
      {form.status === 'approved' && consortium && (
        <>
          <Field label="Grupo">{(id) => <Input id={id} required value={form.groupCode} onChange={(e) => set({ groupCode: e.target.value })} />}</Field>
          <Field label="Cota">{(id) => <Input id={id} required value={form.quotaNumber} onChange={(e) => set({ quotaNumber: e.target.value })} />}</Field>
        </>
      )}
      {form.status === 'approved' && !consortium && (
        <Field label="Valor aprovado (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.approvedAmount} onChange={(e) => set({ approvedAmount: e.target.value })} />}</Field>
      )}
      <div className="sm:col-span-2">
        <Field label="Observação">{(id) => <Input id={id} value={form.message} onChange={(e) => set({ message: e.target.value })} placeholder="Ex.: aprovada no portal em 12/10, documentação conferida" />}</Field>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={save.isPending}>
          Registrar
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function ProposalModal(props: {
  offer: Offer;
  product: 'vehicle_financing' | 'real_estate_financing';
  sourceType: string;
  sourceId: string;
  customerId: string;
  applicant: Partial<Applicant>;
  details: Record<string, unknown>;
  system: 'price' | 'sac';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: props.applicant.name ?? '',
    document: props.applicant.document ?? '',
    birthDate: props.applicant.birthDate ?? '',
    monthlyIncome: props.applicant.monthlyIncome ? String(props.applicant.monthlyIncome) : '',
    email: props.applicant.email ?? '',
    phone: props.applicant.phone ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const send = useMutation({
    mutationFn: () =>
      api('/banking/proposals', {
        method: 'POST',
        body: {
          connectionId: props.offer.connectionId,
          product: props.product,
          sourceType: props.sourceType,
          sourceId: props.sourceId,
          customerId: props.customerId,
          amount: props.offer.amount,
          termMonths: props.offer.termMonths,
          system: props.system,
          details: props.details,
          applicant: {
            ...form,
            birthDate: form.birthDate || null,
            email: form.email || null,
            phone: form.phone || null,
            monthlyIncome: form.monthlyIncome ? Number(form.monthlyIncome.replace(/\./g, '').replace(',', '.')) : null,
          },
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      props.onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    send.mutate();
  }
  return (
    <Modal
      open
      title={`Proposta — ${props.offer.institution}`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="bank-proposal-form" loading={send.isPending}>
            Enviar
          </Button>
        </>
      }
    >
      <form id="bank-proposal-form" onSubmit={submit} className="space-y-4">
        {send.error && <Alert>{send.error instanceof ApiError ? send.error.message : 'Erro ao enviar'}</Alert>}
        <p className="text-sm text-fg-muted">
          {formatMoney(props.offer.amount)} em {props.offer.termMonths}x de {formatMoney(props.offer.firstInstallment)}. Os dados abaixo vão para a instituição fazer a análise de crédito, com o consentimento do cliente.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome completo">{(id) => <Input id={id} required value={form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
          <Field label="CPF ou CNPJ">{(id) => <Input id={id} required value={form.document} onChange={(e) => set({ document: e.target.value })} />}</Field>
          <Field label="Nascimento">{(id) => <Input id={id} type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />}</Field>
          <Field label="Renda mensal (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.monthlyIncome} onChange={(e) => set({ monthlyIncome: e.target.value })} />}</Field>
          <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
          <Field label="Telefone">{(id) => <Input id={id} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
        </div>
      </form>
    </Modal>
  );
}
