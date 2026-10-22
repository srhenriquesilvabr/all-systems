import { useSession, type SessionInfo } from '@all/module-sdk/web';
import { Button, cn, Select } from '@all/ui';
import {
  ChartColumn,
  Circle,
  ClipboardList,
  Contact,
  History,
  Home,
  List,
  LogOut,
  Mail,
  Menu,
  Receipt,
  Shield,
  Tag,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/auth';

const icons: Record<string, LucideIcon> = {
  users: Users,
  shield: Shield,
  history: History,
  tag: Tag,
  contact: Contact,
  list: List,
  chart: ChartColumn,
  receipt: Receipt,
  wallet: Wallet,
  mail: Mail,
  clipboard: ClipboardList,
};

export function AppLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr]">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <span className="font-semibold">All Systems</span>
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-label={open ? 'Fechar menu' : 'Abrir menu'}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </header>

      <aside className={cn('border-r border-line bg-surface md:block', open ? 'block' : 'hidden')}>
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>

      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const session = useSession();
  const { switchTenant, logout } = useAuth();
  const navigate = useNavigate();
  const groups = groupMenu(session.menu);

  return (
    <div className="flex h-full flex-col gap-6 p-4 md:sticky md:top-0 md:h-screen">
      <div>
        <p className="hidden px-2 text-sm font-semibold text-fg md:block">All Systems</p>
        {session.tenants.length > 1 ? (
          <Select
            aria-label="Empresa"
            className="mt-3"
            value={session.tenant.id}
            onChange={async (e) => {
              await switchTenant(e.target.value);
              navigate('/');
            }}
          >
            {session.tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="mt-1 px-2 text-sm text-fg-muted">{session.tenant.name}</p>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto" aria-label="Menu principal">
        <ul className="space-y-1">
          <NavItem to="/" label="Início" icon={Home} onNavigate={onNavigate} />
          {groups.main.map((item) => (
            <NavItem key={item.path} to={item.path} label={item.label} icon={icons[item.icon ?? ''] ?? Circle} onNavigate={onNavigate} />
          ))}
        </ul>
        {groups.named.map(([group, items]) => (
          <div key={group}>
            <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{group}</p>
            <ul className="space-y-1">
              {items.map((item) => (
                <NavItem key={item.path} to={item.path} label={item.label} icon={icons[item.icon ?? ''] ?? Circle} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line pt-4">
        <p className="truncate px-2 text-sm font-medium">{session.user.name}</p>
        <p className="truncate px-2 text-xs text-fg-muted">{session.user.email}</p>
        <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={logout}>
          <LogOut className="size-4" /> Sair
        </Button>
      </div>
    </div>
  );
}

function NavItem({ to, label, icon: Icon, onNavigate }: { to: string; label: string; icon: LucideIcon; onNavigate: () => void }) {
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/'}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm',
            isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-fg-muted hover:bg-muted hover:text-fg',
          )
        }
      >
        <Icon className="size-4" aria-hidden />
        {label}
      </NavLink>
    </li>
  );
}

function groupMenu(menu: SessionInfo['menu']) {
  const main = menu.filter((m) => !m.group);
  const named = new Map<string, SessionInfo['menu']>();
  for (const item of menu.filter((m) => m.group)) named.set(item.group!, [...(named.get(item.group!) ?? []), item]);
  return { main, named: [...named.entries()] };
}
