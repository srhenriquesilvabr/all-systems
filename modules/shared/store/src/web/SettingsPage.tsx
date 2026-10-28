import { api, ApiError, apiUpload, AuthImage, formatPhone, parseMoney } from '@all/module-sdk/web';
import { Alert, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { paymentModeHint, paymentModeLabel, paymentModes, type PaymentMode, type StoreSettings } from '../contracts';
import { moneyText, storeKey, useStoreStatus } from './hooks';

const KEY = [...storeKey, 'settings'];

/** Valores de dinheiro ficam como texto enquanto a pessoa digita ("12,50"). */
interface Form extends Omit<StoreSettings, 'delivery'> {
  delivery: Omit<StoreSettings['delivery'], 'fixedFee' | 'minOrder' | 'districts'> & { fixedFee: string; minOrder: string; districts: { name: string; fee: string }[] };
}

const toForm = (s: StoreSettings): Form => ({
  ...s,
  delivery: { ...s.delivery, fixedFee: moneyText(s.delivery.fixedFee), minOrder: moneyText(s.delivery.minOrder), districts: s.delivery.districts.map((d) => ({ name: d.name, fee: moneyText(d.fee) })) },
});

const money = (s: string) => (s.trim() ? parseMoney(s) : 0);

export function StoreSettingsPage() {
  const queryClient = useQueryClient();
  const status = useStoreStatus();
  const settings = useQuery({ queryKey: KEY, queryFn: () => api<StoreSettings>('/store/settings') });
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (settings.data) setForm(toForm(settings.data));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () =>
      api<StoreSettings>('/store/settings', {
        method: 'PUT',
        body: {
          ...form,
          delivery: {
            ...form!.delivery,
            fixedFee: money(form!.delivery.fixedFee),
            minOrder: money(form!.delivery.minOrder),
            districts: form!.delivery.districts.filter((d) => d.name.trim()).map((d) => ({ name: d.name.trim(), fee: money(d.fee) })),
          },
        },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(KEY, saved);
      queryClient.invalidateQueries({ queryKey: [...storeKey, 'status'] });
    },
  });

  if (settings.isPending || !form) return settings.isError ? <Alert>{settings.error.message}</Alert> : <Spinner />;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setPickup = (patch: Partial<Form['pickup']>) => set({ pickup: { ...form.pickup, ...patch } });
  const setDelivery = (patch: Partial<Form['delivery']>) => set({ delivery: { ...form.delivery, ...patch } });
  const toggleMode = (mode: PaymentMode, on: boolean) => set({ paymentModes: on ? paymentModes.filter((m) => m === mode || form.paymentModes.includes(m)) : form.paymentModes.filter((m) => m !== mode) });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <>
      <PageHeader title="Lojinha" description="Endereço público, entrega, formas de finalizar o pedido e textos da loja online." />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {save.isSuccess && <Alert tone="success">Configurações salvas.</Alert>}

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Loja</h2>
          <Checkbox label="Loja aberta, recebendo pedidos" checked={form.open} onChange={(e) => set({ open: e.target.checked })} />
          {status.data?.publicUrl ? (
            <p className="text-sm text-fg-muted">
              Endereço da loja:{' '}
              <a href={status.data.publicUrl} target="_blank" rel="noreferrer" className="break-all text-brand-700 hover:underline">
                {status.data.publicUrl}
              </a>{' '}
              (o final é o endereço público da empresa, em Dados da empresa)
            </p>
          ) : (
            <Alert tone="info">A empresa ainda não tem endereço público: defina em Dados da empresa.</Alert>
          )}
          <Field label="Mensagem com a loja pausada">{(id) => <Input id={id} maxLength={300} value={form.pausedMessage} onChange={(e) => set({ pausedMessage: e.target.value })} />}</Field>
          <Field label="Boas-vindas" hint="Aparece no topo da loja e na descrição para o Google.">
            {(id) => <Textarea id={id} rows={3} maxLength={1000} value={form.welcome} onChange={(e) => set({ welcome: e.target.value })} placeholder="Pães e doces feitos todos os dias. Peça até as 10h e retire à tarde." />}
          </Field>
          <Field label="Produto sem estoque">
            {(id) => (
              <Select id={id} value={form.outOfStock} onChange={(e) => set({ outOfStock: e.target.value as Form['outOfStock'] })}>
                <option value="sold_out">Aparece como "esgotado"</option>
                <option value="hide">Some da loja</option>
              </Select>
            )}
          </Field>
          <Banner fileId={status.data?.bannerFileId ?? null} />
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Retirada e entrega</h2>
          <Checkbox label="Retirada no local" checked={form.pickup.enabled} onChange={(e) => setPickup({ enabled: e.target.checked })} />
          {form.pickup.enabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Endereço de retirada">{(id) => <Input id={id} maxLength={300} value={form.pickup.address} onChange={(e) => setPickup({ address: e.target.value })} />}</Field>
              <Field label="Horário de retirada">{(id) => <Input id={id} maxLength={300} value={form.pickup.hours} onChange={(e) => setPickup({ hours: e.target.value })} placeholder="Seg. a sáb., das 8h às 18h" />}</Field>
            </div>
          )}
          <Checkbox label="Entrega" checked={form.delivery.enabled} onChange={(e) => setDelivery({ enabled: e.target.checked })} />
          {form.delivery.enabled && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Taxa de entrega">
                  {(id) => (
                    <Select id={id} value={form.delivery.feeMode} onChange={(e) => setDelivery({ feeMode: e.target.value as 'fixed' | 'district' })}>
                      <option value="fixed">Fixa</option>
                      <option value="district">Por bairro</option>
                    </Select>
                  )}
                </Field>
                {form.delivery.feeMode === 'fixed' && (
                  <Field label="Valor (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.delivery.fixedFee} onChange={(e) => setDelivery({ fixedFee: e.target.value })} placeholder="0,00" />}</Field>
                )}
                <Field label="Pedido mínimo (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.delivery.minOrder} onChange={(e) => setDelivery({ minOrder: e.target.value })} placeholder="0,00" />}</Field>
                <Field label="Prazo de entrega">{(id) => <Input id={id} maxLength={120} value={form.delivery.eta} onChange={(e) => setDelivery({ eta: e.target.value })} placeholder="Até 60 minutos" />}</Field>
              </div>
              {form.delivery.feeMode === 'district' && (
                <div className="space-y-2">
                  <p className="text-sm text-fg-muted">Bairros atendidos (fora da lista, a loja não oferece entrega):</p>
                  {form.delivery.districts.map((d, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        aria-label="Bairro"
                        placeholder="Bairro"
                        value={d.name}
                        onChange={(e) => setDelivery({ districts: form.delivery.districts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                      />
                      <Input
                        aria-label="Taxa (R$)"
                        placeholder="0,00"
                        inputMode="decimal"
                        className="w-28"
                        value={d.fee}
                        onChange={(e) => setDelivery({ districts: form.delivery.districts.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)) })}
                      />
                      <Button variant="ghost" size="sm" onClick={() => setDelivery({ districts: form.delivery.districts.filter((_, j) => j !== i) })}>
                        Remover
                      </Button>
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" onClick={() => setDelivery({ districts: [...form.delivery.districts, { name: '', fee: '' }] })}>
                    Adicionar bairro
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Finalizar o pedido</h2>
          {paymentModes.map((mode) => {
            const online = mode === 'online';
            const unavailable = online && !status.data?.onlinePaymentAvailable;
            return (
              <div key={mode}>
                <Checkbox label={`${paymentModeLabel[mode]}${unavailable ? ' (em breve)' : ''}`} checked={form.paymentModes.includes(mode)} disabled={unavailable && !form.paymentModes.includes(mode)} onChange={(e) => toggleMode(mode, e.target.checked)} />
                <p className="ml-6 text-xs text-fg-muted">
                  {online ? 'Cobrança pelo site, quando o meio de pagamento da Palmer for ligado. Até lá a opção não aparece na loja.' : paymentModeHint[mode]}
                </p>
              </div>
            );
          })}
          <Field label="WhatsApp que recebe os pedidos" hint={`Vazio = telefone dos dados da empresa${status.data?.companyPhone ? ` (${formatPhone(status.data.companyPhone)})` : ''}.`}>
            {(id) => <Input id={id} type="tel" maxLength={30} value={form.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="(11) 98765-4321" />}
          </Field>
          {status.data && !status.data.notifications && (
            <p className="text-sm text-fg-muted">Os avisos de andamento ao cliente (e-mail/WhatsApp) saem quando o módulo de Notificações estiver ativo.</p>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-medium">Políticas e privacidade</h2>
          <Field label="Política de troca e devolução">
            {(id) => <Textarea id={id} rows={4} maxLength={3000} value={form.exchangePolicy} onChange={(e) => set({ exchangePolicy: e.target.value })} placeholder="Trocas em até 7 dias com a nota…" />}
          </Field>
          <Field label="E-mail para pedidos de privacidade" hint="Aparece no texto de uso dos dados, no fim do pedido.">
            {(id) => <Input id={id} type="email" value={form.privacyEmail} onChange={(e) => set({ privacyEmail: e.target.value })} placeholder="privacidade@empresa.com.br" />}
          </Field>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </>
  );
}

function Banner({ fileId }: { fileId: string | null }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...storeKey, 'status'] });
  const upload = useMutation({ mutationFn: (file: File) => apiUpload('/store/banner', 'banner', file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api('/store/banner', { method: 'DELETE' }), onSuccess: refresh });
  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) upload.mutate(file);
  }
  const error = upload.error ?? remove.error;
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium">Banner</span>
      {error && <Alert>{error.message}</Alert>}
      {fileId ? <AuthImage fileId={fileId} alt="Banner da loja" className="aspect-[3/1] w-full rounded-xl object-cover" /> : <p className="text-sm text-fg-muted">Sem banner. Use uma imagem larga (ex.: 1500 × 500), JPG, PNG ou WebP até 5 MB.</p>}
      <div className="flex gap-2">
        <label className={`inline-flex h-8 cursor-pointer items-center rounded-full border border-line px-3.5 text-sm font-medium hover:border-fg ${upload.isPending ? 'pointer-events-none opacity-50' : ''}`}>
          {upload.isPending ? 'Enviando…' : fileId ? 'Trocar banner' : 'Enviar banner'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} />
        </label>
        {fileId && (
          <Button variant="ghost" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remover
          </Button>
        )}
      </div>
    </div>
  );
}
