import { api, ApiError, useSession, type ModuleSummary } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, cn } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { Building2, CircleCheck, LayoutGrid, Puzzle, Store, Zap, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth';
import { iconFor } from '../layout/icons';

/** Ramo da empresa = a vertical (lavanderia, advocacia…). Módulo = o que se acrescenta a ele (integrações e recursos). */
const layerLabel: Record<string, string> = { vertical: 'Ramo', integration: 'Integração', shared: 'Módulo' };
const isModule = (m: ModuleSummary) => m.layer === 'integration' || m.layer === 'shared';

export function HomePage() {
  const session = useSession();
  const firstName = session.user.name.split(' ')[0];
  const branches = session.modules.filter((m) => m.layer === 'vertical');
  const contracted = session.modules.filter(isModule);
  const shortcuts = session.menu.filter((m) => !m.group);
  const active = new Set(session.modules.map((m) => m.key));

  // Oferta de contratação só para quem decide: o dono da empresa.
  const catalog = useQuery({
    queryKey: ['modules', 'catalog'],
    queryFn: () => api<ModuleSummary[]>('/modules/catalog'),
    enabled: session.isOwner,
    staleTime: Infinity,
  });
  const available = (catalog.data ?? []).filter((m) => !active.has(m.key));
  const availableBranches = available.filter((m) => m.layer === 'vertical');
  const availableModules = available.filter(isModule);

  return (
    <div className="space-y-8">
      <header className="mb-2">
        <h1 className="font-display text-[1.75rem] font-medium leading-tight tracking-tight">Olá, {firstName}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="size-4" aria-hidden />
            {session.tenant.name}
          </span>
          {branches.map((s) => {
            const Icon = iconFor(s.icon);
            return (
              <span key={s.key} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700" title={s.description}>
                <Icon className="size-3.5" aria-hidden />
                Ramo da empresa: {s.name}
              </span>
            );
          })}
        </div>
      </header>

      <Section icon={Zap} title="Atalhos">
        {shortcuts.length ? (
          <ul className="flex flex-wrap gap-3">
            {shortcuts.map((s) => {
              const Icon = iconFor(s.icon);
              return (
                <li key={s.path}>
                  <Link
                    to={s.path}
                    className="group flex h-full items-center gap-3 rounded-2xl border border-line bg-surface py-3 pl-3 pr-5 transition hover:border-brand-200 hover:shadow-sm"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="whitespace-nowrap text-sm font-medium">{s.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">Nenhuma tela disponível para o seu papel ainda.</p>
        )}
      </Section>

      <Section
        icon={LayoutGrid}
        title="Módulos contratados"
        aside={
          <span className="flex items-center gap-3">
            {session.isOwner && (
              <Link to="/configuracoes/modulos" className="text-sm text-brand-700 hover:underline">
                Gerenciar
              </Link>
            )}
            {contracted.length > 0 && <Badge tone="brand">{contracted.length} ativo(s)</Badge>}
          </span>
        }
      >
        {contracted.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contracted.map((m) => (
              <li key={m.key}>
                <ModuleCard module={m} status={<CircleCheck className="size-4 text-success-700" aria-label="Ativo" />} />
              </li>
            ))}
          </ul>
        ) : (
          <Card className="p-5 text-sm text-fg-muted">Nenhum módulo contratado: só os recursos básicos (clientes, financeiro e usuários).</Card>
        )}
      </Section>

      {session.isOwner && <HireSection icon={Store} title="Ramos disponíveis para contratar" description="Um ramo adicional traz as telas daquele negócio para esta empresa." items={availableBranches} />}
      {session.isOwner && <HireSection icon={Puzzle} title="Módulos disponíveis para contratar" description="Recursos que se somam ao que a empresa já usa." items={availableModules} />}
    </div>
  );
}

function Section({ icon: Icon, title, description, aside, children }: { icon: LucideIcon; title: string; description?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <Icon className="size-5 text-brand-600" aria-hidden />
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ModuleCard({ module: m, status, muted, action }: { module: ModuleSummary; status: ReactNode; muted?: boolean; action?: ReactNode }) {
  const Icon = iconFor(m.icon);
  return (
    <Card className={cn('flex h-full gap-3.5 p-4', muted && 'border-dashed bg-surface/60')}>
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          muted ? 'bg-muted text-fg-muted' : 'bg-brand-600 text-white',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display font-medium leading-snug">{m.name}</h3>
          {status}
        </div>
        {m.description && <p className="mt-1 text-sm leading-snug text-fg-muted">{m.description}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </Card>
  );
}

function HireSection({ icon, title, description, items }: { icon: LucideIcon; title: string; description: string; items: ModuleSummary[] }) {
  if (!items.length) return null;
  return (
    <Section icon={icon} title={title} description={description}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((m) => (
          <li key={m.key}>
            <ModuleCard module={m} muted status={<Badge>{layerLabel[m.layer] ?? m.layer}</Badge>} action={<HireButton module={m} />} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Contratação em dois passos, na própria página: ativa na hora e o menu já traz as telas novas. */
function HireButton({ module }: { module: ModuleSummary }) {
  const { reloadSession } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function hire() {
    setBusy(true);
    setError(null);
    try {
      await api(`/modules/${encodeURIComponent(module.key)}/activate`, { method: 'POST' });
      await reloadSession();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível contratar. Tente novamente.');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button size="sm" onClick={() => setConfirming(true)}>
        Contratar
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm">Ativar {module.name} nesta empresa agora?</p>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={hire}>
          Confirmar
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
