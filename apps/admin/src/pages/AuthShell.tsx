import type { ReactNode } from 'react';
import { BrandLogo } from '../layout/BrandLogo';

/** Moldura das telas sem login (entrar, esqueci a senha, definir senha), na identidade Palmer Tech. */
export function AuthShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1fr_minmax(28rem,36rem)]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Brilho azul ao fundo, como nas seções escuras do site. */}
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 size-[32rem] rounded-full bg-brand-600/30 blur-3xl" />
        <BrandLogo tone="dark" size="lg" className="relative" />
        <div className="relative max-w-md">
          <p className="font-display text-4xl font-light leading-tight tracking-tight">
            Gestão do seu negócio, <span className="font-medium text-cyan">num só lugar.</span>
          </p>
          <p className="mt-4 text-ink-fg-muted">Clientes, ordens de serviço, produção e financeiro conectados.</p>
        </div>
        <p className="relative text-sm text-ink-fg-muted">Palmer Tech · Criciúma, SC</p>
      </aside>

      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
        <div className="w-full max-w-sm">
          <BrandLogo className="mb-8 lg:hidden" />
          <h1 className="font-display text-3xl font-medium tracking-tight">{title}</h1>
          {description && <p className="mt-2 text-sm text-fg-muted">{description}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
