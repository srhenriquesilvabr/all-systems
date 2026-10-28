import { api, ApiError, parseMoney, useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { contactBases, contactBasisLabel, LEGAL_NOTICE, leadAssetLabel, leadAssetTypes, type ContactBasis, type LeadDetail, type Referrer } from '../../contracts';
import { useTeam } from '../common';
import { leadsKey } from './common';

const empty = { name: '', phone: '', email: '', city: '', state: '', assetType: '', creditValue: '', termMonths: '', campaign: '', notes: '', contactBasis: 'requested_contact' as ContactBasis, sellerId: '', referrerId: '' };

/** Cadastro manual do lead (ou edição dos dados de contato e da simulação), na própria página. */
export function LeadFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = useCan('consortium.leads.manage');
  const team = useTeam();
  const lead = useQuery({ queryKey: [...leadsKey, 'detail', id], queryFn: () => api<LeadDetail>(`/consortium/leads/${id}`), enabled: !!id });
  const referrers = useQuery({ queryKey: [...leadsKey, 'referrers'], queryFn: () => api<Referrer[]>('/consortium/referrers'), enabled: !id && canManage });
  const [form, setForm] = useState(empty);
  useEffect(() => {
    const l = lead.data;
    if (l)
      setForm({
        ...empty,
        name: l.name,
        phone: l.phone ?? '',
        email: l.email ?? '',
        city: l.city ?? '',
        state: l.state ?? '',
        assetType: l.assetType ?? '',
        creditValue: l.creditValue ? String(l.creditValue).replace('.', ',') : '',
        termMonths: l.termMonths ? String(l.termMonths) : '',
        campaign: l.campaign ?? '',
        notes: l.notes ?? '',
      });
  }, [lead.data]);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const common = {
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        city: form.city || null,
        state: form.state || null,
        assetType: form.assetType || null,
        creditValue: form.creditValue ? parseMoney(form.creditValue) : null,
        termMonths: form.termMonths ? Number(form.termMonths) : null,
        campaign: form.campaign || null,
        notes: form.notes || null,
      };
      return id
        ? api<LeadDetail>(`/consortium/leads/${id}`, { method: 'PATCH', body: common })
        : api<LeadDetail>('/consortium/leads', { method: 'POST', body: { ...common, source: 'manual', contactBasis: form.contactBasis, sellerId: form.sellerId || null, referrerId: form.referrerId || null } });
    },
    onSuccess: (l) => {
      queryClient.invalidateQueries({ queryKey: leadsKey });
      navigate(`/consorcio/leads/${l.id}`);
    },
  });
  if (id && lead.isPending) return <Spinner />;
  if (id && lead.isError) return <Alert>{lead.error.message}</Alert>;
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <>
      <Link to={id ? `/consorcio/leads/${id}` : '/consorcio/leads'} className="mb-3 inline-block text-sm text-fg-muted hover:text-fg">
        ← {id ? 'Voltar ao lead' : 'Leads'}
      </Link>
      <PageHeader title={id ? `Editar lead nº ${lead.data?.number}` : 'Novo lead'} description={id ? undefined : 'Pessoa que pediu contato no balcão, por telefone, num evento ou por indicação.'} />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Nome">{(fid) => <Input id={fid} required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
          </div>
          <Field label="Celular (com DDD)">{(fid) => <Input id={fid} type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
          <Field label="E-mail">{(fid) => <Input id={fid} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
          <Field label="Cidade">{(fid) => <Input id={fid} value={form.city} onChange={(e) => set({ city: e.target.value })} />}</Field>
          <Field label="UF">{(fid) => <Input id={fid} maxLength={2} value={form.state} onChange={(e) => set({ state: e.target.value.toUpperCase() })} />}</Field>
        </Card>
        <Card className="grid gap-4 p-5 sm:grid-cols-3">
          <h2 className="font-medium sm:col-span-3">O que a pessoa procura</h2>
          <Field label="Tipo de bem">
            {(fid) => (
              <Select id={fid} value={form.assetType} onChange={(e) => set({ assetType: e.target.value })}>
                <option value="">—</option>
                {leadAssetTypes.map((t) => (
                  <option key={t} value={t}>
                    {leadAssetLabel[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Crédito (R$)">{(fid) => <Input id={fid} inputMode="decimal" value={form.creditValue} onChange={(e) => set({ creditValue: e.target.value })} />}</Field>
          <Field label="Prazo (meses)">{(fid) => <Input id={fid} type="number" min={1} max={420} value={form.termMonths} onChange={(e) => set({ termMonths: e.target.value })} />}</Field>
          <div className="sm:col-span-3">
            <Field label="Campanha / origem" hint="Ex.: feira de imóveis, panfleto do bairro. Aparece no relatório de conversão.">
              {(fid) => <Input id={fid} value={form.campaign} onChange={(e) => set({ campaign: e.target.value })} />}
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field label="Observações">{(fid) => <Textarea id={fid} rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
          </div>
        </Card>
        {!id && (
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Por que podemos chamar esta pessoa" hint={LEGAL_NOTICE}>
                {(fid) => (
                  <Select id={fid} value={form.contactBasis} onChange={(e) => set({ contactBasis: e.target.value as ContactBasis })}>
                    {contactBases.map((b) => (
                      <option key={b} value={b}>
                        {contactBasisLabel[b]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Vendedor" hint="Vazio = distribuição automática (se ligada) ou sem vendedor.">
              {(fid) => (
                <Select id={fid} value={form.sellerId} onChange={(e) => set({ sellerId: e.target.value })}>
                  <option value="">—</option>
                  {team.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Indicado por (opcional)">
              {(fid) => (
                <Select id={fid} value={form.referrerId} onChange={(e) => set({ referrerId: e.target.value })}>
                  <option value="">—</option>
                  {referrers.data
                    ?.filter((r) => r.active)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.kind === 'customer' ? 'cliente' : 'vendedor'})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </Card>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(id ? `/consorcio/leads/${id}` : '/consorcio/leads')}>
            Cancelar
          </Button>
        </div>
      </form>
    </>
  );
}
