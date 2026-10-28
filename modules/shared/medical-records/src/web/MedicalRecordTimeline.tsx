import { api, apiBlob, ApiError, apiUpload, formatDate, formatDateTime, today, useCan } from '@all/module-sdk/web';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from '@all/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { fieldText, type AccessLogEntry, type FormField, type MedicalEntry, type MedicalForm } from '../contracts';

export const medicalRecordsKey = ['medical-records'] as const;

const actionLabel: Record<AccessLogEntry['action'], string> = {
  view: 'Abriu o prontuário',
  create: 'Incluiu registro',
  amend: 'Retificou registro',
  attach: 'Anexou arquivo',
  download: 'Abriu anexo',
};

/**
 * Prontuário de um paciente (cliente ou pet): registros só de inclusão, do mais recente ao mais
 * antigo. Corrigir é retificar: o registro original fica visível, marcado como retificado.
 */
export function MedicalRecordTimeline({ subjectType, subjectId }: { subjectType: string; subjectId: string }) {
  const canWrite = useCan('shared.medical-records.write');
  const canAudit = useCan('shared.medical-records.audit');
  const entries = useQuery({
    queryKey: [...medicalRecordsKey, subjectType, subjectId],
    queryFn: () => api<MedicalEntry[]>('/medical-records', { query: { subjectType, subjectId } }),
  });
  const forms = useQuery({
    queryKey: [...medicalRecordsKey, 'forms', subjectType],
    queryFn: () => api<MedicalForm[]>('/medical-records/forms', { query: { subjectType } }),
    staleTime: Infinity,
  });
  const [writing, setWriting] = useState<{ form: MedicalForm; amends?: MedicalEntry } | null>(null);
  const [showLog, setShowLog] = useState(false);

  if (entries.isPending || forms.isPending) return <Spinner />;
  if (entries.isError) return <Alert>{entries.error.message}</Alert>;
  if (forms.isError) return <Alert>{forms.error.message}</Alert>;
  const formOf = (key: string) => forms.data.find((f) => f.key === key) ?? { key, moduleKey: '', label: key, subjectTypes: [], fields: [] };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite &&
          // Formulários geridos por um módulo (ex.: aplicação com lote) entram pela tela dele.
          forms.data
            .filter((f) => !f.managed)
            .map((f) => (
            <Button key={f.key} size="sm" variant={f.key === 'note' ? 'secondary' : 'primary'} onClick={() => setWriting({ form: f })}>
              {f.key === 'note' ? '+ Anotação' : `+ ${f.label}`}
            </Button>
          ))}
        {canAudit && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowLog(true)}>
            Quem acessou
          </Button>
        )}
      </div>
      {entries.data.length === 0 ? (
        <Card>
          <EmptyState title="Prontuário vazio" description="Os registros aparecem aqui, do mais recente ao mais antigo." />
        </Card>
      ) : (
        <ol className="space-y-3">
          {entries.data.map((e) => (
            <EntryCard key={e.id} entry={e} form={formOf(e.formKey)} canWrite={canWrite} onAmend={() => setWriting({ form: formOf(e.formKey), amends: e })} />
          ))}
        </ol>
      )}
      {writing && <EntryModal subjectType={subjectType} subjectId={subjectId} form={writing.form} amends={writing.amends} onClose={() => setWriting(null)} />}
      {showLog && <AccessLogModal subjectType={subjectType} subjectId={subjectId} onClose={() => setShowLog(false)} />}
    </div>
  );
}

