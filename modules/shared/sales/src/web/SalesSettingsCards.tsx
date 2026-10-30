import { api, ApiError, useCan } from '@all/module-sdk/web';
import { Alert, Button, Card, Checkbox, Field, Input, Select } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { SalesSettings } from '../contracts';
import { registersKey, useRegisters, useSalesSettings } from './hooks';

const SETTINGS_KEY = ['modules', 'shared.sales', 'settings'];

/** O PUT grava o objeto inteiro: sempre parte do que já está salvo. */
function useSaveSettings() {
  const queryClient = useQueryClient();
  const settings = useSalesSettings();
  const save = useMutation({
    mutationFn: (patch: Partial<SalesSettings>) => api('/modules/shared.sales/settings', { method: 'PUT', body: { ...(settings.data as SalesSettings), ...patch } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      queryClient.invalidateQueries({ queryKey: registersKey });
    },
  });
  return { settings, save };
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Erro ao salvar');

/** Em Produtos e estoque: vender ou não o que não tem em estoque. */
export function StockRuleCard() {
  const canConfigure = useCan('core.access.settings');
  const { settings, save } = useSaveSettings();
  if (!canConfigure || !settings.data) return null;
  return (
    <Card className="mt-6 space-y-2 p-5">
      {save.error && <Alert>{errorText(save.error)}</Alert>}
      <Checkbox
        label="Bloquear a venda de produto sem estoque"
        checked={settings.data.blockNegativeStock}
        disabled={save.isPending}
        onChange={(e) => save.mutate({ blockNegativeStock: e.target.checked })}
      />
      <p className="text-sm text-fg-muted">Vale para o PDV e a lojinha, só nos produtos com Controlar estoque ligado. Desligado, o saldo pode ficar negativo (quem produz e vende no mesmo dia costuma deixar assim).</p>
    </Card>
  );
}

/** Em Caixas: conta onde entram Pix e cartões e rodapé do cupom. */
export function PosSettingsCard() {
  const canConfigure = useCan('core.access.settings');
  const registers = useRegisters();
  const { settings, save } = useSaveSettings();
  const [bankAccountId, setBankAccountId] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setBankAccountId(settings.data.bankAccountId ?? '');
    setReceiptFooter(settings.data.receiptFooter);
  }, [settings.data]);
  if (!canConfigure || !settings.data) return null;

  return (
    <Card className="mt-6 max-w-xl space-y-4 p-5">
      <h2 className="font-medium">Configurações do caixa</h2>
      {save.error && <Alert>{errorText(save.error)}</Alert>}
      {save.isSuccess && <Alert tone="success">Configurações salvas.</Alert>}
      <Field label="Conta de Pix e cartões" hint="Dinheiro entra sempre na conta Caixa. Esta conta recebe as vendas por Pix, cartão e outras formas, a partir de agora.">
        {(id) => (
          <Select id={id} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Mesma conta do dinheiro (Caixa)</option>
            {registers.data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Rodapé do cupom" hint="Até 200 caracteres. Em branco, o cupom sai sem rodapé. A frase “Não é documento fiscal” sempre sai.">
        {(id) => <Input id={id} maxLength={200} value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} />}
      </Field>
      <Button loading={save.isPending} onClick={() => save.mutate({ bankAccountId: bankAccountId || null, receiptFooter })}>
        Salvar configurações
      </Button>
    </Card>
  );
}
