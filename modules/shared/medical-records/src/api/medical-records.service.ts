import { AuditService, CustomerDataRegistry, CustomersService, FilesService, TenantDb, coreSchema, type UploadedFile } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { businessToday, type AccessLogEntry, type AmendInput, type EntryAttachment, type EntryInput, type FormField, type MedicalEntry, type MedicalForm } from '../contracts';
import { mrAccessLog, mrEntries } from '../db/schema';

const MODULE = 'shared.medical-records';
const FILE_OWNER = 'mr_entry';

/** De quem é o prontuário: devolve o cliente responsável e um nome para exibir. */
export type SubjectResolver = (tx: Tx, id: string) => Promise<{ customerId: string; label: string } | undefined>;
/** O horário da agenda é mesmo deste paciente? Registrado por quem conhece os dois (ex.: a veterinária). */
export type AppointmentChecker = (tx: Tx, appointmentId: string, subjectId: string) => Promise<boolean>;

/**
 * Retificação de formulário de um módulo: antes de gravar, ele pode completar os dados; depois,
 * reagir na mesma transação (ex.: a estética corrige o uso do lote e o estoque).
 */
export type AmendHook = (
  tx: Tx,
  ctx: { original: { id: string; customerId: string; formKey: string; amendsId: string | null; data: Record<string, unknown> }; data: Record<string, unknown>; occurredOn: string },
) => Promise<{ data: Record<string, unknown>; after: (entry: MedicalEntry) => Promise<void> }>;

const NOTE_FORM: MedicalForm = { key: 'note', moduleKey: MODULE, label: 'Anotação', subjectTypes: ['customer', 'pet'], fields: [] };

type AccessAction = AccessLogEntry['action'];

