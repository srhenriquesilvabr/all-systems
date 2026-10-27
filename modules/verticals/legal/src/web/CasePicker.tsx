import { api } from '@all/module-sdk/web';
import type { SubjectValue } from '@all/scheduling/web';
import { Select } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import type { LegalCase } from '../contracts';
import { legalKey } from './shared';

/** Escolha do processo no formulário de horário (audiência, reunião). Opcional. */
export function CasePicker({ customerId, value, onChange }: { customerId: string; value: SubjectValue | null; onChange: (v: SubjectValue | null) => void }) {
  const cases = useQuery({ queryKey: [...legalKey, 'cases', { customerId }], queryFn: () => api<LegalCase[]>('/legal/cases', { query: { customerId } }) });
  const open = cases.data?.filter((c) => c.status === 'active' || c.status === 'suspended') ?? [];
  return (
    <Select
      aria-label="Processo"
      value={value?.id ?? ''}
      onChange={(e) => {
        const c = open.find((x) => x.id === e.target.value);
        onChange(c ? { type: 'legal_case', id: c.id, label: c.number ?? c.title } : null);
      }}
    >
      <option value="">{cases.isPending ? 'Carregando…' : open.length ? 'Nenhum (atendimento avulso)' : 'Nenhum processo em andamento'}</option>
      {open.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
          {c.number ? ` — ${c.number}` : ''}
        </option>
      ))}
    </Select>
  );
}
