import { api, apiUpload, formatDate } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  docTypeLabel,
  environmentLabel,
  environments,
  formatCnae,
  formatNbs,
  providerLabel,
  providers,
  taxRegimeLabel,
  taxRegimes,
  type FiscalOverview,
  type Series,
} from '../contracts';
import { AccountantNotice, decimalText, ErrorMessage, fiscalKey, parseDecimal, useOverview } from './shared';

type Settings = Record<string, string | number | boolean>;

/** Configuração fiscal: empresa, provedor, certificado, CSC, padrões, numeração e automação, tudo na página. */
export function SettingsPage() {
  const overview = useOverview();
  if (overview.isPending) return <Spinner />;
  if (overview.isError) return <Alert>{overview.error.message}</Alert>;
  return <SettingsContent data={overview.data} />;
}

function SettingsContent({ data }: { data: FiscalOverview }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Settings>(data.settings as Settings);
  useEffect(() => setForm(data.settings as Settings), [data.settings]);
  const set = (patch: Settings) => setForm((f) => ({ ...f, ...patch }));
  const text = (k: string) => String(form[k] ?? '');
  const save = useMutation({
    mutationFn: () => {
      const body: Settings = { ...form };
      for (const k of ['defaultIssRate', 'retentionIr', 'retentionPis', 'retentionCofins', 'retentionCsll', 'retentionInss', 'cbsRate', 'ibsRate', 'approximateTaxPercent']) {
        body[k] = parseDecimal(String(form[k] ?? '')) ?? 0;
      }
      body.nfseCancelDays = Number(form.nfseCancelDays ?? 30);
      return api('/fiscal/settings', { method: 'PUT', body });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fiscalKey }),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  const real = form.provider !== 'simulated';
  const blocking = data.readiness.filter((r) => !r.ok && r.blocking);

  return (
    <>
      <PageHeader title="Nota fiscal" description="Dados fiscais da empresa, provedor de emissão, certificado digital e regras de emissão." />
      <div className="space-y-4">
        <AccountantNotice />
        {form.environment === 'production' && <Alert tone="info">Ambiente de produção: as notas emitidas têm valor fiscal e geram imposto.</Alert>}

        <Section title="O que falta para emitir">
          <ul className="space-y-1 text-sm">
            {data.readiness.map((r) => (
              <li key={r.key} className="flex items-start gap-2">
                <span className={r.ok ? 'text-success-700' : r.blocking ? 'text-danger-700' : 'text-warning-700'}>{r.ok ? '✓' : r.blocking ? '✕' : '!'}</span>
                <span>
                  {r.label} <span className="text-fg-subtle">({r.types.map((t) => docTypeLabel[t].split(' ')[0]).join(', ')})</span>
                </span>
              </li>
            ))}
          </ul>
          {blocking.length === 0 && <p className="mt-2 text-sm text-success-700">Tudo certo para emitir no ambiente atual.</p>}
        </Section>

        <CertificateSection data={data} />

        <form onSubmit={submit} className="space-y-4">
          <Section title="Empresa" description="Razão social, CNPJ e endereço vêm de Dados da empresa. As inscrições abaixo, se preenchidas, valem só para as notas.">
            <div className="mb-3 text-sm">
              <p className="font-medium">{data.company.legalName ?? data.company.name}</p>
              <p className="text-fg-muted">
                CNPJ {data.company.document ?? '—'} · {[data.company.address?.street, data.company.address?.number, data.company.address?.city, data.company.address?.state].filter(Boolean).join(', ') || 'sem endereço'}{' '}
                · <Link className="text-brand-700 underline" to="/configuracoes/empresa">editar dados da empresa</Link>
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Regime tributário">
                {(id) => (
                  <Select id={id} value={text('taxRegime')} onChange={(e) => set({ taxRegime: e.target.value })}>
                    {taxRegimes.map((r) => (
                      <option key={r} value={r}>
                        {taxRegimeLabel[r]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="CNAE principal" hint={text('cnae') ? formatCnae(text('cnae')) : 'Ex.: 9602-5/01'}>
                {(id) => <Input id={id} value={text('cnae')} onChange={(e) => set({ cnae: e.target.value })} />}
              </Field>
              <Field label="Código IBGE do município" hint="7 dígitos (ex.: São Paulo 3550308). Necessário para NFS-e.">
                {(id) => <Input id={id} inputMode="numeric" value={text('municipalityCode')} onChange={(e) => set({ municipalityCode: e.target.value })} />}
              </Field>
              <Field label="Inscrição estadual" hint={`Vazio = a do cadastro (${data.company.stateRegistration ?? 'não informada'})`}>
                {(id) => <Input id={id} value={text('stateRegistration')} onChange={(e) => set({ stateRegistration: e.target.value })} />}
              </Field>
              <Field label="Inscrição municipal" hint={`Vazio = a do cadastro (${data.company.municipalRegistration ?? 'não informada'})`}>
                {(id) => <Input id={id} value={text('municipalRegistration')} onChange={(e) => set({ municipalRegistration: e.target.value })} />}
              </Field>
              <Field label="NFS-e" hint="Padrão nacional é obrigatório para os municípios desde 2026.">
                {(id) => (
                  <Select id={id} value={text('nfseStandard')} onChange={(e) => set({ nfseStandard: e.target.value })}>
                    <option value="national">Padrão nacional (NFS-e Nacional)</option>
                    <option value="municipal">Padrão do município</option>
                  </Select>
                )}
              </Field>
            </div>
          </Section>

          <Section title="Provedor e ambiente" description="Comece em homologação: as notas são de teste e não têm valor fiscal.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Provedor">
                {(id) => (
                  <Select id={id} value={text('provider')} onChange={(e) => set({ provider: e.target.value })}>
                    {providers.map((p) => (
                      <option key={p} value={p}>
                        {providerLabel[p]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Ambiente">
                {(id) => (
                  <Select id={id} value={text('environment')} onChange={(e) => set({ environment: e.target.value })}>
                    {environments.map((env) => (
                      <option key={env} value={env}>
                        {environmentLabel[env]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Numeração" hint="Pelo sistema: série e próximo número abaixo.">
                {(id) => (
                  <Select id={id} value={text('numbering')} onChange={(e) => set({ numbering: e.target.value })}>
                    <option value="system">Pelo sistema</option>
                    <option value="provider">Pelo provedor</option>
                  </Select>
                )}
              </Field>
              {real && (
                <>
                  <Field label="Token da API — homologação" hint="Em branco mantém o atual.">
                    {(id) => <Input id={id} type="password" autoComplete="off" value={text('tokenHomologation')} onChange={(e) => set({ tokenHomologation: e.target.value })} />}
                  </Field>
                  <Field label="Token da API — produção" hint="Em branco mantém o atual.">
                    {(id) => <Input id={id} type="password" autoComplete="off" value={text('tokenProduction')} onChange={(e) => set({ tokenProduction: e.target.value })} />}
                  </Field>
                  <Field label="Id da empresa no provedor" hint="Preenchido ao cadastrar a empresa pela API.">
                    {(id) => <Input id={id} value={text('providerCompanyId')} onChange={(e) => set({ providerCompanyId: e.target.value })} />}
                  </Field>
                </>
              )}
              <Field label="Regime especial (NFS-e)" hint="Código do regime especial de tributação municipal; vazio = nenhum.">
                {(id) => <Input id={id} value={text('specialRegime')} onChange={(e) => set({ specialRegime: e.target.value })} />}
              </Field>
            </div>
            {real && <ProviderActions webhookUrl={data.webhookUrl} />}
          </Section>

          <Section title="NFC-e: CSC" description="Código de segurança do contribuinte, gerado no portal da SEFAZ do estado (um por ambiente).">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="ID do CSC — homologação">{(id) => <Input id={id} value={text('cscIdHomologation')} onChange={(e) => set({ cscIdHomologation: e.target.value })} />}</Field>
              <Field label="CSC — homologação" hint="Em branco mantém.">
                {(id) => <Input id={id} type="password" autoComplete="off" value={text('cscTokenHomologation')} onChange={(e) => set({ cscTokenHomologation: e.target.value })} />}
              </Field>
              <Field label="ID do CSC — produção">{(id) => <Input id={id} value={text('cscIdProduction')} onChange={(e) => set({ cscIdProduction: e.target.value })} />}</Field>
              <Field label="CSC — produção" hint="Em branco mantém.">
                {(id) => <Input id={id} type="password" autoComplete="off" value={text('cscTokenProduction')} onChange={(e) => set({ cscTokenProduction: e.target.value })} />}
              </Field>
            </div>
          </Section>

          <Section title="Padrões das notas" description="Valem quando o produto ou serviço não tem cadastro fiscal próprio. Confira com o contador.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Natureza da operação (NFC-e/NF-e)">{(id) => <Input id={id} value={text('defaultNature')} onChange={(e) => set({ defaultNature: e.target.value })} />}</Field>
              <Field label="Descrição padrão (NFS-e)">{(id) => <Input id={id} value={text('serviceNature')} onChange={(e) => set({ serviceNature: e.target.value })} />}</Field>
              <Field label="Alíquota de ISS padrão (%)" hint="De 2% a 5% na maioria dos municípios; 0 = sem padrão.">
                {(id) => <Input id={id} inputMode="decimal" value={decimalText(form.defaultIssRate as number)} onChange={(e) => set({ defaultIssRate: e.target.value })} />}
              </Field>
              <Field label="Item da LC 116 padrão" hint="Para itens de ordem de serviço sem cadastro (ex.: 14.01).">
                {(id) => <Input id={id} value={text('defaultLc116')} onChange={(e) => set({ defaultLc116: e.target.value })} />}
              </Field>
              <Field label="Código de tributação nacional padrão" hint="6 dígitos (NFS-e Nacional).">
                {(id) => <Input id={id} inputMode="numeric" value={text('defaultNationalCode')} onChange={(e) => set({ defaultNationalCode: e.target.value })} />}
              </Field>
              <Field label="NBS padrão" hint={text('defaultNbs') ? formatNbs(text('defaultNbs')) : '9 dígitos'}>
                {(id) => <Input id={id} value={text('defaultNbs')} onChange={(e) => set({ defaultNbs: e.target.value })} />}
              </Field>
              <Field label="Prazo de cancelamento da NFS-e (dias)" hint="Varia por município. NFC-e: 30 min; NF-e: 24 h.">
                {(id) => <Input id={id} inputMode="numeric" value={text('nfseCancelDays')} onChange={(e) => set({ nfseCancelDays: e.target.value })} />}
              </Field>
              <Field label="Tributos aproximados (Lei 12.741), % do total" hint="0 = não informa na nota.">
                {(id) => <Input id={id} inputMode="decimal" value={decimalText(form.approximateTaxPercent as number)} onChange={(e) => set({ approximateTaxPercent: e.target.value })} />}
              </Field>
              <div className="flex items-end pb-2">
                <Checkbox label="ISS retido pelo tomador por padrão" checked={!!form.issWithheldDefault} onChange={(e) => set({ issWithheldDefault: e.target.checked })} />
              </div>
            </div>
            <p className="mb-2 mt-4 text-sm font-medium">Retenções federais quando o tomador é empresa (%)</p>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  ['retentionIr', 'IR'],
                  ['retentionPis', 'PIS'],
                  ['retentionCofins', 'COFINS'],
                  ['retentionCsll', 'CSLL'],
                  ['retentionInss', 'INSS'],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  {(id) => <Input id={id} inputMode="decimal" value={decimalText(form[k] as number)} onChange={(e) => set({ [k]: e.target.value })} />}
                </Field>
              ))}
            </div>
            <p className="mb-2 mt-4 text-sm font-medium">Reforma Tributária (IBS e CBS)</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="flex items-end pb-2">
                <Checkbox label="Destacar IBS/CBS" checked={!!form.reformEnabled} onChange={(e) => set({ reformEnabled: e.target.checked })} />
              </div>
              <Field label="CBS (%)" hint="2026: 0,9 (teste)">{(id) => <Input id={id} inputMode="decimal" value={decimalText(form.cbsRate as number)} onChange={(e) => set({ cbsRate: e.target.value })} />}</Field>
              <Field label="IBS (%)" hint="2026: 0,1 (teste)">{(id) => <Input id={id} inputMode="decimal" value={decimalText(form.ibsRate as number)} onChange={(e) => set({ ibsRate: e.target.value })} />}</Field>
              <Field label="CST IBS/CBS">{(id) => <Input id={id} value={text('ibsCbsCst')} onChange={(e) => set({ ibsCbsCst: e.target.value })} />}</Field>
              <Field label="cClassTrib">{(id) => <Input id={id} value={text('classTrib')} onChange={(e) => set({ classTrib: e.target.value })} />}</Field>
            </div>
            <div className="mt-4">
              <Field label="Informações complementares padrão" hint="Sai em todas as notas (ex.: “Documento emitido por ME ou EPP optante pelo Simples Nacional”).">
                {(id) => <Textarea id={id} value={text('additionalInfo')} onChange={(e) => set({ additionalInfo: e.target.value })} />}
              </Field>
            </div>
          </Section>

          <Section title="Emissão automática e envio ao cliente" description="A emissão automática usa o cadastro fiscal; se faltar algo, a origem aparece em “A emitir” com o motivo.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Venda no caixa (PDV)">
                {(id) => (
                  <Select id={id} value={text('autoSale')} onChange={(e) => set({ autoSale: e.target.value })}>
                    <option value="off">Não emitir sozinho</option>
                    <option value="nfce">Emitir NFC-e ao concluir a venda</option>
                    <option value="nfe">Emitir NF-e ao concluir a venda</option>
                  </Select>
                )}
              </Field>
              <div className="space-y-2 pt-6">
                <Checkbox label="NFS-e ao quitar um atendimento da agenda" checked={!!form.autoAppointment} onChange={(e) => set({ autoAppointment: e.target.checked })} />
                <Checkbox label="NFS-e ao concluir uma ordem de serviço" checked={!!form.autoServiceOrder} onChange={(e) => set({ autoServiceOrder: e.target.checked })} />
              </div>
              <div className="space-y-2 pt-6">
                <Checkbox label="Enviar a nota ao cliente por e-mail" checked={!!form.sendEmail} onChange={(e) => set({ sendEmail: e.target.checked })} />
                <Checkbox label="Enviar a nota ao cliente por WhatsApp" checked={!!form.sendWhatsapp} onChange={(e) => set({ sendWhatsapp: e.target.checked })} />
              </div>
            </div>
          </Section>

          <div className="flex items-center gap-3">
            <Button type="submit" loading={save.isPending}>
              Salvar configuração
            </Button>
            {save.isSuccess && <span className="text-sm text-success-700">Salvo.</span>}
          </div>
          <ErrorMessage error={save.error} />
        </form>

        <SeriesSection series={data.series} />
      </div>
    </>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mb-4 mt-0.5 text-sm text-fg-muted">{description}</p>}
      {!description && <div className="mb-3" />}
      {children}
    </Card>
  );
}

function ProviderActions({ webhookUrl }: { webhookUrl: string }) {
  const queryClient = useQueryClient();
  const sync = useMutation({ mutationFn: () => api<{ message: string }>('/fiscal/provider/sync', { method: 'POST' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: fiscalKey }) });
  const hook = useMutation({ mutationFn: () => api<{ message: string }>('/fiscal/provider/webhook', { method: 'POST' }) });
  const secret = useMutation({ mutationFn: () => api<{ url: string; secret: string }>('/fiscal/webhook-secret', { method: 'POST' }) });
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
      <p className="text-fg-muted">
        Salve a configuração antes. O webhook avisa o sistema quando a nota é autorizada; sem ele, a situação é consultada a cada 5 minutos. Endereço: <code className="break-all">{webhookUrl}</code>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>
          Cadastrar empresa e certificado no provedor
        </Button>
        <Button type="button" variant="secondary" size="sm" loading={hook.isPending} onClick={() => hook.mutate()}>
          Cadastrar webhook no provedor
        </Button>
        <Button type="button" variant="ghost" size="sm" loading={secret.isPending} onClick={() => secret.mutate()}>
          Gerar novo segredo do webhook
        </Button>
      </div>
      {sync.data && <Alert tone="success">{sync.data.message}</Alert>}
      {hook.data && <Alert tone="success">{hook.data.message}</Alert>}
      {secret.data && (
        <Alert tone="info">
          Cole no provedor (cabeçalho <code>X-Fiscal-Token</code>): <code className="break-all">{secret.data.secret}</code>. Ele não aparece de novo.
        </Alert>
      )}
      <ErrorMessage error={sync.error ?? hook.error ?? secret.error} />
    </div>
  );
}

function CertificateSection({ data }: { data: FiscalOverview }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [replacing, setReplacing] = useState(false);
  const upload = useMutation({
    mutationFn: () => apiUpload('/fiscal/certificate', 'certificate', file!, { password }),
    onSuccess: () => {
      setFile(null);
      setPassword('');
      setReplacing(false);
      queryClient.invalidateQueries({ queryKey: fiscalKey });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/fiscal/certificate/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fiscalKey }),
  });
  const c = data.certificate;
  return (
    <Section title="Certificado digital A1" description="Arquivo .pfx/.p12 e senha. Fica guardado cifrado e só é usado para cadastrar a empresa no provedor.">
      {c && (
        <div className="mb-3 space-y-1 text-sm">
          <p className="font-medium">{c.subjectName}</p>
          <p className="text-fg-muted">
            Emitido por {c.issuerName} · válido de {formatDate(c.validFrom)} a {formatDate(c.validTo)}{' '}
            {c.daysLeft < 0 ? <Badge tone="danger">Vencido</Badge> : c.daysLeft <= 30 ? <Badge tone="warning">Vence em {c.daysLeft} dias</Badge> : <Badge tone="success">Válido</Badge>}
          </p>
          {c.documentMismatch && <Alert>O CNPJ do certificado ({c.document}) não é o da empresa.</Alert>}
          {c.daysLeft <= 30 && <Alert tone="info">Renove com a certificadora antes do vencimento: sem certificado válido o provedor não emite. Avisamos por e-mail 30, 15, 7 e 1 dia antes.</Alert>}
        </div>
      )}
      {!c || replacing ? (
        <form
          className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (file) upload.mutate();
          }}
        >
          <Field label="Arquivo do certificado (.pfx ou .p12)">
            {(id) => <Input id={id} type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
          <Field label="Senha">{(id) => <Input id={id} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={!file || !password} loading={upload.isPending}>
              Enviar
            </Button>
            {c && (
              <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
            Trocar certificado
          </Button>
          <Button variant="ghost" size="sm" loading={remove.isPending} onClick={() => confirm('Remover o certificado? O arquivo é apagado.') && remove.mutate(c.id)}>
            Remover
          </Button>
        </div>
      )}
      <div className="mt-2">
        <ErrorMessage error={upload.error ?? remove.error} />
      </div>
    </Section>
  );
}

function SeriesSection({ series }: { series: Series[] }) {
  return (
    <Section title="Séries e numeração" description="Próximo número que o sistema vai usar em cada tipo e ambiente. Só mude se a numeração já estiver em outro sistema (continue de onde parou).">
      <Table>
        <thead>
          <tr>
            <Th>Tipo</Th>
            <Th>Ambiente</Th>
            <Th>Série</Th>
            <Th>Próximo número</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <SeriesRow key={s.id} series={s} />
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

function SeriesRow({ series }: { series: Series }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState({ series: series.series, nextNumber: String(series.nextNumber) });
  const changed = value.series !== series.series || value.nextNumber !== String(series.nextNumber);
  const save = useMutation({
    mutationFn: () => api('/fiscal/series', { method: 'PUT', body: { type: series.type, environment: series.environment, series: value.series, nextNumber: Number(value.nextNumber) } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fiscalKey }),
  });
  return (
    <tr>
      <Td>{docTypeLabel[series.type]}</Td>
      <Td>{series.environment === 'production' ? 'Produção' : 'Homologação'}</Td>
      <Td>
        <Input className="w-20" value={value.series} onChange={(e) => setValue({ ...value, series: e.target.value })} aria-label="Série" />
      </Td>
      <Td>
        <Input className="w-32" inputMode="numeric" value={value.nextNumber} onChange={(e) => setValue({ ...value, nextNumber: e.target.value })} aria-label="Próximo número" />
      </Td>
      <Td className="text-right">
        {changed && (
          <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        )}
        {save.error && <span className="ml-2 text-sm text-danger-600">{save.error.message}</span>}
      </Td>
    </tr>
  );
}
