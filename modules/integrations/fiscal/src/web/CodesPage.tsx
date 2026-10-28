import { api, SpreadsheetImport, useCan, useSession, type ImportColumn, type ImportRow, type ImportSpec } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { formatCest, formatNbs, formatNcm, ICMS_CSOSN, ICMS_CST, isSimples, productOrigins, type FiscalOverview, type ProductCode, type ServiceCode, type TaxRegime } from '../contracts';
import { AccountantNotice, decimalText, ErrorMessage, fiscalKey, parseDecimal, useOverview } from './shared';

interface ProductItem {
  productId: string;
  name: string;
  unit: string;
  barcode?: string | null;
  sku?: string | null;
  code: ProductCode | null;
}
interface ServiceItem {
  refType: string;
  refId: string;
  name: string;
  code: ServiceCode | null;
}
type Pending = { products: { id: string; name: string; unit: string }[]; services: { refType: string; id: string; name: string }[] };

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/** Cadastro fiscal de produtos (NCM, CFOP, CST/CSOSN…) e serviços (LC 116, código nacional, NBS, ISS). */
export function CodesPage() {
  const [tab, setTab] = useState('products');
  const overview = useOverview();
  return (
    <>
      <PageHeader title="Cadastro fiscal" description="Códigos e alíquotas usados nas notas. Os cadastros de produtos e serviços continuam onde estão; aqui ficam só os dados fiscais." />
      <div className="mb-4">
        <AccountantNotice />
      </div>
      <Tabs
        items={[
          { key: 'products', label: 'Produtos (NFC-e/NF-e)' },
          { key: 'services', label: 'Serviços (NFS-e)' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {overview.isPending ? <Spinner /> : tab === 'products' ? <Products overview={overview.data} /> : <Services />}
    </>
  );
}

function useHasModule(key: string) {
  return useSession().modules.some((m) => m.key === key);
}

function Products({ overview }: { overview?: FiscalOverview }) {
  const queryClient = useQueryClient();
  const hasSales = useHasModule('shared.sales');
  const canProducts = useCan('shared.sales.products');
  const canSell = useCan('shared.sales.sell');
  const canCatalog = hasSales && (canProducts || canSell);
  const codes = useQuery({ queryKey: [...fiscalKey, 'codes', 'products'], queryFn: () => api<ProductCode[]>('/fiscal/codes/products') });
  const pending = useQuery({ queryKey: [...fiscalKey, 'codes', 'pending'], queryFn: () => api<Pending>('/fiscal/codes/pending') });
  const catalog = useQuery({
    queryKey: [...fiscalKey, 'catalog', 'products'],
    queryFn: () => api<{ id: string; name: string; unit: string; barcode: string | null; sku: string | null; active: boolean }[]>('/sales/products', { query: { limit: 500 } }),
    enabled: canCatalog,
  });
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const regime = (overview?.settings.taxRegime as TaxRegime | undefined) ?? 'simples';

  const items = useMemo(() => {
    const map = new Map<string, ProductItem>();
    for (const p of catalog.data ?? []) map.set(p.id, { productId: p.id, name: p.name, unit: p.unit, barcode: p.barcode, sku: p.sku, code: null });
    for (const p of pending.data?.products ?? []) if (!map.has(p.id)) map.set(p.id, { productId: p.id, name: p.name, unit: p.unit, code: null });
    for (const c of codes.data ?? []) map.set(c.productId, { ...(map.get(c.productId) ?? { productId: c.productId, name: c.productName, unit: c.taxUnit }), code: c });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [catalog.data, pending.data, codes.data]);
  const shown = items.filter((i) => (!onlyMissing || !i.code) && (!q || norm(i.name).includes(norm(q))));
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...fiscalKey, 'codes'] });

  return (
    <div className="space-y-3">
      {!canCatalog && <Alert tone="info">Aparecem os produtos já cadastrados aqui e os que saíram em vendas. Com acesso ao cadastro de produtos, a lista mostra todos.</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Buscar">{(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Checkbox className="pb-2" label="Só os sem cadastro fiscal" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        <div className="ml-auto flex gap-2">
          <SpreadsheetImport spec={productImportSpec(items, regime)} onImported={refresh} size="sm" />
        </div>
      </div>
      {editing && <ProductEditor item={editing} regime={regime} onClose={() => setEditing(null)} onSaved={refresh} />}
      <Card>
        {codes.isPending ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <EmptyState title="Nenhum produto" description="Os produtos aparecem aqui depois de cadastrados em Produtos e estoque ou vendidos no caixa." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>NCM</Th>
                <Th>CFOP</Th>
                <Th>{isSimples(regime) ? 'CSOSN' : 'CST'}</Th>
                <Th>Origem</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.productId}>
                  <Td>{i.name}</Td>
                  <Td className="tabular-nums">{i.code ? formatNcm(i.code.ncm) : <Badge tone="warning">Sem cadastro</Badge>}</Td>
                  <Td>{i.code?.cfop ?? '—'}</Td>
                  <Td>{i.code?.icmsSituation ?? '—'}</Td>
                  <Td>{i.code ? i.code.origin : '—'}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                      {i.code ? 'Editar' : 'Cadastrar'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function ProductEditor({ item, regime, onClose, onSaved }: { item: ProductItem; regime: TaxRegime; onClose: () => void; onSaved: () => void }) {
  const c = item.code;
  const [f, setF] = useState({
    ncm: c?.ncm ?? '',
    cfop: c?.cfop ?? '5102',
    cest: c?.cest ?? '',
    origin: String(c?.origin ?? 0),
    icmsSituation: c?.icmsSituation ?? (isSimples(regime) ? '102' : '00'),
    icmsRate: decimalText(c?.icmsRate),
    pisCofinsCst: c?.pisCofinsCst ?? '',
    pisRate: decimalText(c?.pisRate),
    cofinsRate: decimalText(c?.cofinsRate),
    taxUnit: c?.taxUnit ?? item.unit.toUpperCase(),
    ibsCbsCst: c?.ibsCbsCst ?? '',
    classTrib: c?.classTrib ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api('/fiscal/codes/products', {
        method: 'PUT',
        body: { ...f, productId: item.productId, productName: item.name, origin: Number(f.origin), icmsRate: parseDecimal(f.icmsRate), pisRate: parseDecimal(f.pisRate), cofinsRate: parseDecimal(f.cofinsRate) },
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/fiscal/codes/products/${item.productId}`, { method: 'DELETE' }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const situations = isSimples(regime) ? ICMS_CSOSN : ICMS_CST;
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-semibold">{item.name}</h2>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="NCM" hint={f.ncm.replace(/\D/g, '').length === 8 ? formatNcm(f.ncm.replace(/\D/g, '')) : '8 dígitos'}>
          {(id) => <Input id={id} value={f.ncm} onChange={(e) => set({ ncm: e.target.value })} autoFocus />}
        </Field>
        <Field label="CFOP" hint="Venda: 5102 (no estado), 6102 (fora)">{(id) => <Input id={id} value={f.cfop} onChange={(e) => set({ cfop: e.target.value })} />}</Field>
        <Field label="CEST" hint={f.cest.replace(/\D/g, '').length === 7 ? formatCest(f.cest.replace(/\D/g, '')) : 'Se houver substituição tributária'}>
          {(id) => <Input id={id} value={f.cest} onChange={(e) => set({ cest: e.target.value })} />}
        </Field>
        <Field label={isSimples(regime) ? 'CSOSN' : 'CST do ICMS'}>
          {(id) => (
            <Select id={id} value={f.icmsSituation} onChange={(e) => set({ icmsSituation: e.target.value })}>
              {situations.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Alíquota ICMS (%)" hint="Só regime normal">{(id) => <Input id={id} inputMode="decimal" value={f.icmsRate} onChange={(e) => set({ icmsRate: e.target.value })} />}</Field>
        <Field label="Unidade tributável">{(id) => <Input id={id} value={f.taxUnit} onChange={(e) => set({ taxUnit: e.target.value })} />}</Field>
        <div className="sm:col-span-2">
          <Field label="Origem">
            {(id) => (
              <Select id={id} value={f.origin} onChange={(e) => set({ origin: e.target.value })}>
                {productOrigins.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="CST PIS/COFINS">{(id) => <Input id={id} value={f.pisCofinsCst} onChange={(e) => set({ pisCofinsCst: e.target.value })} />}</Field>
        <Field label="PIS (%)">{(id) => <Input id={id} inputMode="decimal" value={f.pisRate} onChange={(e) => set({ pisRate: e.target.value })} />}</Field>
        <Field label="COFINS (%)">{(id) => <Input id={id} inputMode="decimal" value={f.cofinsRate} onChange={(e) => set({ cofinsRate: e.target.value })} />}</Field>
        <Field label="CST IBS/CBS" hint="Vazio = padrão">{(id) => <Input id={id} value={f.ibsCbsCst} onChange={(e) => set({ ibsCbsCst: e.target.value })} />}</Field>
        <Field label="cClassTrib" hint="Vazio = padrão">{(id) => <Input id={id} value={f.classTrib} onChange={(e) => set({ classTrib: e.target.value })} />}</Field>
      </div>
      <ErrorMessage error={save.error ?? remove.error} />
      <div className="flex gap-2">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Salvar
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        {item.code && (
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
            Apagar cadastro fiscal
          </Button>
        )}
      </div>
    </Card>
  );
}

function Services() {
  const queryClient = useQueryClient();
  const hasScheduling = useHasModule('shared.scheduling');
  const canScheduling = useCan('shared.scheduling.read');
  const canCatalog = hasScheduling && canScheduling;
  const codes = useQuery({ queryKey: [...fiscalKey, 'codes', 'services'], queryFn: () => api<ServiceCode[]>('/fiscal/codes/services') });
  const pending = useQuery({ queryKey: [...fiscalKey, 'codes', 'pending'], queryFn: () => api<Pending>('/fiscal/codes/pending') });
  const catalog = useQuery({ queryKey: [...fiscalKey, 'catalog', 'services'], queryFn: () => api<{ id: string; name: string }[]>('/scheduling/services'), enabled: canCatalog });
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ServiceItem | null>(null);

  const items = useMemo(() => {
    const map = new Map<string, ServiceItem>();
    const key = (t: string, id: string) => `${t}:${id}`;
    for (const s of catalog.data ?? []) map.set(key('sch_service', s.id), { refType: 'sch_service', refId: s.id, name: s.name, code: null });
    for (const s of pending.data?.services ?? []) if (!map.has(key(s.refType, s.id))) map.set(key(s.refType, s.id), { refType: s.refType, refId: s.id, name: s.name, code: null });
    for (const c of codes.data ?? []) map.set(key(c.refType, c.refId), { ...(map.get(key(c.refType, c.refId)) ?? { refType: c.refType, refId: c.refId, name: c.serviceName }), code: c });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [catalog.data, pending.data, codes.data]);
  const shown = items.filter((i) => (!onlyMissing || !i.code) && (!q || norm(i.name).includes(norm(q))));
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...fiscalKey, 'codes'] });

  return (
    <div className="space-y-3">
      {!canCatalog && <Alert tone="info">Aparecem os serviços já cadastrados aqui e os que saíram em atendimentos e ordens. Com acesso à agenda, a lista mostra todos os serviços.</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Buscar">{(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Checkbox className="pb-2" label="Só os sem cadastro fiscal" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        <div className="ml-auto flex gap-2">
          <SpreadsheetImport spec={serviceImportSpec(items)} onImported={refresh} size="sm" />
        </div>
      </div>
      {editing && <ServiceEditor item={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      <Card>
        {codes.isPending ? (
          <Spinner />
        ) : shown.length === 0 ? (
          <EmptyState title="Nenhum serviço" description="Os serviços da agenda e os itens de ordens de serviço aparecem aqui." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Serviço</Th>
                <Th>Item LC 116</Th>
                <Th>Cód. nacional</Th>
                <Th>NBS</Th>
                <Th className="text-right">ISS</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={`${i.refType}:${i.refId}`}>
                  <Td>
                    {i.name} {i.refType !== 'sch_service' && <Badge>Ordem de serviço</Badge>}
                  </Td>
                  <Td>{i.code?.lc116 ?? <Badge tone="warning">Sem cadastro</Badge>}</Td>
                  <Td>{i.code?.nationalCode ?? '—'}</Td>
                  <Td>{i.code?.nbs ? formatNbs(i.code.nbs) : '—'}</Td>
                  <Td className="text-right">{i.code ? `${decimalText(i.code.issRate)}%${i.code.issWithheld ? ' (retido)' : ''}` : '—'}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                      {i.code ? 'Editar' : 'Cadastrar'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function ServiceEditor({ item, onClose, onSaved }: { item: ServiceItem; onClose: () => void; onSaved: () => void }) {
  const c = item.code;
  const [f, setF] = useState({
    lc116: c?.lc116 ?? '',
    nationalCode: c?.nationalCode ?? '',
    nbs: c?.nbs ?? '',
    municipalCode: c?.municipalCode ?? '',
    issRate: decimalText(c?.issRate),
    issWithheld: c?.issWithheld ?? false,
    cnae: c?.cnae ?? '',
    ibsCbsCst: c?.ibsCbsCst ?? '',
    classTrib: c?.classTrib ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const save = useMutation({
    mutationFn: () => api('/fiscal/codes/services', { method: 'PUT', body: { ...f, refType: item.refType, refId: item.refId, serviceName: item.name, issRate: parseDecimal(f.issRate) ?? 0 } }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/fiscal/codes/services/${encodeURIComponent(item.refType)}/${encodeURIComponent(item.refId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const rate = parseDecimal(f.issRate);
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-semibold">{item.name}</h2>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Item da LC 116" hint="Ex.: 06.01 (barbearia, cabeleireiro)">{(id) => <Input id={id} value={f.lc116} onChange={(e) => set({ lc116: e.target.value })} autoFocus />}</Field>
        <Field label="Código de tributação nacional" hint="6 dígitos (NFS-e Nacional)">{(id) => <Input id={id} inputMode="numeric" value={f.nationalCode} onChange={(e) => set({ nationalCode: e.target.value })} />}</Field>
        <Field label="NBS" hint={f.nbs.replace(/\D/g, '').length === 9 ? formatNbs(f.nbs.replace(/\D/g, '')) : '9 dígitos'}>{(id) => <Input id={id} value={f.nbs} onChange={(e) => set({ nbs: e.target.value })} />}</Field>
        <Field label="Código municipal" hint="Se o município pedir">{(id) => <Input id={id} value={f.municipalCode} onChange={(e) => set({ municipalCode: e.target.value })} />}</Field>
        <Field label="Alíquota do ISS (%)" hint={rate !== null && (rate < 2 || rate > 5) ? 'Atenção: fora de 2% a 5%' : 'De 2% a 5%'}>
          {(id) => <Input id={id} inputMode="decimal" value={f.issRate} onChange={(e) => set({ issRate: e.target.value })} />}
        </Field>
        <Field label="CNAE do serviço" hint="Se diferente do principal">{(id) => <Input id={id} value={f.cnae} onChange={(e) => set({ cnae: e.target.value })} />}</Field>
        <Field label="CST IBS/CBS" hint="Vazio = padrão">{(id) => <Input id={id} value={f.ibsCbsCst} onChange={(e) => set({ ibsCbsCst: e.target.value })} />}</Field>
        <Field label="cClassTrib" hint="Vazio = padrão">{(id) => <Input id={id} value={f.classTrib} onChange={(e) => set({ classTrib: e.target.value })} />}</Field>
        <div className="flex items-end pb-2">
          <Checkbox label="ISS retido pelo tomador" checked={f.issWithheld} onChange={(e) => set({ issWithheld: e.target.checked })} />
        </div>
      </div>
      <ErrorMessage error={save.error ?? remove.error} />
      <div className="flex gap-2">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Salvar
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        {item.code && (
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
            Apagar cadastro fiscal
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---- Planilhas ----------------------------------------------------------------------------------

const text = (row: ImportRow, k: string) => (row[k] === null || row[k] === undefined ? null : String(row[k]).trim() || null);

function productImportSpec(items: ProductItem[], regime: TaxRegime): ImportSpec {
  const columns: ImportColumn[] = [
    { key: 'product', label: 'Produto', required: true, example: 'Pão francês', hint: 'Nome exato, código de barras ou código interno do produto já cadastrado' },
    { key: 'ncm', label: 'NCM', required: true, example: '1905.90.90', hint: '8 dígitos. Formate a coluna como texto' },
    { key: 'cfop', label: 'CFOP', required: true, example: '5102' },
    { key: 'cest', label: 'CEST', example: '', hint: '7 dígitos, se houver substituição tributária' },
    { key: 'origin', label: 'Origem', type: 'integer', example: 0, hint: '0 a 8 (0 = nacional)' },
    { key: 'icmsSituation', label: isSimples(regime) ? 'CSOSN' : 'CST do ICMS', required: true, example: isSimples(regime) ? '102' : '00' },
    { key: 'icmsRate', label: 'Alíquota ICMS (%)', type: 'number', example: '', hint: 'Só regime normal' },
    { key: 'pisCofinsCst', label: 'CST PIS/COFINS', example: '' },
    { key: 'taxUnit', label: 'Unidade tributável', example: 'UN', hint: 'Vazio = a unidade do produto' },
  ];
  const index = new Map<string, ProductItem>();
  for (const i of items) {
    index.set(norm(i.name), i);
    if (i.barcode) index.set(i.barcode, i);
    if (i.sku) index.set(norm(i.sku), i);
  }
  return {
    entity: 'produtos',
    fileName: 'cadastro-fiscal-produtos',
    columns,
    create: async (row) => {
      const key = text(row, 'product') ?? '';
      const item = index.get(key) ?? index.get(norm(key));
      if (!item) throw new Error(`Produto não encontrado: "${key}". Cadastre em Produtos e estoque (ou confira o nome).`);
      return api('/fiscal/codes/products', {
        method: 'PUT',
        body: {
          productId: item.productId,
          productName: item.name,
          ncm: text(row, 'ncm'),
          cfop: text(row, 'cfop'),
          cest: text(row, 'cest'),
          origin: row.origin ?? 0,
          icmsSituation: text(row, 'icmsSituation'),
          icmsRate: row.icmsRate ?? null,
          pisCofinsCst: text(row, 'pisCofinsCst'),
          taxUnit: text(row, 'taxUnit') ?? item.unit.toUpperCase(),
        },
      });
    },
  };
}

function serviceImportSpec(items: ServiceItem[]): ImportSpec {
  const columns: ImportColumn[] = [
    { key: 'service', label: 'Serviço', required: true, example: 'Corte feminino', hint: 'Nome exato do serviço da agenda (ou do item da ordem de serviço)' },
    { key: 'lc116', label: 'Item da LC 116', required: true, example: '06.01' },
    { key: 'nationalCode', label: 'Código de tributação nacional', example: '060101', hint: '6 dígitos. Formate a coluna como texto' },
    { key: 'nbs', label: 'NBS', example: '1.2601.10.00' },
    { key: 'municipalCode', label: 'Código municipal', example: '' },
    { key: 'issRate', label: 'Alíquota do ISS (%)', type: 'number', required: true, example: '2' },
    { key: 'issWithheld', label: 'ISS retido', type: 'boolean', example: 'Não', hint: 'Sim ou Não (vazio = Não)' },
  ];
  const index = new Map(items.map((i) => [norm(i.name), i]));
  return {
    entity: 'serviços',
    fileName: 'cadastro-fiscal-servicos',
    columns,
    create: async (row) => {
      const key = text(row, 'service') ?? '';
      const item = index.get(norm(key));
      if (!item) throw new Error(`Serviço não encontrado: "${key}". Confira o nome (igual ao da agenda).`);
      return api('/fiscal/codes/services', {
        method: 'PUT',
        body: {
          refType: item.refType,
          refId: item.refId,
          serviceName: item.name,
          lc116: text(row, 'lc116'),
          nationalCode: text(row, 'nationalCode'),
          nbs: text(row, 'nbs'),
          municipalCode: text(row, 'municipalCode'),
          issRate: row.issRate,
          issWithheld: row.issWithheld ?? false,
        },
      });
    },
  };
}
