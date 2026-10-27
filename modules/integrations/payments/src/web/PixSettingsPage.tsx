import { api, ApiError, formatMoney } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, PageHeader, QrCode, Spinner } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

interface Settings {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
}

const KEY = ['modules', 'integration.payments', 'settings'];

export function PixSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: KEY, queryFn: () => api<Settings>('/modules/integration.payments/settings') });
  const [form, setForm] = useState<Settings>({ pixKey: '', merchantName: '', merchantCity: '' });
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api('/modules/integration.payments/settings', { method: 'PUT', body: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      test.reset();
    },
  });
  const test = useMutation({ mutationFn: () => api<{ payload: string }>('/payments/pix', { method: 'POST', body: { amount: 0.01, reference: 'TESTE' } }) });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  if (settings.isPending) return <Spinner />;
  if (settings.isError) return <Alert>{settings.error.message}</Alert>;

  return (
    <>
      <PageHeader title="Pix" description="Dados usados para gerar o QR Code de cobrança no balcão." />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
            {save.isSuccess && <Alert tone="success">Dados salvos.</Alert>}
            <Field label="Chave Pix" hint="CPF/CNPJ (só números), e-mail, telefone (+5511…) ou chave aleatória.">
              {(id) => <Input id={id} value={form.pixKey} onChange={(e) => setForm({ ...form, pixKey: e.target.value })} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome do recebedor" hint="Até 25 caracteres, como aparece no banco.">
                {(id) => <Input id={id} maxLength={25} value={form.merchantName} onChange={(e) => setForm({ ...form, merchantName: e.target.value })} />}
              </Field>
              <Field label="Cidade" hint="Até 15 caracteres.">
                {(id) => <Input id={id} maxLength={15} value={form.merchantCity} onChange={(e) => setForm({ ...form, merchantCity: e.target.value })} />}
              </Field>
            </div>
            <Button type="submit" loading={save.isPending}>
              Salvar
            </Button>
          </form>
        </Card>

        <Card className="space-y-3 p-5 text-sm">
          <h2 className="font-medium">Testar</h2>
          <p className="text-fg-muted">Gere uma cobrança de {formatMoney(0.01)} e leia com o app do seu banco para conferir o recebedor.</p>
          {test.error && <Alert>{test.error instanceof ApiError ? test.error.message : 'Erro'}</Alert>}
          {test.data ? (
            <QrCode value={test.data.payload} size={180} label="QR Code Pix de teste" />
          ) : (
            <Button variant="secondary" size="sm" loading={test.isPending} onClick={() => test.mutate()}>
              Gerar QR de teste
            </Button>
          )}
          <p className="text-xs text-fg-muted">
            Este Pix é estático: o sistema não sabe sozinho que o dinheiro entrou. Confirme no banco e registre o pagamento na ordem.
          </p>
        </Card>
      </div>
    </>
  );
}
