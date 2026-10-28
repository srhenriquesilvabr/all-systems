import { api, ApiError, apiBlob, apiDownload } from '@all/module-sdk/web';
import { Alert, Badge } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { ACCOUNTANT_NOTICE, docStatusLabel, docStatusTone, type DocStatus, type FiscalEnvironment, type FiscalOverview } from '../contracts';

export const fiscalKey = ['fiscal'] as const;

export function useOverview() {
  return useQuery({ queryKey: [...fiscalKey, 'overview'], queryFn: () => api<FiscalOverview>('/fiscal/overview') });
}

export function StatusBadge({ status }: { status: DocStatus }) {
  return <Badge tone={docStatusTone[status]}>{docStatusLabel[status]}</Badge>;
}

export function EnvironmentBadge({ environment }: { environment: FiscalEnvironment }) {
  return environment === 'homologation' ? <Badge tone="warning">Homologação</Badge> : <Badge tone="brand">Produção</Badge>;
}

/** Aviso fixo das telas de códigos e alíquotas. */
export function AccountantNotice() {
  return <Alert tone="info">{ACCOUNTANT_NOTICE}</Alert>;
}

/** Mensagem de erro da API, com a lista de pendências da validação fiscal quando houver. */
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError) {
    const issues = (error.body as { issues?: { message: string }[] } | undefined)?.issues;
    if (issues?.length) {
      return (
        <Alert>
          <p className="font-medium">Antes de enviar, resolva:</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </Alert>
      );
    }
    return <Alert>{error.message}</Alert>;
  }
  return <Alert>{error instanceof Error ? error.message : 'Erro inesperado'}</Alert>;
}

/** Número decimal digitado com vírgula. Vazio = null. */
export function parseDecimal(v: string): number | null {
  const t = v.trim().replace(/\./g, (m, i, s: string) => (s.includes(',') ? '' : m)).replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const decimalText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

/** Abre o PDF numa aba nova (a rota é autenticada, então passa pelo fetch). */
export async function openFile(path: string, filename: string, mime: string | null) {
  if (mime && mime !== 'application/pdf') return apiDownload(path, filename);
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const docPath = (id: string) => `/fiscal/notas/${id}`;
