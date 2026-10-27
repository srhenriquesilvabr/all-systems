import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { creditProductLabel, creditProducts, type BankConnection, type CreditProduct } from '../contracts';

export const bankingKey = ['banking'] as const;

/** Instituições parceiras: simuladas (demonstração) ou pela API de cada uma. */
export function ConnectionsPage() {
  const list = useQuery({ queryKey: [...bankingKey, 'connections'], queryFn: () => api<BankConnection[]>('/banking/connections') });
  const [editing, setEditing] = useState<BankConnection | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Bancos e financeiras"
        description="Instituições usadas na simulação e no envio de propostas. As simuladas servem para demonstração; com contrato de parceria, configure a API da instituição."
        actions={<Button onClick={() => setEditing('new')}>Nova instituição</Button>}
      />
      <Card>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <Alert>{list.error.message}</Alert>
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma instituição" />
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
                  </Td>
                  <Td className="text-sm">{c.products.map((p) => creditProductLabel[p]).join(', ')}</Td>
                  <Td>{c.mode === 'api' ? <Badge tone="success">API</Badge> : <Badge>Simulação</Badge>}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                      Editar
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ConnectionModal connection={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ConnectionModal({ connection, onClose }: { connection: BankConnection | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: connection?.name ?? '',
    mode: connection?.mode ?? 'simulated',
    products: connection?.products ?? (['vehicle_financing'] as CreditProduct[]),
    baseUrl: connection?.baseUrl ?? '',
    clientId: connection?.clientId ?? '',
    clientSecret: '',
    webhookSecret: '',
    vehicleMonthlyRate: String(connection?.vehicleMonthlyRate ?? 1.99).replace('.', ','),
    realEstateYearlyRate: String(connection?.realEstateYearlyRate ?? 11.5).replace('.', ','),
    tacFee: String(connection?.tacFee ?? 0).replace('.', ','),
    active: connection?.active ?? true,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const num = (v: string) => Number(v.replace(',', '.'));
  const save = useMutation({
    mutationFn: () =>
      api(connection ? `/banking/connections/${connection.id}` : '/banking/connections', {
        method: connection ? 'PATCH' : 'POST',
        body: {
          ...form,
          baseUrl: form.baseUrl || null,
          clientId: form.clientId || null,
          clientSecret: form.clientSecret || null,
          webhookSecret: form.webhookSecret || null,
          vehicleMonthlyRate: num(form.vehicleMonthlyRate),
          realEstateYearlyRate: num(form.realEstateYearlyRate),
          tacFee: num(form.tacFee),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bankingKey });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Modal
      open
      title={connection ? 'Editar instituição' : 'Nova instituição'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="bank-connection-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="bank-connection-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <Field label="Nome">{(id) => <Input id={id} required value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />}</Field>
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
        <Field label="Conexão">
          {(id) => (
            <Select id={id} value={form.mode} onChange={(e) => set({ mode: e.target.value as typeof form.mode })}>
              <option value="simulated">Simulação (taxas abaixo, decisão automática)</option>
              <option value="api">API da instituição</option>
            </Select>
          )}
        </Field>
        {form.mode === 'api' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="URL da API">{(id) => <Input id={id} required value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.instituicao.com.br" />}</Field>
            </div>
            <Field label="Client ID">{(id) => <Input id={id} value={form.clientId} onChange={(e) => set({ clientId: e.target.value })} />}</Field>
            <Field label="Client secret" hint={connection?.hasClientSecret ? 'Em branco mantém o atual.' : undefined}>
              {(id) => <Input id={id} type="password" autoComplete="off" value={form.clientSecret} onChange={(e) => set({ clientSecret: e.target.value })} />}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Segredo do webhook" hint={connection ? `A instituição avisa em ${connection.webhookUrl}` : 'O endereço do webhook aparece depois de salvar.'}>
                {(id) => <Input id={id} type="password" autoComplete="off" value={form.webhookSecret} onChange={(e) => set({ webhookSecret: e.target.value })} />}
              </Field>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Veículo (% a.m.)">{(id) => <Input id={id} inputMode="decimal" value={form.vehicleMonthlyRate} onChange={(e) => set({ vehicleMonthlyRate: e.target.value })} />}</Field>
            <Field label="Imóvel (% a.a.)">{(id) => <Input id={id} inputMode="decimal" value={form.realEstateYearlyRate} onChange={(e) => set({ realEstateYearlyRate: e.target.value })} />}</Field>
            <Field label="Tarifa de cadastro (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.tacFee} onChange={(e) => set({ tacFee: e.target.value })} />}</Field>
          </div>
        )}
        <Checkbox label="Ativa" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
      </form>
    </Modal>
  );
}
