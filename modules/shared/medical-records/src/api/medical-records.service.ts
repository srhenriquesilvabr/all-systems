import { AuditService, CustomerDataRegistry, CustomersService, FilesService, TenantDb, coreSchema, type UploadedFile } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AccessLogEntry, AmendInput, EntryInput, FormField, MedicalEntry, MedicalForm } from '../contracts';
import { mrAccessLog, mrEntries } from '../db/schema';

const MODULE = 'shared.medical-records';
const FILE_OWNER = 'mr_entry';

/** De quem é o prontuário: devolve o cliente responsável e um nome para exibir. */
export type SubjectResolver = (tx: Tx, id: string) => Promise<{ customerId: string; label: string } | undefined>;

const NOTE_FORM: MedicalForm = { key: 'note', moduleKey: MODULE, label: 'Anotação', subjectTypes: ['customer', 'pet'], fields: [] };

type AccessAction = AccessLogEntry['action'];

@Injectable()
export class MedicalRecordsService implements OnModuleInit {
  private readonly forms = new Map<string, MedicalForm>([[NOTE_FORM.key, NOTE_FORM]]);
  private readonly subjects = new Map<string, SubjectResolver>();

  constructor(
    private readonly tdb: TenantDb,
    private readonly customers: CustomersService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly customerData: CustomerDataRegistry,
  ) {}

  onModuleInit() {
    this.files.protectOwner(FILE_OWNER);
    this.registerSubject('customer', async (tx, id) => {
      const c = await this.customers.findInTx(tx, id);
      return c && { customerId: c.id, label: c.name };
    });
    this.customerData.register({
      moduleKey: MODULE,
      export: async (tx, customerId) =>
        (await tx.select().from(mrEntries).where(eq(mrEntries.customerId, customerId)).orderBy(asc(mrEntries.createdAt))).map((e) => ({
          createdAt: e.createdAt,
          subjectType: e.subjectType,
          title: e.title,
          data: e.data,
          notes: e.notes,
          author: e.authorName,
          amendsId: e.amendsId,
        })),
      // Prontuário é guardado por obrigação legal (LGPD art. 16, I; CFM/CFMV: 20 anos), então não é
      // apagado nem anonimizado junto com o cadastro. A ficha do cliente é anonimizada pelo core.
      anonymize: async () => undefined,
    });
  }

  /** Verticais registram os seus formulários (consulta veterinária, anamnese estética…). */
  registerForm(form: MedicalForm) {
    if (this.forms.has(form.key)) throw new Error(`Formulário de prontuário duplicado: ${form.key}`);
    this.forms.set(form.key, form);
  }

  /** Verticais registram de quem pode ser o prontuário além do próprio cliente (ex.: "pet"). */
  registerSubject(type: string, resolver: SubjectResolver) {
    this.subjects.set(type, resolver);
  }

  formsFor(subjectType: string): Promise<MedicalForm[]> {
    return this.tdb.run(async (tx) => {
      const active = await activeModules(tx);
      return [...this.forms.values()].filter((f) => f.subjectTypes.includes(subjectType) && active.has(f.moduleKey));
    });
  }

  list(subjectType: string, subjectId: string): Promise<MedicalEntry[]> {
    return this.tdb.run(async (tx) => {
      await this.subjectOrFail(tx, subjectType, subjectId);
      await this.log(tx, 'view', subjectType, subjectId);
      const rows = await tx
        .select()
        .from(mrEntries)
        .where(and(eq(mrEntries.subjectType, subjectType), eq(mrEntries.subjectId, subjectId)))
        .orderBy(desc(mrEntries.createdAt), desc(mrEntries.id));
      return this.toDtos(tx, rows);
    });
  }

