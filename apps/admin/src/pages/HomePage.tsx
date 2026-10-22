import { useSession } from '@all/module-sdk/web';
import { Badge, Card, PageHeader } from '@all/ui';
import { Link } from 'react-router';

export function HomePage() {
  const session = useSession();
  const firstName = session.user.name.split(' ')[0];
  const contracted = session.modules.filter((m) => m.layer !== 'core');
  const shortcuts = session.menu.filter((m) => !m.group);

  return (
    <>
      <PageHeader title={`Olá, ${firstName}`} description={session.tenant.name} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-medium">Módulos contratados</h2>
          {contracted.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {contracted.map((m) => (
                <li key={m.key}>
                  <Badge tone="brand">{m.name}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">Só os recursos básicos estão ativos nesta empresa.</p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-medium">Atalhos</h2>
          {shortcuts.length ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {shortcuts.map((s) => (
                <li key={s.path}>
                  <Link to={s.path} className="text-brand-700 hover:underline">
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">Nenhuma tela disponível para o seu papel ainda.</p>
          )}
        </Card>
      </div>
    </>
  );
}
