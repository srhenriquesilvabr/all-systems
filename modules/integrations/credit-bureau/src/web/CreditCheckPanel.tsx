import { api, ApiError, formatDate, formatDateTime, formatMoney, today, useCan, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  CONSENT_VERSION,
  consentMethodLabel,
  consentMethods,
  consentText,
  CREDIT_BUREAU,
  decisionLabel,
  maskDocument,
  parseDocument,
  queryPurposeLabel,
  queryPurposes,
  riskBandLabel,
  type BureauStatus,
  type ConsentMethod,
  type CreditQuery,
  type Decision,
  type QueryPurpose,
  type RiskBand,
} from '../contracts';

export const bureauKey = ['credit-bureau'] as const;
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
export const riskTone: Record<RiskBand, Tone> = { low: 'success', medium: 'brand', high: 'warning', very_high: 'danger' };
export const decisionTone: Record<Decision, Tone> = { pending: 'warning', approved: 'success', rejected: 'danger' };
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export function useBureauStatus(enabled = true) {
  return useQuery({ queryKey: [...bureauKey, 'status'], queryFn: () => api<BureauStatus>('/credit-bureau/status'), enabled, staleTime: 60_000 });
}

/** O módulo de consulta de crédito está contratado nesta empresa? (as verticais mostram o painel só se estiver). */
export function useBureauEnabled() {
  return useSession().modules.some((m) => m.key === CREDIT_BUREAU);
}

export interface CreditCheckDefaults {
  document?: string | null;
  subjectName?: string | null;
  customerId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  purpose?: QueryPurpose;
}

/**
 * Consulta de crédito dentro de outra tela (ex.: lead ou venda da cota): mostra a última consulta
 * desta origem com a decisão; sem consulta, o formulário com a autorização do cliente.
 */
export function CreditCheckPanel({ defaults, title = 'Consulta de crédito' }: { defaults: CreditCheckDefaults; title?: string }) {
  const enabled = useBureauEnabled();
  const canQuery = useCan('integration.credit_bureau.query');
  const canRead = useCan('integration.credit_bureau.read') || canQuery;
  const list = useQuery({
    queryKey: [...bureauKey, 'queries', defaults.sourceType, defaults.sourceId],
    queryFn: () => api<CreditQuery[]>('/credit-bureau/queries', { query: { sourceType: defaults.sourceType ?? undefined, sourceId: defaults.sourceId ?? undefined } }),
    enabled: enabled && canRead && !!defaults.sourceId,
  });
  const [asking, setAsking] = useState(false);
  if (!enabled || !canRead) return null;
  const latest = list.data?.[0];
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        {latest && canQuery && !asking && (
          <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
            Consultar de novo
          </Button>
        )}
      </div>
      {list.isPending && defaults.sourceId ? (
        <Spinner />
      ) : list.isError ? (
        <Alert>{list.error.message}</Alert>
      ) : latest && !asking ? (
        <CreditResult query={latest} />
      ) : canQuery ? (
        <CreditQueryForm defaults={defaults} onDone={() => setAsking(false)} onCancel={latest ? () => setAsking(false) : undefined} />
      ) : (
        <p className="text-sm text-fg-muted">Nenhuma consulta feita. Peça a quem tem permissão de consulta de crédito.</p>
      )}
    </Card>
  );
}