  create(input: EntryInput): Promise<MedicalEntry> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const subject = await this.subjectOrFail(tx, input.subjectType, input.subjectId);
      const form = await this.formOrFail(tx, input.formKey, input.subjectType);
      const data = validate(form, input.data);
      if (!Object.keys(data).length && !input.notes) throw badRequest('EMPTY_ENTRY', 'Preencha algum campo ou escreva uma anotação');
      const [row] = await tx
        .insert(mrEntries)
        .values({
          tenantId,
          customerId: subject.customerId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          formKey: form.key,
          title: form.label,
          data,
          notes: input.notes ?? null,
          appointmentId: input.appointmentId ?? null,
          authorId: userId!,
          authorName: await authorName(tx, userId!),
        })
        .returning();
      await this.log(tx, 'create', input.subjectType, input.subjectId, row!.id);
      await this.audit.log(tx, { action: 'medical_record.created', entity: 'mr_entry', entityId: row!.id });
      return (await this.toDtos(tx, [row!]))[0]!;
    });
  }

  /** Retificação: novo registro que aponta para o anterior. O anterior continua lá, intacto. */
  amend(id: string, input: AmendInput): Promise<MedicalEntry> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const original = await this.entryOrFail(tx, id);
      const [newer] = await tx.select({ id: mrEntries.id }).from(mrEntries).where(eq(mrEntries.amendsId, id)).limit(1);
      if (newer) throw new ConflictException({ code: 'ALREADY_AMENDED', message: 'Este registro já foi retificado: retifique a versão mais recente' });
      const form = this.forms.get(original.formKey) ?? NOTE_FORM;
      const data = validate(form, input.data);
      const [row] = await tx
        .insert(mrEntries)
        .values({
          tenantId,
          customerId: original.customerId,
          subjectType: original.subjectType,
          subjectId: original.subjectId,
          formKey: original.formKey,
          title: original.title,
          data,
          notes: input.notes ?? null,
          appointmentId: original.appointmentId,
          amendsId: original.id,
          amendReason: input.reason,
          authorId: userId!,
          authorName: await authorName(tx, userId!),
        })
        .returning();
      await this.log(tx, 'amend', original.subjectType, original.subjectId, row!.id);
      await this.audit.log(tx, { action: 'medical_record.amended', entity: 'mr_entry', entityId: row!.id, data: { amends: id } });
      return (await this.toDtos(tx, [row!]))[0]!;
    });
  }

  attach(entryId: string, file: UploadedFile) {
    return this.tdb.run(async (tx) => {
      const entry = await this.entryOrFail(tx, entryId);
      const saved = await this.files.saveDocumentInTx(tx, file, { entity: FILE_OWNER, id: entry.id });
      await this.log(tx, 'attach', entry.subjectType, entry.subjectId, entry.id);
      return { id: saved.id, filename: saved.filename, mime: saved.mime, size: saved.size };
    });
  }

  async download(fileId: string) {
    const opened = await this.files.open(fileId, FILE_OWNER);
    await this.tdb.run(async (tx) => {
      const entry = await this.entryOrFail(tx, opened.ownerId);
      await this.log(tx, 'download', entry.subjectType, entry.subjectId, entry.id);
    });
    return opened;
  }

  accessLog(subjectType: string, subjectId: string): Promise<AccessLogEntry[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ log: mrAccessLog, user: { id: coreSchema.users.id, name: coreSchema.users.name } })
        .from(mrAccessLog)
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, mrAccessLog.userId))
        .where(and(eq(mrAccessLog.subjectType, subjectType), eq(mrAccessLog.subjectId, subjectId)))
        .orderBy(desc(mrAccessLog.at), desc(mrAccessLog.id))
        .limit(500);
      return rows.map((r) => ({ id: r.log.id, user: r.user, action: r.log.action, entryId: r.log.entryId, at: r.log.at.toISOString() }));
    });
  }

  private async toDtos(tx: Tx, rows: (typeof mrEntries.$inferSelect)[]): Promise<MedicalEntry[]> {
    const ids = rows.map((r) => r.id);
    const [attachments, amendments] = await Promise.all([
      this.files.listByOwners(tx, FILE_OWNER, ids),
      ids.length
        ? tx.select({ id: mrEntries.id, amendsId: mrEntries.amendsId }).from(mrEntries).where(inArray(mrEntries.amendsId, ids)).orderBy(asc(mrEntries.createdAt))
        : Promise.resolve([]),
    ]);
    return rows.map((r) => ({
      id: r.id,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      formKey: r.formKey,
      title: r.title,
      data: r.data,
      notes: r.notes,
      appointmentId: r.appointmentId,
      amendsId: r.amendsId,
      amendReason: r.amendReason,
      amendedById: amendments.findLast((a) => a.amendsId === r.id)?.id ?? null,
      author: { id: r.authorId, name: r.authorName },
      attachments: attachments.filter((a) => a.ownerId === r.id).map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size })),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async subjectOrFail(tx: Tx, type: string, id: string) {
    const resolver = this.subjects.get(type);
    const subject = resolver && (await resolver(tx, id));
    if (!subject) throw new NotFoundException({ code: 'SUBJECT_NOT_FOUND', message: 'Paciente não encontrado' });
    return subject;
  }

  private async formOrFail(tx: Tx, key: string, subjectType: string) {
    const form = this.forms.get(key);
    if (!form || !form.subjectTypes.includes(subjectType) || !(await activeModules(tx)).has(form.moduleKey)) {
      throw badRequest('FORM_NOT_AVAILABLE', 'Formulário de prontuário não disponível');
    }
    return form;
  }

  private async entryOrFail(tx: Tx, id: string) {
    const [row] = await tx.select().from(mrEntries).where(eq(mrEntries.id, id));
    if (!row) throw new NotFoundException({ code: 'ENTRY_NOT_FOUND', message: 'Registro não encontrado' });
    return row;
  }

  private async log(tx: Tx, action: AccessAction, subjectType: string, subjectId: string, entryId?: string) {
    const { tenantId, userId } = requestContext.requireTenant();
    await tx.insert(mrAccessLog).values({ tenantId, userId: userId ?? null, action, subjectType, subjectId, entryId: entryId ?? null });
  }
}

