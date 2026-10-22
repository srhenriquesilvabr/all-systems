import { api, ApiError } from '@all/module-sdk/web';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { formatDocument, formatPhone } from './format';
import type { Address, Customer, CustomField, Duplicate } from './types';

const matchLabel = { document: 'CPF/CNPJ', email: 'e-mail', phone: 'telefone' } as const;

export const useCustomFields = () =>
  useQuery({ queryKey: ['custom-fields', 'customer'], queryFn: () => api<CustomField[]>('/custom-fields/customer') });

/** Cadastro e edição de cliente, com aviso de possíveis duplicados. */
export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const queryClient = useQueryClient();
  const fields = useCustomFields();
  const [form, setForm] = useState({
    type: customer?.type ?? ('person' as Customer['type']),
    name: customer?.name ?? '',
    document: formatDocument(customer?.document ?? null),
    email: customer?.email ?? '',
    phone: formatPhone(customer?.phone ?? null),
    birthDate: customer?.birthDate ?? '',
    notes: customer?.notes ?? '',
  });
  const [address, setAddress] = useState<Address>(customer?.address ?? {});
  const [custom, setCustom] = useState<Record<string, unknown>>(customer?.customFields ?? {});
  const [duplicates, setDuplicates] = useState<{ list: Duplicate[]; blocking: boolean } | null>(null);

  const save = useMutation({
    mutationFn: (allowDuplicates: boolean) => {
      const body = { ...form, birthDate: form.type === 'person' ? form.birthDate : null, address, customFields: custom };
      const query = { allowDuplicates: allowDuplicates ? 'true' : undefined };
      return customer
        ? api<Customer>(`/customers/${customer.id}`, { method: 'PATCH', body, query })
        : api<Customer>('/customers', { method: 'POST', body, query });
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onSaved(saved);
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.code === 'POSSIBLE_DUPLICATE' || err.code === 'DUPLICATE_DOCUMENT')) {
        setDuplicates({ list: (err.body as { duplicates: Duplicate[] }).duplicates, blocking: err.code === 'DUPLICATE_DOCUMENT' });
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setDuplicates(null);
    save.mutate(false);
  }

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const isPerson = form.type === 'person';
  const showError = save.error && !duplicates;

  return (
    <Modal
      open
      title={customer ? 'Editar cliente' : 'Novo cliente'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {duplicates && !duplicates.blocking ? (
            <Button loading={save.isPending} onClick={() => save.mutate(true)}>
              Salvar mesmo assim
            </Button>
          ) : (
            <Button type="submit" form="customer-form" loading={save.isPending}>
              Salvar
            </Button>
          )}
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="space-y-4">
        {showError && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {duplicates && (
          <Alert tone={duplicates.blocking ? 'danger' : 'info'}>
            <p className="font-medium">{duplicates.blocking ? 'Este CPF/CNPJ já está cadastrado:' : 'Encontramos cadastros parecidos:'}</p>
            <ul className="mt-1 list-disc pl-5">
              {duplicates.list.map((d) => (
                <li key={d.id}>
                  <Link to={`/clientes/${d.id}`} className="underline" onClick={onClose}>
                    {d.name}
                  </Link>{' '}
                  (mesmo {d.matchedOn.map((m) => matchLabel[m]).join(' e ')})
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={form.type} onChange={(e) => set({ type: e.target.value as Customer['type'] })}>
                <option value="person">Pessoa física</option>
                <option value="company">Empresa</option>
              </Select>
            )}
          </Field>
          <Field label={isPerson ? 'Nome completo' : 'Razão social ou nome fantasia'}>
            {(id) => <Input id={id} required minLength={2} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isPerson ? 'CPF' : 'CNPJ'}>{(id) => <Input id={id} inputMode="numeric" value={form.document} onChange={(e) => set({ document: e.target.value })} />}</Field>
          {isPerson && (
            <Field label="Nascimento">{(id) => <Input id={id} type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />}</Field>
          )}
          <Field label="Telefone / WhatsApp">
            {(id) => <Input id={id} type="tel" placeholder="(11) 98765-4321" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />}
          </Field>
          <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Endereço</legend>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_6rem]">
            <Input aria-label="CEP" placeholder="CEP" value={address.zip ?? ''} onChange={(e) => setAddress({ ...address, zip: e.target.value })} />
            <Input aria-label="Rua" placeholder="Rua" value={address.street ?? ''} onChange={(e) => setAddress({ ...address, street: e.target.value })} />
            <Input aria-label="Número" placeholder="Nº" value={address.number ?? ''} onChange={(e) => setAddress({ ...address, number: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_5rem]">
            <Input aria-label="Complemento" placeholder="Complemento" value={address.complement ?? ''} onChange={(e) => setAddress({ ...address, complement: e.target.value })} />
            <Input aria-label="Bairro" placeholder="Bairro" value={address.district ?? ''} onChange={(e) => setAddress({ ...address, district: e.target.value })} />
            <Input aria-label="Cidade" placeholder="Cidade" value={address.city ?? ''} onChange={(e) => setAddress({ ...address, city: e.target.value })} />
            <Input aria-label="UF" placeholder="UF" maxLength={2} value={address.state ?? ''} onChange={(e) => setAddress({ ...address, state: e.target.value.toUpperCase() })} />
          </div>
        </fieldset>

        {fields.data?.map((f) => <CustomFieldInput key={f.id} field={f} value={custom[f.key]} onChange={(v) => setCustom({ ...custom, [f.key]: v })} />)}

        <Field label="Observações">{(id) => <Textarea id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: unknown; onChange: (v: unknown) => void }) {
  const label = field.required ? `${field.label} *` : field.label;
  if (field.type === 'boolean') return <Checkbox label={field.label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  return (
    <Field label={label}>
      {(id) =>
        field.type === 'select' ? (
          <Select id={id} required={field.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">Selecione</option>
            {field.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id={id}
            required={field.required}
            type={field.type === 'date' ? 'date' : 'text'}
            inputMode={field.type === 'number' ? 'decimal' : undefined}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}
