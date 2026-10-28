import { Badge, Button, Field, Input, Select, Textarea } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AddressFields, type Address } from './address';
import { api, apiDownload, apiUpload } from './api';
import { AuthImage } from './files';
import { formatDate, formatDocument, formatPhone } from './format';

// Pessoas da equipe (core.team): o mesmo cadastro serve à agenda (profissional), ao RH
// (colaborador) e à tela "Equipe". Dados pessoais: leitura com core.team.read, edição com core.team.manage.

export interface TeamLink {
  moduleKey: string;
  teamMemberId: string;
  label: string;
  path?: string;
  active: boolean;
}

export interface TeamMemberSummary {
  id: string;
  firstName: string;
  lastName: string | null;
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  photoFileId: string | null;
  startedOn: string | null;
  endedOn: string | null;
  active: boolean;
  userId: string | null;
  links: TeamLink[];
}

export interface TeamFile {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface TeamMemberDetail extends TeamMemberSummary {
  rg: string | null;
  birthDate: string | null;
  address: Address | null;
  linkedinUrl: string | null;
  resumeFileId: string | null;
  notes: string | null;
  photo: TeamFile | null;
  resume: TeamFile | null;
}

/** Estado do formulário (texto puro; vazio = sem valor). */
export interface TeamMemberDraft {
  firstName: string;
  lastName: string;
  cpf: string;
  rg: string;
  birthDate: string;
  email: string;
  phone: string;
  address: Address;
  linkedinUrl: string;
  startedOn: string;
  endedOn: string;
  userId: string;
  notes: string;
}

/** Foto e currículo escolhidos no formulário, enviados depois de salvar (null = remover). */
export interface PendingTeamFiles {
  photo?: File | null;
  resume?: File | null;
}

export const teamKey = ['team'];

export const emptyTeamMemberDraft = (name = ''): TeamMemberDraft => {
  const [firstName = '', ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' '), cpf: '', rg: '', birthDate: '', email: '', phone: '', address: {}, linkedinUrl: '', startedOn: '', endedOn: '', userId: '', notes: '' };
};

export const draftFromTeamMember = (m: TeamMemberDetail): TeamMemberDraft => ({
  firstName: m.firstName,
  lastName: m.lastName ?? '',
  cpf: formatDocument(m.cpf),
  rg: m.rg ?? '',
  birthDate: m.birthDate ?? '',
  email: m.email ?? '',
  phone: formatPhone(m.phone),
  address: m.address ?? {},
  linkedinUrl: m.linkedinUrl ?? '',
  startedOn: m.startedOn ?? '',
  endedOn: m.endedOn ?? '',
  userId: m.userId ?? '',
  notes: m.notes ?? '',
});

/** Corpo para POST/PATCH /team (ou `person` do profissional da agenda). */
export function teamMemberBody(d: TeamMemberDraft) {
  const orNull = (v: string) => v.trim() || null;
  const hasAddress = Object.values(d.address).some((v) => v && String(v).trim());
  return {
    firstName: d.firstName.trim(),
    lastName: orNull(d.lastName),
    cpf: orNull(d.cpf),
    rg: orNull(d.rg),
    birthDate: orNull(d.birthDate),
    email: orNull(d.email),
    phone: orNull(d.phone),
    address: hasAddress ? d.address : null,
    linkedinUrl: orNull(d.linkedinUrl),
    startedOn: orNull(d.startedOn),
    endedOn: orNull(d.endedOn),
    userId: orNull(d.userId),
    notes: orNull(d.notes),
  };
}

/** Envia (ou remove) a foto e o currículo escolhidos no formulário. */
export async function saveTeamFiles(memberId: string, files: PendingTeamFiles) {
  if (files.photo) await apiUpload(`/team/${memberId}/photo`, 'photo', files.photo);
  else if (files.photo === null) await api(`/team/${memberId}/photo`, { method: 'DELETE' });
  if (files.resume) await apiUpload(`/team/${memberId}/resume`, 'file', files.resume);
  else if (files.resume === null) await api(`/team/${memberId}/resume`, { method: 'DELETE' });
}

