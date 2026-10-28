import { api, CustomerSearch, formatMoney, parseMoney } from '@all/module-sdk/web';
import { Button, Card, Checkbox, Field, Input, Select, Table, Td, Textarea, Th } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  docTypeLabel,
  docTypes,
  paymentMethodLabel,
  paymentMethods,
  productOrigins,
  type DocType,
  type DocumentItem,
  type DocumentPayment,
  type FiscalPaymentMethod,
  type ProductCode,
  type Recipient,
  type ServiceCode,
} from '../contracts';
import { decimalText, fiscalKey, parseDecimal } from './shared';

export interface FormValues {
  type: DocType;
  customer: { id: string; name: string } | null;
  recipient: Recipient | null;
  items: DocumentItem[];
  payments: DocumentPayment[];
  nature: string;
  additionalInfo: string;
  serviceDate: string;
}

interface Row {
  key: number;
  kind: 'product' | 'service';
  refType: string | null;
  refId: string | null;
  code: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  codes: Record<string, string>;
  issWithheld: boolean;
  open: boolean;
}

const PRODUCT_CODES = [
  ['ncm', 'NCM'],
  ['cfop', 'CFOP'],
  ['cest', 'CEST'],
  ['icmsSituation', 'CST/CSOSN'],
  ['icmsRate', 'ICMS %'],
  ['taxUnit', 'Unid. tributável'],
] as const;
const SERVICE_CODES = [
  ['lc116', 'Item LC 116'],
  ['nationalCode', 'Cód. nacional'],
  ['nbs', 'NBS'],
  ['municipalCode', 'Cód. municipal'],
  ['issRate', 'ISS %'],
] as const;
const NUMERIC = new Set(['icmsRate', 'issRate']);

let seq = 1;
function toRow(i: Partial<DocumentItem>, type: DocType): Row {
  const codes: Record<string, string> = {};
  for (const [k] of [...PRODUCT_CODES, ...SERVICE_CODES]) {
    const v = (i as Record<string, unknown>)[k];
    codes[k] = v === null || v === undefined ? '' : NUMERIC.has(k) ? decimalText(v as number) : String(v);
  }
  codes.origin = i.origin === null || i.origin === undefined ? '0' : String(i.origin);
  return {
    key: seq++,
    kind: i.kind ?? (type === 'nfse' ? 'service' : 'product'),
    refType: i.refType ?? null,
    refId: i.refId ?? null,
    code: i.code ?? '',
    description: i.description ?? '',
    quantity: i.quantity ? decimalText(i.quantity) : '1',
    unit: i.unit ?? 'UN',
    unitPrice: i.unitPrice ? decimalText(i.unitPrice) : '',
    discount: i.discount ? decimalText(i.discount) : '',
    codes,
    issWithheld: !!i.issWithheld,
    open: false,
  };
}

function fromRow(r: Row) {
  const pick = (keys: readonly (readonly [string, string])[]) =>
    Object.fromEntries(keys.map(([k]) => [k, r.codes[k] ? (NUMERIC.has(k) ? parseDecimal(r.codes[k]!) : r.codes[k]) : null]));
  return {
    kind: r.kind,
    refType: r.refType,
    refId: r.refId,
    code: r.code,
    description: r.description,
    quantity: parseDecimal(r.quantity) ?? 1,
    unit: r.unit || 'UN',
    unitPrice: parseMoney(r.unitPrice || '0'),
    discount: parseMoney(r.discount || '0'),
    ...(r.kind === 'product' ? { ...pick(PRODUCT_CODES), origin: Number(r.codes.origin ?? 0) } : { ...pick(SERVICE_CODES), issWithheld: r.issWithheld }),
  };
}

