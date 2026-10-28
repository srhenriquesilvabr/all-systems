import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, count, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { addressInput } from '../common/address';
import { localToday } from '../common/dates';
import { isValidCpf, normalizePhone, onlyDigits } from '../customers/br';
import { memberships } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { ScheduledJobs } from '../events/jobs';
import { OutboxService } from '../events/outbox';
import { files } from '../files/schema';
import { FilesService, type FileDto, type UploadedFile } from '../files/files.service';
import { teamMemberName, teamMembers } from './schema';
import { TeamLinksRegistry, type TeamLink } from './team-links.registry';

export const TEAM_MODULE = 'core.team';
/** Publicado quando a data de encerramento de uma pessoa já passou (ao salvar ou pelo job diário). */
export const TEAM_MEMBER_ENDED = 'core.team.member_ended';
export interface TeamMemberEnded {
  teamMemberId: string;
  endedOn: string;
}

const PHOTO_OWNER = 'team_member_photo';
/** Currículo não sai pelo download genérico (/files/:id): só por /team/:id/resume, com permissão e registro. */
const RESUME_OWNER = 'team_member_resume';

/** Texto opcional: ausente (undefined) mantém o valor no PATCH; vazio vira null. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v === undefined ? undefined : v || null));

export const teamMemberInput = z.object({
  firstName: z.string().trim().min(1, 'Informe o nome').max(80),
  lastName: text(120),
  cpf: text(14),
  rg: text(20),
  birthDate: isoDate,
  email: z
    .string()
    .trim()
    .email('E-mail inválido')
    .max(254)
    .nullish()
    .or(z.literal(''))
    .transform((v) => (v === undefined ? undefined : v || null)),
  phone: text(20),
  address: addressInput,
  linkedinUrl: text(300)
    // "linkedin.com/in/fulano" sem o https:// também vale.
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .refine((v) => !v || isHttpUrl(v), 'LinkedIn: informe o endereço do perfil (ex.: https://www.linkedin.com/in/fulano)'),
  startedOn: isoDate,
  endedOn: isoDate,
  /** Login do sistema (usuário ativo da empresa). */
  userId: z.string().uuid().nullish(),
  notes: text(2000),
});
export type TeamMemberInput = z.infer<typeof teamMemberInput>;
export type TeamMemberPatch = Partial<TeamMemberInput>;
export type TeamMemberRow = typeof teamMembers.$inferSelect;

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
  /** Sem encerramento, ou encerramento hoje ou no futuro. */
  active: boolean;
  userId: string | null;
  links: TeamLink[];
}

export type TeamMemberDetail = TeamMemberSummary &
  Pick<TeamMemberRow, 'rg' | 'birthDate' | 'address' | 'linkedinUrl' | 'resumeFileId' | 'notes' | 'createdAt' | 'updatedAt'> & {
    photo: FileDto | null;
    resume: FileDto | null;
  };

/** "Ana Maria Lima" → nome "Ana", sobrenome "Maria Lima" (para quem só tem o nome completo: RH, agenda). */
export function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') || null };
}

export const fullName = (m: Pick<TeamMemberRow, 'firstName' | 'lastName'>) => [m.firstName, m.lastName].filter(Boolean).join(' ');

