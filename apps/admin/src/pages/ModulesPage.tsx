import { api, ApiError, formatDate, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from '@all/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth';

interface ContractedModule {
  key: string;
  name: string;
  layer: string;
  description?: string;
  status: 'active' | 'suspended' | 'inactive';
  enabledAt: string;
  disabledAt: string | null;
  dependents: { key: string; name: string }[];
}

const layerLabel: Record<string, string> = { vertical: 'Ramo', integration: 'Integração', shared: 'Módulo' };
const KEY = ['modules', 'contracted'];

/** Configurações → Módulos contratados: o dono desativa ramo ou módulo; os dados ficam guardados. */
export function ModulesPage() {
  const { isOwner } = useSession();
  const list = useQuery({ queryKey: KEY, queryFn: () => api<ContractedModule[]>('/modules/contracted') });
  const active = list.data?.filter((m) => m.status !== 'inactive') ?? [];
  const inactive = list.data?.filter((m) => m.status === 'inactive') ?? [];
  return (
    <div className="max-w-4xl">
      <PageHeader title="Módulos contratados" description="O que está ativo nesta empresa. Para contratar, use a página inicial." />
      <Alert tone="info">
        Desativar só bloqueia o acesso: as telas saem do menu e ninguém usa mais o módulo, mas os dados não são apagados. Para voltar a usar, contrate de novo na{' '}
        <Link to="/" className="underline">
          página inicial
        </Link>{' '}
        e tudo reaparece.
      </Alert>
      {!isOwner && <p className="mb-4 text-sm text-fg-muted">Só o dono da empresa pode desativar.</p>}
      <div className="mt-4 space-y-3">
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <Alert>{list.error.message}</Alert>
        ) : !active.length ? (
          <Card>
            <EmptyState title="Nenhum ramo ou módulo ativo" description="Só os recursos básicos estão em uso." />
          </Card>
        ) : (
          active.map((m) => <ModuleRow key={m.key} module={m} canDisable={isOwner} />)
        )}
      </div>
      {inactive.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-medium">Desativados (dados guardados)</h2>
          <ul className="space-y-2 text-sm">
            {inactive.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2">
                <span className="font-medium">{m.name}</span>
                <Badge>{layerLabel[m.layer] ?? m.layer}</Badge>
                {m.disabledAt && <span className="text-fg-muted">desativado em {formatDate(m.disabledAt.slice(0, 10))}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ModuleRow({ module: m, canDisable }: { module: ContractedModule; canDisable: boolean }) {
  const queryClient = useQueryClient();
  const { reloadSession } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = m.dependents.length > 0;

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await api(`/modules/${encodeURIComponent(m.key)}/deactivate`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['modules'] });
      await reloadSession();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível desativar. Tente novamente.');
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {m.name} <Badge tone={m.layer === 'vertical' ? 'brand' : 'neutral'}>{layerLabel[m.layer] ?? m.layer}</Badge>
            {m.status === 'suspended' && <Badge tone="warning">Suspenso</Badge>}
          </p>
          {m.description && <p className="mt-1 text-sm text-fg-muted">{m.description}</p>}
          {blocked && <p className="mt-1 text-sm text-fg-muted">Em uso por {m.dependents.map((d) => d.name).join(', ')}. Desative antes o que depende dele.</p>}
        </div>
        {canDisable && !confirming && (
          <Button variant="secondary" size="sm" disabled={blocked} title={blocked ? `Em uso por ${m.dependents.map((d) => d.name).join(', ')}` : undefined} onClick={() => setConfirming(true)}>
            Desativar
          </Button>
        )}
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {confirming && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
          <p>
            Desativar <strong>{m.name}</strong> nesta empresa? As telas saem do menu agora, para todos. <strong>Os dados não são apagados</strong> e voltam se a empresa contratar de novo.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy} onClick={disable}>
              Confirmar desativação
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
