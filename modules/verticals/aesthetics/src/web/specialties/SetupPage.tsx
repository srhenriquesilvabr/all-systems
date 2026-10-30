import { api, ApiError, formatDate, SpreadsheetImport, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  councilLabel,
  councils,
  productKindLabel,
  productKinds,
  productUnitLabel,
  productUnits,
  specialtyDescription,
  specialtyKeys,
  specialtyLabel,
  UFS,
  type AesLot,
  type AesProduct,
  type ConsentTemplate,
  type LotTrace,
  type ProfessionalCredential,
  type SpecialtyKey,
} from '../../contracts';
import type { AestheticsSettings } from '../../manifest';
import { specialtiesKey, useAesProducts, useConsentTemplates, useCredentials, useSpecialtyOverview } from './hooks';
import { lotImportSpec } from './lotImport';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function useSave<T>(fn: (body: T) => Promise<unknown>, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: specialtiesKey });
      onDone?.();
    },
  });
}

/** Configurações › Especialidades da clínica: o que está ligado, produtos e lotes, termos e conselhos. */
export function SetupPage() {
  const [tab, setTab] = useState('specialties');
  return (
    <>
      <PageHeader title="Especialidades da clínica" description="Ligue as especialidades e cadastre o que elas usam: produtos com lote, termos de consentimento e o registro dos profissionais." />
      <Tabs
        items={[
          { key: 'specialties', label: 'Especialidades' },
          { key: 'products', label: 'Produtos e lotes' },
          { key: 'templates', label: 'Termos de consentimento' },
          { key: 'credentials', label: 'Registro dos profissionais' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'specialties' && <SpecialtiesSettings />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'credentials' && <CredentialsTab />}
    </>
  );
}

// ---- Especialidades ligadas ----------------------------------------------------------------------

const settingsKey = ['modules', 'aesthetics', 'settings'];

function SpecialtiesSettings() {
  const canSettings = useCan('core.access.settings');
  const overview = useSpecialtyOverview();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => api<AestheticsSettings>('/modules/aesthetics/settings'), enabled: canSettings });
  const [form, setForm] = useState<AestheticsSettings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api('/modules/aesthetics/settings', { method: 'PUT', body: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKey });
      queryClient.invalidateQueries({ queryKey: specialtiesKey });
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
    },
  });

  if (!canSettings) {
    return (
      <Card className="p-4">
        <p className="mb-3 text-sm text-fg-muted">Só quem pode mudar as configurações da empresa liga ou desliga especialidades.</p>
        <ul className="space-y-1 text-sm">
          {specialtyKeys.map((k) => (
            <li key={k}>
              {overview.data?.enabled.includes(k) ? <Badge tone="success">Ligada</Badge> : <Badge>Desligada</Badge>} {specialtyLabel[k]}
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  if (settings.isPending || !form) return <Spinner />;
  if (settings.isError) return <Alert>{settings.error.message}</Alert>;
  const toggle = (k: SpecialtyKey, on: boolean) => setForm({ ...form, specialties: on ? [...form.specialties, k] : form.specialties.filter((x) => x !== k) });
  return (
    <Card className="space-y-4 p-4">
      {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
      {save.isSuccess && <Alert tone="success">Salvo. As especialidades ligadas ganharam os serviços de exemplo e os termos que faltavam.</Alert>}
      <ul className="space-y-3">
        {specialtyKeys.map((k) => (
          <li key={k}>
            <Checkbox
              checked={form.specialties.includes(k)}
              onChange={(e) => toggle(k, e.target.checked)}
              label={
                <>
                  <span className="font-medium">{specialtyLabel[k]}</span>
                  <span className="block text-fg-muted">{specialtyDescription[k]}</span>
                </>
              }
            />
          </li>
        ))}
      </ul>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Retorno dos injetáveis (dias)">
          {(id) => <Input id={id} type="number" min={1} max={180} value={form.harmonizationReturnDays} onChange={(e) => setForm({ ...form, harmonizationReturnDays: Number(e.target.value) })} />}
        </Field>
        <Field label="Retoque da micropigmentação (dias)">
          {(id) => <Input id={id} type="number" min={1} max={180} value={form.micropigmentationRetouchDays} onChange={(e) => setForm({ ...form, micropigmentationRetouchDays: Number(e.target.value) })} />}
        </Field>
      </div>
      <Checkbox
        checked={form.noShowConsumesSession}
        onChange={(e) => setForm({ ...form, noShowConsumesSession: e.target.checked })}
        label={
          <>
            <span className="font-medium">Falta consome sessão do pacote</span>
            <span className="block text-fg-muted">Ligado: quem faltar perde a sessão reservada. Desligado: a sessão volta para o pacote. Vale para as faltas registradas daqui em diante.</span>
          </>
        }
      />
      <p className="text-xs text-fg-muted">Desligar não apaga nada: as fichas continuam no prontuário e os serviços na agenda.</p>
      <div className="flex justify-end">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Salvar
        </Button>
      </div>
    </Card>
  );
}

// ---- Produtos e lotes ----------------------------------------------------------------------------

function ProductsTab() {
  const canSetup = useCan('aesthetics.setup.manage');
  const canTrace = useCan('shared.medical-records.read');
  const products = useAesProducts();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AesProduct | 'new' | null>(null);
  const [lotFor, setLotFor] = useState<{ product: AesProduct | null; lot?: AesLot } | null>(null);
  const [trace, setTrace] = useState<string | null>(null);
  if (products.isPending) return <Spinner />;
  if (products.isError) return <Alert>{products.error.message}</Alert>;
  return (
    <div className="space-y-3">
      {canSetup && (
        <div className="flex flex-wrap justify-end gap-2">
          <SpreadsheetImport spec={lotImportSpec} onImported={() => queryClient.invalidateQueries({ queryKey: specialtiesKey })} />
          <Button variant="secondary" onClick={() => setLotFor({ product: null })}>
            Novo lote
          </Button>
          <Button onClick={() => setEditing('new')}>Novo produto</Button>
        </div>
      )}
      <Card>
        {products.data.length === 0 ? (
          <EmptyState title="Nenhum produto" description="Toxinas, preenchedores, pigmentos, géis e implantes, com lote e validade para o rastreio da Anvisa." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>Tipo</Th>
                <Th>Lotes (validade · usado)</Th>
                <Th>Estoque</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {products.data.map((p) => (
                <tr key={p.id} className={p.active ? undefined : 'opacity-60'}>
                  <Td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-fg-muted">
                      {[p.brand, p.anvisaRegistration && `Anvisa ${p.anvisaRegistration}`].filter(Boolean).join(' · ')}
                    </div>
                  </Td>
                  <Td>
                    {productKindLabel[p.kind]}
                    <div className="text-xs text-fg-muted">{productUnitLabel[p.unit]}</div>
                  </Td>
                  <Td>
                    <ul className="space-y-1">
                      {p.lots.map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-mono">{l.lot}</span>
                          <span className={l.expired ? 'text-danger-600' : 'text-fg-muted'}>{formatDate(l.expiresOn)}</span>
                          {l.expired && <Badge tone="danger">Vencido</Badge>}
                          <span className="tabular-nums text-fg-muted">
                            {String(l.used).replace('.', ',')}
                            {l.quantity != null && ` de ${String(l.quantity).replace('.', ',')}`} {p.unit}
                          </span>
                          {canTrace && (
                            <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setTrace(l.id)}>
                              Quem recebeu
                            </button>
                          )}
                          {canSetup && (
                            <button type="button" className="text-xs text-fg-muted hover:underline" onClick={() => setLotFor({ product: p, lot: l })}>
                              Editar
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td className="text-sm">
                    {p.salesProductName ?? '—'}
                    {p.unitsPerPackage && <div className="text-xs text-fg-muted">{String(p.unitsPerPackage).replace('.', ',')} {p.unit} por embalagem</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    {canSetup && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setLotFor({ product: p })}>
                          + Lote
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          Editar
                        </Button>
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {lotFor && <LotForm products={products.data} product={lotFor.product} lot={lotFor.lot} onClose={() => setLotFor(null)} />}
      {trace && <LotTraceView lotId={trace} onClose={() => setTrace(null)} />}
    </div>
  );
}

function ProductForm({ product, onClose }: { product: AesProduct | null; onClose: () => void }) {
  // Produtos do estoque (vendas): só aparece se o usuário puder ver o cadastro de produtos.
  const stock = useQuery({ queryKey: ['sales', 'products', 'aes-link'], queryFn: () => api<{ id: string; name: string }[]>('/sales/products', { query: { limit: 500 } }), retry: false });
  const [form, setForm] = useState({
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    kind: product?.kind ?? 'toxin',
    unit: product?.unit ?? 'U',
    anvisaRegistration: product?.anvisaRegistration ?? '',
    unitsPerPackage: product?.unitsPerPackage ? String(product.unitsPerPackage) : '',
    salesProductId: product?.salesProductId ?? '',
    active: product?.active ?? true,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useSave(
    () =>
      api(product ? `/aesthetics/products/${product.id}` : '/aesthetics/products', {
        method: product ? 'PATCH' : 'POST',
        body: { ...form, brand: form.brand || null, anvisaRegistration: form.anvisaRegistration || null, unitsPerPackage: form.unitsPerPackage ? Number(form.unitsPerPackage.replace(',', '.')) : null, salesProductId: form.salesProductId || null },
      }),
    onClose,
  );
  return (
    <Modal
      open
      title={product ? `Editar ${product.name}` : 'Novo produto'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">{(id) => <Input id={id} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Toxina botulínica 100 U" />}</Field>
          <Field label="Marca / fabricante">{(id) => <Input id={id} value={form.brand} onChange={(e) => set({ brand: e.target.value })} />}</Field>
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={form.kind} onChange={(e) => set({ kind: e.target.value as typeof form.kind })}>
                {productKinds.map((k) => (
                  <option key={k} value={k}>
                    {productKindLabel[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Unidade de uso">
            {(id) => (
              <Select id={id} value={form.unit} onChange={(e) => set({ unit: e.target.value as typeof form.unit })}>
                {productUnits.map((u) => (
                  <option key={u} value={u}>
                    {productUnitLabel[u]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Registro na Anvisa">{(id) => <Input id={id} value={form.anvisaRegistration} onChange={(e) => set({ anvisaRegistration: e.target.value })} />}</Field>
          <Field label="Quantidade por embalagem" hint="Ex.: 100 U por frasco; usado para dar baixa no estoque">
            {(id) => <Input id={id} inputMode="decimal" value={form.unitsPerPackage} onChange={(e) => set({ unitsPerPackage: e.target.value })} />}
          </Field>
          {stock.isSuccess && (
            <Field label="Baixa no estoque (produto do PDV)" hint="Cada uso em paciente dá baixa proporcional neste produto">
              {(id) => (
                <Select id={id} value={form.salesProductId} onChange={(e) => set({ salesProductId: e.target.value })}>
                  <option value="">Não dar baixa</option>
                  {stock.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Checkbox label="Ativo (aparece ao registrar)" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
      </div>
    </Modal>
  );
}

function LotForm({ products, product, lot, onClose }: { products: AesProduct[]; product: AesProduct | null; lot?: AesLot; onClose: () => void }) {
  const [form, setForm] = useState({
    productId: product?.id ?? '',
    lot: lot?.lot ?? '',
    expiresOn: lot?.expiresOn ?? '',
    receivedOn: lot?.receivedOn ?? '',
    quantity: lot?.quantity != null ? String(lot.quantity) : '',
    notes: lot?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const body = { ...form, receivedOn: form.receivedOn || null, quantity: form.quantity ? Number(form.quantity.replace(',', '.')) : null, notes: form.notes || null };
  const save = useSave(() => (lot ? api(`/aesthetics/lots/${lot.id}`, { method: 'PATCH', body }) : api('/aesthetics/lots', { method: 'POST', body })), onClose);
  return (
    <Modal
      open
      title={lot ? `Lote ${lot.lot}` : 'Novo lote'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!form.productId || !form.lot.trim() || !form.expiresOn} onClick={() => save.mutate(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
        {lot && lot.used > 0 && <Alert tone="info">Este lote já foi usado em pacientes: número e validade não mudam mais.</Alert>}
        <Field label="Produto">
          {(id) => (
            <Select id={id} disabled={!!lot} value={form.productId} onChange={(e) => set({ productId: e.target.value })}>
              <option value="">Escolha</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lote">{(id) => <Input id={id} value={form.lot} onChange={(e) => set({ lot: e.target.value })} />}</Field>
          <Field label="Validade">{(id) => <Input id={id} type="date" value={form.expiresOn} onChange={(e) => set({ expiresOn: e.target.value })} />}</Field>
          <Field label="Recebido em">{(id) => <Input id={id} type="date" value={form.receivedOn} onChange={(e) => set({ receivedOn: e.target.value })} />}</Field>
          <Field label="Quantidade recebida (na unidade do produto)">{(id) => <Input id={id} inputMode="decimal" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />}</Field>
        </div>
        <Field label="Observações">{(id) => <Input id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

/** Rastreio do lote: quem recebeu (para um recall). Cada paciente listado entra no log de acesso. */
function LotTraceView({ lotId, onClose }: { lotId: string; onClose: () => void }) {
  const trace = useQuery({ queryKey: [...specialtiesKey, 'trace', lotId], queryFn: () => api<LotTrace>(`/aesthetics/lots/${lotId}/trace`), staleTime: 0 });
  return (
    <Modal open title="Quem recebeu este lote" onClose={onClose}>
      {trace.isPending ? (
        <Spinner />
      ) : trace.isError ? (
        <Alert>{trace.error.message}</Alert>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">{trace.data.product.name}</span>
            {trace.data.product.brand && ` (${trace.data.product.brand})`} · lote <span className="font-mono">{trace.data.lot.lot}</span> · validade {formatDate(trace.data.lot.expiresOn)}
            {trace.data.product.anvisaRegistration && ` · Anvisa ${trace.data.product.anvisaRegistration}`}
          </p>
          {trace.data.usages.length === 0 ? (
            <p className="text-sm text-fg-muted">Nenhum paciente recebeu este lote.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Paciente</Th>
                  <Th>Especialidade</Th>
                  <Th className="text-right">Quantidade</Th>
                </tr>
              </thead>
              <tbody>
                {trace.data.usages.map((u) => (
                  <tr key={u.id}>
                    <Td className="tabular-nums">{formatDate(u.usedOn)}</Td>
                    <Td>{u.customer.name}</Td>
                    <Td>{specialtyLabel[u.specialty]}</Td>
                    <Td className="text-right tabular-nums">
                      {u.reversalOf && <Badge>Estorno</Badge>} {String(u.amount).replace('.', ',')} {u.unit}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="text-xs text-fg-muted">Esta consulta ficou registrada no log de acesso do prontuário de cada paciente listado.</p>
        </div>
      )}
    </Modal>
  );
}

// ---- Termos --------------------------------------------------------------------------------------

function TemplatesTab() {
  const canSetup = useCan('aesthetics.setup.manage');
  const templates = useConsentTemplates();
  const [editing, setEditing] = useState<ConsentTemplate | 'new' | null>(null);
  if (templates.isPending) return <Spinner />;
  if (templates.isError) return <Alert>{templates.error.message}</Alert>;
  return (
    <div className="space-y-3">
      {canSetup && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}>Novo modelo</Button>
        </div>
      )}
      <Card>
        {templates.data.length === 0 ? (
          <EmptyState title="Nenhum modelo" description="Ao ligar uma especialidade, ela traz modelos de termo que você pode editar." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Termo</Th>
                <Th>Especialidade</Th>
                <Th>Versão</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {templates.data.map((t) => (
                <tr key={t.id} className={t.active ? undefined : 'opacity-60'}>
                  <Td className="font-medium">
                    {t.title}
                    {!t.active && <Badge>Inativo</Badge>}
                  </Td>
                  <Td>{t.specialty ? specialtyLabel[t.specialty] : 'Todas'}</Td>
                  <Td className="tabular-nums">v{t.version}</Td>
                  <Td className="text-right">
                    {canSetup && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                        Editar
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <TemplateForm template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateForm({ template, onClose }: { template: ConsentTemplate | null; onClose: () => void }) {
  const [form, setForm] = useState({ title: template?.title ?? '', specialty: template?.specialty ?? '', body: template?.body ?? '', active: template?.active ?? true });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useSave(
    () => api(template ? `/aesthetics/consent-templates/${template.id}` : '/aesthetics/consent-templates', { method: template ? 'PATCH' : 'POST', body: { ...form, specialty: form.specialty || null } }),
    onClose,
  );
  return (
    <Modal
      open
      title={template ? `Editar: ${template.title}` : 'Novo modelo de termo'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao salvar')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título">{(id) => <Input id={id} value={form.title} onChange={(e) => set({ title: e.target.value })} />}</Field>
          <Field label="Especialidade">
            {(id) => (
              <Select id={id} value={form.specialty} onChange={(e) => set({ specialty: e.target.value as SpecialtyKey | '' })}>
                <option value="">Todas</option>
                {specialtyKeys.map((k) => (
                  <option key={k} value={k}>
                    {specialtyLabel[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Texto" hint="Use {{paciente}}, {{procedimento}}, {{profissional}} e {{data}}: são preenchidos no aceite. Editar o texto cria uma nova versão; os aceites antigos guardam o texto da versão deles.">
          {(id) => <Textarea id={id} rows={14} value={form.body} onChange={(e) => set({ body: e.target.value })} />}
        </Field>
        <Checkbox label="Ativo" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
      </div>
    </Modal>
  );
}

// ---- Registro dos profissionais ------------------------------------------------------------------

function CredentialsTab() {
  const canSetup = useCan('aesthetics.setup.manage');
  const list = useCredentials();
  const [editing, setEditing] = useState<ProfessionalCredential | null>(null);
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">Clareamento exige CRO; cirurgia plástica, CRM (e RQE do cirurgião); injetáveis, registro em conselho de saúde. Os profissionais vêm da agenda.</p>
      <Card>
        {list.data.length === 0 ? (
          <EmptyState title="Nenhum profissional" description="Cadastre os profissionais em Agenda › Profissionais e horários." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Profissional</Th>
                <Th>Registro</Th>
                <Th>Especialidade</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.resourceId} className={p.active ? undefined : 'opacity-60'}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td>{p.credential?.label ?? <span className="text-fg-muted">—</span>}</Td>
                  <Td>{p.credential?.specialty ?? '—'}</Td>
                  <Td className="text-right">
                    {canSetup && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                        {p.credential ? 'Editar' : 'Informar registro'}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <CredentialForm item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CredentialForm({ item, onClose }: { item: ProfessionalCredential; onClose: () => void }) {
  const c = item.credential;
  const [form, setForm] = useState({ council: c?.council ?? 'CRM', number: c?.number ?? '', uf: c?.uf ?? 'SP', rqe: c?.rqe ?? '', specialty: c?.specialty ?? '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useSave(() => api(`/aesthetics/credentials/${item.resourceId}`, { method: 'PUT', body: { ...form, rqe: form.rqe || null, specialty: form.specialty || null } }), onClose);
  const remove = useSave(() => api(`/aesthetics/credentials/${item.resourceId}`, { method: 'DELETE' }), onClose);
  return (
    <Modal
      open
      title={`Registro: ${item.name}`}
      onClose={onClose}
      footer={
        <>
          {c && (
            <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
              Remover registro
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={form.number.trim().length < 2} onClick={() => save.mutate(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(save.error || remove.error) && <Alert>{errorText(save.error ?? remove.error, 'Erro ao salvar')}</Alert>}
        {!item.teamMemberId && <Alert tone="info">Este profissional ainda não está ligado a uma pessoa da equipe: edite-o na agenda antes.</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Conselho">
            {(id) => (
              <Select id={id} value={form.council} onChange={(e) => set({ council: e.target.value as typeof form.council })}>
                {councils.map((k) => (
                  <option key={k} value={k}>
                    {councilLabel[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Número">{(id) => <Input id={id} value={form.number} onChange={(e) => set({ number: e.target.value })} />}</Field>
          <Field label="UF">
            {(id) => (
              <Select id={id} value={form.uf} onChange={(e) => set({ uf: e.target.value as typeof form.uf })}>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="RQE (especialista)">{(id) => <Input id={id} value={form.rqe} onChange={(e) => set({ rqe: e.target.value })} />}</Field>
          <div className="sm:col-span-2">
            <Field label="Especialidade">{(id) => <Input id={id} value={form.specialty} placeholder="Ex.: Cirurgia plástica, Dermatologia" onChange={(e) => set({ specialty: e.target.value })} />}</Field>
          </div>
        </div>
      </div>
    </Modal>
  );
}
