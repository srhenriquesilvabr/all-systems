import { api, ApiError, CustomerSearch, formatDate, formatMoney, parseMoney, today, useCan, type CustomerOption } from '@all/module-sdk/web';
import { MedicalRecordTimeline } from '@all/medical-records/web';
import { useServices } from '@all/scheduling/web';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { packageStatusLabel, type PackageStatus, type SessionPackage } from '../contracts';

const key = ['aesthetics', 'packages'] as const;
const tone: Record<PackageStatus, 'brand' | 'success' | 'neutral'> = { active: 'brand', finished: 'success', cancelled: 'neutral' };

function usePackages(query: { customerId?: string; status?: string }) {
  return useQuery({ queryKey: [...key, query], queryFn: () => api<SessionPackage[]>('/aesthetics/packages', { query }) });
}

export function PackagesPage() {
  const [status, setStatus] = useState('active');
  const packages = usePackages({ status: status || undefined });
  const canSell = useCan('aesthetics.packages.sell');
  const [selling, setSelling] = useState(false);

  return (
    <>
      <PageHeader
        title="Pacotes de sessões"
        description="Sessões marcadas na agenda saem do pacote automaticamente, com valor zerado."
        actions={
          <>
            <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Ativos</option>
              <option value="finished">Concluídos</option>
              <option value="cancelled">Cancelados</option>
              <option value="">Todos</option>
            </Select>
            {canSell && <Button onClick={() => setSelling(true)}>Vender pacote</Button>}
          </>
        }
      />
      <Card>
        {packages.isPending ? (
          <Spinner />
        ) : packages.isError ? (
          <div className="p-4">
            <Alert>{packages.error.message}</Alert>
          </div>
        ) : packages.data.length === 0 ? (
          <EmptyState title="Nenhum pacote" />
        ) : (
          <PackagesTable packages={packages.data} showCustomer />
        )}
      </Card>
      {selling && <SellModal onClose={() => setSelling(false)} />}
    </>
  );
}

