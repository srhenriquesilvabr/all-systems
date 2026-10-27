import { api, ApiError, formatMoney, parseMoney, useSession } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { SchedulingSettings, Service } from '../contracts';
import { schedulingKey, useResources, useSchedulingSettings, useServices } from './hooks';

export function SchedulingServicesPage() {
  const services = useServices();
  const [editing, setEditing] = useState<Service | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Serviços da agenda"
        description="O que pode ser marcado, quanto tempo leva e quanto custa."
        actions={<Button onClick={() => setEditing('new')}>Novo serviço</Button>}
      />
      <div className="space-y-6">
        <Card>
          {services.isPending ? (
            <Spinner />
          ) : services.isError ? (
            <div className="p-4">
              <Alert>{services.error.message}</Alert>
            </div>
          ) : services.data.length === 0 ? (
            <EmptyState title="Nenhum serviço ainda" action={<Button onClick={() => setEditing('new')}>Cadastrar o primeiro</Button>} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Serviço</Th>
                  <Th className="text-right">Duração</Th>
                  <Th className="text-right">Preço</Th>
                  <Th>Online</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {services.data.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <span className={s.active ? 'font-medium' : 'text-fg-subtle'}>{s.name}</span>
                      {s.category && <span className="ml-2 text-xs text-fg-muted">{s.category}</span>}
                      {!s.active && <Badge>Inativo</Badge>}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {s.durationMin} min{s.bufferMin ? ` + ${s.bufferMin}` : ''}
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(s.price)}</Td>
                    <Td>{s.online ? <Badge tone="brand">Sim</Badge> : <span className="text-fg-subtle">Não</span>}</Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Editar
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <SettingsCard />
      </div>
      {editing && <ServiceModal service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ServiceModal({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const resources = useResources();
  const [form, setForm] = useState({
    name: service?.name ?? '',
    category: service?.category ?? '',
    durationMin: String(service?.durationMin ?? 60),
    bufferMin: String(service?.bufferMin ?? 0),
    price: service ? service.price.toFixed(2).replace('.', ',') : '',
    online: service?.online ?? true,
    active: service?.active ?? true,
    description: service?.description ?? '',
  });
  const [resourceIds, setResourceIds] = useState<string[]>(service?.resourceIds ?? []);
  const save = useMutation({
    mutationFn: () =>
      api(service ? `/scheduling/services/${service.id}` : '/scheduling/services', {
        method: service ? 'PATCH' : 'POST',
        body: {
          ...form,
          category: form.category || null,
          description: form.description || null,
          durationMin: Number(form.durationMin),
          bufferMin: Number(form.bufferMin) || 0,
          price: parseMoney(form.price),
          resourceIds,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schedulingKey });
      onClose();
    },
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open
      title={service ? 'Editar serviço' : 'Novo serviço'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="sch-service-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="sch-service-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field label="Nome">{(id) => <Input id={id} required minLength={2} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />}</Field>
          <Field label="Categoria">{(id) => <Input id={id} value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder="Ex.: Cabelo" />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Duração (min)">{(id) => <Input id={id} type="number" min={5} step={5} value={form.durationMin} onChange={(e) => set({ durationMin: e.target.value })} />}</Field>
          <Field label="Intervalo depois (min)" hint="Limpeza, preparo.">
            {(id) => <Input id={id} type="number" min={0} step={5} value={form.bufferMin} onChange={(e) => set({ bufferMin: e.target.value })} />}
          </Field>
          <Field label="Preço (R$)">{(id) => <Input id={id} inputMode="decimal" required value={form.price} onChange={(e) => set({ price: e.target.value })} placeholder="0,00" />}</Field>
        </div>
        <Field label="Descrição (aparece no agendamento online)">
          {(id) => <Textarea id={id} rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Quem faz</legend>
          <p className="mb-2 text-xs text-fg-muted">Nenhum marcado = qualquer profissional.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {resources.data
              ?.filter((r) => r.kind === 'professional')
              .map((r) => (
                <Checkbox
                  key={r.id}
                  label={r.name}
                  checked={resourceIds.includes(r.id)}
                  onChange={(e) => setResourceIds(e.target.checked ? [...resourceIds, r.id] : resourceIds.filter((id) => id !== r.id))}
                />
              ))}
          </div>
        </fieldset>
        <Checkbox label="Pode ser marcado online pelo cliente" checked={form.online} onChange={(e) => set({ online: e.target.checked })} />
        <Checkbox label="Ativo" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
      </form>
    </Modal>
  );
}

/** Lembretes e agendamento online (configurações do módulo). */
function SettingsCard() {
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const settings = useSchedulingSettings();
  const [form, setForm] = useState<SchedulingSettings | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api('/modules/shared.scheduling/settings', { method: 'PUT', body: form }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['modules', 'shared.scheduling', 'settings'] }),
  });
  if (settings.isError) return null; // sem permissão de configurar: o cartão não aparece
  if (!form) return null;
  const link = tenant.slug ? `${window.location.origin}/agendar/${tenant.slug}` : '';

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-medium">Lembretes e agendamento online</h2>
      {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
      {save.isSuccess && <Alert tone="success">Configurações salvas.</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Lembrete ao cliente">
          {(id) => (
            <Select id={id} value={String(form.reminderHours)} onChange={(e) => setForm({ ...form, reminderHours: Number(e.target.value) })}>
              <option value="0">Não enviar</option>
              <option value="2">2 horas antes</option>
              <option value="12">12 horas antes</option>
              <option value="24">1 dia antes</option>
              <option value="48">2 dias antes</option>
            </Select>
          )}
        </Field>
        <Field label="Intervalo entre horários">
          {(id) => (
            <Select id={id} value={String(form.slotMinutes)} onChange={(e) => setForm({ ...form, slotMinutes: Number(e.target.value) })}>
              {[10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Checkbox label="Receber agendamentos online (o cliente marca pelo link, sem ligar)" checked={form.onlineBooking} onChange={(e) => setForm({ ...form, onlineBooking: e.target.checked })} />
      {form.onlineBooking && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Antecedência mínima (horas)">
            {(id) => <Input id={id} type="number" min={0} value={form.onlineMinNoticeHours} onChange={(e) => setForm({ ...form, onlineMinNoticeHours: Number(e.target.value) })} />}
          </Field>
          <Field label="Até quantos dias à frente">
            {(id) => <Input id={id} type="number" min={1} max={180} value={form.onlineMaxDays} onChange={(e) => setForm({ ...form, onlineMaxDays: Number(e.target.value) })} />}
          </Field>
        </div>
      )}
      {form.onlineBooking && link && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm">
          <span className="text-fg-muted">Link para divulgar (Instagram, WhatsApp, Google):</span>
          <code className="select-all break-all">{link}</code>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </Button>
        </div>
      )}
      <Button loading={save.isPending} onClick={() => save.mutate()}>
        Salvar configurações
      </Button>
    </Card>
  );
}
