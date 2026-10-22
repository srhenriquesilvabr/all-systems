import type { ReactNode } from 'react';
import { cn } from './cn';

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'success' | 'info'; children: ReactNode }) {
  const tones = {
    danger: 'border-danger-200 bg-danger-50 text-danger-700',
    success: 'border-success-200 bg-success-50 text-success-700',
    info: 'border-brand-200 bg-brand-50 text-brand-700',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-md border px-3 py-2 text-sm', tones[tone])}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-fg-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