function EntryCard({ entry: e, form, canWrite, onAmend }: { entry: MedicalEntry; form: MedicalForm; canWrite: boolean; onAmend: () => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => apiUpload(`/medical-records/${e.id}/attachments`, 'file', file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: medicalRecordsKey }),
  });
  const filled = form.fields.filter((f) => !f.hidden && fieldText(f, e.data[f.key]));
  const superseded = !!e.amendedById;

  return (
    <li>
      <Card className={superseded ? 'p-4 opacity-60' : 'p-4'}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{e.title}</span>
            {e.amendsId && <Badge tone="warning">Retificação</Badge>}
            {superseded && <Badge>Retificado</Badge>}
          </div>
          <span className="text-xs text-fg-muted">
            <span className="font-medium text-fg">{formatDate(e.occurredOn)}</span> · {e.author.name}
            <span title="Quando foi registrado no sistema"> · registrado em {formatDateTime(e.createdAt)}</span>
          </span>
        </div>
        {e.amendReason && <p className="mt-1 text-xs text-fg-muted">Motivo da retificação: {e.amendReason}</p>}
        {filled.length > 0 && (
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {filled.map((f) => (
              <div key={f.key} className={f.type === 'textarea' || f.type === 'list' ? 'sm:col-span-2' : undefined}>
                <dt className="text-xs text-fg-muted">{f.label}</dt>
                <dd className="whitespace-pre-line">{f.type === 'list' ? <ListValue field={f} value={e.data[f.key]} /> : fieldText(f, e.data[f.key])}</dd>
              </div>
            ))}
          </dl>
        )}
        {e.notes && <p className="mt-3 whitespace-pre-line text-sm">{e.notes}</p>}
        {e.attachments.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {e.attachments.map((a) => (
              <li key={a.id}>
                <button type="button" className="rounded-full border border-line px-3 py-1 text-xs hover:bg-muted" onClick={() => openAttachment(a.id)}>
                  {a.filename}
                </button>
              </li>
            ))}
          </ul>
        )}
        {upload.error && (
          <div className="mt-2">
            <Alert>{upload.error instanceof ApiError ? upload.error.message : 'Erro ao anexar'}</Alert>
          </div>
        )}
        {canWrite && !superseded && (
          <div className="mt-3 flex gap-2 print:hidden">
            <Button size="sm" variant="ghost" loading={upload.isPending} onClick={() => fileInput.current?.click()}>
              Anexar arquivo
            </Button>
            <Button size="sm" variant="ghost" onClick={onAmend}>
              Retificar
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                if (file) upload.mutate(file);
                ev.target.value = '';
              }}
            />
          </div>
        )}
      </Card>
    </li>
  );
}