function isHttpUrl(v: string) {
  try {
    const url = new URL(v);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

const notFound = () => new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND', message: 'Pessoa da equipe não encontrada' });

/**
 * Pessoas da equipe. Outros módulos (agenda, RH) gravam por `saveInTx`, dentro da transação deles,
 * e reagem ao encerramento pelo evento `core.team.member_ended`.
 */
@Injectable()
export class TeamService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly outbox: OutboxService,
    private readonly jobs: ScheduledJobs,
    private readonly links: TeamLinksRegistry,
  ) {}

  onModuleInit() {
    this.files.protectOwner(RESUME_OWNER);
    // Encerramentos com data futura: avisados no dia seguinte ao encerramento.
    this.jobs.every('core.team.endings', 60 * 60_000, () => this.notifyEndings());
  }

  /** Valida um cadastro vindo de outro módulo (ex.: formulário do profissional da agenda). */
  parse(input: unknown, partial = false): TeamMemberPatch {
    const result = (partial ? teamMemberInput.partial() : teamMemberInput).safeParse(input ?? {});
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION',
        message: result.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
      });
    }
    return result.data;
  }

  list(opts: { q?: string; status?: 'active' | 'ended' | 'all'; limit: number; offset: number }) {
    const ctx = requestContext.require();
    return this.tdb.run(async (tx) => {
      const today = localToday();
      const where = and(
        searchFilter(opts.q),
        opts.status === 'active' ? or(isNull(teamMembers.endedOn), gte(teamMembers.endedOn, today)) : undefined,
        opts.status === 'ended' ? lt(teamMembers.endedOn, today) : undefined,
      );
      const [rows, totals] = await Promise.all([
        tx.select().from(teamMembers).where(where).orderBy(asc(teamMembers.firstName), asc(teamMembers.lastName)).limit(opts.limit).offset(opts.offset),
        tx.select({ total: count() }).from(teamMembers).where(where),
      ]);
      const links = await this.links.findInTx(tx, ctx.modules ?? new Set(), rows.map((r) => r.id));
      return { items: rows.map((r) => toSummary(r, links, today)), total: totals[0]?.total ?? 0 };
    });
  }

  get(id: string): Promise<TeamMemberDetail> {
    return this.tdb.run(async (tx) => {
      const detail = await this.detailInTx(tx, id);
      await this.audit.log(tx, { action: 'team_member.viewed', entity: 'team_member', entityId: id });
      return detail;
    });
  }

  create(input: TeamMemberInput) {
    return this.tdb.run(async (tx) => this.detailInTx(tx, (await this.saveInTx(tx, null, input)).id));
  }

  update(id: string, input: TeamMemberPatch) {
    return this.tdb.run(async (tx) => this.detailInTx(tx, (await this.saveInTx(tx, id, input)).id));
  }

  async findInTx(tx: Tx, id: string): Promise<TeamMemberRow | undefined> {
    const [row] = await tx.select().from(teamMembers).where(eq(teamMembers.id, id));
    return row;
  }

  async findOrFailInTx(tx: Tx, id: string): Promise<TeamMemberRow> {
    const row = await this.findInTx(tx, id);
    if (!row) throw notFound();
    return row;
  }

  async findByCpfInTx(tx: Tx, cpf: string): Promise<TeamMemberRow | undefined> {
    const digits = onlyDigits(cpf);
    if (!digits) return undefined;
    const [row] = await tx.select().from(teamMembers).where(eq(teamMembers.cpf, digits));
    return row;
  }

  /**
   * Cria (id null) ou altera uma pessoa, na transação de quem chama. No PATCH, campo ausente
   * mantém o valor; null apaga. CPF e telefone só são validados quando mudam (cadastros antigos
   * do RH podem ter valores fora do padrão).
   */
  async saveInTx(tx: Tx, id: string | null, input: TeamMemberPatch): Promise<TeamMemberRow> {
    const { tenantId } = requestContext.requireTenant();
    const current = id ? await this.findOrFailInTx(tx, id) : null;
    const data = await this.normalize(tx, input, current);
    if (!current && !data.firstName) throw new BadRequestException({ code: 'VALIDATION', message: ['firstName: Informe o nome'] });

    const startedOn = data.startedOn !== undefined ? data.startedOn : (current?.startedOn ?? null);
    const endedOn = data.endedOn !== undefined ? data.endedOn : (current?.endedOn ?? null);
    if (startedOn && endedOn && endedOn < startedOn) {
      throw new BadRequestException({ code: 'END_BEFORE_START', message: 'O encerramento precisa ser depois do início na empresa' });
    }
    const endChanged = data.endedOn !== undefined && data.endedOn !== (current?.endedOn ?? null);

    if (data.cpf) {
      const [taken] = await tx
        .select({ id: teamMembers.id, firstName: teamMembers.firstName, lastName: teamMembers.lastName })
        .from(teamMembers)
        .where(and(eq(teamMembers.cpf, data.cpf), current ? ne(teamMembers.id, current.id) : undefined));
      if (taken) {
        throw new ConflictException({ code: 'DUPLICATE_CPF', message: `Este CPF já é de ${fullName(taken)}, da equipe`, existing: { id: taken.id, name: fullName(taken) } });
      }
    }

    const values = { ...data, ...(endChanged ? { endNotifiedAt: null } : {}) };
    let row: TeamMemberRow;
    if (current) {
      [row] = (await tx.update(teamMembers).set(values).where(eq(teamMembers.id, current.id)).returning()) as [TeamMemberRow];
    } else {
      [row] = (await tx
        .insert(teamMembers)
        .values({ ...values, firstName: data.firstName!, tenantId })
        .returning()) as [TeamMemberRow];
    }

    if (endChanged && row.endedOn && row.endedOn < localToday()) await this.announceEnd(tx, row);
    await this.audit.log(tx, {
      action: current ? 'team_member.updated' : 'team_member.created',
      entity: 'team_member',
      entityId: row.id,
      data: { fields: Object.keys(input).filter((k) => input[k as keyof TeamMemberPatch] !== undefined) },
    });
    return row;
  }

  // ---- Foto e currículo -----------------------------------------------------------------------

  setPhoto(id: string, file: UploadedFile) {
    return this.tdb.run(async (tx) => {
      const member = await this.findOrFailInTx(tx, id);
      const saved = await this.files.saveImageInTx(tx, file, { entity: PHOTO_OWNER, id });
      await tx.update(teamMembers).set({ photoFileId: saved.id }).where(eq(teamMembers.id, id));
      if (member.photoFileId) await this.files.removeInTx(tx, member.photoFileId, { entity: PHOTO_OWNER, id }).catch(() => undefined);
      await this.audit.log(tx, { action: 'team_member.photo_changed', entity: 'team_member', entityId: id });
      return saved;
    });
  }

  removePhoto(id: string) {
    return this.tdb.run(async (tx) => {
      const member = await this.findOrFailInTx(tx, id);
      if (!member.photoFileId) return;
      await tx.update(teamMembers).set({ photoFileId: null }).where(eq(teamMembers.id, id));
      await this.files.removeInTx(tx, member.photoFileId, { entity: PHOTO_OWNER, id });
      await this.audit.log(tx, { action: 'team_member.photo_removed', entity: 'team_member', entityId: id });
    });
  }

  setResume(id: string, file: UploadedFile) {
    return this.tdb.run(async (tx) => {
      const member = await this.findOrFailInTx(tx, id);
      const saved = await this.files.saveResumeInTx(tx, file, { entity: RESUME_OWNER, id });
      await tx.update(teamMembers).set({ resumeFileId: saved.id }).where(eq(teamMembers.id, id));
      if (member.resumeFileId) await this.files.removeInTx(tx, member.resumeFileId, { entity: RESUME_OWNER, id }).catch(() => undefined);
      await this.audit.log(tx, { action: 'team_member.resume_changed', entity: 'team_member', entityId: id });
      return saved;
    });
  }

  removeResume(id: string) {
    return this.tdb.run(async (tx) => {
      const member = await this.findOrFailInTx(tx, id);
      if (!member.resumeFileId) return;
      await tx.update(teamMembers).set({ resumeFileId: null }).where(eq(teamMembers.id, id));
      await this.files.removeInTx(tx, member.resumeFileId, { entity: RESUME_OWNER, id });
      await this.audit.log(tx, { action: 'team_member.resume_removed', entity: 'team_member', entityId: id });
    });
  }

  /** Download do currículo, registrado na auditoria (dado pessoal). */
  async openResume(id: string) {
    const member = await this.tdb.run((tx) => this.findOrFailInTx(tx, id));
    if (!member.resumeFileId) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Esta pessoa não tem currículo anexado' });
    const opened = await this.files.open(member.resumeFileId, RESUME_OWNER);
    if (opened.ownerId !== id) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Arquivo não encontrado' });
    await this.tdb.run((tx) => this.audit.log(tx, { action: 'team_member.resume_downloaded', entity: 'team_member', entityId: id }));
    return opened;
  }

  // ---- Encerramento ---------------------------------------------------------------------------

  /** Avisa os módulos (uma vez por data de encerramento) que a pessoa saiu da empresa. */
  private async announceEnd(tx: Tx, row: TeamMemberRow) {
    const payload: TeamMemberEnded = { teamMemberId: row.id, endedOn: row.endedOn! };
    await this.outbox.publish(tx, TEAM_MEMBER_ENDED, { ...payload });
    await tx.update(teamMembers).set({ endNotifiedAt: new Date() }).where(eq(teamMembers.id, row.id));
  }

  /** Encerramentos que passaram desde a última execução (datas futuras informadas antes). */
  async notifyEndings() {
    for (const tenantId of await this.jobs.tenantsWithModule(TEAM_MODULE)) {
      await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const due = await tx
            .select()
            .from(teamMembers)
            .where(and(isNotNull(teamMembers.endedOn), lt(teamMembers.endedOn, localToday()), isNull(teamMembers.endNotifiedAt)));
          for (const row of due) await this.announceEnd(tx, row);
        }),
      );
    }
  }

  // ---- interno --------------------------------------------------------------------------------

  private async detailInTx(tx: Tx, id: string): Promise<TeamMemberDetail> {
    const ctx = requestContext.requireTenant();
    const row = await this.findOrFailInTx(tx, id);
    const fileIds = [row.photoFileId, row.resumeFileId].filter((f): f is string => !!f);
    const attached = fileIds.length ? await tx.select().from(files).where(inArray(files.id, fileIds)) : [];
    const dto = (fileId: string | null): FileDto | null => {
      const f = attached.find((a) => a.id === fileId);
      return f ? { id: f.id, filename: f.filename, mime: f.mime, size: f.size, createdAt: f.createdAt } : null;
    };
    const links = await this.links.findInTx(tx, ctx.modules ?? new Set(), [id]);
    return {
      ...toSummary(row, links, localToday()),
      rg: row.rg,
      birthDate: row.birthDate,
      address: row.address,
      linkedinUrl: row.linkedinUrl,
      resumeFileId: row.resumeFileId,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      photo: dto(row.photoFileId),
      resume: dto(row.resumeFileId),
    };
  }

  /** Normaliza nomes, documento, telefone e e-mail; recusa CPF ou telefone inválidos e login de fora da empresa. */
  private async normalize(tx: Tx, input: TeamMemberPatch, current: TeamMemberRow | null) {
    const errors: string[] = [];
    const out: Partial<typeof teamMembers.$inferInsert> = {};
    const squash = (v: string) => v.trim().replace(/\s+/g, ' ');

    if (input.firstName !== undefined) out.firstName = squash(input.firstName);
    if (input.lastName !== undefined) out.lastName = input.lastName ? squash(input.lastName) : null;
    if (input.cpf !== undefined) {
      const digits = input.cpf ? onlyDigits(input.cpf) : '';
      if (digits && digits !== current?.cpf && !isValidCpf(digits)) errors.push('cpf: CPF inválido');
      out.cpf = digits || null;
    }
    if (input.phone !== undefined) {
      if (!input.phone) out.phone = null;
      else if (input.phone === current?.phone) out.phone = input.phone;
      else {
        const phone = normalizePhone(input.phone);
        if (!phone) errors.push('phone: telefone inválido (use DDD + número)');
        out.phone = phone;
      }
    }
    if (input.email !== undefined) out.email = input.email ? input.email.toLowerCase() : null;
    if (input.userId !== undefined) {
      if (input.userId && input.userId !== current?.userId) {
        const { tenantId } = requestContext.requireTenant();
        const [member] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, input.userId), eq(memberships.status, 'active')));
        if (!member) errors.push('userId: usuário não encontrado nesta empresa');
      }
      out.userId = input.userId ?? null;
    }
    for (const key of ['rg', 'birthDate', 'address', 'linkedinUrl', 'startedOn', 'endedOn', 'notes'] as const) {
      if (input[key] !== undefined) (out as Record<string, unknown>)[key] = input[key] ?? null;
    }
    if (errors.length) throw new BadRequestException({ code: 'VALIDATION', message: errors });
    return out;
  }
}

function toSummary(r: TeamMemberRow, links: TeamLink[], today: string): TeamMemberSummary {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    name: fullName(r),
    cpf: r.cpf,
    email: r.email,
    phone: r.phone,
    photoFileId: r.photoFileId,
    startedOn: r.startedOn,
    endedOn: r.endedOn,
    active: !r.endedOn || r.endedOn >= today,
    userId: r.userId,
    links: links.filter((l) => l.teamMemberId === r.id),
  };
}

function searchFilter(q?: string): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const digits = onlyDigits(term);
  return or(
    ilike(teamMemberName, like),
    ilike(teamMembers.email, like),
    digits.length >= 3 ? sql`${teamMembers.cpf} like ${`%${digits}%`}` : undefined,
    digits.length >= 3 ? sql`${teamMembers.phone} like ${`%${digits}%`}` : undefined,
  );
}
