import { useSession, type SessionInfo } from '@all/module-sdk/web';
import { Button, cn, Select } from '@all/ui';
import {
  AlarmClock,
  Banknote,
  Briefcase,
  Building2,
  Calculator,
  CalendarCheck,
  Car,
  Gavel,
  Handshake,
  IdCard,
  Landmark,
  Ticket,
  Cake,
  CalendarDays,
  ChefHat,
  ChartColumn,
  Circle,
  ClipboardList,
  Contact,
  History,
  KanbanSquare,
  Plus,
  QrCode,
  Home,
  List,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Package,
  PawPrint,
  Percent,
  Receipt,
  Scale,
  Shield,
  ShoppingCart,
  Smile,
  Syringe,
  Tag,
  Target,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/auth';
import { BrandLogo } from './BrandLogo';

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
  plus: Plus,
  kanban: KanbanSquare,
  qr: QrCode,
  calendar: CalendarDays,
  message: MessageCircle,
  percent: Percent,
  paw: PawPrint,
  syringe: Syringe,
  package: Package,
  smile: Smile,
  register: ShoppingCart,
  cake: Cake,
  chef: ChefHat,
  scale: Scale,
  alarm: AlarmClock,
  target: Target,
  bank: Landmark,
  car: Car,
  handshake: Handshake,
  building: Building2,
  calculator: Calculator,
  ticket: Ticket,
  gavel: Gavel,
  'calendar-check': CalendarCheck,
  briefcase: Briefcase,
  'id-card': IdCard,
  banknote: Banknote,
};

export function AppLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_1fr] print:block">
      <header className="flex items-center justify-between bg-ink px-4 py-3 md:hidden print:hidden">
        <BrandLogo tone="dark" size="sm" />
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setOpen(!open)} aria-label={open ? 'Fechar menu' : 'Abrir menu'}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </header>

      <aside className={cn('bg-ink text-white md:block print:hidden', open ? 'block' : 'hidden')}>
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>

      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8 print:p-0">
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
  const paths = ['/', ...session.menu.map((m) => m.path)];

  return (
    <div className="flex h-full flex-col gap-5 p-4 md:sticky md:top-0 md:h-screen">
      <div>
        <BrandLogo tone="dark" className="mb-5 hidden px-2 md:inline-flex" />
        {session.tenants.length > 1 ? (
          <Select
            aria-label="Empresa"
            className="border-ink-soft bg-ink-soft text-white"
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
          <p className="px-2 text-sm font-medium text-white">{session.tenant.name}</p>
        )}
      </div>

      <nav className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1" aria-label="Menu principal">
        <ul className="space-y-0.5">
          <NavItem to="/" label="Início" icon={Home} onNavigate={onNavigate} paths={paths} />
          {groups.main.map((item) => (
            <NavItem key={item.path} to={item.path} label={item.label} icon={icons[item.icon ?? ''] ?? Circle} onNavigate={onNavigate} paths={paths} />
          ))}
        </ul>
        {groups.named.map(([group, items]) => (
          <div key={group}>
            <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-ink-fg-muted">{group}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <NavItem key={item.path} to={item.path} label={item.label} icon={icons[item.icon ?? ''] ?? Circle} onNavigate={onNavigate} paths={paths} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 pt-4">
        <p className="truncate px-2 text-sm font-medium">{session.user.name}</p>
        <p className="truncate px-2 text-xs text-ink-fg-muted">{session.user.email}</p>
        <Button variant="ghost" size="sm" className="mt-2 w-full justify-start text-ink-fg-muted hover:bg-white/10 hover:text-white" onClick={logout}>
          <LogOut className="size-4" /> Sair
        </Button>
      </div>
    </div>
  );
}

/**
 * Item do menu ativo: o de caminho mais específico que casa com a página atual. Assim
 * "/consorcio/cotas" acende "Cotas" e não também "Simulador" ("/consorcio"), mas
 * "/imoveis/123" continua acendendo "Imóveis".
 */
function activePath(pathname: string, paths: string[]) {
  return paths.filter((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`))).sort((a, b) => b.length - a.length)[0];
}

function NavItem({ to, label, icon: Icon, onNavigate, paths }: { to: string; label: string; icon: LucideIcon; onNavigate: () => void; paths: string[] }) {
  const { pathname } = useLocation();
  const active = activePath(pathname, paths) === to;
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/'}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
          active ? 'bg-brand-600 font-medium text-white' : 'text-ink-fg-muted hover:bg-white/5 hover:text-white',
        )}
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
