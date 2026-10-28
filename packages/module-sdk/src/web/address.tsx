import { Input } from '@all/ui';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/** Endereço dos cadastros (cliente, pessoa da equipe), guardado em jsonb. */
export interface Address {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
}

/** Resposta de `GET /cep/:cep` (ViaCEP consultado pelo servidor). */
export interface CepAddress {
  zip: string;
  street: string;
  district: string;
  city: string;
  state: string;
  complement: string;
}

const zipMask = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

type LookupState = 'idle' | 'loading' | 'not_found' | 'error';

/**
 * Campos de endereço com busca pelo CEP: ao completar os 8 dígitos, preenche rua, bairro,
 * cidade e UF; o usuário completa número e complemento (o foco vai para o número).
 * `cepPath` troca a rota da busca (ex.: a da vitrine pública, que não tem login).
 */
export function AddressFields({ value, onChange, cepPath = (cep) => `/cep/${cep}` }: { value: Address; onChange: (address: Address) => void; cepPath?: (cep: string) => string }) {
  const [state, setState] = useState<LookupState>('idle');
  const latest = useRef(value);
  const lastLookup = useRef(value.zip?.replace(/\D/g, '') ?? '');
  const numberInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const set = (patch: Partial<Address>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    onChange(next);
  };

  async function lookup(zip: string) {
    const digits = zip.replace(/\D/g, '');
    if (digits.length !== 8 || digits === lastLookup.current) return;
    lastLookup.current = digits;
    setState('loading');
    try {
      const found = await api<CepAddress>(cepPath(digits));
      // A resposta pode chegar depois de o usuário mudar o CEP de novo: só vale a do CEP atual.
      if (latest.current.zip?.replace(/\D/g, '') !== digits) return;
      const current = latest.current;
      set({
        zip: found.zip,
        street: found.street || current.street,
        district: found.district || current.district,
        city: found.city || current.city,
        state: found.state || current.state,
      });
      setState('idle');
      if (!current.number) numberInput.current?.focus();
    } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? 'not_found' : 'error');
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_6rem]">
        <div>
          <Input
            aria-label="CEP"
            placeholder="CEP"
            inputMode="numeric"
            value={value.zip ?? ''}
            onChange={(e) => {
              const zip = zipMask(e.target.value);
              set({ zip });
              if (state !== 'idle' && state !== 'loading') setState('idle');
              void lookup(zip);
            }}
            onBlur={(e) => void lookup(e.target.value)}
          />
        </div>
        <Input aria-label="Rua" placeholder="Rua" value={value.street ?? ''} onChange={(e) => set({ street: e.target.value })} />
        <Input ref={numberInput} aria-label="Número" placeholder="Nº" value={value.number ?? ''} onChange={(e) => set({ number: e.target.value })} />
      </div>
      {state !== 'idle' && (
        <p className={`text-xs ${state === 'loading' ? 'text-fg-muted' : 'text-danger-600'}`} role="status">
          {state === 'loading' ? 'Buscando o endereço…' : state === 'not_found' ? 'CEP não encontrado. Confira os números ou preencha o endereço.' : 'Não foi possível buscar o CEP agora. Preencha o endereço.'}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_5rem]">
        <Input aria-label="Complemento" placeholder="Complemento" value={value.complement ?? ''} onChange={(e) => set({ complement: e.target.value })} />
        <Input aria-label="Bairro" placeholder="Bairro" value={value.district ?? ''} onChange={(e) => set({ district: e.target.value })} />
        <Input aria-label="Cidade" placeholder="Cidade" value={value.city ?? ''} onChange={(e) => set({ city: e.target.value })} />
        <Input aria-label="UF" placeholder="UF" maxLength={2} value={value.state ?? ''} onChange={(e) => set({ state: e.target.value.toUpperCase() })} />
      </div>
    </div>
  );
}
