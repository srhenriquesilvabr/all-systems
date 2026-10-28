import { api, ApiError, formatMoney } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, cn } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  administratorKindLabel,
  administratorKinds,
  catalogByKey,
  connectionModeLabel,
  consortiumLineLabel,
  creditProductLabel,
  creditProducts,
  integrationChannelLabel,
  MANUAL_MODE_TEXT,
  type AdministratorKind,
  type BankConnection,
  type CatalogAdministrator,
  type ConnectionAdapter,
  type ConnectionMode,
  type CreditProduct,
  type ManualPlanInput,
} from '../contracts';

export const bankingKey = ['banking'] as const;
const BASE = '/configuracoes/bancos';

type CatalogEntry = CatalogAdministrator & { vendorAdapter: 'implemented' | 'pending'; vendorNotes: string[] };
interface CatalogResponse {
  administrators: CatalogEntry[];
  vendorPendingItems: string[];
}

function useCatalog() {
  return useQuery({ queryKey: [...bankingKey, 'catalog'], queryFn: () => api<CatalogResponse>('/banking/catalog'), staleTime: 10 * 60_000 });
}
const useConnections = () => useQuery({ queryKey: [...bankingKey, 'connections'], queryFn: () => api<BankConnection[]>('/banking/connections') });

const modeTone: Record<ConnectionMode, 'neutral' | 'success' | 'warning'> = { simulated: 'neutral', api: 'success', manual: 'warning' };

