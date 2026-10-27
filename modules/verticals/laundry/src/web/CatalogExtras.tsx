import { api, ApiError, formatMoney, parseMoney } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { LaundryService } from '../contracts';
import { laundryKey, useGarmentTypes, useServicePrices } from './hooks';

/** Tipos de peça usados no balcão e na tabela de preços. */
export function GarmentTypesTab() {
  const queryClient = useQueryClient();
  const garments = useGarmentTypes();
  const [name, setName] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...laundryKey, 'garment-types'] });
  const create = useMutation({
    mutationFn: () => api('/laundry/garment-types', { method: 'POST', body: { name } }),
    onSuccess: () => {
      setName('');
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api(`/laundry/garment-types/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: refresh,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-wrap gap-2 p-4">
        <Input aria-label="Novo tipo de peça" placeholder="Novo tipo de peça (ex.: Vestido de festa)" className="max-w-sm" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" loading={create.isPending} disabled={name.trim().length < 2}>
          Adicionar
        </Button>
      </form>
      {(create.error || toggle.error) && (
        <div className="px-4 pb-3">
          <Alert>{(create.error ?? toggle.error) instanceof ApiError ? (create.error ?? toggle.error)!.message : 'Erro'}</Alert>
        </div>
      )}
      {garments.isPending ? (
        <Spinner />
      ) : !garments.data?.length ? (
        <EmptyState title="Nenhum tipo de peça" />
      ) : (
        <Table>
          <tbody>
            {garments.data.map((g) => (
              <tr key={g.id}>
                <Td className={g.active ? '' : 'text-fg-subtle'}>{g.name}</Td>
                <Td>{!g.active && <Badge>Inativo</Badge>}</Td>
                <Td className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => toggle.mutate({ id: g.id, active: !g.active })}>
                    {g.active ? 'Desativar' : 'Reativar'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/** Preço do serviço por tipo de peça. Em branco = vale o preço base. */
export function PricesModal({ service, onClose }: { service: LaundryService; onClose: () => void }) {
  const queryClient = useQueryClient();
  const garments = useGarmentTypes();
  const prices = useServicePrices(service.id);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (prices.data) setValues(Object.fromEntries(prices.data.map((p) => [p.garmentTypeId, p.price.toFixed(2).replace('.', ',')])));
  }, [prices.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/laundry/services/${service.id}/prices`, {
        method: 'PUT',
        body: {
          prices: Object.entries(values)
            .filter(([, v]) => v.trim() !== '')
            .map(([garmentTypeId, v]) => ({ garmentTypeId, price: parseMoney(v) })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...laundryKey, 'prices', service.id] });
      onClose();
    },
  });

  return (
    <Modal
      open
      title={`Preço por peça — ${service.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      {save.error && (
        <div className="mb-3">
          <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>
        </div>
      )}
      <p className="mb-3 text-sm text-fg-muted">Deixe em branco para usar o preço base ({formatMoney(service.basePrice)}).</p>
      {garments.isPending || prices.isPending ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Tipo de peça</Th>
              <Th className="w-36">Preço (R$)</Th>
            </tr>
          </thead>
          <tbody>
            {garments.data
              ?.filter((g) => g.active)
              .map((g) => (
                <tr key={g.id}>
                  <Td>{g.name}</Td>
                  <Td>
                    <Input
                      aria-label={`Preço para ${g.name}`}
                      inputMode="decimal"
                      placeholder={service.basePrice.toFixed(2).replace('.', ',')}
                      value={values[g.id] ?? ''}
                      onChange={(e) => setValues({ ...values, [g.id]: e.target.value })}
                    />
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
      )}
    </Modal>
  );
}