/** Confere os valores contra os campos do formulário e descarta o que não é do formulário. */
function validate(form: MedicalForm, data: Record<string, unknown>): Record<string, unknown> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of form.fields) shape[f.key] = fieldSchema(f);
  const parsed = z.object(shape).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = form.fields.find((f) => f.key === issue.path[0]);
    throw badRequest('INVALID_ENTRY', field ? `${field.label}: ${issue.message}` : issue.message);
  }
  return Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

function fieldSchema(f: FormField): z.ZodTypeAny {
  const base = (() => {
    switch (f.type) {
      case 'number':
        return z.preprocess((v) => (v === '' || v === null ? undefined : typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number({ invalid_type_error: 'número inválido' }).finite());
      case 'boolean':
        return z.boolean();
      case 'date':
        return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data inválida');
      case 'select':
        return z.enum((f.options ?? ['']) as [string, ...string[]], { errorMap: () => ({ message: 'opção inválida' }) });
      case 'textarea':
        return z.string().trim().max(10_000);
      default:
        return z.string().trim().max(500);
    }
  })();
  if (f.required) return f.type === 'text' || f.type === 'textarea' ? (base as z.ZodString).min(1, 'obrigatório') : base;
  return z.preprocess((v) => (v === '' || v === null ? undefined : v), base.optional());
}

async function activeModules(tx: Tx) {
  const rows = await tx
    .select({ key: coreSchema.tenantModules.moduleKey })
    .from(coreSchema.tenantModules)
    .where(eq(coreSchema.tenantModules.status, 'active'));
  return new Set(rows.map((r) => r.key));
}

async function authorName(tx: Tx, userId: string) {
  const [u] = await tx.select({ name: coreSchema.users.name }).from(coreSchema.users).where(eq(coreSchema.users.id, userId));
  return u?.name ?? 'Usuário';
}

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