/** Abre o anexo numa aba nova (o download passa pela API, que registra o acesso). */
export async function openAttachment(fileId: string) {
  const tab = window.open('', '_blank');
  const blob = await apiBlob(`/medical-records/attachments/${fileId}`).catch((err: unknown) => {
    tab?.close();
    window.alert(err instanceof ApiError && err.status === 403 ? 'Sem permissão para abrir o anexo' : 'Não foi possível abrir o anexo');
    return null;
  });
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  if (tab) tab.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function EntryModal({ subjectType, subjectId, form, amends, onClose }: { subjectType: string; subjectId: string; form: MedicalForm; amends?: MedicalEntry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<Record<string, unknown>>(amends?.data ?? {});
  const [notes, setNotes] = useState(amends?.notes ?? '');
  const [reason, setReason] = useState('');
  const [occurredOn, setOccurredOn] = useState(amends?.occurredOn ?? today());
  const save = useMutation({
    mutationFn: () =>
      amends
        ? api(`/medical-records/${amends.id}/amend`, { method: 'POST', body: { data, notes: notes || null, reason, occurredOn } })
        : api('/medical-records', { method: 'POST', body: { subjectType, subjectId, formKey: form.key, data, notes: notes || null, occurredOn } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: medicalRecordsKey });
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
      title={amends ? `Retificar: ${form.label}` : form.label}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="mr-entry-form" loading={save.isPending}>
            {amends ? 'Salvar retificação' : 'Incluir no prontuário'}
          </Button>
        </>
      }
    >
      <form id="mr-entry-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao salvar'}</Alert>}
        {!amends && <p className="text-xs text-fg-muted">Depois de incluído, o registro não pode ser apagado nem editado — só retificado.</p>}
        <Field label="Data do atendimento" hint="Para lançar um atendimento antigo, informe a data em que ele aconteceu.">
          {(id) => <Input id={id} type="date" required max={today()} className="sm:w-48" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {form.fields
            .filter((f) => !f.hidden)
            .map((f) => (
              <div key={f.key} className={f.type === 'textarea' || f.type === 'list' ? 'sm:col-span-2' : undefined}>
                <RecordFieldInput field={f} value={data[f.key]} onChange={(v) => setData({ ...data, [f.key]: v })} />
              </div>
            ))}
        </div>
        <Field label={form.fields.length ? 'Observações' : 'Anotação'}>
          {(id) => <Textarea id={id} rows={form.fields.length ? 3 : 6} value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus={!form.fields.length} />}
        </Field>
        {amends && (
          <Field label="Motivo da retificação">{(id) => <Input id={id} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: peso digitado errado" />}</Field>
        )}
      </form>
    </Modal>
  );
}

/** Linhas de um campo `list`, em tabela (sem os subcampos ocultos). */
export function ListValue({ field, value }: { field: FormField; value: unknown }) {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const cols = (field.itemFields ?? []).filter((c) => !c.hidden && rows.some((r) => fieldText(c, r[c.key])));
  if (!rows.length) return null;
  return (
    <div className="mt-1 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-fg-muted">
            {cols.map((c) => (
              <th key={c.key} className="py-1 pr-3 font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {cols.map((c) => (
                <td key={c.key} className="py-1 pr-3 align-top">
                  {fieldText(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Editor de um campo `list`: uma linha por item, com os subcampos visíveis. */
function ListInput({ field: f, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const cols = (f.itemFields ?? []).filter((c) => !c.hidden && c.type !== 'list');
  const set = (i: number, patch: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{f.label}</legend>
      {f.hint && <p className="text-xs text-fg-muted">{f.hint}</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid items-end gap-2 rounded-xl border border-line p-3 sm:grid-cols-3">
          {cols.map((c) => (
            <div key={c.key} className={c.type === 'textarea' ? 'sm:col-span-3' : undefined}>
              <RecordFieldInput field={c} value={r[c.key]} onChange={(v) => set(i, { [c.key]: v })} />
            </div>
          ))}
          <div className="sm:col-span-3">
            <Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              Remover linha
            </Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...rows, {}])}>
        + Linha
      </Button>
    </fieldset>
  );
}

/** Campo de formulário de prontuário (usado também pelas telas dos módulos com fichas próprias). */
export function RecordFieldInput({ field: f, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === 'list') return <ListInput field={f} value={value} onChange={onChange} />;
  if (f.type === 'boolean') return <Checkbox label={f.label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  const label = f.unit ? `${f.label} (${f.unit})` : f.label;
  return (
    <Field label={label} hint={f.hint}>
      {(id) =>
        f.type === 'textarea' ? (
          <Textarea id={id} rows={3} required={f.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        ) : f.type === 'select' ? (
          <Select id={id} required={f.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">—</option>
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id={id}
            required={f.required}
            type={f.type === 'date' ? 'date' : 'text'}
            inputMode={f.type === 'number' ? 'decimal' : undefined}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

function AccessLogModal({ subjectType, subjectId, onClose }: { subjectType: string; subjectId: string; onClose: () => void }) {
  const log = useQuery({
    queryKey: [...medicalRecordsKey, 'access-log', subjectType, subjectId],
    queryFn: () => api<AccessLogEntry[]>('/medical-records/access-log', { query: { subjectType, subjectId } }),
  });
  return (
    <Modal open title="Quem acessou este prontuário" onClose={onClose}>
      {log.isPending ? (
        <Spinner />
      ) : log.isError ? (
        <Alert>{log.error.message}</Alert>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {log.data.map((l) => (
            <li key={l.id} className="flex justify-between gap-4 py-2">
              <span>
                <span className="font-medium">{l.user?.name ?? 'Sistema'}</span> · {actionLabel[l.action]}
              </span>
              <span className="whitespace-nowrap text-fg-muted">{formatDateTime(l.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
