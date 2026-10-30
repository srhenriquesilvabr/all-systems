import { AuditService, ModuleHooks, ModuleSettingsService, TeamLinksRegistry, TenantDb, coreSchema } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { MedicalRecordsService } from '@all/medical-records';
import { requestContext } from '@all/module-sdk';
import { salesSchema } from '@all/sales';
import { schedulingSchema } from '@all/scheduling';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  credentialText,
  kindsBySpecialty,
  localToday,
  specialtyLabel,
  type AesLot,
  type AesProduct,
  type ConsentTemplate,
  type ConsentTemplateInput,
  type CredentialInput,
  type LotInput,
  type LotTrace,
  type ProductInput,
  type ProfessionalCredential,
  type SpecialtyKey,
  type SpecialtyOverview,
} from '../contracts';
import { aesConsentTemplates, aesLotUsages, aesProductLots, aesProducts, aesProfessionalCredentials } from '../db/schema';
import type { AestheticsSettings } from '../manifest';
import { BASIC_LASER_SERVICE, LASER_ROOM, SPECIALTY_SERVICES, SPECIALTY_TEMPLATES } from './specialty-seeds';

export const MODULE = 'aesthetics';
const { schResources, schServices, schServiceResources } = schedulingSchema;
const { salesProducts } = salesSchema;

export const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const notFound = (code: string, message: string) => new NotFoundException({ code, message });
const brDate = (iso: string) => iso.split('-').reverse().join('/');

/** Violação de índice único do Postgres (23505), atravessando o erro do driver. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) if (e.code === '23505') return true;
  return false;
}

/**
 * Cadastros das especialidades: quais estão ligadas (e o que cada uma traz ao ligar), registro
 * dos profissionais no conselho, produtos com lote e validade e modelos de termo.
 */
