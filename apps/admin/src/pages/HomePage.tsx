import { api, useSession, type ModuleSummary } from '@all/module-sdk/web';
import { Badge, Card, cn } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { Building2, CircleCheck, LayoutGrid, Puzzle, Zap, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { iconFor } from '../layout/icons';

const layerLabel: Record<string, string> = { vertical: 'Setor', integration: 'Integração', shared: 'Recurso' };

export function HomePage() {
  const session = useSession();
  const firstName = session.user.name.split(' ')[0];
  const contracted = session.modules.filter((m) => m.layer !== 'core');
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

  return (
    <div className="space-y-8">
      <header className="mb-2">
        <h1 className="font-display text-[28px] font-medium leading-tight tracking-tight">Olá, {firstName}</h1>
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-fg-muted">
          <Building2 className="size-4" aria-hidden />
          {session.tenant.name}
        </p>
      </header>

      <Section icon={Zap} title="Atalhos">
        {shortcuts.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shortcuts.map((s) => {
              const Icon = iconFor(s.icon);
              return (
                <li key={s.path}>
                  <Link
                    to={s.path}
                    className="group flex h-full items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 transition hover:border-brand-200 hover:shadow-sm"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="text-sm font-medium">{s.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">Nenhuma tela disponível para o seu papel ainda.</p>
        )}
      </Section>

      <Section icon={LayoutGrid} title="Módulos contratados" aside={contracted.length > 0 && <Badge tone="brand">{contracted.length} ativo(s)</Badge>}>
        {contracted.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contracted.map((m) => (
              <li key={m.key}>
                <ModuleCard module={m} status={<CircleCheck className="size-4 text-success-700" aria-label="Ativo" />} />
              </li>
            ))}
          </ul>
        ) : (
          <Card className="p-5 text-sm text-fg-muted">Só os recursos básicos estão ativos nesta empresa: clientes, financeiro e usuários.</Card>
        )}
      </Section>

      {session.isOwner && available.length > 0 && (
        <Section icon={Puzzle} title="Disponíveis para contratar" description="Fale com a Palmer Tech para ativar um módulo nesta empresa.">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((m) => (
              <li key={m.key}>
                <ModuleCard module={m} muted status={<Badge>{layerLabel[m.layer] ?? m.layer}</Badge>} />
              </li>
            ))}
          </ul>
        </Section>
      )}
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

function ModuleCard({ module: m, status, muted }: { module: ModuleSummary; status: ReactNode; muted?: boolean }) {
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
      </div>
    </Card>
  );
}