function PackagesTable({ packages, showCustomer }: { packages: SessionPackage[]; showCustomer?: boolean }) {
  const canSell = useCan('aesthetics.packages.sell');
  const [cancelling, setCancelling] = useState<SessionPackage | null>(null);
  return (
    <>
      <Table>
        <thead>
          <tr>
            {showCustomer && <Th>Cliente</Th>}
            <Th>Procedimento</Th>
            <Th>Sessões</Th>
            <Th className="text-right">Valor</Th>
            <Th>Validade</Th>
            <Th>Situação</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {packages.map((p) => (
            <tr key={p.id}>
              {showCustomer && (
                <Td>
                  <Link to={`/clientes/${p.customer.id}`} className="font-medium text-brand-700 hover:underline">
                    {p.customer.name}
                  </Link>
                </Td>
              )}
              <Td>{p.service.name}</Td>
              <Td className="whitespace-nowrap">
                <SessionMeter pkg={p} />
              </Td>
              <Td className="text-right tabular-nums">{formatMoney(p.price)}</Td>
              <Td className="whitespace-nowrap tabular-nums">{p.expiresOn ? formatDate(p.expiresOn) : '—'}</Td>
              <Td>
                <Badge tone={tone[p.status]}>{packageStatusLabel[p.status]}</Badge>
                {p.cancelReason && <div className="text-xs text-fg-muted">{p.cancelReason}</div>}
              </Td>
              <Td className="text-right">
                {canSell && p.status === 'active' && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(p)}>
                    Cancelar
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {cancelling && <CancelModal pkg={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

/** "3 de 10 usadas · 1 marcada" com uma barra fina. */
function SessionMeter({ pkg }: { pkg: SessionPackage }) {
  const pct = (n: number) => `${(n / pkg.totalSessions) * 100}%`;
  return (
    <div className="min-w-36">
      <div className="text-sm tabular-nums">
        {pkg.usedSessions} de {pkg.totalSessions} usadas
        {pkg.reservedSessions > 0 && <span className="text-fg-muted"> · {pkg.reservedSessions} marcada(s)</span>}
      </div>
      <div className="mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="rounded-full bg-brand-600" style={{ width: pct(pkg.usedSessions) }} />
        <div className="rounded-full bg-brand-600/35" style={{ width: pct(pkg.reservedSessions) }} />
      </div>
    </div>
  );
}

function SellModal({ customer: fixed, onClose }: { customer?: { id: string }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const services = useServices();
  const [customer, setCustomer] = useState<CustomerOption | { id: string; name?: string } | null>(fixed ?? null);
  const [form, setForm] = useState({ serviceId: '', totalSessions: '10', price: '', installments: '1', firstDueOn: today(), expiresOn: '', notes: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const service = services.data?.find((s) => s.id === form.serviceId);
  const save = useMutation({
    mutationFn: () =>
      api('/aesthetics/packages', {
        method: 'POST',
        body: { ...form, customerId: customer?.id, price: parseMoney(form.price), notes: form.notes || null },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open
      title="Vender pacote"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="aes-package-form" loading={save.isPending} disabled={!customer}>
            Vender
          </Button>
        </>
      }
    >
      {!customer ? (
        <CustomerSearch onSelect={setCustomer} />
      ) : (
        <form id="aes-package-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao vender'}</Alert>}
          {'name' in customer && customer.name && (
            <p className="text-sm">
              Cliente: <span className="font-medium">{customer.name}</span>
            </p>
          )}
          <Field label="Procedimento">
            {(id) => (
              <Select id={id} required value={form.serviceId} onChange={(e) => set({ serviceId: e.target.value })}>
                <option value="">Escolha</option>
                {services.data
                  ?.filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {formatMoney(s.price)} a sessão
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Sessões">{(id) => <Input id={id} type="number" min={2} max={100} required value={form.totalSessions} onChange={(e) => set({ totalSessions: e.target.value })} />}</Field>
            <Field label="Valor do pacote (R$)" hint={service ? `Avulso: ${formatMoney(service.price * Number(form.totalSessions || 0))}` : undefined}>
              {(id) => <Input id={id} inputMode="decimal" required value={form.price} onChange={(e) => set({ price: e.target.value })} placeholder="0,00" />}
            </Field>
            <Field label="Parcelas">
              {(id) => (
                <Select id={id} value={form.installments} onChange={(e) => set({ installments: e.target.value })}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}x
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="1º vencimento">{(id) => <Input id={id} type="date" required value={form.firstDueOn} onChange={(e) => set({ firstDueOn: e.target.value })} />}</Field>
            <Field label="Validade (opcional)">{(id) => <Input id={id} type="date" value={form.expiresOn} onChange={(e) => set({ expiresOn: e.target.value })} />}</Field>
          </div>
          <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
          <p className="text-xs text-fg-muted">As parcelas entram no financeiro como "a receber".</p>
        </form>
      )}
    </Modal>
  );
}

function CancelModal({ pkg, onClose }: { pkg: SessionPackage; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/aesthetics/packages/${pkg.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Cancelar pacote"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()}>
            Cancelar pacote
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao cancelar'}</Alert>}
        <p className="text-sm text-fg-muted">
          {pkg.usedSessions} de {pkg.totalSessions} sessões usadas. As parcelas ainda em aberto são canceladas no financeiro; as já pagas ficam (faça o estorno, se houver, pelo financeiro).
        </p>
        <Field label="Motivo">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
      </div>
    </Modal>
  );
}

/** Aba "Pacotes" na ficha do cliente. */
export function CustomerPackagesTab({ customerId }: { customerId: string }) {
  const packages = usePackages({ customerId });
  const canSell = useCan('aesthetics.packages.sell');
  const [selling, setSelling] = useState(false);
  if (packages.isPending) return <Spinner />;
  if (packages.isError) return <Alert>{packages.error.message}</Alert>;
  return (
    <>
      {canSell && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setSelling(true)}>
            Vender pacote
          </Button>
        </div>
      )}
      <Card>{packages.data.length === 0 ? <EmptyState title="Nenhum pacote" /> : <PackagesTable packages={packages.data} />}</Card>
      {selling && <SellModal customer={{ id: customerId }} onClose={() => setSelling(false)} />}
    </>
  );
}

/** Aba "Prontuário" na ficha do cliente (anamnese e evolução). */
export function CustomerRecordsTab({ customerId }: { customerId: string }) {
  return <MedicalRecordTimeline subjectType="customer" subjectId={customerId} />;
}
