import { api, formatDocument, useSession } from '@all/module-sdk/web';
import { Select } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import type { EmployerRef, EmployersResponse } from '../contracts';
import { hrKey } from './hrKey';

/**
 * Empresas que podem empregar colaboradores (clientes do tipo empresa). `enabled` só vem ligado
 * quando um ramo ativo usa o recurso (Consultoria de RH); sem ele as telas do RH ficam como antes.
 */
export function useEmployers() {
  return useQuery({ queryKey: [...hrKey, 'employers'], queryFn: () => api<EmployersResponse>('/hr/employers'), staleTime: 60_000 });
}

/** Valor do filtro: '' = todas, 'own' = a própria empresa, ou o id da empresa-cliente. */
export type EmployerChoice = '' | 'own' | string;

/** Filtro de empresa guardado no endereço (?empresa=), para os links da ficha da empresa atendida. */
export function useEmployerParam(): [EmployerChoice, (v: EmployerChoice) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get('empresa') ?? '';
  const set = (v: EmployerChoice) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set('empresa', v);
        else next.delete('empresa');
        return next;
      },
      { replace: true },
    );
  return [value, set];
}

/** Empregador escolhido no filtro, como vai para a API (null = a própria empresa). */
export const employerIdOf = (choice: EmployerChoice): string | null => (choice && choice !== 'own' ? choice : null);

export const employerLabel = (e: EmployerRef | null) => (e ? e.name : 'Própria empresa');

export function EmployerSelect({
  value,
  onChange,
  allowAll = false,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  value: EmployerChoice;
  onChange: (v: EmployerChoice) => void;
  /** Mostra "Todas as empresas" (filtro). Sem isso, é a escolha do empregador (cadastro, folha). */
  allowAll?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const employers = useEmployers();
  const items = employers.data?.items ?? [];
  return (
    <Select id={id} aria-label={ariaLabel} className={className} value={value || (allowAll ? '' : 'own')} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">Todas as empresas</option>}
      <option value="own">Própria empresa</option>
      {items.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.document ? ` — ${formatDocument(c.document)}` : ''}
        </option>
      ))}
    </Select>
  );
}

/** Cabeçalho dos documentos impressos: o empregador (empresa atendida, com CNPJ) ou a própria empresa. */
export function EmployerHeading({ employer }: { employer: EmployerRef | null }) {
  const { tenant } = useSession();
  if (!employer) return <h1 className="text-lg font-bold">{tenant.name}</h1>;
  return (
    <div>
      <h1 className="text-lg font-bold">{employer.name}</h1>
      {employer.document && <p className="text-xs">CNPJ {formatDocument(employer.document)}</p>}
      <p className="text-xs">Folha processada por {tenant.name}</p>
    </div>
  );
}
