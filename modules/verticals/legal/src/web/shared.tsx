import { api, ApiError, CustomerSearch, parseMoney, type CustomerOption } from '@all/module-sdk/web';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { caseAreaLabel, caseAreas, caseRoleLabel, caseRoles, caseStatuses, caseStatusLabel, type LegalCase } from '../contracts';

export const legalKey = ['legal'] as const;

export function useTeam() {
  return useQuery({ queryKey: [...legalKey, 'team'], queryFn: () => api<{ id: string; name: string }[]>('/legal/team'), staleTime: 5 * 60_000 });
}

export const statusTone = { active: 'brand', suspended: 'warning', settled: 'success', won: 'success', lost: 'neutral', archived: 'neutral' } as const;

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Dias até o vencimento (negativo = vencido). */
export function daysUntil(iso: string): number {
  return Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 86_400_000);
}

export function dueText(iso: string): string {
  const d = daysUntil(iso);
  if (d < 0) return `vencido há ${-d} dia${d === -1 ? '' : 's'}`;
  if (d === 0) return 'vence hoje';
  if (d === 1) return 'vence amanhã';
  return `em ${d} dias`;
}

export function CaseModal({ legalCase, customer: fixed, onClose, onSaved }: { legalCase: LegalCase | null; customer?: { id: string }; onClose: () => void; onSaved?: (c: LegalCase) => void }) {
  const queryClient = useQueryClient();
  const team = useTeam();
  const [customer, setCustomer] = useState<CustomerOption | { id: string; name?: string } | null>(legalCase ? legalCase.customer : (fixed ?? null));
  const [form, setForm] = useState({
    number: legalCase?.number ?? '',
    title: legalCase?.title ?? '',
    area: legalCase?.area ?? 'civil',
    role: legalCase?.role ?? 'plaintiff',
    court: legalCase?.court ?? '',
    opposingParty: legalCase?.opposingParty ?? '',
    claimValue: legalCase?.claimValue != null ? legalCase.claimValue.toFixed(2).replace('.', ',') : '',
    responsibleUserId: legalCase?.responsible?.id ?? '',
    status: legalCase?.status ?? 'active',
    notes: legalCase?.notes ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () =>
      api<LegalCase>(legalCase ? `/legal/cases/${legalCase.id}` : '/legal/cases', {
        method: legalCase ? 'PATCH' : 'POST',
        body: {
          ...form,
          customerId: legalCase ? undefined : customer?.id,
          number: form.number || null,
          court: form.court || null,
          opposingParty: form.opposingParty || null,
          claimValue: form.claimValue ? parseMoney(form.claimValue) : null,
          responsibleUserId: form.responsibleUserId || null,
          notes: form.notes || null,
        },
      }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: legalKey });
      onSaved?.(saved);
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
      title={legalCase ? 'Editar processo' : 'Novo processo'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="legal-case-form" loading={save.isPending} disabled={!customer}>
            Salvar
          </Button>
        </>
      }
    >
      {!customer ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">De qual cliente é o processo?</p>
          <CustomerSearch onSelect={setCustomer} />
        </div>
      ) : (
        <form id="legal-case-form" onSubmit={submit} className="space-y-4">
          {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
          {'name' in customer && customer.name && (
            <p className="text-sm">
              Cliente: <span className="font-medium">{customer.name}</span>
            </p>
          )}
          <Field label="Título">{(id) => <Input id={id} required minLength={3} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Reclamação trabalhista — horas extras" autoFocus />}</Field>
          <Field label="Número CNJ" hint="Deixe em branco em caso consultivo ou ainda não distribuído.">
            {(id) => <Input id={id} value={form.number} onChange={(e) => set({ number: e.target.value })} placeholder="0000000-00.0000.0.00.0000" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Área">
              {(id) => (
                <Select id={id} value={form.area} onChange={(e) => set({ area: e.target.value as typeof form.area })}>
                  {caseAreas.map((a) => (
                    <option key={a} value={a}>
                      {caseAreaLabel[a]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="O cliente é">
              {(id) => (
                <Select id={id} value={form.role} onChange={(e) => set({ role: e.target.value as typeof form.role })}>
                  {caseRoles.map((r) => (
                    <option key={r} value={r}>
                      {caseRoleLabel[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Vara / tribunal">{(id) => <Input id={id} value={form.court} onChange={(e) => set({ court: e.target.value })} />}</Field>
            <Field label="Parte contrária">{(id) => <Input id={id} value={form.opposingParty} onChange={(e) => set({ opposingParty: e.target.value })} />}</Field>
            <Field label="Valor da causa (R$)">{(id) => <Input id={id} inputMode="decimal" value={form.claimValue} onChange={(e) => set({ claimValue: e.target.value })} placeholder="0,00" />}</Field>
            <Field label="Responsável">
              {(id) => (
                <Select id={id} value={form.responsibleUserId} onChange={(e) => set({ responsibleUserId: e.target.value })}>
                  <option value="">—</option>
                  {team.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {legalCase && (
              <Field label="Situação">
                {(id) => (
                  <Select id={id} value={form.status} onChange={(e) => set({ status: e.target.value as typeof form.status })}>
                    {caseStatuses.map((s) => (
                      <option key={s} value={s}>
                        {caseStatusLabel[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
          <Field label="Observações">{(id) => <Textarea id={id} rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        </form>
      )}
    </Modal>
  );
}