@Injectable()
export class SpecialtySetupService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
    private readonly teamLinks: TeamLinksRegistry,
    private readonly records: MedicalRecordsService,
  ) {}

  onModuleInit() {
    // Ligou uma especialidade: serviços de exemplo e termos dela (sem duplicar).
    this.hooks.register(MODULE, {
      onSettingsSaved: (tx, tenantId, settings) => this.seedInTx(tx, tenantId, ((settings as AestheticsSettings).specialties ?? []) as SpecialtyKey[]),
    });
    // O cadastro da pessoa mostra o registro no conselho.
    this.teamLinks.register({
      moduleKey: MODULE,
      find: async (tx, ids) => {
        const rows = await tx.select().from(aesProfessionalCredentials).where(inArray(aesProfessionalCredentials.teamMemberId, ids));
        return rows.map((r) => ({ teamMemberId: r.teamMemberId, label: `Registro ${credentialText(r)}`, path: '/estetica/cadastros', active: true }));
      },
    });
  }

  // ---- Especialidades ligadas ----------------------------------------------------------------

  async enabledInTx(tx: Tx): Promise<SpecialtyKey[]> {
    return ((await this.settings.getInTx<AestheticsSettings>(tx, MODULE)).specialties ?? []) as SpecialtyKey[];
  }

  async assertEnabledInTx(tx: Tx, specialty: SpecialtyKey) {
    if (!(await this.enabledInTx(tx)).includes(specialty)) {
      throw badRequest('SPECIALTY_DISABLED', `${specialtyLabel[specialty]} não está ligada nas configurações da clínica`);
    }
  }

  overview(): Promise<SpecialtyOverview> {
    return this.tdb.run(async (tx) => {
      const s = await this.settings.getInTx<AestheticsSettings>(tx, MODULE);
      return { enabled: s.specialties as SpecialtyKey[], returnDays: { harmonization: s.harmonizationReturnDays, micropigmentation: s.micropigmentationRetouchDays } };
    });
  }

  /** onEnable (inclusive na atualização de versão): dados das especialidades já ligadas. */
  async seedEnabledInTx(tx: Tx, tenantId: string) {
    await this.seedInTx(tx, tenantId, await this.enabledInTx(tx));
  }

  /**
   * Serviços de exemplo (pelo nome), modelos de termo (pela chave) e, no laser, o equipamento.
   * Idempotente: o que já existe, mesmo editado pela clínica, fica como está.
   */
  async seedInTx(tx: Tx, tenantId: string, keys: SpecialtyKey[]) {
    if (!keys.length) return;
    const existing = new Set((await tx.select({ name: schServices.name }).from(schServices).where(eq(schServices.tenantId, tenantId))).map((s) => s.name.toLowerCase()));
    const created: { id: string; name: string; requiresRoom: boolean }[] = [];
    for (const key of keys) {
      const fresh = SPECIALTY_SERVICES[key].filter((s) => !existing.has(s.name.toLowerCase()));
      if (!fresh.length) continue;
      for (const s of fresh) existing.add(s.name.toLowerCase());
      created.push(
        ...(await tx
          .insert(schServices)
          .values(fresh.map((s) => ({ tenantId, name: s.name, category: s.category, durationMin: s.durationMin, bufferMin: s.bufferMin ?? 0, price: s.price, online: s.online ?? false, description: s.description ?? null, requiresRoom: s.requiresRoom ?? false })))
          .returning({ id: schServices.id, name: schServices.name, requiresRoom: schServices.requiresRoom })),
      );
    }
    if (keys.includes('laser')) await this.ensureLaserRoom(tx, tenantId, created.filter((s) => s.requiresRoom).map((s) => s.id));

    const templates = (['common', ...keys] as const).flatMap((k) => SPECIALTY_TEMPLATES[k].map((t) => ({ ...t, specialty: k === 'common' ? null : k })));
    const have = new Set(
      (await tx.select({ key: aesConsentTemplates.key }).from(aesConsentTemplates).where(eq(aesConsentTemplates.tenantId, tenantId))).map((t) => t.key).filter(Boolean),
    );
    const missing = templates.filter((t) => !have.has(t.key));
    if (missing.length) await tx.insert(aesConsentTemplates).values(missing.map((t) => ({ tenantId, key: t.key, specialty: t.specialty, title: t.title, body: t.body })));
  }

  /**
   * Equipamento de laser na agenda, ligado aos serviços de laser criados agora. Na primeira vez (o
   * equipamento nasce aqui), a depilação dos exemplos básicos passa a exigir o aparelho; depois, o que
   * a clínica mudar à mão nesse serviço fica como está.
   */
  private async ensureLaserRoom(tx: Tx, tenantId: string, serviceIds: string[]) {
    const [room] = await tx
      .select({ id: schResources.id })
      .from(schResources)
      .where(and(eq(schResources.tenantId, tenantId), eq(schResources.kind, 'room'), eq(schResources.name, LASER_ROOM.name)));
    const roomId = room?.id ?? (await tx.insert(schResources).values({ tenantId, name: LASER_ROOM.name, kind: 'room', color: LASER_ROOM.color }).returning({ id: schResources.id }))[0]!.id;
    const ids = [...serviceIds];
    if (!room) {
      const upgraded = await tx
        .update(schServices)
        .set({ requiresRoom: true })
        .where(and(eq(schServices.tenantId, tenantId), sql`lower(${schServices.name}) = lower(${BASIC_LASER_SERVICE})`))
        .returning({ id: schServices.id });
      ids.push(...upgraded.map((s) => s.id));
      if (upgraded.length) await this.audit.log(tx, { action: 'aesthetics.laser_service_upgraded', entity: 'sch_service', entityId: upgraded[0]!.id, data: { requiresRoom: true, roomId } });
    }
    if (ids.length) await tx.insert(schServiceResources).values(ids.map((serviceId) => ({ tenantId, serviceId, resourceId: roomId }))).onConflictDoNothing();
  }

  // ---- Registro no conselho ------------------------------------------------------------------

  listCredentials(): Promise<ProfessionalCredential[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ r: schResources, c: aesProfessionalCredentials })
        .from(schResources)
        .leftJoin(aesProfessionalCredentials, eq(aesProfessionalCredentials.teamMemberId, schResources.teamMemberId))
        .where(eq(schResources.kind, 'professional'))
        .orderBy(desc(schResources.active), asc(schResources.name));
      return rows.map(({ r, c }) => ({
        resourceId: r.id,
        name: r.name,
        active: r.active,
        teamMemberId: r.teamMemberId,
        credential: c ? { council: c.council, number: c.number, uf: c.uf as CredentialInput['uf'], rqe: c.rqe, specialty: c.specialty, label: credentialText(c) } : null,
      }));
    });
  }

  saveCredential(resourceId: string, input: CredentialInput) {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const resource = await this.professionalOrFail(tx, resourceId);
      if (!resource.teamMemberId) throw badRequest('NO_TEAM_MEMBER', 'Este profissional não está ligado a uma pessoa da equipe: edite-o na agenda');
      const values = { council: input.council, number: input.number.toUpperCase(), uf: input.uf, rqe: input.rqe ?? null, specialty: input.specialty ?? null };
      await tx
        .insert(aesProfessionalCredentials)
        .values({ tenantId, teamMemberId: resource.teamMemberId, ...values })
        .onConflictDoUpdate({ target: [aesProfessionalCredentials.tenantId, aesProfessionalCredentials.teamMemberId], set: values });
      await this.audit.log(tx, { action: 'aesthetics.credential.saved', entity: 'team_member', entityId: resource.teamMemberId, data: { ...values } });
    });
  }

  removeCredential(resourceId: string) {
    return this.tdb.run(async (tx) => {
      const resource = await this.professionalOrFail(tx, resourceId);
      if (!resource.teamMemberId) return;
      await tx.delete(aesProfessionalCredentials).where(eq(aesProfessionalCredentials.teamMemberId, resource.teamMemberId));
      await this.audit.log(tx, { action: 'aesthetics.credential.removed', entity: 'team_member', entityId: resource.teamMemberId });
    });
  }

  /** Profissional da agenda e o registro dele (para conferir habilitação e assinar a ficha). */
  async professionalInTx(tx: Tx, resourceId: string) {
    const resource = await this.professionalOrFail(tx, resourceId);
    const [credential] = resource.teamMemberId
      ? await tx.select().from(aesProfessionalCredentials).where(eq(aesProfessionalCredentials.teamMemberId, resource.teamMemberId))
      : [];
    return { resource, credential, label: credential ? `${resource.name} — ${credentialText(credential)}` : resource.name };
  }

  private async professionalOrFail(tx: Tx, id: string) {
    const [r] = await tx.select().from(schResources).where(eq(schResources.id, id));
    if (!r || r.kind !== 'professional') throw notFound('PROFESSIONAL_NOT_FOUND', 'Profissional não encontrado');
    return r;
  }

  // ---- Produtos e lotes ----------------------------------------------------------------------

  listProducts(opts: { specialty?: SpecialtyKey; active?: boolean } = {}): Promise<AesProduct[]> {
    return this.tdb.run(async (tx) => {
      const kinds = opts.specialty ? kindsBySpecialty[opts.specialty] : null;
      const rows = await tx
        .select({ p: aesProducts, salesName: salesProducts.name })
        .from(aesProducts)
        .leftJoin(salesProducts, eq(salesProducts.id, aesProducts.salesProductId))
        .where(and(kinds ? inArray(aesProducts.kind, kinds) : undefined, opts.active === undefined ? undefined : eq(aesProducts.active, opts.active)))
        .orderBy(asc(aesProducts.name));
      const lots = await this.lotsOf(
        tx,
        rows.map((r) => r.p.id),
      );
      return rows.map(({ p, salesName }) => toProduct(p, salesName, lots.get(p.id) ?? []));
    });
  }

  createProduct(input: ProductInput) {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const id = await this.insertProduct(tx, tenantId, input);
      await this.audit.log(tx, { action: 'aesthetics.product.created', entity: 'aes_product', entityId: id });
      return this.productDto(tx, id);
    });
  }

  updateProduct(id: string, input: ProductInput) {
    return this.tdb.run(async (tx) => {
      await this.productOrFail(tx, id);
      if (input.salesProductId) await this.salesProductOrFail(tx, input.salesProductId);
      await guardDuplicate(() => tx.update(aesProducts).set(productRow(input)).where(eq(aesProducts.id, id)));
      await this.audit.log(tx, { action: 'aesthetics.product.updated', entity: 'aes_product', entityId: id });
      return this.productDto(tx, id);
    });
  }

  /**
   * Lote novo. Na importação por planilha o produto vem pelo nome: usa o existente (sem
   * diferenciar maiúsculas) ou cadastra com o tipo e a unidade informados.
   */
  addLot(input: LotInput) {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      let productId = input.productId ?? null;
      if (!productId && input.product?.name) {
        const [found] = await tx
          .select({ id: aesProducts.id })
          .from(aesProducts)
          .where(sql`lower(${aesProducts.name}) = lower(${input.product.name.trim()})`);
        if (found) productId = found.id;
        else {
          const { kind, unit } = input.product;
          if (!kind || !unit) throw badRequest('PRODUCT_DETAILS_REQUIRED', `Produto "${input.product.name}" não cadastrado: informe o tipo e a unidade para cadastrá-lo`);
          productId = await this.insertProduct(tx, tenantId, { ...input.product, kind, unit, active: input.product.active ?? true });
        }
      }
      const product = await this.productOrFail(tx, productId!);
      if (input.receivedOn && input.receivedOn > localToday()) throw badRequest('INVALID_DATE', 'A data de recebimento não pode ser no futuro');
      const [lot] = await guardDuplicate(
        () =>
          tx
            .insert(aesProductLots)
            .values({
              tenantId,
              productId: product.id,
              lot: input.lot.trim().toUpperCase(),
              expiresOn: input.expiresOn,
              receivedOn: input.receivedOn ?? null,
              quantity: input.quantity == null ? null : String(input.quantity),
              notes: input.notes ?? null,
            })
            .returning(),
        { code: 'LOT_EXISTS', message: `O lote ${input.lot.toUpperCase()} de ${product.name} já está cadastrado` },
      );
      await this.audit.log(tx, { action: 'aesthetics.lot.created', entity: 'aes_product_lot', entityId: lot!.id, data: { product: product.name, lot: lot!.lot, expiresOn: lot!.expiresOn } });
      return this.productDto(tx, product.id);
    });
  }

  /** Correção do lote. Número e validade só mudam enquanto o lote não foi usado em ninguém. */
  updateLot(id: string, input: { lot: string; expiresOn: string; receivedOn?: string | null; quantity?: number | null; notes?: string | null }) {
    return this.tdb.run(async (tx) => {
      const [lot] = await tx.select().from(aesProductLots).where(eq(aesProductLots.id, id)).for('update');
      if (!lot) throw notFound('LOT_NOT_FOUND', 'Lote não encontrado');
      const [used] = await tx.select({ id: aesLotUsages.id }).from(aesLotUsages).where(eq(aesLotUsages.lotId, id)).limit(1);
      const code = input.lot.trim().toUpperCase();
      if (used && (code !== lot.lot || input.expiresOn !== lot.expiresOn)) {
        throw badRequest('LOT_IN_USE', 'Este lote já foi usado em pacientes: o número e a validade não podem mudar (cadastre outro lote)');
      }
      await guardDuplicate(
        () =>
          tx
            .update(aesProductLots)
            .set({ lot: code, expiresOn: input.expiresOn, receivedOn: input.receivedOn ?? null, quantity: input.quantity == null ? null : String(input.quantity), notes: input.notes ?? null })
            .where(eq(aesProductLots.id, id)),
        { code: 'LOT_EXISTS', message: `O lote ${code} já está cadastrado para este produto` },
      );
      await this.audit.log(tx, { action: 'aesthetics.lot.updated', entity: 'aes_product_lot', entityId: id });
      return this.productDto(tx, lot.productId);
    });
  }

  /** Quem recebeu o lote (recall). Cada paciente listado conta como acesso ao prontuário dele. */
  traceLot(id: string): Promise<LotTrace> {
    return this.tdb.run(async (tx) => {
      const [row] = await tx.select({ lot: aesProductLots, product: aesProducts }).from(aesProductLots).innerJoin(aesProducts, eq(aesProducts.id, aesProductLots.productId)).where(eq(aesProductLots.id, id));
      if (!row) throw notFound('LOT_NOT_FOUND', 'Lote não encontrado');
      const usages = await tx
        .select({ u: aesLotUsages, customer: { id: customers.id, name: customers.name } })
        .from(aesLotUsages)
        .innerJoin(customers, eq(customers.id, aesLotUsages.customerId))
        .where(eq(aesLotUsages.lotId, id))
        .orderBy(desc(aesLotUsages.usedOn), desc(aesLotUsages.createdAt));
      for (const customerId of new Set(usages.map((u) => u.customer.id))) await this.records.logAccessInTx(tx, 'view', 'customer', customerId);
      await this.audit.log(tx, { action: 'aesthetics.lot.traced', entity: 'aes_product_lot', entityId: id, data: { patients: new Set(usages.map((u) => u.customer.id)).size } });
      const lots = await this.lotsOf(tx, [row.product.id]);
      return {
        product: { id: row.product.id, name: row.product.name, brand: row.product.brand, anvisaRegistration: row.product.anvisaRegistration },
        lot: lots.get(row.product.id)!.find((l) => l.id === id)!,
        usages: usages.map(({ u, customer }) => ({
          id: u.id,
          customer,
          amount: Number(u.amount),
          unit: u.unit,
          usedOn: u.usedOn,
          specialty: u.specialty as SpecialtyKey,
          entryId: u.entryId,
          reversalOf: u.reversalOf,
        })),
      };
    });
  }

  /** Lote para usar num procedimento: existe, é do tenant e não estava vencido no dia. */
  async lotForUseInTx(tx: Tx, lotId: string, usedOn: string) {
    const [row] = await tx.select({ lot: aesProductLots, product: aesProducts }).from(aesProductLots).innerJoin(aesProducts, eq(aesProducts.id, aesProductLots.productId)).where(eq(aesProductLots.id, lotId));
    if (!row) throw notFound('LOT_NOT_FOUND', 'Lote não encontrado');
    if (row.lot.expiresOn < usedOn) {
      throw badRequest('LOT_EXPIRED', `${row.product.name}: o lote ${row.lot.lot} venceu em ${brDate(row.lot.expiresOn)} e não pode ser usado`);
    }
    return row;
  }

  private async insertProduct(tx: Tx, tenantId: string, input: ProductInput) {
    if (input.salesProductId) await this.salesProductOrFail(tx, input.salesProductId);
    const [row] = await guardDuplicate(() => tx.insert(aesProducts).values({ tenantId, ...productRow(input) }).returning({ id: aesProducts.id }));
    return row!.id;
  }

  private async productDto(tx: Tx, id: string): Promise<AesProduct> {
    const [row] = await tx
      .select({ p: aesProducts, salesName: salesProducts.name })
      .from(aesProducts)
      .leftJoin(salesProducts, eq(salesProducts.id, aesProducts.salesProductId))
      .where(eq(aesProducts.id, id));
    if (!row) throw notFound('PRODUCT_NOT_FOUND', 'Produto não encontrado');
    return toProduct(row.p, row.salesName, (await this.lotsOf(tx, [id])).get(id) ?? []);
  }

  private async productOrFail(tx: Tx, id: string) {
    const [p] = await tx.select().from(aesProducts).where(eq(aesProducts.id, id));
    if (!p) throw notFound('PRODUCT_NOT_FOUND', 'Produto não encontrado');
    return p;
  }

  private async salesProductOrFail(tx: Tx, id: string) {
    const [p] = await tx.select({ id: salesProducts.id }).from(salesProducts).where(eq(salesProducts.id, id));
    if (!p) throw badRequest('SALES_PRODUCT_NOT_FOUND', 'Produto do estoque não encontrado');
  }

  private async lotsOf(tx: Tx, productIds: string[]): Promise<Map<string, AesLot[]>> {
    const out = new Map<string, AesLot[]>();
    if (!productIds.length) return out;
    const [lots, used] = await Promise.all([
      tx.select().from(aesProductLots).where(inArray(aesProductLots.productId, productIds)).orderBy(asc(aesProductLots.expiresOn), asc(aesProductLots.lot)),
      tx
        .select({ lotId: aesLotUsages.lotId, total: sql<string>`sum(${aesLotUsages.amount})` })
        .from(aesLotUsages)
        .where(inArray(aesLotUsages.productId, productIds))
        .groupBy(aesLotUsages.lotId),
    ]);
    const today = localToday();
    for (const l of lots) {
      const list = out.get(l.productId) ?? [];
      list.push({
        id: l.id,
        lot: l.lot,
        expiresOn: l.expiresOn,
        receivedOn: l.receivedOn,
        quantity: l.quantity == null ? null : Number(l.quantity),
        used: Number(used.find((u) => u.lotId === l.id)?.total ?? 0),
        expired: l.expiresOn < today,
        notes: l.notes,
      });
      out.set(l.productId, list);
    }
    return out;
  }

  // ---- Modelos de termo ----------------------------------------------------------------------

  listTemplates(specialty?: SpecialtyKey): Promise<ConsentTemplate[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select()
        .from(aesConsentTemplates)
        .where(specialty ? sql`(${aesConsentTemplates.specialty} = ${specialty} or ${aesConsentTemplates.specialty} is null)` : undefined)
        .orderBy(asc(aesConsentTemplates.specialty), asc(aesConsentTemplates.title));
      return rows.map(toTemplate);
    });
  }

  createTemplate(input: ConsentTemplateInput) {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .insert(aesConsentTemplates)
        .values({ tenantId, specialty: input.specialty ?? null, title: input.title, body: input.body, active: input.active })
        .returning();
      await this.audit.log(tx, { action: 'aesthetics.consent_template.created', entity: 'aes_consent_template', entityId: row!.id });
      return toTemplate(row!);
    });
  }

  /** Editar o texto sobe a versão; os aceites já registrados guardam o texto da versão deles. */
  updateTemplate(id: string, input: ConsentTemplateInput) {
    return this.tdb.run(async (tx) => {
      const [current] = await tx.select().from(aesConsentTemplates).where(eq(aesConsentTemplates.id, id)).for('update');
      if (!current) throw notFound('TEMPLATE_NOT_FOUND', 'Modelo de termo não encontrado');
      const changed = current.title !== input.title || current.body !== input.body;
      const [row] = await tx
        .update(aesConsentTemplates)
        .set({ specialty: input.specialty ?? null, title: input.title, body: input.body, active: input.active, version: changed ? current.version + 1 : current.version })
        .where(eq(aesConsentTemplates.id, id))
        .returning();
      await this.audit.log(tx, { action: 'aesthetics.consent_template.updated', entity: 'aes_consent_template', entityId: id, data: { version: row!.version } });
      return toTemplate(row!);
    });
  }

  async templateInTx(tx: Tx, id: string) {
    const [row] = await tx.select().from(aesConsentTemplates).where(eq(aesConsentTemplates.id, id));
    if (!row) throw notFound('TEMPLATE_NOT_FOUND', 'Modelo de termo não encontrado');
    return row;
  }

  /** Nome do usuário logado (quem registra), para o texto do termo quando não há profissional. */
  async userNameInTx(tx: Tx, userId: string) {
    const [u] = await tx.select({ name: coreSchema.users.name }).from(coreSchema.users).where(eq(coreSchema.users.id, userId));
    return u?.name ?? 'Usuário';
  }
}

