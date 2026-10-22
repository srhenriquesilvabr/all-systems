import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface shadow-xs', className)} {...props} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-muted text-fg-muted',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
    brand: 'bg-brand-50 text-brand-700',
  };
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export interface TabItem {
  key: string;
  label: string;
}

/** Abas simples controladas pelo chamador (o conteúdo fica fora). */
export function Tabs({ items, active, onChange }: { items: TabItem[]; active: string; onChange: (key: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          type="button"
          aria-selected={tab.key === active}
          onClick={() => onChange(tab.key)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm',
            tab.key === active ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-fg-muted hover:text-fg',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
