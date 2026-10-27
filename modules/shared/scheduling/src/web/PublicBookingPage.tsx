import { ApiError, formatMoney } from '@all/module-sdk/web';
import { Alert, Button, Card, Field, Input, Select, Spinner, Textarea, cn } from '@all/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { AvailabilitySlots, BookingSubjectField } from '../contracts';
import { localToUtc, shiftDate, todayLocal } from './hooks';

interface BookingInfo {
  company: { name: string };
  maxDays: number;
  services: { id: string; name: string; category: string | null; durationMin: number; price: number; description: string | null }[];
  professionals: { id: string; name: string; color: string; serviceIds: string[] }[];
  /** Campos extras de "para quem é" (ex.: o pet), definidos por outro módulo ativo na empresa. */
  subject: { label: string; fields: BookingSubjectField[] } | null;
}

/** Página pública: sem login, fala direto com /api/public/booking/<slug>. */
async function publicApi<T>(path: string, init?: { method?: string; body?: unknown; query?: Record<string, string | undefined> }): Promise<T> {
  const url = new URL(`/api/public/booking${path}`, window.location.origin);
  for (const [k, v] of Object.entries(init?.query ?? {})) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, data?.code, Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? 'Erro'), data);
  return data as T;
}

const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

export function PublicBookingPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const info = useQuery({ queryKey: ['booking', slug], queryFn: () => publicApi<BookingInfo>(`/${slug}`), retry: false });
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [professionalId, setProfessionalId] = useState<string>('any');
  const [date, setDate] = useState(todayLocal());
  const [slot, setSlot] = useState<{ time: string; resourceId: string } | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [subjectFields, setSubjectFields] = useState<Record<string, string>>({});

  const availability = useQuery({
    queryKey: ['booking', slug, 'availability', date, serviceIds.join(','), professionalId],
    queryFn: () =>
      publicApi<AvailabilitySlots[]>(`/${slug}/availability`, {
        query: { date, serviceIds: serviceIds.join(','), resourceId: professionalId === 'any' ? undefined : professionalId },
      }),
    enabled: serviceIds.length > 0,
  });
  const book = useMutation({
    mutationFn: () =>
      publicApi<{ startsAt: string; professional: string; services: string[]; subject: string | null; total: number }>(`/${slug}`, {
        method: 'POST',
        body: {
          ...form,
          email: form.email || null,
          notes: form.notes || null,
          serviceIds,
          resourceId: slot!.resourceId,
          startsAt: localToUtc(date, slot!.time).toISOString(),
          subjectFields: info.data?.subject ? subjectFields : null,
        },
      }),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        availability.refetch();
      }
    },
  });

  if (info.isPending) return <Shell><Spinner /></Shell>;
  if (info.isError) {
    return (
      <Shell>
        <Alert>{info.error instanceof ApiError && info.error.status === 404 ? 'Agendamento online indisponível para esta empresa.' : 'Não foi possível carregar. Tente de novo.'}</Alert>
      </Shell>
    );
  }
  const { company, services, professionals, maxDays, subject } = info.data;

  if (book.data) {
    return (
      <Shell company={company.name}>
        <Card className="space-y-3 p-6 text-center">
          <p className="font-display text-2xl font-medium">Horário marcado!</p>
          <p className="text-fg-muted">
            {book.data.services.join(', ')}
            {book.data.subject ? ` para ${book.data.subject}` : ''} com {book.data.professional}
            <br />
            {date.split('-').reverse().join('/')} às {slot?.time}
          </p>
          <p className="text-sm text-fg-muted">Você vai receber a confirmação pelo WhatsApp ou e-mail. Até lá!</p>
        </Card>
      </Shell>
    );
  }

  // Profissionais que fazem todos os serviços escolhidos.
  const eligible = professionals.filter((p) => serviceIds.every((s) => p.serviceIds.includes(s)));
  // "Sem preferência": junta os horários de todos e guarda quem atende em cada um.
  const slots = new Map<string, string>();
  for (const r of availability.data ?? []) for (const t of r.slots) if (!slots.has(t)) slots.set(t, r.resourceId);
  const days = Array.from({ length: Math.min(maxDays, 14) }, (_, i) => shiftDate(todayLocal(), i));
  const chosen = services.filter((s) => serviceIds.includes(s.id));

  function submit(e: FormEvent) {
    e.preventDefault();
    book.mutate();
  }

  return (
    <Shell company={company.name}>
      <Step n={1} title="Serviço">
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => {
            const on = serviceIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setServiceIds(on ? serviceIds.filter((id) => id !== s.id) : [...serviceIds, s.id]);
                  setSlot(null);
                }}
                className={cn('rounded-xl border p-3 text-left transition', on ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface hover:border-fg')}
              >
                <span className="block font-medium">{s.name}</span>
                <span className="text-sm text-fg-muted">
                  {s.durationMin} min · {formatMoney(s.price)}
                </span>
                {s.description && <span className="mt-1 block text-xs text-fg-muted">{s.description}</span>}
              </button>
            );
          })}
        </div>
      </Step>

      {serviceIds.length > 0 && (
        <Step n={2} title="Profissional">
          <div className="flex flex-wrap gap-2">
            {[{ id: 'any', name: 'Sem preferência' }, ...eligible].map((p) => (
              <Chip key={p.id} on={professionalId === p.id} onClick={() => { setProfessionalId(p.id); setSlot(null); }}>
                {p.name}
              </Chip>
            ))}
          </div>
          {eligible.length === 0 && <p className="mt-2 text-sm text-fg-muted">Nenhum profissional faz todos esses serviços juntos. Tente escolher menos serviços.</p>}
        </Step>
      )}

      {serviceIds.length > 0 && (
        <Step n={3} title="Dia e horário">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {days.map((d) => (
              <Chip key={d} on={d === date} onClick={() => { setDate(d); setSlot(null); }}>
                {dayFmt.format(new Date(`${d}T12:00:00Z`))}
              </Chip>
            ))}
          </div>
          {availability.isPending ? (
            <Spinner label="Buscando horários…" />
          ) : slots.size === 0 ? (
            <p className="text-sm text-fg-muted">Sem horários livres neste dia. Escolha outro.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[...slots.entries()].sort().map(([time, resourceId]) => (
                <Chip key={time} on={slot?.time === time} onClick={() => setSlot({ time, resourceId })}>
                  {time}
                </Chip>
              ))}
            </div>
          )}
        </Step>
      )}

      {slot && (
        <Step n={4} title="Seus dados">
          <form onSubmit={submit} className="space-y-3">
            {book.error && <Alert>{book.error instanceof ApiError ? book.error.message : 'Não foi possível marcar. Tente de novo.'}</Alert>}
            <Field label="Nome">{(id) => <Input id={id} required minLength={2} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
            <Field label="Celular (WhatsApp)">
              {(id) => <Input id={id} required type="tel" autoComplete="tel" placeholder="(48) 99999-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
            </Field>
            <Field label="E-mail (opcional)">{(id) => <Input id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
            {subject?.fields.map((f) => (
              <Field key={f.key} label={f.required ? f.label : `${f.label} (opcional)`}>
                {(id) =>
                  f.options ? (
                    <Select id={id} required={f.required} value={subjectFields[f.key] ?? ''} onChange={(e) => setSubjectFields({ ...subjectFields, [f.key]: e.target.value })}>
                      <option value="">Escolha</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={id}
                      required={f.required}
                      maxLength={f.maxLength}
                      value={subjectFields[f.key] ?? ''}
                      onChange={(e) => setSubjectFields({ ...subjectFields, [f.key]: e.target.value })}
                    />
                  )
                }
              </Field>
            ))}
            <Field label="Observação (opcional)">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
            <div className="rounded-xl bg-muted p-3 text-sm">
              <strong>{chosen.map((s) => s.name).join(', ')}</strong>
              <br />
              {date.split('-').reverse().join('/')} às {slot.time} · {formatMoney(chosen.reduce((sum, s) => sum + s.price, 0))}
            </div>
            <Button type="submit" className="w-full" loading={book.isPending}>
              Confirmar agendamento
            </Button>
            <p className="text-xs text-fg-muted">Usamos seu celular e e-mail só para confirmar e lembrar do horário.</p>
          </form>
        </Step>
      )}
    </Shell>
  );
}

function Shell({ company, children }: { company?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-ink px-4 py-6 text-white">
        <div className="mx-auto max-w-xl">
          <p className="text-sm text-ink-fg-muted">Agendamento online</p>
          <h1 className="font-display text-2xl font-medium">{company ?? ' '}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6">{children}</main>
      <footer className="pb-8 text-center text-xs text-fg-muted">
        Agendamento por <span className="font-display font-semibold">palmer</span>
        <span className="font-display font-light text-brand-600">tech</span>
      </footer>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
        <span className="grid size-7 place-items-center rounded-full bg-brand-600 text-sm text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('shrink-0 rounded-full border px-3.5 py-1.5 text-sm tabular-nums transition', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface hover:border-fg')}
    >
      {children}
    </button>
  );
}
