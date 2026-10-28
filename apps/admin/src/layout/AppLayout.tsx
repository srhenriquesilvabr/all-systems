import { useSession, type SessionInfo } from '@all/module-sdk/web';
import { Button, cn, PanelHost, Select } from '@all/ui';
import { Building2, Home, LogOut, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/auth';
import { BrandLogo } from './BrandLogo';
import { CompanyBrand, CompanyLogo } from './CompanyBrand';
import { iconFor } from './icons';
import { useCompanyBrand, useTheme, type ThemePreference } from './theme';

const COLLAPSED_KEY = 'palmer:sidebar-collapsed';

/** Preferência do navegador; sem acesso ao storage (modo privado), o menu só não é lembrado. */
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppLayout() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Cor da empresa nos dois temas; troca junto com a empresa.
  useCompanyBrand(session.tenant.brandColor);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // segue sem lembrar a preferência
    }
  };

  return (
    <div
      className={cn(
        'min-h-screen md:grid md:transition-[grid-template-columns] md:duration-200 print:block',
        collapsed ? 'md:grid-cols-[4.5rem_1fr]' : 'md:grid-cols-[16rem_1fr]',
      )}
    >
      <header className="flex items-center justify-between bg-ink px-4 py-3 md:hidden print:hidden">
        {session.tenant.logoUrl ? (
          <CompanyLogo name={session.tenant.name} logoUrl={session.tenant.logoUrl} className="h-10 max-w-[12rem] px-2 py-1" />
        ) : (
          <BrandLogo tone="dark" size="sm" />
        )}
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setOpen(!open)} aria-label={open ? 'Fechar menu' : 'Abrir menu'}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </header>

      <aside className={cn('min-w-0 bg-ink text-white md:block print:hidden', open ? 'block' : 'hidden')}>
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} onNavigate={() => setOpen(false)} />
      </aside>

      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8 print:p-0">
        <div className="mx-auto max-w-[120rem]">
          <PanelHost>
            <Outlet />
          </PanelHost>
        </div>
      </main>
    </div>
  );
}

/**
 * Menu lateral. Recolhido (só no desktop) mostra apenas os ícones; o nome aparece no
 * tooltip e continua disponível para leitores de tela. No celular o menu abre sempre inteiro.
 */
