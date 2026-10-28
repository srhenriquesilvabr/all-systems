import type { MedicalEntry } from '@all/medical-records';
import { apiBlob, apiUpload, ApiError, formatDate, today } from '@all/module-sdk/web';
import { Alert, Button, Card, EmptyState, Field, Input, Modal, Select } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { photoAngles, photoPhases, photoRegions, specialtyLabel, type AesCase, type SpecialtyKey } from '../../contracts';
import { specialtiesKey } from './hooks';

/**
 * Foto do prontuário: baixada pela rota dos anexos, que confere a permissão e registra o acesso
 * no log do prontuário (nunca pelo download genérico de arquivos).
 */
export function RecordImage({ fileId, alt, className }: { fileId: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    apiBlob(`/medical-records/attachments/${fileId}`)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);
  if (failed) return <div className={`flex items-center justify-center bg-muted text-xs text-fg-muted ${className ?? ''}`}>Sem acesso à imagem</div>;
  return src ? <img src={src} alt={alt} className={`object-contain ${className ?? ''}`} /> : <div className={`animate-pulse bg-muted ${className ?? ''}`} />;
}

const caption = (e: MedicalEntry) => `${String(e.data.region ?? '')} · ${String(e.data.angle ?? '')} · ${String(e.data.phase ?? '')} · ${formatDate(e.occurredOn)}`;

/** Fotos padronizadas (região, ângulo, momento) e comparação antes/depois lado a lado. */
export function PhotoBoard({
  customerId,
  specialty,
  photos,
  cases,
  canWrite,
}: {
  customerId: string;
  specialty: SpecialtyKey;
  photos: MedicalEntry[];
  cases: AesCase[];
  canWrite: boolean;
}) {
  const withImage = photos.filter((p) => p.attachments.length > 0 && !p.amendedById);
  const [uploading, setUploading] = useState(false);
  const [compare, setCompare] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => setUploading(true)}>
            + Foto
          </Button>
        )}
        {withImage.length >= 2 && (
          <Button size="sm" variant="secondary" onClick={() => setCompare(true)}>
            Comparar antes e depois
          </Button>
        )}
      </div>
      {withImage.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma foto" description="Fotos padronizadas por região e ângulo, para comparar a evolução." />
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {withImage.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <RecordImage fileId={p.attachments[0]!.id} alt={caption(p)} className="aspect-square w-full" />
              <p className="px-2 py-1.5 text-xs text-fg-muted">{caption(p)}</p>
            </li>
          ))}
        </ul>
      )}
      {uploading && <PhotoUpload customerId={customerId} specialty={specialty} cases={cases} onClose={() => setUploading(false)} />}
      {compare && <PhotoCompare photos={withImage} onClose={() => setCompare(false)} />}
    </div>
  );
}

function PhotoUpload({ customerId, specialty, cases, onClose }: { customerId: string; specialty: SpecialtyKey; cases: AesCase[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ region: photoRegions[specialty][0]!, angle: 'Frontal', phase: 'Antes', occurredOn: today(), caseId: '' });
  const [file, setFile] = useState<File | null>(null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const q = new URLSearchParams({ customerId, specialty, ...form });
      return apiUpload(`/aesthetics/photos?${q.toString()}`, 'file', file!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: specialtiesKey });
      queryClient.invalidateQueries({ queryKey: ['medical-records'] });
      onClose();
    },
  });
  const open = cases.filter((c) => c.specialty === specialty && c.status === 'active');
  return (
    <Modal
      open
      title={`Foto clínica — ${specialtyLabel[specialty]}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!file || form.region.trim().length < 2} onClick={() => save.mutate()}>
            Incluir no prontuário
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao enviar a foto'}</Alert>}
        <p className="text-xs text-fg-muted">Use sempre a mesma distância, luz e fundo para a comparação ficar justa. A foto entra no prontuário e não pode ser apagada.</p>
        <Field label="Foto (JPG, PNG ou WebP, até 8 MB)">
          {(id) => <Input id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Região">
            {(id) => (
              <>
                <Input id={id} list={`${id}-regions`} value={form.region} onChange={(e) => set({ region: e.target.value })} />
                <datalist id={`${id}-regions`}>
                  {photoRegions[specialty].map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Ângulo">
            {(id) => (
              <Select id={id} value={form.angle} onChange={(e) => set({ angle: e.target.value })}>
                {photoAngles.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Momento">
            {(id) => (
              <Select id={id} value={form.phase} onChange={(e) => set({ phase: e.target.value })}>
                {photoPhases.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Data da foto">{(id) => <Input id={id} type="date" max={today()} value={form.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />}</Field>
          {open.length > 0 && (
            <Field label="Tratamento (opcional)">
              {(id) => (
                <Select id={id} value={form.caseId} onChange={(e) => set({ caseId: e.target.value })}>
                  <option value="">—</option>
                  {open.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Lado a lado: por padrão, o "Antes" mais antigo e o "Depois" mais recente da mesma região e ângulo. */
function PhotoCompare({ photos, onClose }: { photos: MedicalEntry[]; onClose: () => void }) {
  const sorted = useMemo(() => [...photos].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt)), [photos]);
  const initial = useMemo(() => {
    const before = sorted.find((p) => p.data.phase === 'Antes') ?? sorted[0]!;
    const same = sorted.filter((p) => p.id !== before.id && p.data.region === before.data.region && p.data.angle === before.data.angle);
    const after = [...same].reverse().find((p) => p.data.phase !== 'Antes') ?? same.at(-1) ?? sorted.at(-1)!;
    return { left: before.id, right: after.id };
  }, [sorted]);
  const [left, setLeft] = useState(initial.left);
  const [right, setRight] = useState(initial.right);
  const pick = (id: string) => sorted.find((p) => p.id === id)!;
  const side = (value: string, onChange: (v: string) => void, label: string) => {
    const p = pick(value);
    return (
      <div className="space-y-2">
        <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          {sorted.map((o) => (
            <option key={o.id} value={o.id}>
              {caption(o)}
            </option>
          ))}
        </Select>
        <RecordImage key={p.id} fileId={p.attachments[0]!.id} alt={caption(p)} className="aspect-[3/4] w-full rounded-xl border border-line" />
        <p className="text-center text-sm font-medium">
          {String(p.data.phase)} · {formatDate(p.occurredOn)}
        </p>
      </div>
    );
  };
  return (
    <Modal open title="Antes e depois" onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        {side(left, setLeft, 'Foto da esquerda')}
        {side(right, setRight, 'Foto da direita')}
      </div>
      <p className="mt-3 text-xs text-fg-muted">Cada foto aberta fica registrada no log de acesso do prontuário.</p>
    </Modal>
  );
}
