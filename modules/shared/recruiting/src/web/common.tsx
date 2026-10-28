import { apiBlob, formatDateTime } from '@all/module-sdk/web';
import { Badge, Button, cn } from '@all/ui';
import { useState, type ReactNode } from 'react';
import type { RecEvent } from './types';

/** Nota de aderência: verde a partir de 75, amarelo a partir de 50. "Estimativa" quando não veio da IA. */
export function ScoreBadge({ score, method, status }: { score: number | null; method: 'ai' | 'heuristic' | null; status?: string }) {
  if (score == null) {
    if (status === 'pending' || status === 'running') return <Badge>Analisando…</Badge>;
    return <Badge>Sem nota</Badge>;
  }
  const tone = score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger';
  return (
    <span className="inline-flex items-center gap-1" title={method === 'heuristic' ? 'Estimativa sem IA (palavras-chave)' : 'Nota de aderência pela IA'}>
      <Badge tone={tone}>{score}</Badge>
      {method === 'heuristic' && <span className="text-[11px] text-fg-muted">estimativa</span>}
    </span>
  );
}

export function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="break-words">{children}</div>
    </div>
  );
}

/** Lista editável de textos (requisitos, benefícios): um por linha, com adicionar/remover. */
export function TextList({ items, onChange, placeholder, max = 30 }: { items: string[]; onChange: (items: string[]) => void; placeholder: string; max?: number }) {
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim();
    if (!v || items.length >= max) return;
    onChange([...items, v]);
    setDraft('');
  }
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={`${i}-${item}`} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
              <span className="flex-1">{item}</span>
              <button type="button" className="text-fg-muted hover:text-danger-600" aria-label={`Remover ${item}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          className="block h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={add} disabled={!draft.trim()}>
          Adicionar
        </Button>
      </div>
    </div>
  );
}

const eventLabel: Record<RecEvent['kind'], string> = {
  applied: 'Candidatura',
  note: 'Anotação',
  stage: 'Etapa',
  rejected: 'Reprovado',
  reopened: 'Reaberto',
  hired: 'Contratação',
  analysis: 'Análise',
  edited: 'Cadastro',
};

export function Timeline({ events }: { events: RecEvent[] }) {
  if (!events.length) return <p className="px-4 py-6 text-sm text-fg-muted">Nada registrado ainda.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {events.map((e) => (
        <li key={e.id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <Badge tone={e.kind === 'rejected' ? 'danger' : e.kind === 'hired' ? 'success' : e.kind === 'note' ? 'brand' : 'neutral'}>{eventLabel[e.kind]}</Badge>
            {formatDateTime(e.createdAt)}
          </div>
          {e.text && <p className={cn('mt-1 whitespace-pre-wrap', e.kind === 'note' ? 'text-fg' : 'text-fg-muted')}>{e.text}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Abre o currículo (rota autenticada e auditada) numa aba nova. */
export function ResumeButton({ path, label = 'Ver currículo' }: { path: string; label?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function open() {
    setLoading(true);
    setError(null);
    // A aba abre já no clique (bloqueador de pop-up) e recebe o arquivo quando ele chega.
    const tab = window.open('', '_blank');
    try {
      const blob = await apiBlob(path);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
      setError('Não foi possível abrir o currículo');
    } finally {
      setLoading(false);
    }
  }
  return (
    <span className="inline-flex flex-col">
      <Button type="button" size="sm" variant="secondary" loading={loading} onClick={open}>
        {label}
      </Button>
      {error && <span className="mt-1 text-xs text-danger-600">{error}</span>}
    </span>
  );
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