/** Instituições parceiras: simuladas (demonstração), pela API ou manuais (sem API). */
export function ConnectionsPage() {
  const navigate = useNavigate();
  const list = useConnections();
  return (
    <>
      <PageHeader
        title="Bancos e administradoras"
        description="Instituições usadas na simulação, no envio de propostas e na adesão de consórcio. Cada integração real depende de contrato com a instituição."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(`${BASE}/catalogo`)}>
              Catálogo de administradoras
            </Button>
            <Button onClick={() => navigate(`${BASE}/nova`)}>Nova conexão</Button>
          </>
        }
      />
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma instituição" description="Escolha uma administradora do catálogo para começar." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Instituição</Th>
                <Th>Produtos</Th>
                <Th>Conexão</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className={c.active ? 'font-medium' : 'text-fg-subtle'}>{c.name}</span> {!c.active && <Badge>Inativa</Badge>}
                    {c.catalogKey && <div className="text-xs text-fg-muted">{catalogByKey(c.catalogKey)?.name ?? c.catalogKey} · catálogo</div>}
                  </Td>
                  <Td className="text-sm">{c.products.map((p) => creditProductLabel[p]).join(', ')}</Td>
                  <Td>
                    <Badge tone={modeTone[c.mode]}>{connectionModeLabel[c.mode]}</Badge>
                    {c.mode === 'api' && <div className="text-xs text-fg-muted">{c.adapter === 'vendor' ? 'Adaptador da administradora' : 'REST genérico'}</div>}
                  </Td>
                  <Td className="text-right">
                    <Link to={`${BASE}/${c.id}`} className="text-sm text-brand-700 hover:underline">
                      Editar
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/** Catálogo de referência: o que cada administradora oferece, o canal conhecido e o que é preciso para ligar. */
export function CatalogPage() {
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [kind, setKind] = useState<AdministratorKind | ''>('');
  return (
    <>
      <PageHeader
        title="Catálogo de administradoras"
        description="Referência para escolher e preparar as integrações. Oferta, canal e exigências mudam: confirme sempre com a administradora antes de assinar."
        actions={
          <Button variant="secondary" onClick={() => navigate(BASE)}>
            Voltar às conexões
          </Button>
        }
      />
      <Alert tone="info">
        Nenhuma administradora publica API aberta: a integração real só existe com contrato de parceria (representante, correspondente ou integrador credenciado) e com as credenciais da
        própria corretora. Sem API, use o modo <strong>manual</strong>: a equipe registra a proposta e a resposta, e o acompanhamento funciona igual.
      </Alert>
      <div className="my-4">
        <Select aria-label="Tipo" className="max-w-64" value={kind} onChange={(e) => setKind(e.target.value as AdministratorKind | '')}>
          <option value="">Todos os tipos</option>
          {administratorKinds.map((k) => (
            <option key={k} value={k}>
              {administratorKindLabel[k]}
            </option>
          ))}
        </Select>
      </div>
      {catalog.isPending ? (
        <Spinner />
      ) : catalog.isError ? (
        <Alert>{catalog.error.message}</Alert>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {catalog.data.administrators
              .filter((a) => !kind || a.kind === kind)
              .map((a) => (
                <Card key={a.key} className="space-y-3 p-5">
                  <CatalogDetails entry={a} />
                  <Link to={`${BASE}/nova?catalogo=${a.key}`} className="inline-block text-sm text-brand-700 hover:underline">
                    Conectar esta administradora
                  </Link>
                </Card>
              ))}
          </div>
          <Card className="mt-6 p-5 text-sm">
            <h2 className="mb-2 font-medium">Para escrever o adaptador de uma administradora (modo API)</h2>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              {catalog.data.vendorPendingItems.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function CatalogDetails({ entry }: { entry: CatalogEntry }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{entry.name}</span>
        <Badge>{administratorKindLabel[entry.kind]}</Badge>
        {!entry.confirmed && <Badge tone="warning">A confirmar</Badge>}
      </div>
      <div>
        <span className="text-fg-muted">Consórcio: </span>
        {entry.lines.map((l) => consortiumLineLabel[l]).join(', ')}
        {entry.creditProducts.some((p) => p !== 'consortium') && <span className="text-fg-muted"> · também financiamento</span>}
      </div>
      <div>
        <span className="text-fg-muted">Canal mais comum: </span>
        {entry.channels.map((c) => integrationChannelLabel[c]).join(' · ')}
      </div>
      <div>
        <span className="text-fg-muted">Adaptador próprio (API): </span>
        {entry.vendorAdapter === 'implemented' ? 'implementado' : 'esqueleto — aguardando documentação do contrato'}
      </div>
      <div>
        <div className="text-fg-muted">Para ligar:</div>
        <ul className="list-disc space-y-0.5 pl-5">
          {entry.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {entry.vendorNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      {entry.notes && <p className="text-xs text-fg-muted">{entry.notes}</p>}
    </div>
  );
}

const emptyPlan = (): PlanDraft => ({ name: '', assetType: 'vehicle', creditValue: '', termMonths: '', adminFeePercent: '', reserveFundPercent: '', insurancePercent: '' });
type PlanDraft = { externalId?: string | null; name: string; assetType: ManualPlanInput['assetType']; creditValue: string; termMonths: string; adminFeePercent: string; reserveFundPercent: string; insurancePercent: string };
const num = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'));
const dec = (v: string) => Number(v.replace(',', '.'));
const toDraft = (p: ManualPlanInput): PlanDraft => ({
  externalId: p.externalId ?? null,
  name: p.name,
  assetType: p.assetType,
  creditValue: String(p.creditValue),
  termMonths: String(p.termMonths),
  adminFeePercent: String(p.adminFeePercent).replace('.', ','),
  reserveFundPercent: String(p.reserveFundPercent ?? 0).replace('.', ','),
  insurancePercent: String(p.insurancePercent ?? 0).replace('.', ','),
});

/** Nova conexão (escolhendo a administradora do catálogo) ou edição, na própria página. */
export function ConnectionFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const connections = useConnections();
  const catalog = useCatalog();
  const editing = id ? connections.data?.find((c) => c.id === id) : undefined;
  const [params] = useSearchParams();
  const preset = params.get('catalogo');
  const [catalogKey, setCatalogKey] = useState<string | null | undefined>(id ? undefined : preset ?? undefined);

  if (id && connections.isPending) return <Spinner />;
  if (id && !editing) return <Alert>Instituição não encontrada.</Alert>;
  // Nova conexão: primeiro escolhe a administradora (ou "outra instituição").
  if (!id && catalogKey === undefined) {
    return (
      <>
        <PageHeader title="Nova conexão" description="Escolha a administradora ou o banco. O catálogo traz o que cada um oferece e o que é preciso para ligar." />
        {catalog.isPending ? (
          <Spinner />
        ) : catalog.isError ? (
          <Alert>{catalog.error.message}</Alert>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.data.administrators.map((a) => (
              <button key={a.key} type="button" onClick={() => setCatalogKey(a.key)} className="rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-brand-600">
                <span className="block font-medium">{a.name}</span>
                <span className="block text-xs text-fg-muted">
                  {administratorKindLabel[a.kind]} · {a.lines.map((l) => consortiumLineLabel[l]).join(', ')}
                </span>
              </button>
            ))}
            <button type="button" onClick={() => setCatalogKey(null)} className="rounded-2xl border border-dashed border-line p-4 text-left transition hover:border-brand-600">
              <span className="block font-medium">Outra instituição</span>
              <span className="block text-xs text-fg-muted">Banco, financeira ou administradora fora do catálogo</span>
            </button>
          </div>
        )}
        <div className="mt-4">
          <Button variant="secondary" onClick={() => navigate(BASE)}>
            Cancelar
          </Button>
        </div>
      </>
    );
  }
  const key = editing ? editing.catalogKey : (catalogKey ?? null);
  const entry = catalog.data?.administrators.find((a) => a.key === key);
  return (
    <ConnectionForm
      key={editing?.id ?? key ?? 'other'}
      connection={editing ?? null}
      catalogKey={key}
      entry={entry}
      onBack={() => (editing ? navigate(BASE) : setCatalogKey(undefined))}
      onSaved={() => navigate(BASE)}
    />
  );
}

function ConnectionForm({
  connection,
  catalogKey,
  entry,
  onBack,
  onSaved,
}: {
  connection: BankConnection | null;
  catalogKey: string | null;
  entry?: CatalogEntry;
  onBack: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: connection?.name ?? entry?.name ?? '',
    mode: (connection?.mode ?? 'simulated') as ConnectionMode,
    adapter: (connection?.adapter ?? 'generic_rest') as ConnectionAdapter,
    products: connection?.products ?? (entry ? entry.creditProducts.filter((p) => p === 'consortium') : (['vehicle_financing'] as CreditProduct[])),
    baseUrl: connection?.baseUrl ?? '',
    clientId: connection?.clientId ?? '',
    clientSecret: '',
    webhookSecret: '',
    vehicleMonthlyRate: String(connection?.vehicleMonthlyRate ?? 1.99).replace('.', ','),
    realEstateYearlyRate: String(connection?.realEstateYearlyRate ?? 11.5).replace('.', ','),
    tacFee: String(connection?.tacFee ?? 0).replace('.', ','),
    active: connection?.active ?? true,
  });
  const [plans, setPlans] = useState<PlanDraft[]>(connection?.manualPlans.map(toDraft) ?? []);
  // O catálogo chega depois: completa nome e produtos de uma conexão nova.
  useEffect(() => {
    if (!connection && entry && !form.name) setForm((f) => ({ ...f, name: entry.name, products: entry.creditProducts.filter((p) => p === 'consortium') }));
  }, [entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api(connection ? `/banking/connections/${connection.id}` : '/banking/connections', {
        method: connection ? 'PATCH' : 'POST',
        body: {
          ...form,
          catalogKey,
          baseUrl: form.baseUrl || null,
          clientId: form.clientId || null,
          clientSecret: form.clientSecret || null,
          webhookSecret: form.webhookSecret || null,
          vehicleMonthlyRate: dec(form.vehicleMonthlyRate),
          realEstateYearlyRate: dec(form.realEstateYearlyRate),
          tacFee: dec(form.tacFee),
          manualPlans:
            form.mode === 'manual'
              ? plans.map((p) => ({
                  externalId: p.externalId ?? null,
                  name: p.name,
                  assetType: p.assetType,
                  creditValue: num(p.creditValue),
                  termMonths: Number(p.termMonths),
                  adminFeePercent: dec(p.adminFeePercent || '0'),
                  reserveFundPercent: dec(p.reserveFundPercent || '0'),
                  insurancePercent: dec(p.insurancePercent || '0'),
                }))
              : [],
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bankingKey });
      onSaved();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  const setPlan = (i: number, patch: Partial<PlanDraft>) => setPlans(plans.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const modes: { key: ConnectionMode; text: string }[] = [
    { key: 'simulated', text: 'Taxas de referência e decisão automática. Para demonstração e treinamento; não fala com a instituição.' },
    { key: 'manual', text: MANUAL_MODE_TEXT },
    { key: 'api', text: 'Integração pela API, com contrato e credenciais da própria corretora: o contrato REST genérico da Palmer ou o adaptador da administradora.' },
  ];

  return (
    <>
      <PageHeader title={connection ? `Editar ${connection.name}` : 'Nova conexão'} description={entry ? `${entry.name} · ${administratorKindLabel[entry.kind]}` : 'Instituição fora do catálogo'} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <form onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          <Card className="space-y-4 p-5">
            <Field label="Nome na tela">{(id) => <Input id={id} required value={form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Produtos</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {creditProducts.map((p) => (
                  <Checkbox
                    key={p}
                    label={creditProductLabel[p]}
                    checked={form.products.includes(p)}
                    onChange={(e) => set({ products: e.target.checked ? [...form.products, p] : form.products.filter((x) => x !== p) })}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium">Modo</legend>
              {modes.map((m) => (
                <label key={m.key} className={cn('flex cursor-pointer gap-3 rounded-xl border p-3 text-sm', form.mode === m.key ? 'border-brand-600 bg-brand-50/40' : 'border-line')}>
                  <input type="radio" name="mode" className="mt-1" checked={form.mode === m.key} onChange={() => set({ mode: m.key })} />
                  <span>
                    <span className="block font-medium">{connectionModeLabel[m.key]}</span>
                    <span className="block text-fg-muted">{m.text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </Card>

          {form.mode === 'api' && (
            <Card className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Adaptador">
                  {(id) => (
                    <Select id={id} value={form.adapter} onChange={(e) => set({ adapter: e.target.value as ConnectionAdapter })}>
                      <option value="generic_rest">REST genérico (contrato publicado pela Palmer, OAuth2 + webhook assinado)</option>
                      <option value="vendor" disabled={!catalogKey}>
                        Adaptador da administradora{entry?.vendorAdapter === 'implemented' ? '' : ' (esqueleto — a confirmar com a administradora)'}
                      </option>
                    </Select>
                  )}
                </Field>
                {form.adapter === 'vendor' && entry?.vendorAdapter !== 'implemented' && (
                  <p className="mt-2 text-xs text-warning-700">
                    O adaptador desta administradora ainda é um esqueleto: as chamadas respondem "a confirmar com a administradora" até chegar a documentação do contrato. Enquanto isso, use o modo
                    manual.
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Field label="URL da API">
                  {(id) => <Input id={id} required={form.adapter === 'generic_rest'} value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.instituicao.com.br" />}
                </Field>
              </div>
              <Field label="Client ID">{(id) => <Input id={id} value={form.clientId} onChange={(e) => set({ clientId: e.target.value })} />}</Field>
              <Field label="Client secret" hint={connection?.hasClientSecret ? 'Em branco mantém o atual.' : 'Guardado cifrado; não volta para a tela.'}>
                {(id) => <Input id={id} type="password" autoComplete="off" value={form.clientSecret} onChange={(e) => set({ clientSecret: e.target.value })} />}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Segredo do webhook" hint={connection ? `A instituição avisa em ${connection.webhookUrl}` : 'O endereço do webhook aparece depois de salvar.'}>
                  {(id) => <Input id={id} type="password" autoComplete="off" value={form.webhookSecret} onChange={(e) => set({ webhookSecret: e.target.value })} />}
                </Field>
              </div>
            </Card>
          )}

          {form.mode !== 'api' && form.products.some((p) => p !== 'consortium') && (
            <Card className="grid gap-4 p-5 sm:grid-cols-3">
              <p className="text-sm text-fg-muted sm:col-span-3">{form.mode === 'manual' ? 'Taxas de referência para a simulação (a taxa que vale é a da resposta da instituição).' : 'Taxas usadas na simulação.'}</p>
              <Field label="Veículo (% a.m.)">{(id) => <Input id={id} inputMode="decimal" value={form.vehicleMonthlyRate} onChange={(e) => set({ vehicleMonthlyRate: e.target.value })} />}</Field>
              <Field label="Imóvel (% a.a.)">{(id) => <Input id={id} inputMode="decimal" value={form.realEstateYearlyRate} onChange={(e) => set({ realEstateYearlyRate: e.target.value })} />}</Field>
              <Field label="Tarifa de cadastro (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.tacFee} onChange={(e) => set({ tacFee: e.target.value })} />}</Field>
            </Card>
          )}

          {form.mode === 'manual' && form.products.includes('consortium') && (
            <Card className="space-y-3 p-5">
              <div>
                <h2 className="font-medium">Planos de consórcio</h2>
                <p className="text-sm text-fg-muted">Sem API, os planos vêm da tabela da administradora. Depois de salvar, use "Atualizar planos" no simulador do consórcio.</p>
              </div>
              {plans.map((p, i) => (
                <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-6">
                  <div className="sm:col-span-2">
                    <Field label="Plano">{(id) => <Input id={id} required value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} placeholder="Auto 80 mil" />}</Field>
                  </div>
                  <Field label="Bem">
                    {(id) => (
                      <Select id={id} value={p.assetType} onChange={(e) => setPlan(i, { assetType: e.target.value as PlanDraft['assetType'] })}>
                        {(['vehicle', 'real_estate', 'heavy', 'services'] as const).map((t) => (
                          <option key={t} value={t}>
                            {consortiumLineLabel[t]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Crédito (R$)">{(id) => <Input id={id} required inputMode="decimal" value={p.creditValue} onChange={(e) => setPlan(i, { creditValue: e.target.value })} />}</Field>
                  <Field label="Prazo (meses)">{(id) => <Input id={id} required type="number" min={1} max={420} value={p.termMonths} onChange={(e) => setPlan(i, { termMonths: e.target.value })} />}</Field>
                  <Field label="Taxa adm. (%)">{(id) => <Input id={id} required inputMode="decimal" value={p.adminFeePercent} onChange={(e) => setPlan(i, { adminFeePercent: e.target.value })} />}</Field>
                  <Field label="Fundo reserva (%)">{(id) => <Input id={id} inputMode="decimal" value={p.reserveFundPercent} onChange={(e) => setPlan(i, { reserveFundPercent: e.target.value })} />}</Field>
                  <Field label="Seguro (% a.m.)">{(id) => <Input id={id} inputMode="decimal" value={p.insurancePercent} onChange={(e) => setPlan(i, { insurancePercent: e.target.value })} />}</Field>
                  <div className="flex items-end text-xs text-fg-muted sm:col-span-3">{p.creditValue && p.termMonths ? `Crédito ${formatMoney(num(p.creditValue))} em ${p.termMonths} meses` : null}</div>
                  <div className="flex items-end justify-end">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPlans(plans.filter((_, j) => j !== i))}>
                      Remover
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" size="sm" variant="secondary" onClick={() => setPlans([...plans, emptyPlan()])}>
                Adicionar plano
              </Button>
            </Card>
          )}

          <Checkbox label="Ativa" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              Salvar
            </Button>
            <Button type="button" variant="secondary" onClick={onBack}>
              {connection ? 'Cancelar' : 'Voltar'}
            </Button>
          </div>
        </form>
        <aside>
          {entry ? (
            <Card className="p-5">
              <CatalogDetails entry={entry} />
            </Card>
          ) : (
            <Card className="p-5 text-sm text-fg-muted">Instituição fora do catálogo: confirme com ela o canal de integração (API, portal ou arquivo) e o contrato necessário antes de usar em produção.</Card>
          )}
        </aside>
      </div>
    </>
  );
}
