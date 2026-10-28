import { CreditCheckPanel } from '@all/credit-bureau/web';
import { api, ApiError, CustomerSearch, formatMoney, parseMoney, useSession, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { assetTypeLabel, assetTypes, type LeadDetail, type Plan, type Quota } from '../../contracts';
import { key, pct, useTeam } from '../common';
import { leadsKey } from './common';

interface CustomerFull {
  id: string;
  name: string;
  document: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Venda da cota na própria página: plano, cliente, proponente e, com a consulta de crédito
 * contratada, a análise antes de enviar a adesão. Vindo de um lead, a cota fica ligada a ele.
 */
export function SellPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const team = useTeam();
  const [params, setParams] = useSearchParams();
  const leadId = params.get('lead');
  const planId = params.get('plano');
  const customerId = params.get('cliente');
  const lead = useQuery({ queryKey: [...leadsKey, 'detail', leadId], queryFn: () => api<LeadDetail>(`/consortium/leads/${leadId}`), enabled: !!leadId });
  const customer = useQuery({ queryKey: ['customers', customerId], queryFn: () => api<CustomerFull>(`/customers/${customerId}`), enabled: !!customerId });
  const [assetType, setAssetType] = useState('');
  useEffect(() => {
    if (lead.data?.assetType && !assetType) setAssetType(lead.data.assetType);
  }, [lead.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const plans = useQuery({ queryKey: [...key, 'plans', assetType, 'sell'], queryFn: () => api<Plan[]>('/consortium/plans', { query: { assetType: assetType || undefined } }) });
  const plan = plans.data?.find((p) => p.id === planId);
  const [form, setForm] = useState({ document: '', birthDate: '', monthlyIncome: '', dueDay: '10', sellerId: user.id });
  useEffect(() => {
    const c = customer.data;
    if (c) setForm((f) => ({ ...f, document: f.document || (c.document ?? ''), birthDate: f.birthDate || (c.birthDate?.slice(0, 10) ?? '') }));
  }, [customer.data]);
  useEffect(() => {
    if (lead.data?.seller) setForm((f) => ({ ...f, sellerId: lead.data!.seller!.id }));
  }, [lead.data]);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const sell = useMutation({
    mutationFn: () =>
      api<Quota>('/consortium/quotas', {
        method: 'POST',
        body: {
          customerId,
          planId,
          dueDay: Number(form.dueDay),
          sellerId: form.sellerId || null,
          leadId: leadId || null,
          applicant: {
            name: customer.data?.name,
            document: form.document,
            birthDate: form.birthDate || null,
            monthlyIncome: form.monthlyIncome ? parseMoney(form.monthlyIncome) : null,
            email: customer.data?.email ?? null,
            phone: customer.data?.phone ?? null,
          },
        },
      }),
    onSuccess: (q) => {
      queryClient.invalidateQueries({ queryKey: key });
      navigate(`/consorcio/cotas/${q.id}`);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    sell.mutate();
  }

  return (
    <>
      <Link to={leadId ? `/consorcio/leads/${leadId}` : '/consorcio'} className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← {leadId ? 'Voltar ao lead' : 'Simulador'}
      </Link>
      <PageHeader
        title="Vender cota"
        description={lead.data ? `Lead nº ${lead.data.number} · ${lead.data.name}` : 'A adesão vai para a administradora; grupo e número da cota chegam quando ela aceitar.'}
      />
      <div className="space-y-4">
        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">1. Plano</h2>
            {plan && (
              <Button size="sm" variant="ghost" onClick={() => setParam('plano', null)}>
                Trocar plano
              </Button>
            )}
          </div>
          {plan ? (
            <p className="text-sm">
              <strong>{plan.name}</strong> ({plan.institution}) · crédito {formatMoney(plan.creditValue)} em {plan.termMonths}x de {formatMoney(plan.installment)} · taxa adm. {pct(plan.adminFeePercent)}
            </p>
          ) : (
            <>
              <Select aria-label="Tipo de bem" className="max-w-48" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
                <option value="">Todos os bens</option>
                {assetTypes.map((t) => (
                  <option key={t} value={t}>
                    {assetTypeLabel[t]}
                  </option>
                ))}
              </Select>
              {plans.isPending ? (
                <Spinner />
              ) : plans.isError ? (
                <Alert>{plans.error.message}</Alert>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Plano</Th>
                      <Th className="text-right">Crédito</Th>
                      <Th className="text-right">Prazo</Th>
                      <Th className="text-right">Parcela</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {plans.data.map((p) => (
                      <tr key={p.id}>
                        <Td>
                          {p.name}
                          <div className="text-xs text-fg-muted">{p.institution}</div>
                        </Td>
                        <Td className="text-right tabular-nums">{formatMoney(p.creditValue)}</Td>
                        <Td className="text-right tabular-nums">{p.termMonths}x</Td>
                        <Td className="text-right tabular-nums">{formatMoney(p.installment)}</Td>
                        <Td className="text-right">
                          <Button size="sm" variant="secondary" onClick={() => setParam('plano', p.id)}>
                            Escolher
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {lead.data?.creditValue && <p className="text-xs text-fg-muted">O lead procura {formatMoney(lead.data.creditValue)}{lead.data.termMonths ? ` em ${lead.data.termMonths} meses` : ''}.</p>}
            </>
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">2. Cliente</h2>
            {customerId && !leadId && (
              <Button size="sm" variant="ghost" onClick={() => setParam('cliente', null)}>
                Trocar cliente
              </Button>
            )}
          </div>
          {customerId ? (
            customer.isPending ? (
              <Spinner />
            ) : customer.isError ? (
              <Alert>{customer.error.message}</Alert>
            ) : (
              <p className="text-sm">
                <Link to={`/clientes/${customer.data.id}`} className="text-brand-700 hover:underline">
                  {customer.data.name}
                </Link>
                {customer.data.phone && ` · ${customer.data.phone}`}
              </p>
            )
          ) : (
            <CustomerSearch autoFocus={false} onSelect={(c: CustomerOption) => setParam('cliente', c.id)} />
          )}
        </Card>

        {customerId && customer.data && (
          <CreditCheckPanel
            defaults={{
              document: form.document,
              subjectName: customer.data.name,
              customerId: customer.data.id,
              sourceType: leadId ? 'consortium_lead' : 'consortium_customer',
              sourceId: leadId ?? customer.data.id,
              purpose: 'consortium_sale',
            }}
            title="3. Consulta de crédito"
          />
        )}

        {plan && customerId && (
          <Card className="p-5">
            <form onSubmit={submit} className="space-y-4">
              <h2 className="font-medium">Proponente e adesão</h2>
              {sell.error && <Alert>{sell.error instanceof ApiError ? sell.error.message : 'Erro ao enviar'}</Alert>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="CPF ou CNPJ">{(id) => <Input id={id} required value={form.document} onChange={(e) => set({ document: e.target.value })} />}</Field>
                <Field label="Nascimento">{(id) => <Input id={id} type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />}</Field>
                <Field label="Renda mensal (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.monthlyIncome} onChange={(e) => set({ monthlyIncome: e.target.value })} />}</Field>
                <Field label="Dia de vencimento">{(id) => <Input id={id} type="number" min={1} max={28} value={form.dueDay} onChange={(e) => set({ dueDay: e.target.value })} />}</Field>
                <Field label="Vendedor">
                  {(id) => (
                    <Select id={id} value={form.sellerId} onChange={(e) => set({ sellerId: e.target.value })}>
                      {team.data?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <p className="text-xs text-fg-muted">
                Se a empresa exigir a consulta de crédito aprovada (configurações da captação), a adesão só é enviada depois dela. Instituição manual: a adesão fica registrada para a equipe enviar
                pelo portal e registrar a resposta.
              </p>
              <Button type="submit" loading={sell.isPending}>
                Enviar adesão
              </Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
