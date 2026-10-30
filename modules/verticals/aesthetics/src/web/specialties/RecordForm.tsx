import type { FormField, MedicalEntry, MedicalForm } from '@all/medical-records';
import { ListValue, openAttachment, RecordFieldInput } from '@all/medical-records/web';
import { api, ApiError, apiUpload, formatDate, formatDateTime, today, useCan } from '@all/module-sdk/web';
import { localToUtc, useResources, useServices } from '@all/scheduling/web';
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { specialtyLabel, specialtyRequirement, type AesCase, type AesProduct, type SpecialtyKey } from '../../contracts';
import { FaceMap, type FacePoint } from './FaceMap';
import { daysFrom, specialtiesKey, useAesProducts, useCredentials, useSpecialtyOverview } from './hooks';
import { RecordImage } from './Photos';

type Row = Record<string, unknown>;
const LOT_KEYS = new Set(['product', 'lot', 'expiresOn', 'lotId']);
const hasLot = (fields: FormField[] | undefined) => !!fields?.some((f) => f.key === 'lotId');

/** Lotes que podem ser usados no dia (os vencidos ficam de fora). */
function lotOptions(products: AesProduct[] | undefined, on: string) {
  return (products ?? []).flatMap((p) =>
    p.lots
      .filter((l) => l.expiresOn >= on)
      .map((l) => ({ id: l.id, unit: p.unit, label: `${p.name}${p.brand ? ` (${p.brand})` : ''} — lote ${l.lot}, val. ${formatDate(l.expiresOn)}` })),
  );
}

