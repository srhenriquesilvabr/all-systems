import { api, ApiError, CustomerSearch, formatDate, formatDateTime, formatMoney, parseMoney, today, useCan, type CustomerOption } from '@all/module-sdk/web';
import type { MedicalForm } from '@all/medical-records';
import { localToUtc, OutsideScheduleAlert, useResources, useServices } from '@all/scheduling/web';
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Textarea } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { budgetKindLabel, budgetKinds, specialtyLabel, surgeryStageLabel, surgeryStages, type AesCase, type BudgetKind, type SpecialtyKey, type SurgeryStage } from '../../contracts';
import { SellModal } from '../packages';
import { specialtiesKey, useCredentials } from './hooks';

const statusLabel: Record<AesCase['status'], string> = { active: 'Em andamento', finished: 'Concluído', cancelled: 'Cancelado' };
const statusTone: Record<AesCase['status'], 'brand' | 'success' | 'neutral'> = { active: 'brand', finished: 'success', cancelled: 'neutral' };
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function useCaseMutation<T>(fn: (body: T) => Promise<unknown>, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: specialtiesKey });
      onDone?.();
    },
  });
}

/** Novo tratamento (com paciente fixo ou escolhido na busca). */
export function NewCaseForm({ customerId, specialty, onClose }: { customerId?: string; specialty: SpecialtyKey; onClose: () => void }) {
  const credentials = useCredentials();
  const [customer, setCustomer] = useState<CustomerOption | { id: string } | null>(customerId ? { id: customerId } : null);
  const [form, setForm] = useState({ title: '', professionalId: '', plannedSessions: '', startedOn: today(), notes: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useCaseMutation(
    () =>
      api('/aesthetics/cases', {
        method: 'POST',
        body: {
          customerId: customer!.id,
          specialty,
          title: form.title,
          professionalId: form.professionalId || null,
          plannedSessions: form.plannedSessions ? Number(form.plannedSessions) : null,
          startedOn: form.startedOn,
          notes: form.notes || null,
        },
      }),
    onClose,
  );
  const surgery = specialty === 'plastic_surgery';
  return (
    <Modal
      open
      title={`Novo tratamento — ${specialtyLabel[specialty]}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!customer || form.title.trim().length < 3} onClick={() => save.mutate(undefined)}>
            Abrir tratamento
          </Button>
        </>
      }
    >
      {!customer ? (
        <CustomerSearch onSelect={setCustomer} />
      ) : (
        <div className="space-y-4">
          {save.error && <Alert>{errorText(save.error, 'Erro ao abrir o tratamento')}</Alert>}
          {'name' in customer && <p className="text-sm">Paciente: <span className="font-medium">{customer.name}</span></p>}
          <Field label={surgery ? 'Cirurgia' : 'Tratamento'}>
            {(id) => (
              <Input
                id={id}
                value={form.title}
                placeholder={surgery ? 'Ex.: Mamoplastia de aumento' : specialty === 'whitening' ? 'Ex.: Clareamento combinado' : 'Ex.: Protocolo para eflúvio'}
                onChange={(e) => set({ title: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={surgery ? 'Cirurgião' : 'Profissional responsável'}>
              {(id) => (
                <Select id={id} value={form.professionalId} onChange={(e) => set({ professionalId: e.target.value })}>
                  <option value="">—</option>
                  {credentials.data
                    ?.filter((p) => p.active)
                    .map((p) => (
                      <option key={p.resourceId} value={p.resourceId}>
                        {p.name}
                        {p.credential ? ` — ${p.credential.label}` : ''}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            {!surgery && (
              <Field label="Sessões previstas">{(id) => <Input id={id} type="number" min={1} max={100} value={form.plannedSessions} onChange={(e) => set({ plannedSessions: e.target.value })} />}</Field>
            )}
            <Field label="Início">{(id) => <Input id={id} type="date" max={today()} value={form.startedOn} onChange={(e) => set({ startedOn: e.target.value })} />}</Field>
          </div>
          <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        </div>
      )}
    </Modal>
  );
}

/** Cartão do tratamento: andamento, etapa da cirurgia, orçamento, agenda e encerramento. */
export function CaseCard({
  item: c,
  forms,
  onRecord,
  onConsent,
}: {
  item: AesCase;
  /** Fichas da especialidade: com mais de uma, "+ Ficha" pergunta qual. */
  forms?: MedicalForm[];
  onRecord?: (caseId: string, form?: MedicalForm) => void;
  onConsent?: (caseId: string) => void;
}) {
  const canWrite = useCan('shared.medical-records.write');
  const canBudget = useCan('aesthetics.surgery.budget');
  const canSchedule = useCan('shared.scheduling.write');
  const canSell = useCan('aesthetics.packages.sell');
  const [panel, setPanel] = useState<'budget' | 'surgery' | 'close' | 'drainage' | 'forms' | 'rename' | null>(null);
  const [title, setTitle] = useState(c.title);
  const rename = useCaseMutation(() => api(`/aesthetics/cases/${c.id}`, { method: 'PATCH', body: { title } }), () => setPanel(null));
  const stage = useCaseMutation((s: SurgeryStage) => api(`/aesthetics/cases/${c.id}/stage`, { method: 'POST', body: { stage: s } }));
  const surgery = c.specialty === 'plastic_surgery';
  const surgeryActive = c.surgery && c.surgery.status !== 'cancelled' && c.surgery.status !== 'no_show';
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.title}</span>
            <Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge>
            {c.stage && c.status === 'active' && <Badge tone="warning">{surgeryStageLabel[c.stage]}</Badge>}
            {c.consentAccepted ? <Badge tone="success">Termo aceito</Badge> : <Badge>Sem termo</Badge>}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Desde {formatDate(c.startedOn)}
            {c.professional && ` · ${c.professional.name}`}
            {c.plannedSessions ? ` · ${c.doneSessions} de ${c.plannedSessions} sessões` : c.doneSessions ? ` · ${c.doneSessions} sessão(ões)` : ''}
            {c.finishedOn && ` · encerrado em ${formatDate(c.finishedOn)}`}
          </p>
          {c.closeReason && <p className="text-xs text-fg-muted">Motivo: {c.closeReason}</p>}
        </div>
        {c.status === 'active' && (
          <div className="flex flex-wrap gap-2">
            {onRecord && canWrite && (
              <Button size="sm" variant="secondary" onClick={() => ((forms?.length ?? 0) > 1 ? setPanel(panel === 'forms' ? null : 'forms') : onRecord(c.id, forms?.[0]))}>
                + Ficha
              </Button>
            )}
            {canWrite && (
              <Button size="sm" variant="ghost" onClick={() => setPanel('rename')}>
                Renomear
              </Button>
            )}
            {canWrite && (
              <Button size="sm" variant="ghost" onClick={() => setPanel('close')}>
                Encerrar
              </Button>
            )}
          </div>
        )}
      </div>
      {panel === 'forms' && onRecord && (
        <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-line p-3">
          {forms?.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant="secondary"
              onClick={() => {
                setPanel(null);
                onRecord(c.id, f);
              }}
            >
              + {f.label}
            </Button>
          ))}
          {onConsent && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPanel(null);
                onConsent(c.id);
              }}
            >
              + Termo de consentimento
            </Button>
          )}
        </div>
      )}
      {panel === 'rename' && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
          {rename.error && <Alert>{errorText(rename.error, 'Erro ao renomear')}</Alert>}
          <Field label={surgery ? 'Cirurgia' : 'Tratamento'}>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
          <Button size="sm" loading={rename.isPending} disabled={title.trim().length < 3} onClick={() => rename.mutate(undefined)}>
            Salvar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
            Voltar
          </Button>
        </div>
      )}
      {c.notes && <p className="mt-2 whitespace-pre-line text-sm">{c.notes}</p>}
      {c.packages.length > 0 && (
        <p className="mt-2 text-sm text-fg-muted">
          Pacotes deste tratamento: {c.packages.map((p) => `${p.service} (${p.usedSessions} de ${p.totalSessions} usadas${p.status === 'cancelled' ? ', cancelado' : ''})`).join('; ')}
        </p>
      )}
      {surgery && (
        <div className="mt-3 space-y-2 rounded-xl border border-line p-3 text-sm">
          {c.budget ? (
            <p>
              Orçamento {c.budget.status === 'approved' ? <Badge tone="success">aprovado</Badge> : <Badge>em elaboração</Badge>}: clínica {formatMoney(c.budget.clinicTotal)}
              {c.budget.thirdPartyTotal > 0 && ` + ${formatMoney(c.budget.thirdPartyTotal)} pagos direto a terceiros`}
              {c.budget.approvedOn && ` · aprovado em ${formatDate(c.budget.approvedOn)} (${c.budget.installments}x)`}
            </p>
          ) : (
            <p className="text-fg-muted">Sem orçamento.</p>
          )}
          {c.surgery && (
            <p>
              Cirurgia {surgeryActive ? 'marcada' : `(${c.surgery.status === 'cancelled' ? 'horário cancelado' : 'falta'})`}: {formatDateTime(c.surgery.startsAt)} · {c.surgery.location}
              {c.surgery.team.length > 0 && ` · equipe: ${c.surgery.team.map((m) => `${m.name} (${m.role})`).join(', ')}`}
            </p>
          )}
          {c.status === 'active' && (
            <div className="flex flex-wrap items-center gap-2">
              {canBudget && (
                <Button size="sm" variant="secondary" onClick={() => setPanel('budget')}>
                  {c.budget?.status === 'approved' ? 'Ver orçamento' : 'Orçamento'}
                </Button>
              )}
              {canSchedule && !surgeryActive && (
                <Button size="sm" variant="secondary" onClick={() => setPanel('surgery')}>
                  Marcar cirurgia
                </Button>
              )}
              {canSell && surgeryActive && (
                <Button size="sm" variant="secondary" onClick={() => setPanel('drainage')}>
                  Pacote de drenagem (pós-operatório)
                </Button>
              )}
              {canWrite && (
                <Select
                  aria-label="Etapa"
                  className="h-8 w-auto"
                  value={c.stage ?? ''}
                  disabled={stage.isPending}
                  onChange={(e) => e.target.value !== c.stage && stage.mutate(e.target.value as SurgeryStage)}
                >
                  {surgeryStages.map((s) => (
                    <option key={s} value={s} disabled={s === 'scheduled'}>
                      Etapa: {surgeryStageLabel[s]}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}
          {stage.error && <Alert>{errorText(stage.error, 'Erro ao mudar a etapa')}</Alert>}
        </div>
      )}
      {panel === 'budget' && <BudgetEditor item={c} onClose={() => setPanel(null)} />}
      {panel === 'surgery' && <SurgeryScheduleForm item={c} onClose={() => setPanel(null)} />}
      {panel === 'close' && <CloseCaseForm item={c} onClose={() => setPanel(null)} />}
      {panel === 'drainage' && <SellModal customer={{ id: c.customer.id }} serviceName="Drenagem linfática" caseId={c.id} onClose={() => setPanel(null)} />}
    </Card>
  );
}

function CloseCaseForm({ item: c, onClose }: { item: AesCase; onClose: () => void }) {
  const [status, setStatus] = useState<'finished' | 'cancelled'>('finished');
  const [reason, setReason] = useState('');
  const save = useCaseMutation(() => api(`/aesthetics/cases/${c.id}/close`, { method: 'POST', body: { status, reason: reason || null } }), onClose);
  return (
    <Modal
      open
      title={`Encerrar: ${c.title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant={status === 'cancelled' ? 'danger' : 'primary'} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {status === 'cancelled' ? 'Cancelar tratamento' : 'Concluir tratamento'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{errorText(save.error, 'Erro ao encerrar')}</Alert>}
        <Field label="Como termina">
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as 'finished' | 'cancelled')}>
              <option value="finished">Concluído (alta)</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          )}
        </Field>
        <Field label={status === 'cancelled' ? 'Motivo' : 'Observação (opcional)'}>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {status === 'cancelled' && c.budget?.status === 'approved' && (
          <p className="text-sm text-fg-muted">As parcelas do orçamento ainda em aberto são canceladas no financeiro; as pagas ficam (estorno pelo financeiro).</p>
        )}
      </div>
    </Modal>
  );
}

