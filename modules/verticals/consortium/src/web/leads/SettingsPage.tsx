import { useBureauEnabled } from '@all/credit-bureau/web';
import { api, ApiError, useSession } from '@all/module-sdk/web';
import { Alert, Button, Card, Checkbox, Field, Input, PageHeader, Spinner, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { ConsortiumSettings } from '../../manifest';
import { LEGAL_NOTICE } from '../../contracts';
import { useTeam } from '../common';
import { leadsKey, SETTINGS_KEY, useConsortiumSettings } from './common';

/** Captação: simulador público, distribuição para vendedores, WhatsApp, indicação e LGPD. */
export function LeadSettingsPage() {
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const team = useTeam();
  const bureau = useBureauEnabled();
  const settings = useConsortiumSettings();
  const [form, setForm] = useState<ConsortiumSettings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api('/modules/consortium/settings', { method: 'PUT', body: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      queryClient.invalidateQueries({ queryKey: leadsKey });
    },
  });
  if (settings.isPending || !form) return settings.isError ? <Alert>{settings.error.message}</Alert> : <Spinner />;
  const set = <K extends keyof ConsortiumSettings>(k: K, v: ConsortiumSettings[K]) => setForm({ ...form, [k]: v });
  const publicUrl = tenant.slug ? `${window.location.origin}/consorcio/${tenant.slug}` : null;
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <>
      <PageHeader title="Captação de clientes" description="Simulador público, distribuição dos leads, mensagem do WhatsApp, indicação premiada e prazos da LGPD." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {save.isSuccess && <Alert tone="success">Configurações salvas.</Alert>}
        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Simulador público</h2>
          <Checkbox label="Publicar o simulador com a marca da empresa" checked={form.publicSimulator} onChange={(e) => set('publicSimulator', e.target.checked)} />
          {publicUrl && (
            <p className="text-sm">
              Endereço:{' '}
              <a href={publicUrl} target="_blank" rel="noreferrer" className="break-all text-brand-700 hover:underline">
                {publicUrl}
              </a>
              <span className="block text-xs text-fg-muted">Use nos anúncios com utm_source, utm_medium e utm_campaign para o relatório por campanha (ex.: ?utm_source=instagram&utm_campaign=imovel-out).</span>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="E-mail para pedidos do titular (LGPD)" hint="Aparece no texto de autorização.">
              {(id) => <Input id={id} type="email" value={form.privacyEmail} onChange={(e) => set('privacyEmail', e.target.value)} />}
            </Field>
            <Field label="Guardar leads que não compraram por (meses)" hint="Depois disso os dados são anonimizados.">
              {(id) => <Input id={id} type="number" min={1} max={60} value={form.leadRetentionMonths} onChange={(e) => set('leadRetentionMonths', Number(e.target.value) || 1)} />}
            </Field>
          </div>
          <p className="text-xs text-fg-muted">{LEGAL_NOTICE}</p>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-medium">Distribuição dos leads</h2>
          <Checkbox label="Distribuir os leads novos entre os vendedores abaixo, um de cada vez (rodízio)" checked={form.leadRoundRobin} onChange={(e) => set('leadRoundRobin', e.target.checked)} />
          <div className="grid gap-1 sm:grid-cols-2">
            {team.data?.map((u) => (
              <Checkbox
                key={u.id}
                label={u.name}
                checked={form.leadSellerIds.includes(u.id)}
                onChange={(e) => set('leadSellerIds', e.target.checked ? [...form.leadSellerIds, u.id] : form.leadSellerIds.filter((x) => x !== u.id))}
              />
            ))}
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-medium">Mensagem pronta do WhatsApp</h2>
          <Field label="Texto" hint="Variáveis: {{nome}}, {{vendedor}}, {{empresa}}, {{tipo}}, {{credito}}, {{prazo}}, {{parcela}}.">
            {(id) => <Textarea id={id} rows={4} maxLength={1000} value={form.leadWhatsappMessage} onChange={(e) => set('leadWhatsappMessage', e.target.value)} />}
          </Field>
        </Card>

        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">Indicação premiada</h2>
          <Field label="Recompensa (texto do link)" hint='Ex.: "R$ 200 por cota ativa". Aparece na página de quem foi indicado.'>
            {(id) => <Input id={id} maxLength={200} value={form.referralReward} onChange={(e) => set('referralReward', e.target.value)} />}
          </Field>
          <Field label="Valor padrão da recompensa (R$)">
            {(id) => <Input id={id} inputMode="decimal" value={String(form.referralRewardAmount)} onChange={(e) => set('referralRewardAmount', Number(e.target.value.replace(',', '.')) || 0)} />}
          </Field>
        </Card>

        {bureau && (
          <Card className="space-y-2 p-5">
            <h2 className="font-medium">Consulta de crédito na venda</h2>
            <Checkbox
              label="Exigir consulta de crédito aprovada (últimos 30 dias) antes de enviar a adesão"
              checked={form.requireCreditApproval}
              onChange={(e) => set('requireCreditApproval', e.target.checked)}
            />
            <p className="text-xs text-fg-muted">A consulta sempre precisa da autorização do cliente registrada; cada consulta tem custo.</p>
          </Card>
        )}

        <Button type="submit" loading={save.isPending}>
          Salvar
        </Button>
      </form>
    </>
  );
}
