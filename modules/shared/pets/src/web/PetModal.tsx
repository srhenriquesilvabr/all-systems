import { api, ApiError, CustomerSearch } from '@all/module-sdk/web';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { sizeLabel, species, speciesLabel, type Pet } from '../contracts';
import { petsKey } from './hooks';

/** Cadastro e edição de pet. Sem tutor definido, pede para escolher o cliente. */
export function PetModal({ pet, tutor, onClose, onSaved }: { pet: Pet | null; tutor?: { id: string; name?: string } | null; onClose: () => void; onSaved?: (p: Pet) => void }) {
  const queryClient = useQueryClient();
  const [owner, setOwner] = useState<{ id: string; name?: string } | null>(pet ? pet.tutor : (tutor ?? null));
  const [form, setForm] = useState({
    name: pet?.name ?? '',
    species: pet?.species ?? 'dog',
    breed: pet?.breed ?? '',
    sex: pet?.sex ?? 'unknown',
    birthDate: pet?.birthDate ?? '',
    weightKg: pet?.weightKg != null ? String(pet.weightKg).replace('.', ',') : '',
    coat: pet?.coat ?? '',
    size: pet?.size ?? '',
    neutered: pet?.neutered ?? false,
    microchip: pet?.microchip ?? '',
    notes: pet?.notes ?? '',
    deceased: pet?.deceased ?? false,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api<Pet>(pet ? `/pets/${pet.id}` : '/pets', {
        method: pet ? 'PATCH' : 'POST',
        body: {
          ...form,
          customerId: owner?.id,
          breed: form.breed || null,
          coat: form.coat || null,
          size: form.size || null,
          microchip: form.microchip || null,
          notes: form.notes || null,
          weightKg: form.weightKg ? Number(form.weightKg.replace(',', '.')) : null,
        },
      }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: petsKey });
      onSaved?.(saved);
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
      title={pet ? `Editar ${pet.name}` : 'Novo pet'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="pet-form" loading={save.isPending} disabled={!owner}>
            Salvar
          </Button>
        </>
      }
    >
      {!owner ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">Primeiro, quem é o tutor?</p>
          <CustomerSearch onSelect={setOwner} />
        </div>
      ) : (
        <form id="pet-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          {owner.name && (
            <p className="text-sm">
              Tutor: <span className="font-medium">{owner.name}</span>
              {!pet && !tutor && (
                <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => setOwner(null)}>
                  trocar
                </button>
              )}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome">{(id) => <Input id={id} required value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />}</Field>
            <Field label="Espécie">
              {(id) => (
                <Select id={id} value={form.species} onChange={(e) => set({ species: e.target.value as typeof form.species })}>
                  {species.map((s) => (
                    <option key={s} value={s}>
                      {speciesLabel[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Raça">{(id) => <Input id={id} value={form.breed} onChange={(e) => set({ breed: e.target.value })} placeholder="SRD, Poodle…" />}</Field>
            <Field label="Sexo">
              {(id) => (
                <Select id={id} value={form.sex} onChange={(e) => set({ sex: e.target.value as typeof form.sex })}>
                  <option value="unknown">Não informado</option>
                  <option value="male">Macho</option>
                  <option value="female">Fêmea</option>
                </Select>
              )}
            </Field>
            <Field label="Nascimento">{(id) => <Input id={id} type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />}</Field>
            <Field label="Peso (kg)">{(id) => <Input id={id} inputMode="decimal" value={form.weightKg} onChange={(e) => set({ weightKg: e.target.value })} placeholder="0,0" />}</Field>
            <Field label="Porte">
              {(id) => (
                <Select id={id} value={form.size} onChange={(e) => set({ size: e.target.value as typeof form.size })}>
                  <option value="">—</option>
                  {Object.entries(sizeLabel).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Pelagem">{(id) => <Input id={id} value={form.coat} onChange={(e) => set({ coat: e.target.value })} placeholder="Curta, longa, cor…" />}</Field>
            <Field label="Microchip">{(id) => <Input id={id} value={form.microchip} onChange={(e) => set({ microchip: e.target.value })} />}</Field>
          </div>
          <Field label="Observações" hint="Temperamento, alergias, cuidados no manejo.">
            {(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox label="Castrado(a)" checked={form.neutered} onChange={(e) => set({ neutered: e.target.checked })} />
            {pet && <Checkbox label="Falecido(a)" checked={form.deceased} onChange={(e) => set({ deceased: e.target.checked })} />}
          </div>
        </form>
      )}
    </Modal>
  );
}