/** Formulário da nota (avulsa ou correção de rascunho/rejeitada), na própria página. */
export function DocumentForm({ initial, allowTypeChange, submitLabel, busy, onSubmit, onCancel }: {
  initial: FormValues;
  allowTypeChange: boolean;
  submitLabel: string;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const [type, setType] = useState<DocType>(initial.type);
  const [customer, setCustomer] = useState(initial.customer);
  const [manualRecipient, setManualRecipient] = useState(!!initial.recipient && !initial.customer);
  const [recipient, setRecipient] = useState<Recipient>(
    initial.recipient ?? { name: '', document: null, email: null, phone: null, stateRegistration: null, ieIndicator: 9, address: null },
  );
  const [rows, setRows] = useState<Row[]>(initial.items.length ? initial.items.map((i) => toRow(i, initial.type)) : [toRow({}, initial.type)]);
  const [payments, setPayments] = useState(initial.payments.map((p) => ({ method: p.method, amount: decimalText(p.amount) })));
  const [nature, setNature] = useState(initial.nature);
  const [additionalInfo, setAdditionalInfo] = useState(initial.additionalInfo);
  const [serviceDate, setServiceDate] = useState(initial.serviceDate);

  const products = useQuery({ queryKey: [...fiscalKey, 'codes', 'products'], queryFn: () => api<ProductCode[]>('/fiscal/codes/products'), enabled: type !== 'nfse' });
  const services = useQuery({ queryKey: [...fiscalKey, 'codes', 'services'], queryFn: () => api<ServiceCode[]>('/fiscal/codes/services'), enabled: type === 'nfse' });

  const total = rows.reduce((s, r) => s + (parseDecimal(r.quantity) ?? 0) * parseMoney(r.unitPrice || '0') - parseMoney(r.discount || '0'), 0);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setCode = (key: number, code: string, value: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, codes: { ...r.codes, [code]: value } } : r)));

  function changeType(t: DocType) {
    setType(t);
    setRows([toRow({}, t)]);
    setPayments([]);
  }

  function pickCatalog(key: number, value: string) {
    if (type === 'nfse') {
      const s = services.data?.find((s) => `${s.refType}:${s.refId}` === value);
      if (s) update(key, { refType: s.refType, refId: s.refId, description: s.serviceName, codes: { ...toRow({}, type).codes } });
    } else {
      const p = products.data?.find((p) => p.productId === value);
      if (p) update(key, { refType: 'sales_product', refId: p.productId, code: p.productId.slice(0, 8).toUpperCase(), description: p.productName, unit: p.taxUnit, codes: { ...toRow({}, type).codes } });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      items: rows.filter((r) => r.description.trim()).map(fromRow),
      customerId: manualRecipient ? null : (customer?.id ?? null),
      recipient: manualRecipient && recipient.name ? recipient : null,
      payments: type === 'nfse' ? [] : payments.filter((p) => p.amount).map((p) => ({ method: p.method, amount: parseMoney(p.amount) })),
      nature: nature || null,
      additionalInfo: additionalInfo || null,
      serviceDate: type === 'nfse' ? serviceDate || null : null,
    };
    if (allowTypeChange) body.type = type;
    onSubmit(body);
  }

  const addr = recipient.address ?? {};
  const setAddr = (patch: Record<string, string>) => setRecipient({ ...recipient, address: { ...addr, ...patch } });

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {allowTypeChange ? (
            <Field label="Tipo de nota">
              {(id) => (
                <Select id={id} value={type} onChange={(e) => changeType(e.target.value as DocType)}>
                  {docTypes.map((t) => (
                    <option key={t} value={t}>
                      {docTypeLabel[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <div>
              <p className="text-sm font-medium">Tipo de nota</p>
              <p className="mt-2 text-sm">{docTypeLabel[type]}</p>
            </div>
          )}
          <Field label={type === 'nfse' ? 'Descrição do serviço (natureza)' : 'Natureza da operação'}>{(id) => <Input id={id} value={nature} onChange={(e) => setNature(e.target.value)} placeholder="Padrão da configuração" />}</Field>
          {type === 'nfse' && <Field label="Data da prestação">{(id) => <Input id={id} type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />}</Field>}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{type === 'nfse' ? 'Tomador do serviço' : 'Destinatário'}</p>
          {!manualRecipient && (customer ? (
            <p className="text-sm">
              {customer.name}{' '}
              <Button type="button" size="sm" variant="ghost" onClick={() => setCustomer(null)}>
                Trocar
              </Button>
            </p>
          ) : (
            <CustomerSearch autoFocus={false} onSelect={(c) => setCustomer({ id: c.id, name: c.name })} />
          ))}
          <Checkbox label="Informar os dados à mão (cliente sem cadastro ou dados diferentes)" checked={manualRecipient} onChange={(e) => setManualRecipient(e.target.checked)} />
          {manualRecipient && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nome / razão social">{(id) => <Input id={id} value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />}</Field>
              <Field label="CPF ou CNPJ">{(id) => <Input id={id} value={recipient.document ?? ''} onChange={(e) => setRecipient({ ...recipient, document: e.target.value || null })} />}</Field>
              <Field label="E-mail">{(id) => <Input id={id} type="email" value={recipient.email ?? ''} onChange={(e) => setRecipient({ ...recipient, email: e.target.value || null })} />}</Field>
              {type === 'nfe' && (
                <>
                  <Field label="Contribuinte do ICMS">
                    {(id) => (
                      <Select id={id} value={recipient.ieIndicator} onChange={(e) => setRecipient({ ...recipient, ieIndicator: Number(e.target.value) as 1 | 2 | 9 })}>
                        <option value={9}>Não contribuinte</option>
                        <option value={1}>Contribuinte (com IE)</option>
                        <option value={2}>Contribuinte isento</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Inscrição estadual">{(id) => <Input id={id} value={recipient.stateRegistration ?? ''} onChange={(e) => setRecipient({ ...recipient, stateRegistration: e.target.value || null })} />}</Field>
                  <Field label="CEP">{(id) => <Input id={id} value={addr.zip ?? ''} onChange={(e) => setAddr({ zip: e.target.value })} />}</Field>
                  <Field label="Rua">{(id) => <Input id={id} value={addr.street ?? ''} onChange={(e) => setAddr({ street: e.target.value })} />}</Field>
                  <Field label="Número">{(id) => <Input id={id} value={addr.number ?? ''} onChange={(e) => setAddr({ number: e.target.value })} />}</Field>
                  <Field label="Bairro">{(id) => <Input id={id} value={addr.district ?? ''} onChange={(e) => setAddr({ district: e.target.value })} />}</Field>
                  <Field label="Cidade">{(id) => <Input id={id} value={addr.city ?? ''} onChange={(e) => setAddr({ city: e.target.value })} />}</Field>
                  <Field label="UF">{(id) => <Input id={id} maxLength={2} value={addr.state ?? ''} onChange={(e) => setAddr({ state: e.target.value.toUpperCase() })} />}</Field>
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>{type === 'nfse' ? 'Serviço' : 'Produto'}</Th>
              <Th className="w-24 text-right">Qtd.</Th>
              <Th className="w-20">Unid.</Th>
              <Th className="w-32 text-right">Preço</Th>
              <Th className="w-28 text-right">Desconto</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RowEditor key={r.key} row={r} type={type} products={products.data ?? []} services={services.data ?? []} update={update} setCode={setCode} pick={pickCatalog} remove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
            ))}
          </tbody>
        </Table>
        <div className="flex items-center justify-between border-t border-line p-3">
          <Button type="button" size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, toRow({}, type)])}>
            Adicionar item
          </Button>
          <span className="text-sm font-medium">Total: {formatMoney(Math.max(0, total))}</span>
        </div>
      </Card>

      {type !== 'nfse' && (
        <Card className="space-y-2 p-5">
          <p className="text-sm font-medium">Formas de pagamento</p>
          {payments.map((p, n) => (
            <div key={n} className="flex gap-2">
              <Select value={p.method} onChange={(e) => setPayments(payments.map((x, i) => (i === n ? { ...x, method: e.target.value as FiscalPaymentMethod } : x)))} aria-label="Forma">
                {paymentMethods.map((m) => (
                  <option key={m} value={m}>
                    {paymentMethodLabel[m]}
                  </option>
                ))}
              </Select>
              <Input className="w-36" inputMode="decimal" value={p.amount} onChange={(e) => setPayments(payments.map((x, i) => (i === n ? { ...x, amount: e.target.value } : x)))} aria-label="Valor" />
              <Button type="button" size="sm" variant="ghost" onClick={() => setPayments(payments.filter((_, i) => i !== n))}>
                Remover
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => setPayments([...payments, { method: 'pix', amount: decimalText(Math.round(Math.max(0, total) * 100) / 100) }])}>
            Adicionar pagamento
          </Button>
          <p className="text-xs text-fg-muted">Sem forma de pagamento, a nota sai com “Outros” no valor total.</p>
        </Card>
      )}

      <Card className="p-5">
        <Field label="Informações complementares" hint="Sai impressa na nota.">
          {(id) => <Textarea id={id} value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)} />}
        </Field>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

function RowEditor({ row: r, type, products, services, update, setCode, pick, remove }: {
  row: Row;
  type: DocType;
  products: ProductCode[];
  services: ServiceCode[];
  update: (key: number, patch: Partial<Row>) => void;
  setCode: (key: number, code: string, value: string) => void;
  pick: (key: number, value: string) => void;
  remove: () => void;
}) {
  const codes = r.kind === 'product' ? PRODUCT_CODES : SERVICE_CODES;
  const catalog = type === 'nfse' ? services.map((s) => ({ value: `${s.refType}:${s.refId}`, label: s.serviceName })) : products.map((p) => ({ value: p.productId, label: p.productName }));
  const selected = r.refId ? (type === 'nfse' ? `${r.refType}:${r.refId}` : r.refId) : '';
  return (
    <>
      <tr>
        <Td>
          <div className="space-y-1">
            {catalog.length > 0 && (
              <Select value={selected} onChange={(e) => pick(r.key, e.target.value)} aria-label="Do cadastro fiscal">
                <option value="">{type === 'nfse' ? 'Serviço do cadastro fiscal…' : 'Produto do cadastro fiscal…'}</option>
                {catalog.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
            <Input value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} placeholder="Descrição" aria-label="Descrição" />
          </div>
        </Td>
        <Td>
          <Input className="text-right" inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} aria-label="Quantidade" />
        </Td>
        <Td>
          <Input value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} aria-label="Unidade" />
        </Td>
        <Td>
          <Input className="text-right" inputMode="decimal" value={r.unitPrice} onChange={(e) => update(r.key, { unitPrice: e.target.value })} aria-label="Preço" />
        </Td>
        <Td>
          <Input className="text-right" inputMode="decimal" value={r.discount} onChange={(e) => update(r.key, { discount: e.target.value })} aria-label="Desconto" />
        </Td>
        <Td className="whitespace-nowrap text-right">
          <Button type="button" size="sm" variant="ghost" onClick={() => update(r.key, { open: !r.open })}>
            {r.open ? 'Ocultar códigos' : 'Códigos'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={remove}>
            Remover
          </Button>
        </Td>
      </tr>
      {r.open && (
        <tr>
          <Td colSpan={6} className="bg-muted/40">
            <p className="mb-2 text-xs text-fg-muted">Em branco = usa o cadastro fiscal {r.refId ? 'do item' : '(ou o padrão da configuração)'}. O que for preenchido aqui vale só para esta nota.</p>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {codes.map(([k, label]) => (
                <Field key={k} label={label}>
                  {(id) => <Input id={id} value={r.codes[k] ?? ''} onChange={(e) => setCode(r.key, k, e.target.value)} />}
                </Field>
              ))}
              {r.kind === 'product' ? (
                <Field label="Origem">
                  {(id) => (
                    <Select id={id} value={r.codes.origin ?? '0'} onChange={(e) => setCode(r.key, 'origin', e.target.value)}>
                      {productOrigins.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <div className="flex items-end pb-2">
                  <Checkbox label="ISS retido" checked={r.issWithheld} onChange={(e) => update(r.key, { issWithheld: e.target.checked })} />
                </div>
              )}
            </div>
          </Td>
        </tr>
      )}
    </>
  );
}