type BudgetRow = { kind: BudgetKind; description: string; amount: string; billedBy: 'clinic' | 'third_party' };

/** Orçamento em partes: honorários, anestesista, hospital, prótese, materiais. Aprovado vira "a receber". */
export function BudgetEditor({ item: c, onClose }: { item: AesCase; onClose: () => void }) {
  const approved = c.budget?.status === 'approved';
  const [rows, setRows] = useState<BudgetRow[]>(
    c.budget?.items.map((i) => ({ ...i, amount: String(i.amount).replace('.', ',') })) ?? [
      { kind: 'surgeon', description: 'Honorários do cirurgião', amount: '', billedBy: 'clinic' },
      { kind: 'anesthetist', description: 'Equipe de anestesia', amount: '', billedBy: 'third_party' },
      { kind: 'hospital', description: 'Hospital / centro cirúrgico', amount: '', billedBy: 'third_party' },
      { kind: 'implant', description: 'Próteses', amount: '', billedBy: 'clinic' },
      { kind: 'materials', description: 'Materiais, malha e medicamentos', amount: '', billedBy: 'clinic' },
    ],
  );
  const [validUntil, setValidUntil] = useState(c.budget?.validUntil ?? '');
  const [installments, setInstallments] = useState('1');
  const [firstDueOn, setFirstDueOn] = useState(today());
  const set = (i: number, patch: Partial<BudgetRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const items = rows.filter((r) => r.description.trim() && r.amount.trim()).map((r) => ({ ...r, amount: parseMoney(r.amount) }));
  const total = (who: string) => items.filter((i) => i.billedBy === who).reduce((s, i) => s + (Number.isFinite(i.amount) ? i.amount : 0), 0);
  const save = useCaseMutation(() => api(`/aesthetics/cases/${c.id}/budget`, { method: 'PUT', body: { items, validUntil: validUntil || null } }));
  const approve = useCaseMutation(async () => {
    await api(`/aesthetics/cases/${c.id}/budget`, { method: 'PUT', body: { items, validUntil: validUntil || null } });
    return api(`/aesthetics/cases/${c.id}/budget/approve`, { method: 'POST', body: { installments: Number(installments), firstDueOn } });
  }, onClose);
  return (
    <Modal open title={`Orçamento: ${c.title} — ${c.customer.name}`} onClose={onClose}>
      <div className="space-y-4">
        {(save.error || approve.error) && <Alert>{errorText(save.error ?? approve.error, 'Erro no orçamento')}</Alert>}
        {save.isSuccess && !approve.isPending && <Alert tone="success">Orçamento salvo.</Alert>}
        {approved && <Alert tone="info">Aprovado em {formatDate(c.budget!.approvedOn!)}: a parte da clínica já está no financeiro. Para refazer, cancele o tratamento.</Alert>}
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid items-end gap-2 rounded-xl border border-line p-3 sm:grid-cols-[10rem_1fr_8rem_10rem_auto]">
              <Select aria-label="Tipo" disabled={approved} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as BudgetKind })}>
                {budgetKinds.map((k) => (
                  <option key={k} value={k}>
                    {budgetKindLabel[k]}
                  </option>
                ))}
              </Select>
              <Input aria-label="Descrição" disabled={approved} value={r.description} onChange={(e) => set(i, { description: e.target.value })} />
              <Input aria-label="Valor (R$)" disabled={approved} inputMode="decimal" placeholder="0,00" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} />
              <Select aria-label="Quem cobra" disabled={approved} value={r.billedBy} onChange={(e) => set(i, { billedBy: e.target.value as BudgetRow['billedBy'] })}>
                <option value="clinic">Cobrado pela clínica</option>
                <option value="third_party">Pago direto ao prestador</option>
              </Select>
              {!approved && (
                <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  Remover
                </Button>
              )}
            </div>
          ))}
          {!approved && (
            <Button size="sm" variant="secondary" onClick={() => setRows([...rows, { kind: 'other', description: '', amount: '', billedBy: 'clinic' }])}>
              + Item
            </Button>
          )}
        </div>
        <p className="text-sm">
          Clínica: <span className="font-medium tabular-nums">{formatMoney(total('clinic'))}</span> · Terceiros: <span className="tabular-nums">{formatMoney(total('third_party'))}</span> · Total para o paciente:{' '}
          <span className="font-medium tabular-nums">{formatMoney(total('clinic') + total('third_party'))}</span>
        </p>
        {!approved && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Validade do orçamento">{(id) => <Input id={id} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}</Field>
              <Field label="Parcelas (ao aprovar)">
                {(id) => (
                  <Select id={id} value={installments} onChange={(e) => setInstallments(e.target.value)}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}x
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="1º vencimento">{(id) => <Input id={id} type="date" min={today()} value={firstDueOn} onChange={(e) => setFirstDueOn(e.target.value)} />}</Field>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" loading={save.isPending} disabled={!items.length} onClick={() => save.mutate(undefined)}>
                Salvar rascunho
              </Button>
              <Button loading={approve.isPending} disabled={!items.length || total('clinic') <= 0} onClick={() => approve.mutate(undefined)}>
                Aprovar e lançar no financeiro
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Cirurgia na agenda: cirurgião (CRM + RQE), procedimento, sala/centro cirúrgico, local e equipe. */
function SurgeryScheduleForm({ item: c, onClose }: { item: AesCase; onClose: () => void }) {
  const resources = useResources();
  const services = useServices();
  const credentials = useCredentials();
  const defaultService = services.data?.find((s) => s.active && s.name === 'Cirurgia plástica (centro cirúrgico)')?.id ?? '';
  const [form, setForm] = useState({ resourceId: c.professional?.id ?? '', serviceId: '', date: '', time: '07:00', roomId: '', location: '' });
  const [team, setTeam] = useState<{ role: string; name: string }[]>([
    { role: 'Anestesista', name: '' },
    { role: 'Auxiliar', name: '' },
    { role: 'Instrumentador(a)', name: '' },
  ]);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const serviceId = form.serviceId || defaultService;
  const canOverride = useCan('shared.scheduling.manage');
  const save = useCaseMutation(
    (override: boolean) =>
      api(`/aesthetics/cases/${c.id}/surgery`, {
        method: 'POST',
        body: {
          resourceId: form.resourceId,
          serviceId,
          startsAt: localToUtc(form.date, form.time).toISOString(),
          roomId: form.roomId || null,
          location: form.location,
          team: team.filter((m) => m.name.trim().length >= 2),
          overrideSchedule: override || undefined,
        },
      }),
    onClose,
  );
  const outside = save.error instanceof ApiError && save.error.code === 'OUTSIDE_SCHEDULE';
  const surgeons = credentials.data?.filter((p) => p.active && p.credential?.council === 'CRM') ?? [];
  return (
    <Modal
      open
      title={`Marcar cirurgia: ${c.title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!form.resourceId || !serviceId || !form.date || !form.time || form.location.trim().length < 2} onClick={() => save.mutate(false)}>
            Marcar na agenda
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {outside && <OutsideScheduleAlert message={(save.error as ApiError).message} canOverride={canOverride} busy={save.isPending} onConfirm={() => save.mutate(true)} />}
        {save.error && !outside && <Alert>{errorText(save.error, 'Erro ao marcar a cirurgia')}</Alert>}
        <p className="text-xs text-fg-muted">Para marcar: orçamento aprovado, termo aceito neste tratamento e pré-operatório liberado (inclusive pela anestesia).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cirurgião (CRM e RQE)">
            {(id) => (
              <Select id={id} value={form.resourceId} onChange={(e) => set({ resourceId: e.target.value })}>
                <option value="">—</option>
                {surgeons.map((p) => (
                  <option key={p.resourceId} value={p.resourceId}>
                    {p.name} — {p.credential!.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Procedimento na agenda">
            {(id) => (
              <Select id={id} value={serviceId} onChange={(e) => set({ serviceId: e.target.value })}>
                <option value="">Escolha</option>
                {services.data
                  ?.filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.durationMin + s.bufferMin} min)
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Dia">{(id) => <Input id={id} type="date" min={today()} value={form.date} onChange={(e) => set({ date: e.target.value })} />}</Field>
          <Field label="Hora">{(id) => <Input id={id} type="time" step={900} value={form.time} onChange={(e) => set({ time: e.target.value })} />}</Field>
          <Field label="Sala / centro cirúrgico da agenda (opcional)">
            {(id) => (
              <Select id={id} value={form.roomId} onChange={(e) => set({ roomId: e.target.value })}>
                <option value="">—</option>
                {resources.data
                  ?.filter((r) => r.kind === 'room' && r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Local (hospital / clínica)">{(id) => <Input id={id} value={form.location} placeholder="Ex.: Hospital Santa Catarina — centro cirúrgico 3" onChange={(e) => set({ location: e.target.value })} />}</Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Equipe</legend>
          {team.map((m, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[12rem_1fr]">
              <Input aria-label="Função" value={m.role} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
              <Input aria-label="Nome" value={m.name} placeholder="Nome" onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setTeam([...team, { role: '', name: '' }])}>
            + Pessoa
          </Button>
        </fieldset>
      </div>
    </Modal>
  );
}
