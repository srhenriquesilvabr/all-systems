import { api, ApiError, formatDateTime, formatMoney, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { bureauProviderLabel, bureauProviders, bureauRequirements, consentMethodLabel, decisionLabel, maskDocument, queryPurposeLabel, riskBandLabel, type BureauProvider, type CreditQuery } from '../contracts';
import { bureauKey, CreditQueryForm, CreditResult, decisionTone, riskTone, useBureauStatus } from './CreditCheckPanel';

/** Histórico de consultas, com o uso do mês e uma consulta avulsa na própria página. */
export function QueriesPage() {
  const navigate = useNavigate();
  const canQuery = useCan('integration.credit_bureau.query');
  const status = useBureauStatus();
  const [document, setDocument] = useState('');
  const [asking, setAsking] = useState(false);
  const list = useQuery({
    queryKey: [...bureauKey, 'queries', { document }],
    queryFn: () => api<CreditQuery[]>('/credit-bureau/queries', { query: { document: document.replace(/[^0-9a-z]/gi, '').length >= 11 ? document : undefined } }),
  });
  return (
    <>
      <PageHeader
        title="Consultas de crédito"
        description="Score e resumo de pendências de CPF/CNPJ, sempre com a autorização do cliente registrada. Cada consulta tem custo e fica na auditoria."
        actions={canQuery && !asking && <Button onClick={() => setAsking(true)}>Nova consulta</Button>}
      />
      {status.data && (
        <Card className="mb-4 flex flex-wrap gap-6 p-4 text-sm">
          <div>
            <div className="text-xs text-fg-muted">Birô</div>
            <div className="font-medium">{status.data.providerName}</div>
          </div>
          <div>
            <div className="text-xs text-fg-muted">Consultas no mês</div>
            <div className="font-medium tabular-nums">
              {status.data.month.count}
              {status.data.monthlyLimit ? ` de ${status.data.monthlyLimit}` : ''}
            </div>
          </div>
          <div>
            <div className="text-xs text-fg-muted">Custo no mês</div>
            <div className="font-medium tabular-nums">{formatMoney(status.data.month.cost)}</div>
          </div>
          {status.data.simulated && <Badge tone="warning">Modo simulado: resultados de demonstração</Badge>}
        </Card>
      )}
      {asking && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 font-medium">Nova consulta</h2>
          <CreditQueryForm defaults={{ purpose: 'credit_analysis' }} onDone={(q) => navigate(`/credito/consultas/${q.id}`)} onCancel={() => setAsking(false)} />
        </Card>
      )}
      <div className="mb-4">
        <Input aria-label="Buscar por documento" placeholder="Buscar por CPF/CNPJ" className="max-w-64" value={document} onChange={(e) => setDocument(e.target.value)} />
      </div>
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma consulta" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quando</Th>
                <Th>Titular</Th>
                <Th>Finalidade</Th>
                <Th className="text-right">Score</Th>
                <Th>Decisão</Th>
                <Th>Por</Th>
                <Th className="text-right">Custo</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((q) => (
                <tr key={q.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/credito/consultas/${q.id}`)}>
                  <Td className="whitespace-nowrap text-sm">{formatDateTime(q.createdAt)}</Td>
                  <Td>
                    {q.subjectName}
                    <div className="text-xs text-fg-muted">{maskDocument(q.document)}</div>
                  </Td>
                  <Td className="text-sm">{queryPurposeLabel[q.consent.purpose]}</Td>
                  <Td className="text-right tabular-nums">
                    {q.status === 'error' ? <Badge tone="danger">Erro</Badge> : q.score}
                    {q.riskBand && (
                      <div>
                        <Badge tone={riskTone[q.riskBand]}>{riskBandLabel[q.riskBand]}</Badge>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={decisionTone[q.decision]}>{decisionLabel[q.decision]}</Badge>
                    {q.simulated && <div className="text-xs text-fg-muted">simulada</div>}
                  </Td>
                  <Td className="text-sm">{q.queriedBy ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(q.cost)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/** Detalhe: resultado, decisão e a autorização do cliente (texto exato). Abrir fica na auditoria. */
export function QueryPage() {
  const { id = '' } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: [...bureauKey, 'query', id], queryFn: () => api<CreditQuery>(`/credit-bureau/queries/${id}`) });
  if (query.isPending) return <Spinner />;
  if (query.isError) return <Alert>{query.error.message}</Alert>;
  const q = query.data;
  return (
    <>
      <Link to="/credito/consultas" className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← Consultas de crédito
      </Link>
      <PageHeader title={q.subjectName} description={`${maskDocument(q.document)} · ${bureauProviderLabel[q.provider]} · ${queryPurposeLabel[q.consent.purpose]}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-5">
          <CreditResult query={q} showSubject={false} />
        </Card>
        <Card className="space-y-2 p-5 text-sm">
          <h2 className="font-medium">Autorização do cliente</h2>
          <p className="text-xs leading-relaxed text-fg-muted">{q.consent.text}</p>
          <p>
            {consentMethodLabel[q.consent.method]} em {q.consent.givenAt.split('-').reverse().join('/')}, registrada por {q.consent.recordedBy ?? '—'} (versão {q.consent.version})
          </p>
          {q.consent.evidence && <p>Prova: {q.consent.evidence}</p>}
          <p className="text-xs text-fg-muted">Custo: {formatMoney(q.cost)}</p>
        </Card>
      </div>
    </>
  );
}

interface Settings {
  provider: BureauProvider;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  costPerQueryPf: number;
  costPerQueryPj: number;
  monthlyLimit: number;
  suggestedMinScore: number;
}
const SETTINGS_KEY = ['modules', 'integration.credit_bureau', 'settings'];

/** Birô, credenciais do contrato, custo por consulta, teto mensal e score sugerido. */
export function BureauSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<Settings>('/modules/integration.credit_bureau/settings') });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api('/modules/integration.credit_bureau/settings', { method: 'PUT', body: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      queryClient.invalidateQueries({ queryKey: bureauKey });
    },
  });
  if (settings.isPending || !form) return settings.isError ? <Alert>{settings.error.message}</Alert> : <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  const real = form.provider !== 'simulated';
  return (
    <>
      <PageHeader title="Consulta de crédito" description="Birô usado nas consultas, credenciais do contrato e custos." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {save.isSuccess && <Alert tone="success">Configurações salvas.</Alert>}
        <Card className="space-y-3 p-5">
          <h2 className="font-medium">Birô</h2>
          {bureauProviders.map((p) => (
            <label key={p} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3 text-sm', form.provider === p ? 'border-brand-600 bg-brand-50/40' : 'border-line')}>
              <input type="radio" name="provider" className="mt-1" checked={form.provider === p} onChange={() => set('provider', p)} />
              <span>
                <span className="block font-medium">{bureauProviderLabel[p]}</span>
                <span className="block text-fg-muted">
                  {p === 'simulated' ? 'Gera score e pendências de demonstração a partir do documento. Não consulta ninguém.' : 'Consulta real, com o contrato e as credenciais da empresa.'}
                </span>
              </span>
            </label>
          ))}
          {real && (
            <Alert tone="info">
              O adaptador de {bureauProviderLabel[form.provider]} ainda é um esqueleto: a consulta responde "a confirmar com o birô" até a documentação do contrato chegar. Para ligar:
              <ul className="mt-1 list-disc pl-5">
                {bureauRequirements[form.provider as Exclude<BureauProvider, 'simulated'>].map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Alert>
          )}
        </Card>
        {real && (
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="URL da API (do contrato)">{(id) => <Input id={id} value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://" />}</Field>
            </div>
            <Field label="Usuário / client ID">{(id) => <Input id={id} value={form.clientId} onChange={(e) => set('clientId', e.target.value)} />}</Field>
            <Field label="Senha / client secret" hint="Guardada cifrada; em branco mantém a atual.">
              {(id) => <Input id={id} type="password" autoComplete="off" value={form.clientSecret} onChange={(e) => set('clientSecret', e.target.value)} />}
            </Field>
          </Card>
        )}
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">Custos e limites</h2>
          <Field label="Custo por consulta de CPF (R$)">{(id) => <Input id={id} inputMode="decimal" value={String(form.costPerQueryPf)} onChange={(e) => set('costPerQueryPf', Number(e.target.value.replace(',', '.')) || 0)} />}</Field>
          <Field label="Custo por consulta de CNPJ (R$)">{(id) => <Input id={id} inputMode="decimal" value={String(form.costPerQueryPj)} onChange={(e) => set('costPerQueryPj', Number(e.target.value.replace(',', '.')) || 0)} />}</Field>
          <Field label="Limite de consultas por mês" hint="0 = sem limite.">
            {(id) => <Input id={id} type="number" min={0} value={form.monthlyLimit} onChange={(e) => set('monthlyLimit', Number(e.target.value) || 0)} />}
          </Field>
          <Field label="Score mínimo sugerido (0 a 1000)" hint="Só orienta a equipe; a decisão é sempre de uma pessoa.">
            {(id) => <Input id={id} type="number" min={0} max={1000} value={form.suggestedMinScore} onChange={(e) => set('suggestedMinScore', Number(e.target.value) || 0)} />}
          </Field>
        </Card>
        <Card className="p-5 text-sm text-fg-muted">
          <Checkbox label="Toda consulta exige a autorização do cliente registrada (finalidade, data, forma e quem consultou)." checked disabled readOnly />
        </Card>
        <Button type="submit" loading={save.isPending}>
          Salvar
        </Button>
      </form>
    </>
  );
}
