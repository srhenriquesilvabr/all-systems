import type { SubjectValue } from '@all/scheduling/web';
import { Button, Select } from '@all/ui';
import { useEffect, useState } from 'react';
import { speciesLabel } from '../contracts';
import { usePets } from './hooks';
import { PetModal } from './PetModal';

/** Escolha do pet no formulário de horário da agenda. */
export function PetPicker({ customerId, value, onChange }: { customerId: string; value: SubjectValue | null; onChange: (v: SubjectValue | null) => void }) {
  const pets = usePets({ customerId });
  const [creating, setCreating] = useState(false);
  const alive = pets.data?.filter((p) => !p.deceased) ?? [];

  // Com um pet só, já vem escolhido.
  useEffect(() => {
    if (!value && alive.length === 1) onChange({ type: 'pet', id: alive[0]!.id, label: alive[0]!.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pets.data]);

  return (
    <div className="flex gap-2">
      <Select
        aria-label="Pet"
        className="flex-1"
        value={value?.id ?? ''}
        onChange={(e) => {
          const p = alive.find((x) => x.id === e.target.value);
          onChange(p ? { type: 'pet', id: p.id, label: p.name } : null);
        }}
      >
        <option value="">{pets.isPending ? 'Carregando…' : alive.length ? 'Escolha o pet' : 'Nenhum pet cadastrado'}</option>
        {alive.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({speciesLabel[p.species]}
            {p.breed ? `, ${p.breed}` : ''})
          </option>
        ))}
      </Select>
      <Button type="button" variant="secondary" size="sm" onClick={() => setCreating(true)}>
        Novo
      </Button>
      {creating && (
        <PetModal
          pet={null}
          tutor={{ id: customerId }}
          onClose={() => setCreating(false)}
          onSaved={(p) => onChange({ type: 'pet', id: p.id, label: p.name })}
        />
      )}
    </div>
  );
}
