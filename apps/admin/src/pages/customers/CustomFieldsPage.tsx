import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useCustomFields } from './CustomerForm';
import type { CustomField } from './types';

const typeLabels: Record<CustomField['type'], string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  boolean: 'Sim/Não',
  select: 'Lista de opções',
};

export function CustomFieldsPage() {
  const queryClient = useQueryClient();
  const fields = useCustomFields();
  const [creating, setCreating] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/custom-fields/customer/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  });

  return (
    <>
      <PageHeader
        title="Campos de clientes"
        description="Informações extras que sua empresa quer guardar no cadastro de clientes."
        actions={<Button onClick={() => setCreating(true)}>Novo campo</Button>}
      />
      {remove.error && (
        <div className="mb-4">
          <Alert>{remove.error.message}</Alert>
        </div>
      )}
      <Card>
        {fields.isPending ? (
          <Spinner />
        ) : fields.isError ? (
          <div className="p-4">
            <Alert>{fields.error.message}</Alert>
          </div>
        ) : fields.data.length === 0 ? (
          <EmptyState title="Nenhum campo extra" description="Exemplos: “Como conheceu a empresa”, “Preferência de contato”, “Limite de crédito”." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Campo</Th>
                <Th>Tipo</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {fields.data.map((f) => (
                <tr key={f.id}>
                  <Td>
                    <span className="font-medium">{f.label}</span> {f.required && <Badge>Obrigatório</Badge>}
                  </Td>
                  <Td className="text-fg-muted">
                    {typeLabels[f.type]}
                    {f.options && `: ${f.options.join(', ')}`}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => confirm(`Excluir o campo "${f.label}"? Os valores já preenchidos deixam de aparecer.`) && remove.mutate(f.id)}
                    >
                      Excluir
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {creating && <NewFieldModal onClose={() => setCreating(false)} />}
    </>
  );
}

function NewFieldModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomField['type']>('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      api('/custom-fields/customer', {
        method: 'POST',
        body: { label, type, required, options: type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : undefined },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields'] });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      open
      title="Novo campo"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="field-form" loading={create.isPending}>
            Criar
          </Button>
        </>
      }
    >
      <form id="field-form" onSubmit={submit} className="space-y-4">
        {create.error && <Alert>{create.error instanceof ApiError ? create.error.message : 'Erro ao criar'}</Alert>}
        <Field label="Nome do campo">{(id) => <Input id={id} required minLength={2} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />}</Field>
        <Field label="Tipo" hint="O tipo não pode ser alterado depois.">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as CustomField['type'])}>
              {Object.entries(typeLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {type === 'select' && (
          <Field label="Opções" hint="Separadas por vírgula.">
            {(id) => <Input id={id} required value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Indicação, Instagram, Google" />}
          </Field>
        )}
        <Checkbox label="Preenchimento obrigatório" checked={required} onChange={(e) => setRequired(e.target.checked)} />
      </form>
    </Modal>
  );
}