function productRow(input: ProductInput) {
  return {
    name: input.name.trim(),
    brand: input.brand ?? null,
    kind: input.kind,
    unit: input.unit,
    anvisaRegistration: input.anvisaRegistration ?? null,
    unitsPerPackage: input.unitsPerPackage == null ? null : String(input.unitsPerPackage),
    salesProductId: input.salesProductId ?? null,
    active: input.active,
  };
}

function toProduct(p: typeof aesProducts.$inferSelect, salesName: string | null, lots: AesLot[]): AesProduct {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    kind: p.kind,
    unit: p.unit,
    anvisaRegistration: p.anvisaRegistration,
    unitsPerPackage: p.unitsPerPackage == null ? null : Number(p.unitsPerPackage),
    salesProductId: p.salesProductId,
    salesProductName: salesName,
    active: p.active,
    lots,
  };
}

const toTemplate = (t: typeof aesConsentTemplates.$inferSelect): ConsentTemplate => ({
  id: t.id,
  key: t.key,
  specialty: t.specialty as SpecialtyKey | null,
  title: t.title,
  body: t.body,
  active: t.active,
  version: t.version,
  updatedAt: t.updatedAt.toISOString(),
});

async function guardDuplicate<T>(fn: () => Promise<T>, conflict = { code: 'PRODUCT_EXISTS', message: 'Já existe um produto com este nome' }): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictException(conflict);
    throw err;
  }
}