function LotSelect({ value, options, onChange, label = 'Produto e lote' }: { value: unknown; options: ReturnType<typeof lotOptions>; onChange: (id: string, unit: string) => void; label?: string }) {
  return (
    <Field label={label} hint={options.length ? undefined : 'Nenhum lote válido cadastrado (Configurações › Especialidades da clínica)'}>
      {(id) => (
        <Select
          id={id}
          value={String(value ?? '')}
          onChange={(e) => {
            const o = options.find((x) => x.id === e.target.value);
            onChange(e.target.value, o?.unit ?? '');
          }}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Linhas com lote (pontos de aplicação, pigmentos, implantes): lote do cadastro + quantidade. */
function LotRows({
  field,
  rows,
  options,
  onChange,
  withMap,
}: {
  field: FormField;
  rows: Row[];
  options: ReturnType<typeof lotOptions>;
  onChange: (rows: Row[]) => void;
  withMap?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const cols = (field.itemFields ?? []).filter((c) => !c.hidden && !LOT_KEYS.has(c.key) && c.key !== 'unit');
  const set = (i: number, patch: Row) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Novo ponto herda o lote do anterior (a mesma seringa/frasco costuma ir em vários pontos).
  const add = (extra: Row = {}) => {
    const last = rows.at(-1);
    onChange([...rows, { ...(last?.lotId ? { lotId: last.lotId, unit: last.unit } : {}), ...extra }]);
    setSelected(rows.length);
  };
  const total = rows.reduce((s, r) => s + (Number(String(r.amount ?? '').replace(',', '.')) || 0), 0);
  const list = (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className={`grid items-end gap-2 rounded-xl border p-3 sm:grid-cols-3 ${selected === i ? 'border-brand-600' : 'border-line'}`} onFocus={() => setSelected(i)}>
          <div className="sm:col-span-3 flex items-center justify-between text-xs text-fg-muted">
            <span>{withMap ? `Ponto ${i + 1}` : `Item ${i + 1}`}</span>
            <Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              Remover
            </Button>
          </div>
          <div className="sm:col-span-2">
            <LotSelect value={r.lotId} options={options} onChange={(lotId, unit) => set(i, { lotId, unit })} />
          </div>
          {cols.map((c) => (
            <div key={c.key}>
              <RecordFieldInput field={c.key === 'amount' && r.unit ? { ...c, unit: String(r.unit) } : c} value={r[c.key]} onChange={(v) => set(i, { [c.key]: v })} />
            </div>
          ))}
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => add()}>
        + {withMap ? 'Ponto' : 'Item'}
      </Button>
      {total > 0 && <p className="text-sm text-fg-muted">Total: {String(total).replace('.', ',')}</p>}
    </div>
  );
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{field.label}</legend>
      {withMap ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_1fr]">
          <div>
            <FaceMap points={rows.map((r) => ({ x: Number(r.x ?? 100), y: Number(r.y ?? 125), region: String(r.region ?? '') }))} selected={selected} onSelect={setSelected} onAdd={(p: FacePoint) => add({ ...p })} className="w-full" />
            <p className="mt-1 text-xs text-fg-muted">Clique no rosto para marcar cada ponto. O lado direito do paciente fica à esquerda da tela.</p>
          </div>
          {list}
        </div>
      ) : (
        list
      )}
    </fieldset>
  );
}

/**
 * Ficha de uma especialidade. Profissional (com o registro do conselho), lote e caso são
 * escolhidos dos cadastros; o servidor preenche produto, lote e validade e confere tudo.
 */
export function SpecialtyRecordForm({
  customerId,
  specialty,
  form,
  cases,
  caseId: initialCase,
  nextSession,
  amends,
  onClose,
}: {
  customerId: string;
  specialty: SpecialtyKey;
  form: MedicalForm;
  cases: AesCase[];
  caseId?: string;
  nextSession?: number;
  /** Retificação: parte da ficha original; o original continua guardado. */
  amends?: MedicalEntry;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const overview = useSpecialtyOverview();
  const credentials = useCredentials();
  const products = useAesProducts({ specialty, active: true });
  const rooms = useResources();
  const [occurredOn, setOccurredOn] = useState(amends?.occurredOn ?? today());
  const [professionalId, setProfessionalId] = useState(typeof amends?.data.professionalId === 'string' ? amends.data.professionalId : '');
  const openCases = cases.filter((c) => c.specialty === specialty && c.status === 'active');
  const surgery = specialty === 'plastic_surgery';
  // Na cirurgia, termo e pré-operatório só contam ligados ao tratamento: com um só, já vem escolhido.
  const [caseId, setCaseId] = useState(initialCase ?? (typeof amends?.data.caseId === 'string' ? amends.data.caseId : surgery && openCases.length === 1 ? openCases[0]!.id : ''));
  const [notes, setNotes] = useState(amends?.notes ?? '');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [data, setData] = useState<Row>(() => {
    if (amends) return { ...amends.data };
    const d: Row = {};
    if (nextSession && form.fields.some((f) => f.key === 'session' && f.type === 'number')) d.session = nextSession;
    return d;
  });
  const returnDays = form.key === 'aesthetics.harmonization' ? overview.data?.returnDays.harmonization : form.key === 'aesthetics.micropigmentation' ? overview.data?.returnDays.micropigmentation : undefined;
  const returnKey = form.key === 'aesthetics.harmonization' ? 'returnOn' : form.key === 'aesthetics.micropigmentation' ? 'retouchOn' : null;
  const requirement = form.key.startsWith('aesthetics.') && !['aesthetics.complication'].includes(form.key) ? specialtyRequirement[specialty] : undefined;
  const options = useMemo(() => lotOptions(products.data, occurredOn), [products.data, occurredOn]);
  const set = (patch: Row) => setData({ ...data, ...patch });
  // Campo que pede foto (ex.: desenho aprovado da micropigmentação).
  const wantsPhoto = form.key === 'aesthetics.micropigmentation';

  const save = useMutation({
    mutationFn: async () => {
      const filled = { ...(returnKey && returnDays && data[returnKey] === undefined ? { [returnKey]: daysFrom(occurredOn, returnDays) } : {}), ...data };
      const entry = amends
        ? await api<MedicalEntry>(`/medical-records/${amends.id}/amend`, {
            method: 'POST',
            body: { data: { ...filled, professionalId: professionalId || undefined, caseId: caseId || undefined }, notes: notes || null, reason, occurredOn },
          })
        : await api<MedicalEntry>('/aesthetics/records', {
            method: 'POST',
            body: { specialty, formKey: form.key, customerId, caseId: caseId || null, professionalId: professionalId || null, occurredOn, data: filled, notes: notes || null },
          });
      // A ficha já entrou; se a foto falhar, avisa para anexar de novo sem perder o que foi escrito.
      if (photo) {
        try {
          await apiUpload(`/medical-records/${entry.id}/attachments`, 'file', photo);
        } catch {
          return { photoFailed: true };
        }
      }
      return { photoFailed: false };
    },
    onSuccess: ({ photoFailed: failed }) => {
      queryClient.invalidateQueries({ queryKey: specialtiesKey });
      queryClient.invalidateQueries({ queryKey: ['medical-records'] });
      if (failed) setPhotoFailed(true);
      else onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const topLot = hasLot(form.fields);
  return (
    <Modal
      open
      title={`${amends ? 'Retificar: ' : ''}${form.label} — ${specialtyLabel[specialty]}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {!photoFailed && (
            <Button type="submit" form="aes-record-form" loading={save.isPending} disabled={!!amends && reason.trim().length < 3}>
              {amends ? 'Salvar retificação' : 'Incluir no prontuário'}
            </Button>
          )}
        </>
      }
    >
      <form id="aes-record-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {photoFailed && <Alert>A ficha foi incluída, mas a foto não subiu. Anexe pelo prontuário completo, no registro desta ficha.</Alert>}
        {amends ? (
          <p className="text-xs text-fg-muted">A ficha original continua guardada. Se a quantidade ou o lote mudar, o rastreio e o estoque são corrigidos com um estorno.</p>
        ) : (
          <p className="text-xs text-fg-muted">Depois de incluída, a ficha não pode ser apagada nem editada — só retificada.</p>
        )}
        {surgery && !openCases.length && !amends && <Alert tone="info">Este paciente não tem tratamento de cirurgia aberto. A ficha fica no prontuário, mas não conta para marcar a cirurgia: abra o tratamento antes.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data do atendimento">{(id) => <Input id={id} type="date" required max={today()} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />}</Field>
          <Field label="Profissional" hint={requirement?.message}>
            {(id) => (
              <Select id={id} required={!!requirement} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                <option value="">—</option>
                {credentials.data
                  ?.filter((p) => p.active)
                  .map((p) => {
                    const ok = !requirement || (p.credential && requirement.councils.includes(p.credential.council));
                    return (
                      <option key={p.resourceId} value={p.resourceId} disabled={!ok}>
                        {p.name}
                        {p.credential ? ` — ${p.credential.label}` : ''}
                        {ok ? '' : ' (sem o registro exigido)'}
                      </option>
                    );
                  })}
              </Select>
            )}
          </Field>
          {openCases.length > 0 && (
            <Field label="Tratamento" hint={surgery ? 'Termo e pré-operatório só contam para marcar a cirurgia ligados ao tratamento.' : undefined}>
              {(id) => (
                <Select id={id} required={surgery} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                  {(!surgery || openCases.length > 1) && <option value="">{surgery ? 'Escolha' : '—'}</option>}
                  {openCases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {topLot && (
            <div className="sm:col-span-2">
              <LotSelect label={form.fields.find((f) => f.key === 'product')?.label ?? 'Produto e lote'} value={data.lotId} options={options} onChange={(lotId) => set({ lotId })} />
            </div>
          )}
          {form.fields
            .filter((f) => !f.hidden && f.key !== 'professional' && !(topLot && LOT_KEYS.has(f.key)))
            .map((f) => {
              const wide = f.type === 'textarea' || f.type === 'list';
              if (f.type === 'list' && hasLot(f.itemFields)) {
                return (
                  <div key={f.key} className="sm:col-span-2">
                    <LotRows field={f} rows={(data[f.key] as Row[] | undefined) ?? []} options={options} onChange={(rows) => set({ [f.key]: rows })} withMap={form.key === 'aesthetics.harmonization'} />
                  </div>
                );
              }
              if (form.key === 'aesthetics.laser' && f.key === 'device') {
                const equipment = rooms.data?.filter((r) => r.kind === 'room' && r.active) ?? [];
                return (
                  <Field key={f.key} label="Equipamento / sala">
                    {(id) => (
                      <Select id={id} value={String(data.roomId ?? '')} onChange={(e) => set({ roomId: e.target.value || null, device: equipment.find((r) => r.id === e.target.value)?.name ?? null })}>
                        <option value="">—</option>
                        {equipment.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                );
              }
              const value = returnKey === f.key && data[f.key] === undefined && returnDays ? daysFrom(occurredOn, returnDays) : data[f.key];
              return (
                <div key={f.key} className={wide ? 'sm:col-span-2' : undefined}>
                  <RecordFieldInput field={f} value={value} onChange={(v) => set({ [f.key]: v })} />
                </div>
              );
            })}
        </div>
        {wantsPhoto && (
          <Field label="Foto do desenho aprovado" hint="JPG, PNG, WebP ou PDF. Fica anexa à ficha no prontuário.">
            {(id) => <Input id={id} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />}
          </Field>
        )}
        <Field label="Observações">{(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {amends && <Field label="Motivo da retificação">{(id) => <Input id={id} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
      </form>
    </Modal>
  );
}

/** Ficha de especialidade já incluída: campos, mapa facial (harmonização) e anexos. */
export function SpecialtyEntryCard({
  entry: e,
  form,
  onSchedule,
  onAmend,
}: {
  entry: MedicalEntry;
  form: MedicalForm | undefined;
  onSchedule?: (date: string, professionalId: string | null) => void;
  onAmend?: () => void;
}) {
  const fields = (form?.fields ?? []).filter((f) => !f.hidden && f.key !== 'text' && e.data[f.key] !== undefined && e.data[f.key] !== '');
  const points = e.formKey === 'aesthetics.harmonization' && Array.isArray(e.data.points) ? (e.data.points as Row[]) : [];
  const returnOn = (e.data.returnOn ?? e.data.retouchOn ?? e.data.nextSessionOn ?? e.data.nextReturn) as string | undefined;
  const images = e.attachments.filter((a) => a.mime.startsWith('image/'));
  const superseded = !!e.amendedById;
  return (
    <Card className={superseded ? 'p-4 opacity-60' : 'p-4'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{e.title}</span>
          {e.amendsId && <Badge tone="warning">Retificação</Badge>}
          {superseded && <Badge>Retificado</Badge>}
        </div>
        <span className="text-xs text-fg-muted">
          <span className="font-medium text-fg">{formatDate(e.occurredOn)}</span> · {e.author.name} · registrado em {formatDateTime(e.createdAt)}
        </span>
      </div>
      <div className={points.length ? 'mt-3 grid gap-4 md:grid-cols-[minmax(0,12rem)_1fr]' : 'mt-3'}>
        {points.length > 0 && <FaceMap points={points.map((p) => ({ x: Number(p.x ?? 100), y: Number(p.y ?? 125), region: String(p.region ?? '') }))} className="w-full" />}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className={f.type === 'textarea' || f.type === 'list' ? 'sm:col-span-2' : undefined}>
              <dt className="text-xs text-fg-muted">{f.label}</dt>
              <dd className="whitespace-pre-line">{f.type === 'list' ? <ListValue field={f} value={e.data[f.key]} /> : display(f, e.data[f.key])}</dd>
            </div>
          ))}
        </dl>
      </div>
      {e.formKey === 'aesthetics.consent' && typeof e.data.text === 'string' && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-brand-700">Texto aceito (versão {String(e.data.version ?? '1')})</summary>
          <p className="mt-2 whitespace-pre-line rounded-lg bg-muted p-3">{e.data.text}</p>
        </details>
      )}
      {e.notes && <p className="mt-3 whitespace-pre-line text-sm">{e.notes}</p>}
      {images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((a) => (
            <button key={a.id} type="button" onClick={() => openAttachment(a.id)} className="overflow-hidden rounded-lg border border-line" title={a.filename}>
              <RecordImage fileId={a.id} alt={a.filename} className={e.formKey === 'aesthetics.consent' ? 'h-16 w-48 bg-white' : 'size-24'} />
            </button>
          ))}
        </div>
      )}
      {!superseded && ((onSchedule && returnOn) || onAmend) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onSchedule && returnOn && (
            <Button size="sm" variant="secondary" onClick={() => onSchedule(returnOn, typeof e.data.professionalId === 'string' ? e.data.professionalId : null)}>
              Agendar {e.formKey === 'aesthetics.micropigmentation' ? 'retoque' : e.formKey === 'aesthetics.harmonization' ? 'retorno / retoque' : 'retorno'} ({formatDate(returnOn)})
            </Button>
          )}
          {onAmend && (
            <Button size="sm" variant="ghost" onClick={onAmend}>
              Retificar
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function display(f: FormField, v: unknown) {
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  if (f.type === 'date' && typeof v === 'string') return formatDate(v);
  if (f.type === 'number') return `${String(v).replace('.', ',')}${f.unit ? ` ${f.unit}` : ''}`;
  return String(v);
}

/**
 * Retorno ou retoque na agenda, a partir da data prevista na ficha: horários livres do
 * profissional no dia (mesma regra da agenda).
 */
export function ScheduleReturn({
  customerId,
  date: initialDate,
  professionalId,
  serviceHint,
  onClose,
}: {
  customerId: string;
  date: string;
  professionalId: string | null;
  serviceHint: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const services = useServices();
  const resources = useResources();
  const fallback = services.data?.find((s) => s.active && serviceHint.some((h) => s.name.toLowerCase().includes(h.toLowerCase())))?.id ?? '';
  const [serviceId, setServiceId] = useState('');
  const [resourceId, setResourceId] = useState(professionalId ?? '');
  const [date, setDate] = useState(initialDate < today() ? today() : initialDate);
  const [time, setTime] = useState('');
  const service = serviceId || fallback;
  const slots = useQuery({
    queryKey: ['scheduling', 'availability', date, service, resourceId],
    queryFn: () => api<{ resourceId: string; resourceName: string; slots: string[] }[]>('/scheduling/availability', { query: { date, serviceIds: service, resourceId: resourceId || undefined } }),
    enabled: !!service && !!date,
  });
  // Sem profissional escolhido: o primeiro que tem horário livre no dia.
  const target = resourceId ? slots.data?.find((s) => s.resourceId === resourceId) : slots.data?.find((s) => s.slots.length);
  const free = target?.slots ?? [];
  const save = useMutation({
    mutationFn: () => {
      return api('/scheduling/appointments', { method: 'POST', body: { customerId, resourceId: resourceId || target?.resourceId, serviceIds: [service], startsAt: localToUtc(date, time).toISOString(), notes: 'Retorno/retoque marcado pela ficha da especialidade' } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Agendar retorno"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!service || !time} onClick={() => save.mutate()}>
            Marcar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao marcar'}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Serviço">
            {(id) => (
              <Select id={id} value={service} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Escolha</option>
                {services.data
                  ?.filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Profissional">
            {(id) => (
              <Select id={id} value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                <option value="">Qualquer um</option>
                {resources.data
                  ?.filter((r) => r.kind === 'professional' && r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Dia">{(id) => <Input id={id} type="date" min={today()} value={date} onChange={(e) => (setDate(e.target.value), setTime(''))} />}</Field>
        </div>
        {service && (
          <div>
            <p className="mb-2 text-sm font-medium">Horários livres</p>
            {slots.isPending ? (
              <p className="text-sm text-fg-muted">Carregando…</p>
            ) : free.length === 0 ? (
              <p className="text-sm text-fg-muted">Nenhum horário livre neste dia.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {free.map((s) => (
                  <Button key={s} size="sm" variant={s === time ? 'primary' : 'secondary'} onClick={() => setTime(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Para quem pode marcar na agenda. */
export const useCanSchedule = () => useCan('shared.scheduling.write');
