import type { Pet } from '@all/pets';
import { api, ApiError, formatDate, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { matchVaccine, type Vaccination, type VaccineCatalogEntry } from '../contracts';

export const vetKey = ['vet'] as const;

export const useVaccineCatalog = () => useQuery({ queryKey: [...vetKey, 'catalog'], queryFn: () => api<VaccineCatalogEntry[]>('/vet/vaccines'), staleTime: 60_000 });

/** Aba "Vacinas" na ficha do pet: a carteira de vacinação, com impressão. */
export function VaccinesTab({ pet }: { pet: Pet }) {
  const canWrite = useCan('vet.vaccines.write');
  const list = useQuery({ queryKey: [...vetKey, 'vaccinations', pet.id], queryFn: () => api<Vaccination[]>(`/vet/pets/${pet.id}/vaccinations`) });
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Vaccination | null>(null);

  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{list.error.message}</Alert>;
  const now = today();

  return (
    <>
      <div className="mb-3 flex justify-end gap-2 print:hidden">
        {list.data.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            Imprimir carteira
          </Button>
        )}
        {canWrite && (
          <Button size="sm" onClick={() => setAdding(true)}>
            Registrar vacina
          </Button>
        )}
      </div>
      <h2 className="mb-2 hidden text-lg font-medium print:block">Carteira de vacinação — {pet.name}</h2>
      <Card>
        {list.data.length === 0 ? (
          <EmptyState title="Nenhuma vacina registrada" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vacina</Th>
                <Th>Aplicada</Th>
                <Th>Reforço</Th>
                <Th>Lote</Th>
                <Th>Responsável</Th>
                <Th className="print:hidden" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((v) => (
                <tr key={v.id} className={v.voided ? 'text-fg-subtle line-through' : undefined}>
                  <Td>
                    <span className="font-medium">{v.vaccineName}</span>
                    {v.dose && <span className="text-fg-muted"> · {v.dose}</span>}
                    {v.vaccine !== v.vaccineName && <div className="text-xs text-fg-muted">Registrada como “{v.vaccine}”</div>}
                    {v.notes && <div className="whitespace-pre-line text-xs text-fg-muted">{v.notes}</div>}
                    {v.voided && <div className="text-xs no-underline">Anulada: {v.voided.reason}</div>}
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{formatDate(v.appliedOn)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {v.nextDueOn ? (
                      <>
                        {formatDate(v.nextDueOn)} {!v.voided && v.nextDueOn < now && <Badge tone="danger">Vencida</Badge>}
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>{[v.batch, v.manufacturer].filter(Boolean).join(' · ') || '—'}</Td>
                  <Td>{v.appliedBy}</Td>
                  <Td className="text-right print:hidden">
                    {canWrite && !v.voided && (
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(v)}>
                        Anular
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {adding && <VaccinationModal petId={pet.id} onClose={() => setAdding(false)} />}
      {voiding && <VoidModal vaccination={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

function VaccinationModal({ petId, onClose }: { petId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ vaccine: '', dose: '', batch: '', manufacturer: '', appliedOn: today(), nextDueOn: '', notes: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const catalog = useVaccineCatalog();
  const matched = form.vaccine.trim() ? matchVaccine(form.vaccine, catalog.data ?? []) : undefined;
  const save = useMutation({
    mutationFn: () =>
      api('/vet/vaccinations', {
        method: 'POST',
        body: { ...form, petId, dose: form.dose || null, batch: form.batch || null, manufacturer: form.manufacturer || null, notes: form.notes || null },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vetKey });
      onClose();
    },
  });
  // Reforço anual é o mais comum: sugere a mesma data no ano seguinte.
  const nextYear = (d: string) => (d ? `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` : '');

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open
      title="Registrar vacina"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="vet-vaccination-form" loading={save.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="vet-vaccination-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field
            label="Vacina"
            hint={
              !form.vaccine.trim()
                ? 'Escolha da lista. Se digitar, o sistema procura no catálogo.'
                : matched
                  ? matched.name === form.vaccine.trim()
                    ? undefined
                    : `Conta como ${matched.name}.`
                  : 'Vacina nova: entra no catálogo com este nome. Confira se não é um nome diferente para uma que já existe.'
            }
          >
            {(id) => (
              <>
                <Input id={id} required list="vet-vaccines" value={form.vaccine} onChange={(e) => set({ vaccine: e.target.value })} autoFocus />
                <datalist id="vet-vaccines">
                  {catalog.data
                    ?.filter((v) => v.active)
                    .map((v) => (
                      <option key={v.id} value={v.name} />
                    ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Dose">{(id) => <Input id={id} value={form.dose} onChange={(e) => set({ dose: e.target.value })} placeholder="1ª dose, reforço…" />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Aplicada em">{(id) => <Input id={id} type="date" required max={today()} value={form.appliedOn} onChange={(e) => set({ appliedOn: e.target.value })} />}</Field>
          <Field label="Próximo reforço" hint="O tutor é lembrado antes.">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} type="date" value={form.nextDueOn} onChange={(e) => set({ nextDueOn: e.target.value })} />
                <Button type="button" size="sm" variant="ghost" onClick={() => set({ nextDueOn: nextYear(form.appliedOn) })}>
                  +1 ano
                </Button>
              </div>
            )}
          </Field>
          <Field label="Lote">{(id) => <Input id={id} value={form.batch} onChange={(e) => set({ batch: e.target.value })} />}</Field>
          <Field label="Fabricante">{(id) => <Input id={id} value={form.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} />}</Field>
        </div>
        <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

function VoidModal({ vaccination, onClose }: { vaccination: Vaccination; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/vet/vaccinations/${vaccination.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vetKey });
      onClose();
    },
  });
  return (
    <Modal
      open
      title={`Anular ${vaccination.vaccineName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()}>
            Anular
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao anular'}</Alert>}
        <p className="text-sm text-fg-muted">A vacina continua na carteira, riscada, com o motivo. Use para lançamentos errados.</p>
        <Field label="Motivo">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
      </div>
    </Modal>
  );
}