function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle: () => void; onNavigate: () => void }) {
  const session = useSession();
  const { switchTenant, logout } = useAuth();
  const navigate = useNavigate();
  const groups = groupMenu(session.menu);
  const paths = ['/', ...session.menu.map((m) => m.path)];
  const item = (to: string, label: string, icon: LucideIcon) => (
    <NavItem key={to} to={to} label={label} icon={icon} collapsed={collapsed} onNavigate={onNavigate} paths={paths} />
  );

  return (
    <div className={cn('flex h-full flex-col gap-5 p-4 md:sticky md:top-0 md:h-screen', collapsed && 'md:px-3')}>
      <div>
        <div className={cn('mb-5 hidden items-center justify-between gap-2 md:flex', collapsed && 'flex-col')}>
          <CompanyBrand name={session.tenant.name} logoUrl={session.tenant.logoUrl} collapsed={collapsed} />
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="rounded-lg p-1.5 text-ink-fg-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>

        <div className={cn(collapsed && 'md:hidden')}>
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
        {collapsed && (
          <button
            type="button"
            onClick={onToggle}
            title={`${session.tenant.name}${session.tenants.length > 1 ? ' (expandir para trocar de empresa)' : ''}`}
            aria-label={`Empresa: ${session.tenant.name}. Expandir menu`}
            className="mx-auto hidden size-10 items-center justify-center rounded-lg bg-ink-soft text-white hover:bg-white/10 md:flex"
          >
            <Building2 className="size-5" />
          </button>
        )}
      </div>

      <nav className={cn('sidebar-scroll -mx-1 flex-1 space-y-5 overflow-y-auto overflow-x-hidden pl-1 pr-2.5', collapsed && 'md:pr-1')} aria-label="Menu principal">
        <ul className="space-y-0.5">
          {item('/', 'Início', Home)}
          {groups.main.map((m) => item(m.path, m.label, iconFor(m.icon)))}
        </ul>
        {groups.named.map(([group, items]) => (
          <div key={group}>
            <p className={cn('mb-1 px-2 text-xs font-medium uppercase tracking-wide text-ink-fg-muted', collapsed && 'md:hidden')}>{group}</p>
            {collapsed && <hr className="mx-2 mb-2 hidden border-white/10 md:block" />}
            <ul className="space-y-0.5">{items.map((m) => item(m.path, m.label, iconFor(m.icon)))}</ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 pt-4">
        <div className={cn('flex items-center gap-2.5 px-2', collapsed && 'md:justify-center md:px-0')}>
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold"
            title={collapsed ? `${session.user.name} (${session.user.email})` : undefined}
            aria-hidden
          >
            {initials(session.user.name)}
          </span>
          <div className={cn('min-w-0', collapsed && 'md:hidden')}>
            <p className="truncate text-sm font-medium">{session.user.name}</p>
            <p className="truncate text-xs text-ink-fg-muted">{session.user.email}</p>
          </div>
        </div>
        <ThemeSwitch collapsed={collapsed} />
        <Button
          variant="ghost"
          size="sm"
          className={cn('mt-1 w-full justify-start text-ink-fg-muted hover:bg-white/10 hover:text-white', collapsed && 'md:justify-center')}
          onClick={logout}
          title={collapsed ? 'Sair' : undefined}
        >
          <LogOut className="size-4" /> <span className={cn(collapsed && 'md:sr-only')}>Sair</span>
        </Button>
      </div>
    </div>
  );
}

const themes: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Automático', icon: Monitor },
];

/** Tema da tela. Aberto: três opções lado a lado. Recolhido: um botão que alterna entre elas. */
function ThemeSwitch({ collapsed }: { collapsed: boolean }) {
  const { preference, change } = useTheme();
  const current = themes.find((t) => t.value === preference)!;
  const next = themes[(themes.indexOf(current) + 1) % themes.length]!;

  return (
    <>
      <div role="radiogroup" aria-label="Tema" className={cn('mt-3 grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1', collapsed && 'md:hidden')}>
        {themes.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={preference === value}
            onClick={() => change(value)}
            title={label}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors',
              preference === value ? 'bg-ink-soft font-medium text-white' : 'text-ink-fg-muted hover:text-white',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={() => change(next.value)}
          title={`Tema: ${current.label} (mudar para ${next.label})`}
          aria-label={`Tema: ${current.label}. Mudar para ${next.label}`}
          className="mx-auto mt-3 hidden size-9 items-center justify-center rounded-lg text-ink-fg-muted hover:bg-white/10 hover:text-white md:flex"
        >
          <current.icon className="size-4" />
        </button>
      )}
    </>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

/**
 * Item do menu ativo: o de caminho mais específico que casa com a página atual. Assim
 * "/consorcio/cotas" acende "Cotas" e não também "Simulador" ("/consorcio"), mas
 * "/imoveis/123" continua acendendo "Imóveis".
 */
function activePath(pathname: string, paths: string[]) {
  return paths.filter((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`))).sort((a, b) => b.length - a.length)[0];
}

function NavItem({
  to,
  label,
  icon: Icon,
  collapsed,
  onNavigate,
  paths,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  onNavigate: () => void;
  paths: string[];
}) {
  const { pathname } = useLocation();
  const active = activePath(pathname, paths) === to;
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/'}
        onClick={onNavigate}
        title={collapsed ? label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
          collapsed && 'md:justify-center md:py-2',
          active ? 'bg-brand-600 font-medium text-white' : 'text-ink-fg-muted hover:bg-white/5 hover:text-white',
        )}
      >
        <Icon className={cn('size-4 shrink-0', collapsed && 'md:size-5')} aria-hidden />
        <span className={cn('truncate', collapsed && 'md:sr-only')}>{label}</span>
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