@Injectable()
export class MedicalRecordsService implements OnModuleInit {
  private readonly forms = new Map<string, MedicalForm>([[NOTE_FORM.key, NOTE_FORM]]);
  private readonly subjects = new Map<string, SubjectResolver>();
  private readonly amendHooks = new Map<string, AmendHook>();
  private readonly appointmentCheckers = new Map<string, AppointmentChecker>();

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
        (await tx.select().from(mrEntries).where(eq(mrEntries.customerId, customerId)).orderBy(asc(mrEntries.occurredOn), asc(mrEntries.createdAt))).map((e) => ({
          occurredOn: e.occurredOn,
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

  /** O módulo dono dos formulários reage às retificações deles (ver AmendHook). */
  registerAmendHook(moduleKey: string, hook: AmendHook) {
    this.amendHooks.set(moduleKey, hook);
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

  /** Com um verificador registrado, o registro só se liga a um horário que seja do mesmo paciente. */
  registerAppointmentChecker(subjectType: string, checker: AppointmentChecker) {
    this.appointmentCheckers.set(subjectType, checker);
  }

  formsFor(subjectType: string): Promise<MedicalForm[]> {
    return this.tdb.run(async (tx) => {
      const active = await activeModules(tx);
      return [...this.forms.values()].filter((f) => f.subjectTypes.includes(subjectType) && active.has(f.moduleKey));
    });
  }

  list(subjectType: string, subjectId: string): Promise<MedicalEntry[]> {
    return this.tdb.run((tx) => this.listInTx(tx, subjectType, subjectId));
  }

  /**
   * Registros do paciente (todos ou só os de alguns formulários), na transação de quem chama.
   * Conta como abertura do prontuário no log de acesso.
   */
  async listInTx(tx: Tx, subjectType: string, subjectId: string, opts: { formKeys?: string[] } = {}): Promise<MedicalEntry[]> {
    await this.subjectOrFail(tx, subjectType, subjectId);
    await this.log(tx, 'view', subjectType, subjectId);
    if (opts.formKeys && !opts.formKeys.length) return [];
    const rows = await tx
      .select()
      .from(mrEntries)
      .where(and(eq(mrEntries.subjectType, subjectType), eq(mrEntries.subjectId, subjectId), opts.formKeys ? inArray(mrEntries.formKey, opts.formKeys) : undefined))
      // Pela data do atendimento; no mesmo dia, o registrado por último primeiro.
      .orderBy(desc(mrEntries.occurredOn), desc(mrEntries.createdAt), desc(mrEntries.id));
    return this.toDtos(tx, rows);
  }

  /** Rota genérica do prontuário: formulário gerido por um módulo só entra pela tela dele. */
  create(input: EntryInput): Promise<MedicalEntry> {
    return this.tdb.run(async (tx) => {
      const form = await this.formOrFail(tx, input.formKey, input.subjectType);
      if (form.managed) throw badRequest('FORM_MANAGED', `"${form.label}" é registrado pela tela do módulo, não pelo prontuário`);
      return this.createInTx(tx, input);
    });
  }

  /**
   * Inclui um registro na transação de quem chama (ex.: a estética grava a aplicação junto com o
   * uso do lote). Mesmas regras e mesmo log de acesso da rota genérica; vale também para os
   * formulários geridos pelo módulo.
   */
  async createInTx(tx: Tx, input: EntryInput): Promise<MedicalEntry> {
    const { tenantId, userId } = requestContext.requireTenant();
    const subject = await this.subjectOrFail(tx, input.subjectType, input.subjectId);
    const form = await this.formOrFail(tx, input.formKey, input.subjectType);
    const data = validate(form, input.data);
    if (!Object.keys(data).length && !input.notes) throw badRequest('EMPTY_ENTRY', 'Preencha algum campo ou escreva uma anotação');
    const checker = this.appointmentCheckers.get(input.subjectType);
    if (input.appointmentId && checker && !(await checker(tx, input.appointmentId, input.subjectId))) {
      throw badRequest('APPOINTMENT_MISMATCH', 'Este horário da agenda não é deste paciente');
    }
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
        occurredOn: input.occurredOn ?? businessToday(),
        authorId: userId!,
        authorName: await authorName(tx, userId!),
      })
      .returning();
    await this.log(tx, 'create', input.subjectType, input.subjectId, row!.id);
    await this.audit.log(tx, { action: 'medical_record.created', entity: 'mr_entry', entityId: row!.id });
    return (await this.toDtos(tx, [row!]))[0]!;
  }

  /** Retificação: novo registro que aponta para o anterior. O anterior continua lá, intacto. */
  amend(id: string, input: AmendInput): Promise<MedicalEntry> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const original = await this.entryOrFail(tx, id);
      const [newer] = await tx.select({ id: mrEntries.id }).from(mrEntries).where(eq(mrEntries.amendsId, id)).limit(1);
      if (newer) throw new ConflictException({ code: 'ALREADY_AMENDED', message: 'Este registro já foi retificado: retifique a versão mais recente' });
      const form = this.forms.get(original.formKey) ?? NOTE_FORM;
      const occurredOn = input.occurredOn ?? original.occurredOn;
      const hook = this.amendHooks.get(form.moduleKey);
      const prepared = hook ? await hook(tx, { original, data: validate(form, input.data), occurredOn }) : null;
      const data = prepared ? prepared.data : validate(form, input.data);
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
          // A retificação tem a sua própria data (corrige também a data, se for o caso).
          occurredOn: input.occurredOn ?? original.occurredOn,
          authorId: userId!,
          authorName: await authorName(tx, userId!),
        })
        .returning();
      await this.log(tx, 'amend', original.subjectType, original.subjectId, row!.id);
      await this.audit.log(tx, { action: 'medical_record.amended', entity: 'mr_entry', entityId: row!.id, data: { amends: id } });
      const entry = (await this.toDtos(tx, [row!]))[0]!;
      await prepared?.after(entry);
      return entry;
    });
  }

  attach(entryId: string, file: UploadedFile) {
    return this.tdb.run((tx) => this.attachInTx(tx, entryId, file));
  }

  /** Anexo na transação de quem chama; com `image`, só JPG, PNG ou WebP (fotos clínicas, assinatura). */
  async attachInTx(tx: Tx, entryId: string, file: UploadedFile, opts: { image?: boolean } = {}): Promise<EntryAttachment> {
    const entry = await this.entryOrFail(tx, entryId);
    const owner = { entity: FILE_OWNER, id: entry.id };
    const saved = opts.image ? await this.files.saveImageInTx(tx, file, owner) : await this.files.saveDocumentInTx(tx, file, owner);
    await this.log(tx, 'attach', entry.subjectType, entry.subjectId, entry.id);
    return { id: saved.id, filename: saved.filename, mime: saved.mime, size: saved.size };
  }

  /**
   * Registros de alguns formulários de clientes, para conferências do módulo dono (ex.: há termo
   * aceito para esta cirurgia?). Não devolve nada para a tela, por isso não entra no log de acesso.
   */
  entriesByFormInTx(tx: Tx, customerIds: string[], formKeys: string[]) {
    if (!formKeys.length || !customerIds.length) return Promise.resolve([] as (typeof mrEntries.$inferSelect)[]);
    return tx
      .select()
      .from(mrEntries)
      .where(and(inArray(mrEntries.customerId, customerIds), inArray(mrEntries.formKey, formKeys)))
      .orderBy(asc(mrEntries.createdAt));
  }

  /** Acesso feito por outra tela (ex.: rastreio de lote de um módulo) entra no mesmo log. */
  logAccessInTx(tx: Tx, action: AccessAction, subjectType: string, subjectId: string, entryId?: string) {
    return this.log(tx, action, subjectType, subjectId, entryId);
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
    const ancestors = await this.ancestorsOf(tx, rows);
    const [attachments, amendments] = await Promise.all([
      this.files.listByOwners(tx, FILE_OWNER, [...ids, ...ancestors.keys()]),
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
      attachments: [
        ...attachments.filter((a) => a.ownerId === r.id).map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size })),
        // Retificação leva os anexos do que ela corrige, só por referência: nada é copiado nem movido.
        ...chainOf(r, ancestors).flatMap((ancestor) =>
          attachments
            .filter((a) => a.ownerId === ancestor.id)
            .map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, inheritedFrom: { entryId: ancestor.id, occurredOn: ancestor.occurredOn } })),
        ),
      ],
      occurredOn: r.occurredOn,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Registros anteriores das retificações (toda a cadeia até o original), além dos que já vieram. */
  private async ancestorsOf(tx: Tx, rows: (typeof mrEntries.$inferSelect)[]) {
    const known = new Map<string, { id: string; amendsId: string | null; occurredOn: string }>();
    for (const r of rows) known.set(r.id, r);
    const out = new Map<string, { id: string; amendsId: string | null; occurredOn: string }>();
    let missing = [...new Set(rows.map((r) => r.amendsId).filter((id): id is string => !!id))];
    while (missing.length) {
      const toLoad = missing.filter((id) => !known.has(id));
      if (toLoad.length) {
        const loaded = await tx.select({ id: mrEntries.id, amendsId: mrEntries.amendsId, occurredOn: mrEntries.occurredOn }).from(mrEntries).where(inArray(mrEntries.id, toLoad));
        for (const r of loaded) known.set(r.id, r);
      }
      for (const id of missing) {
        const entry = known.get(id);
        if (entry) out.set(id, entry);
      }
      missing = [...new Set(missing.map((id) => known.get(id)?.amendsId).filter((id): id is string => !!id && !out.has(id)))];
    }
    return out;
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

/** Do registro corrigido por este até o original, do mais recente ao mais antigo. */
function chainOf(entry: { amendsId: string | null }, ancestors: Map<string, { id: string; amendsId: string | null; occurredOn: string }>) {
  const chain: { id: string; occurredOn: string }[] = [];
  let next = entry.amendsId;
  while (next) {
    const ancestor = ancestors.get(next);
    if (!ancestor) break;
    chain.push(ancestor);
    next = ancestor.amendsId;
  }
  return chain;
}

/** Confere os valores contra os campos do formulário e descarta o que não é do formulário. */
function validate(form: MedicalForm, data: Record<string, unknown>): Record<string, unknown> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of form.fields) shape[f.key] = fieldSchema(f);
  const parsed = z.object(shape).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = form.fields.find((f) => f.key === issue.path[0]);
    const sub = field?.type === 'list' && typeof issue.path[1] === 'number' ? field.itemFields?.find((f) => f.key === issue.path[2]) : undefined;
    const where = field && sub ? `${field.label}, linha ${(issue.path[1] as number) + 1}, ${sub.label}` : field?.label;
    throw badRequest('INVALID_ENTRY', where ? `${where}: ${issue.message}` : issue.message);
  }
  return compact(parsed.data);
}

/** Sem os campos vazios (lista vazia também). */
function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
}

function fieldSchema(f: FormField): z.ZodTypeAny {
  if (f.type === 'list') {
    const item: Record<string, z.ZodTypeAny> = {};
    // Sem lista dentro de lista: um subcampo "list" vira texto.
    for (const sub of f.itemFields ?? []) item[sub.key] = fieldSchema(sub.type === 'list' ? { ...sub, type: 'text' } : sub);
    const list = z
      .array(z.object(item).transform(compact), { required_error: 'obrigatório', invalid_type_error: 'lista inválida' })
      .max(200, 'no máximo 200 linhas')
      // Linha toda em branco não conta.
      .transform((rows) => rows.filter((r) => Object.keys(r).length));
    return f.required ? list.refine((rows) => rows.length > 0, 'inclua ao menos uma linha') : z.preprocess((v) => (v === null || v === '' ? undefined : v), list.optional());
  }
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