export const useTeamMember = (id: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: [...teamKey, 'member', id], queryFn: () => api<TeamMemberDetail>(`/team/${id}`), enabled: !!id && enabled });

const useUsers = () => useQuery({ queryKey: ['users', 'team'], queryFn: () => api<{ id: string; name: string }[]>('/users/team'), staleTime: 60_000 });

/**
 * Campos do cadastro da pessoa: foto, nome, documentos, contato, endereço (com CEP), LinkedIn,
 * currículo, início/encerramento na empresa, login do sistema e observações.
 */
export function TeamMemberFields({
  draft,
  onChange,
  member,
  files,
  onFilesChange,
  readOnly = false,
}: {
  draft: TeamMemberDraft;
  onChange: (draft: TeamMemberDraft) => void;
  /** Cadastro salvo (para mostrar a foto e o currículo atuais). */
  member?: TeamMemberDetail | null;
  files: PendingTeamFiles;
  onFilesChange: (files: PendingTeamFiles) => void;
  readOnly?: boolean;
}) {
  const users = useUsers();
  const set = (patch: Partial<TeamMemberDraft>) => onChange({ ...draft, ...patch });
  const photoInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (files.photo ? URL.createObjectURL(files.photo) : null), [files.photo]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const currentPhoto = files.photo === null ? null : (member?.photoFileId ?? null);
  const currentResume = files.resume === null ? null : (member?.resume ?? null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <fieldset disabled={readOnly} className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="size-20 shrink-0 overflow-hidden rounded-full bg-muted">
          {preview ? (
            <img src={preview} alt="Foto escolhida" className="size-full object-cover" />
          ) : currentPhoto ? (
            <AuthImage fileId={currentPhoto} alt="Foto de perfil" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-2xl font-medium text-fg-muted" aria-hidden>
              {(draft.firstName[0] ?? '?').toUpperCase()}
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFilesChange({ ...files, photo: file });
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="secondary" onClick={() => photoInput.current?.click()}>
              {currentPhoto || preview ? 'Trocar foto' : 'Escolher foto'}
            </Button>
            {(currentPhoto || preview) && (
              <Button size="sm" variant="ghost" onClick={() => onFilesChange({ ...files, photo: member?.photoFileId ? null : undefined })}>
                Remover foto
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">{(id) => <Input id={id} required value={draft.firstName} onChange={(e) => set({ firstName: e.target.value })} />}</Field>
        <Field label="Sobrenome">{(id) => <Input id={id} value={draft.lastName} onChange={(e) => set({ lastName: e.target.value })} />}</Field>
        <Field label="CPF">{(id) => <Input id={id} inputMode="numeric" placeholder="000.000.000-00" value={draft.cpf} onChange={(e) => set({ cpf: e.target.value })} />}</Field>
        <Field label="RG">{(id) => <Input id={id} value={draft.rg} onChange={(e) => set({ rg: e.target.value })} />}</Field>
        <Field label="Data de nascimento">{(id) => <Input id={id} type="date" value={draft.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />}</Field>
        <Field label="Telefone / WhatsApp">
          {(id) => <Input id={id} type="tel" placeholder="(11) 98765-4321" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />}
        </Field>
        <Field label="E-mail">{(id) => <Input id={id} type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
        <Field label="LinkedIn">
          {(id) => <Input id={id} type="url" inputMode="url" placeholder="https://www.linkedin.com/in/…" value={draft.linkedinUrl} onChange={(e) => set({ linkedinUrl: e.target.value })} />}
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">Endereço</p>
        <AddressFields value={draft.address} onChange={(address) => set({ address })} />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">Currículo</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {files.resume ? (
            <span>{files.resume.name} (será enviado ao salvar)</span>
          ) : currentResume && member ? (
            <button type="button" className="text-brand-700 hover:underline" onClick={() => apiDownload(`/team/${member.id}/resume`, currentResume.filename)}>
              {currentResume.filename}
            </button>
          ) : (
            <span className="text-fg-muted">Nenhum arquivo.</span>
          )}
          {!readOnly && (
            <>
              <input
                ref={resumeInput}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFilesChange({ ...files, resume: file });
                  e.target.value = '';
                }}
              />
              <Button size="sm" variant="secondary" onClick={() => resumeInput.current?.click()}>
                {currentResume || files.resume ? 'Trocar' : 'Enviar currículo'}
              </Button>
              {(currentResume || files.resume) && (
                <Button size="sm" variant="ghost" onClick={() => onFilesChange({ ...files, resume: member?.resume ? null : undefined })}>
                  Remover
                </Button>
              )}
            </>
          )}
        </div>
        <p className="mt-1 text-xs text-fg-muted">PDF ou Word (DOC/DOCX), até 15 MB.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Início na empresa">{(id) => <Input id={id} type="date" value={draft.startedOn} onChange={(e) => set({ startedOn: e.target.value })} />}</Field>
        <Field label="Data de encerramento" hint={draft.endedOn && draft.endedOn < today ? 'Já passou: a pessoa sai da agenda (profissional inativo).' : 'Depois desta data, a pessoa sai da agenda.'}>
          {(id) => <Input id={id} type="date" value={draft.endedOn} onChange={(e) => set({ endedOn: e.target.value })} />}
        </Field>
        <Field label="Login do sistema" hint="Usuário do admin que é esta pessoa (opcional).">
          {(id) => (
            <Select id={id} value={draft.userId} onChange={(e) => set({ userId: e.target.value })}>
              <option value="">Não usa o sistema</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Observações">{(id) => <Textarea id={id} rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
    </fieldset>
  );
}

/** Onde a pessoa aparece (agenda, RH…): selos com link para a tela de cada módulo. */
export function TeamLinks({ links, renderLink }: { links: TeamLink[]; renderLink?: (link: TeamLink, children: ReactNode) => ReactNode }) {
  if (!links.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {links.map((l) => {
        const badge = <Badge tone={l.active ? 'brand' : 'neutral'}>{l.active ? l.label : `${l.label} (inativo)`}</Badge>;
        return <span key={`${l.moduleKey}:${l.path ?? l.label}`}>{renderLink && l.path ? renderLink(l, badge) : badge}</span>;
      })}
    </span>
  );
}

/** Busca de pessoa já cadastrada na equipe (para vincular a um profissional da agenda ou a um colaborador). */
export function TeamMemberPicker({ onSelect, excludeIds = [], autoFocus = false }: { onSelect: (m: TeamMemberSummary) => void; excludeIds?: string[]; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: [...teamKey, 'search', q],
    queryFn: () => api<{ items: TeamMemberSummary[] }>('/team', { query: { q, status: 'all', limit: 8 } }),
    enabled: q.trim().length >= 2,
  });
  const items = results.data?.items.filter((m) => !excludeIds.includes(m.id)) ?? [];
  return (
    <div>
      <Input type="search" aria-label="Buscar pessoa da equipe" placeholder="Nome, CPF, e-mail ou telefone" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} />
      {q.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted" onClick={() => onSelect(m)}>
                <span className="font-medium">{m.name}</span>
                <span className="text-sm text-fg-muted">{formatDocument(m.cpf) || formatPhone(m.phone) || m.email || ''}</span>
                {!m.active && m.endedOn && <Badge>Encerrado em {formatDate(m.endedOn)}</Badge>}
                <TeamLinks links={m.links} />
              </button>
            </li>
          ))}
          {results.isSuccess && items.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">Ninguém encontrado na equipe.</li>}
        </ul>
      )}
    </div>
  );
}