/** Formulário da consulta: documento, finalidade e a autorização do cliente (texto, data, forma, prova). */
export function CreditQueryForm({ defaults, onDone, onCancel }: { defaults: CreditCheckDefaults; onDone?: (q: CreditQuery) => void; onCancel?: () => void }) {
  const queryClient = useQueryClient();
  const status = useBureauStatus();
  const [form, setForm] = useState({
    document: defaults.document ?? '',
    subjectName: defaults.subjectName ?? '',
    purpose: (defaults.purpose ?? 'consortium_sale') as QueryPurpose,
    givenAt: today(),
    method: 'signed_term' as ConsentMethod,
    evidence: '',
    confirmed: false,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const parsed = parseDocument(form.document);
  const run = useMutation({
    mutationFn: () =>
      api<CreditQuery>('/credit-bureau/queries', {
        method: 'POST',
        body: {
          document: form.document,
          subjectName: form.subjectName,
          customerId: defaults.customerId ?? null,
          sourceType: defaults.sourceType ?? null,
          sourceId: defaults.sourceId ?? null,
          purpose: form.purpose,
          consent: { givenAt: form.givenAt, method: form.method, evidence: form.evidence || null, confirmed: form.confirmed, version: CONSENT_VERSION },
        },
      }),
    onSuccess: (q) => {
      queryClient.invalidateQueries({ queryKey: bureauKey });
      onDone?.(q);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    run.mutate();
  }
  if (status.isPending) return <Spinner />;
  if (status.isError) return <Alert>{status.error.message}</Alert>;
  const s = status.data;
  const cost = parsed ? (parsed.type === 'cpf' ? s.costPerQueryPf : s.costPerQueryPj) : null;
  return (
    <form onSubmit={submit} className="space-y-4">
      {run.error && <Alert>{errorText(run.error, 'Erro na consulta')}</Alert>}
      {s.simulated && <Alert tone="info">Modo simulado: o resultado é de demonstração e não vem de nenhum birô.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CPF ou CNPJ" error={form.document && !parsed ? 'Documento inválido' : undefined}>
          {(id) => <Input id={id} required value={form.document} onChange={(e) => set({ document: e.target.value })} />}
        </Field>
        <Field label="Nome do titular">{(id) => <Input id={id} required value={form.subjectName} onChange={(e) => set({ subjectName: e.target.value })} />}</Field>
        <div className="sm:col-span-2">
          <Field label="Finalidade">
            {(id) => (
              <Select id={id} value={form.purpose} onChange={(e) => set({ purpose: e.target.value as QueryPurpose })}>
                {queryPurposes.map((p) => (
                  <option key={p} value={p}>
                    {queryPurposeLabel[p][0]!.toUpperCase() + queryPurposeLabel[p].slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-line bg-muted/30 p-4">
        <p className="text-sm font-medium">Autorização do cliente</p>
        <p className="text-xs leading-relaxed text-fg-muted">
          {consentText({ company: s.company, provider: s.provider, purpose: form.purpose, documentType: parsed?.type ?? 'cpf' })}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data da autorização">{(id) => <Input id={id} type="date" required max={today()} value={form.givenAt} onChange={(e) => set({ givenAt: e.target.value })} />}</Field>
          <Field label="Como autorizou">
            {(id) => (
              <Select id={id} value={form.method} onChange={(e) => set({ method: e.target.value as ConsentMethod })}>
                {consentMethods.map((m) => (
                  <option key={m} value={m}>
                    {consentMethodLabel[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Onde está a prova (opcional)" hint="Ex.: termo arquivado na pasta do cliente; protocolo da ligação; mensagem de 12/10 no WhatsApp.">
              {(id) => <Textarea id={id} rows={2} maxLength={300} value={form.evidence} onChange={(e) => set({ evidence: e.target.value })} />}
            </Field>
          </div>
        </div>
        <Checkbox required label="Confirmo que o cliente concordou com o texto acima antes desta consulta." checked={form.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} />
      </div>
      <p className="text-xs text-fg-muted">
        {s.providerName}
        {cost != null && ` · custo desta consulta: ${formatMoney(cost)}`} · consultas no mês: {s.month.count}
        {s.monthlyLimit ? ` de ${s.monthlyLimit}` : ''}. A consulta fica no histórico e na auditoria com o seu usuário.
      </p>
      <div className="flex gap-2">
        <Button type="submit" loading={run.isPending} disabled={!form.confirmed || !parsed}>
          Consultar
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

/** Resultado: score, faixa, pendências resumidas e a decisão (seguir/reprovar). */
export function CreditResult({ query, showSubject = true }: { query: CreditQuery; showSubject?: boolean }) {
  const queryClient = useQueryClient();
  const canQuery = useCan('integration.credit_bureau.query');
  const [note, setNote] = useState(query.decisionNote ?? '');
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => api<CreditQuery>(`/credit-bureau/queries/${query.id}/decision`, { method: 'POST', body: { decision, note: note || null } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bureauKey }),
  });
  if (query.status === 'error') {
    return (
      <div className="space-y-1 text-sm">
        <Alert>Consulta sem resultado: {query.error}</Alert>
        <p className="text-xs text-fg-muted">
          {formatDateTime(query.createdAt)} · {query.queriedBy ?? '—'}
        </p>
      </div>
    );
  }
  const s = query.summary;
  const belowSuggested = query.score != null && query.score < query.suggestedMinScore;
  return (
    <div className="space-y-3 text-sm">
      {query.simulated && <Badge tone="warning">Resultado simulado</Badge>}
      {showSubject && (
        <p>
          {query.subjectName} · {maskDocument(query.document)}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <div className="text-xs text-fg-muted">Score</div>
          <div className="font-display text-3xl font-semibold tabular-nums">{query.score ?? '—'}</div>
        </div>
        {query.riskBand && <Badge tone={riskTone[query.riskBand]}>{riskBandLabel[query.riskBand]}</Badge>}
        <Badge tone={decisionTone[query.decision]}>{decisionLabel[query.decision]}</Badge>
      </div>
      {s && (
        <ul className="grid gap-1 sm:grid-cols-3">
          <li>
            Negativações: <strong>{s.negativeRecords.count}</strong>
            {s.negativeRecords.count > 0 && ` (${formatMoney(s.negativeRecords.totalAmount)})`}
          </li>
          <li>
            Protestos: <strong>{s.protests.count}</strong>
            {s.protests.count > 0 && ` (${formatMoney(s.protests.totalAmount)})`}
          </li>
          <li>
            Cheques sem fundo: <strong>{s.bouncedChecks}</strong>
          </li>
          {s.alerts.map((a) => (
            <li key={a} className="text-warning-700 sm:col-span-3">
              {a}
            </li>
          ))}
        </ul>
      )}
      {belowSuggested && <p className="text-xs text-warning-700">Score abaixo do mínimo sugerido ({query.suggestedMinScore}). A decisão é da equipe.</p>}
      <p className="text-xs text-fg-muted">
        Consultado em {formatDateTime(query.createdAt)} por {query.queriedBy ?? '—'} · autorização de {formatDate(query.consent.givenAt)} ({consentMethodLabel[query.consent.method]})
        {query.externalId && ` · protocolo ${query.externalId}`}
        {query.decidedAt && ` · decisão de ${query.decidedBy ?? '—'} em ${formatDateTime(query.decidedAt)}`}
      </p>
      {query.decisionNote && <p className="text-xs">Observação: {query.decisionNote}</p>}
      {canQuery && (
        <div className="space-y-2">
          {decide.error && <Alert>{errorText(decide.error, 'Erro ao registrar a decisão')}</Alert>}
          <Input aria-label="Observação da decisão" placeholder="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant={query.decision === 'approved' ? 'primary' : 'secondary'} loading={decide.isPending && decide.variables === 'approved'} onClick={() => decide.mutate('approved')}>
              Seguir com a venda
            </Button>
            <Button size="sm" variant={query.decision === 'rejected' ? 'primary' : 'secondary'} loading={decide.isPending && decide.variables === 'rejected'} onClick={() => decide.mutate('rejected')}>
              Reprovar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
