import { Alert, Button, Input, QrCode } from '@all/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from './api';
import { formatMoney, formatPhone } from './format';
import { useSession } from './session';

export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

/** Busca de cliente por nome, documento ou telefone (usada ao abrir ordens e marcar horários). */
export function CustomerSearch({ onSelect, autoFocus = true }: { onSelect: (c: CustomerOption) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['customers', 'search', q],
    queryFn: () => api<{ items: CustomerOption[] }>('/customers', { query: { q, limit: 8 } }),
    enabled: q.trim().length >= 2,
  });

  return (
    <div>
      <Input type="search" aria-label="Buscar cliente" placeholder="Nome, CPF/CNPJ ou telefone" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} />
      {q.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {results.data?.items.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => onSelect(c)}>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-sm text-fg-muted">{formatPhone(c.phone) || c.email || ''}</span>
              </button>
            </li>
          ))}
          {results.data?.items.length === 0 && (
            <li className="px-3 py-2 text-sm text-fg-muted">
              Nenhum cliente encontrado.{' '}
              <a href="/clientes?novo=1" className="text-brand-700 hover:underline">
                Cadastrar cliente
              </a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * QR Code Pix do valor, se a empresa contratou o módulo de Pix. A chamada é por HTTP (quem usa não
 * importa o módulo de integração) e a confirmação continua sendo de quem recebe.
 */
export function PixCharge({ amount, reference }: { amount: number; reference: string }) {
  const { modules } = useSession();
  const charge = useMutation({
    mutationFn: () => api<{ payload: string }>('/payments/pix', { method: 'POST', body: { amount, reference } }),
  });
  const [copied, setCopied] = useState(false);
  if (!modules.some((m) => m.key === 'integration.payments')) return null;

  if (!charge.data) {
    return (
      <div className="space-y-2 rounded-lg border border-line p-3">
        {charge.error && <Alert>{charge.error instanceof ApiError ? charge.error.message : 'Erro ao gerar o Pix'}</Alert>}
        <Button variant="secondary" size="sm" loading={charge.isPending} disabled={!(amount > 0)} onClick={() => charge.mutate()}>
          Gerar QR Code Pix de {Number.isFinite(amount) ? formatMoney(amount) : '—'}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-line p-3 text-center">
      <QrCode value={charge.data.payload} size={200} label={`QR Code Pix de ${formatMoney(amount)}`} />
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(charge.data!.payload);
          setCopied(true);
        }}
      >
        {copied ? 'Copiado!' : 'Copiar código “copia e cola”'}
      </Button>
      <p className="text-xs text-fg-muted">Confira o recebimento no aplicativo do banco antes de registrar o pagamento.</p>
    </div>
  );
}
