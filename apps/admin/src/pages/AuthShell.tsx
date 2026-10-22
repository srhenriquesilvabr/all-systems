import { Card } from '@all/ui';
import type { ReactNode } from 'react';

/** Moldura das telas sem login (entrar, esqueci a senha, definir senha). */
export function AuthShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-brand-700">All Systems</p>
        <Card className="p-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </div>
  );
}
