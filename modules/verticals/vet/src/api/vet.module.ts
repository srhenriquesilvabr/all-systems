import { AuditService, ModuleHooks, ModuleSettingsService, ScheduledJobs, TenantDb, ZodPipe, coreSchema } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { MedicalRecordsModule, MedicalRecordsService } from '@all/medical-records';
import { ModuleRoute, RequireAnyPermission, RequirePermission, requestContext } from '@all/module-sdk';
import { NotificationsModule, NotificationsService, notificationsSchema } from '@all/notifications';
import { PetsModule, PetsService } from '@all/pets';
import { pets } from '@all/pets/schema';
import { SchedulingModule, SchedulingService } from '@all/scheduling';
import { schAppointments, schServices } from '@all/scheduling/schema';
import { Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  defaultVaccines,
  matchVaccine,
  mergeVaccineInput,
  returnAppointmentInput,
  vaccinationInput,
  vaccineCatalogInput,
  vaccineKey,
  vetForms,
  voidInput,
  type ReminderStatus,
  type ReturnAppointmentInput,
  type Vaccination,
  type VaccinationInput,
  type VaccineCatalogEntry,
  type VaccineCatalogInput,
  type VaccineDue,
} from '../contracts';
import { vetVaccinations, vetVaccines } from '../db/schema';
import type { VetSettings } from '../manifest';

const MODULE = 'vet';

const VET_SERVICES = [
  { name: 'Consulta clínica', category: 'Consultas', durationMin: 30, price: '150.00' },
  { name: 'Retorno', category: 'Consultas', durationMin: 20, price: '80.00' },
  { name: 'Vacina V10', category: 'Vacinas', durationMin: 15, price: '90.00' },
  { name: 'Vacina antirrábica', category: 'Vacinas', durationMin: 15, price: '70.00' },
  { name: 'Vacina V4 felina', category: 'Vacinas', durationMin: 15, price: '110.00' },
  { name: 'Coleta para exames', category: 'Exames', durationMin: 15, price: '40.00' },
  { name: 'Microchipagem', category: 'Procedimentos', durationMin: 15, price: '80.00' },
  { name: 'Castração', category: 'Cirurgias', durationMin: 120, price: '600.00' },
];

const brDate = (iso: string) => iso.split('-').reverse().join('/');
const { notifications } = notificationsSchema;
const VOID_DUPLICATE = 'Duplicada: mesma vacina na mesma data';

@Injectable()
export class VetService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly jobs: ScheduledJobs,
    private readonly settings: ModuleSettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly pets: PetsService,
    private readonly records: MedicalRecordsService,
    private readonly scheduling: SchedulingService,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    for (const form of vetForms) this.records.registerForm(form);
    // O prontuário veterinário é do pet; o responsável (para LGPD e contato) é o tutor.
    this.records.registerSubject('pet', async (tx, id) => {
      const pet = await this.pets.findInTx(tx, id);
      return pet && { customerId: pet.customerId, label: pet.name };
    });
    // A consulta só se liga a um horário do próprio pet (ou do tutor, se o horário foi marcado sem pet).
    this.records.registerAppointmentChecker('pet', async (tx, appointmentId, petId) => {
      const [row] = await tx.select({ subjectId: schAppointments.subjectId, customerId: schAppointments.customerId }).from(schAppointments).where(eq(schAppointments.id, appointmentId));
      if (!row) return false;
      if (row.subjectId) return row.subjectId === petId;
      return row.customerId === (await this.pets.findInTx(tx, petId))?.customerId;
    });
    this.jobs.every('vet.vaccine-reminders', 60 * 60_000, () => this.sendVaccineReminders());
  }

  // ---- Catálogo --------------------------------------------------------------------------------

  catalog(): Promise<VaccineCatalogEntry[]> {
    return this.tdb.run(async (tx) => {
      const [rows, uses] = await Promise.all([
        tx.select().from(vetVaccines).orderBy(asc(vetVaccines.name)),
        tx.select({ vaccineId: vetVaccinations.vaccineId, total: count() }).from(vetVaccinations).groupBy(vetVaccinations.vaccineId),
      ]);
      return rows.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, active: r.active, uses: uses.find((u) => u.vaccineId === r.id)?.total ?? 0 }));
    });
  }

  saveVaccine(id: string | null, input: VaccineCatalogInput): Promise<VaccineCatalogEntry> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const others = (await tx.select().from(vetVaccines)).filter((v) => v.id !== id);
      for (const name of [input.name, ...input.aliases]) {
        const taken = matchVaccine(name, others);
        if (taken) throw new ConflictException({ code: 'VACCINE_EXISTS', message: `"${name}" já conta como ${taken.name}` });
      }
      const values = { name: input.name, nameKey: vaccineKey(input.name), aliases: input.aliases, active: input.active };
      const [row] = id ? await tx.update(vetVaccines).set(values).where(eq(vetVaccines.id, id)).returning() : await tx.insert(vetVaccines).values({ ...values, tenantId }).returning();
      if (!row) throw new NotFoundException({ code: 'VACCINE_NOT_FOUND', message: 'Vacina não encontrada no catálogo' });
      await this.audit.log(tx, { action: id ? 'vet.vaccine.updated' : 'vet.vaccine.created', entity: 'vet_vaccine', entityId: row.id, data: input });
      return { id: row.id, name: row.name, aliases: row.aliases, active: row.active, uses: 0 };
    });
  }

  /**
   * Junta duas vacinas do catálogo que são a mesma: as aplicações passam para a que fica, com o texto
   * original intacto, e o nome da outra vira apelido. Duas aplicações no mesmo dia: a repetida é
   * anulada com motivo, não apagada.
   */
  mergeVaccine(id: string, intoId: string): Promise<VaccineCatalogEntry> {
    return this.tdb.run(async (tx) => {
      if (id === intoId) throw new ConflictException({ code: 'SAME_VACCINE', message: 'Escolha outra vacina' });
      const locked = await tx.select().from(vetVaccines).where(inArray(vetVaccines.id, [id, intoId])).orderBy(asc(vetVaccines.id)).for('update');
      const from = locked.find((v) => v.id === id);
      const into = locked.find((v) => v.id === intoId);
      if (!from || !into) throw new NotFoundException({ code: 'VACCINE_NOT_FOUND', message: 'Vacina não encontrada no catálogo' });
      const moving = await tx.select().from(vetVaccinations).where(and(eq(vetVaccinations.vaccineId, id), isNull(vetVaccinations.voidedAt)));
      for (const v of moving) {
        const [twin] = await tx
          .select({ id: vetVaccinations.id })
          .from(vetVaccinations)
          .where(and(eq(vetVaccinations.petId, v.petId), eq(vetVaccinations.vaccineId, intoId), eq(vetVaccinations.appliedOn, v.appliedOn), isNull(vetVaccinations.voidedAt)));
        if (twin) await tx.update(vetVaccinations).set({ voidedAt: new Date(), voidReason: VOID_DUPLICATE }).where(eq(vetVaccinations.id, v.id));
      }
      await tx.update(vetVaccinations).set({ vaccineId: intoId }).where(eq(vetVaccinations.vaccineId, id));
      const aliases = [...new Set([...into.aliases, from.name, ...from.aliases])];
      const [row] = await tx.update(vetVaccines).set({ aliases }).where(eq(vetVaccines.id, intoId)).returning();
      await tx.delete(vetVaccines).where(eq(vetVaccines.id, id));
      await this.audit.log(tx, { action: 'vet.vaccine.merged', entity: 'vet_vaccine', entityId: intoId, data: { from: from.name, into: into.name, applications: moving.length } });
      return { id: row!.id, name: row!.name, aliases: row!.aliases, active: row!.active, uses: moving.length };
    });
  }

  /** Vacina do catálogo com este nome ou apelido; sem nenhuma, entra uma nova com o nome digitado. */
  private async resolveVaccine(tx: Tx, tenantId: string, name: string) {
    const catalog = await tx.select().from(vetVaccines);
    const found = matchVaccine(name, catalog);
    if (found) return found;
    const nameKey = vaccineKey(name) || name.trim().toLowerCase();
    const [created] = await tx.insert(vetVaccines).values({ tenantId, name: name.trim(), nameKey }).onConflictDoNothing().returning();
    if (created) return created;
    const [existing] = await tx.select().from(vetVaccines).where(eq(vetVaccines.nameKey, nameKey));
    return existing!;
  }

  /** Marca o retorno da consulta: o horário já nasce com o pet e o tutor. */
  scheduleReturn(petId: string, input: ReturnAppointmentInput) {
    return this.tdb.run(async (tx) => {
      const pet = await this.petOrFail(tx, petId);
      return this.scheduling.createInTx(tx, {
        customerId: pet.customerId,
        resourceId: input.resourceId,
        serviceIds: input.serviceIds,
        startsAt: input.startsAt,
        notes: input.notes ?? null,
        subject: { type: 'pet', id: pet.id, label: pet.name },
      });
    });
  }

  vaccinations(petId: string): Promise<Vaccination[]> {
    return this.tdb.run(async (tx) => {
      await this.petOrFail(tx, petId);
      const rows = await tx
        .select({ v: vetVaccinations, vaccineName: vetVaccines.name })
        .from(vetVaccinations)
        .leftJoin(vetVaccines, eq(vetVaccines.id, vetVaccinations.vaccineId))
        .where(eq(vetVaccinations.petId, petId))
        .orderBy(desc(vetVaccinations.appliedOn), desc(vetVaccinations.id));
      return rows.map((r) => toDto(r.v, r.vaccineName));
    });
  }

  addVaccination(input: VaccinationInput): Promise<Vaccination> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const pet = await this.petOrFail(tx, input.petId);
      const [user] = await tx.select({ name: coreSchema.users.name }).from(coreSchema.users).where(eq(coreSchema.users.id, userId!));
      const catalogVaccine = await this.resolveVaccine(tx, tenantId, input.vaccine);
      const [row] = await tx
        .insert(vetVaccinations)
        .values({
          tenantId,
          petId: pet.id,
          customerId: pet.customerId,
          vaccine: input.vaccine,
          vaccineId: catalogVaccine.id,
          dose: input.dose ?? null,
          batch: input.batch ?? null,
          manufacturer: input.manufacturer ?? null,
          appliedOn: input.appliedOn,
          nextDueOn: input.nextDueOn,
          appliedById: userId ?? null,
          appliedByName: user?.name ?? 'Usuário',
          notes: input.notes ?? null,
        })
        // A mesma vacina na mesma data (índice único): não abre outra, nem derruba a transação.
        .onConflictDoNothing()
        .returning();
      if (!row) {
        const [existing] = await tx
          .select()
          .from(vetVaccinations)
          .where(and(eq(vetVaccinations.petId, pet.id), eq(vetVaccinations.vaccineId, catalogVaccine.id), eq(vetVaccinations.appliedOn, input.appliedOn), isNull(vetVaccinations.voidedAt)));
        if (input.skipDuplicate) return { ...toDto(existing!, catalogVaccine.name), duplicate: true };
        throw new ConflictException({ code: 'DUPLICATE_VACCINATION', message: `${catalogVaccine.name} já está registrada em ${brDate(input.appliedOn)} para ${pet.name}` });
      }
      await this.audit.log(tx, { action: 'vet.vaccination.created', entity: 'vet_vaccination', entityId: row.id });
      return toDto(row, catalogVaccine.name);
    });
  }

  voidVaccination(id: string, reason: string): Promise<Vaccination> {
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .update(vetVaccinations)
        .set({ voidedAt: new Date(), voidReason: reason })
        .where(and(eq(vetVaccinations.id, id), isNull(vetVaccinations.voidedAt)))
        .returning();
      if (!row) throw new NotFoundException({ code: 'VACCINATION_NOT_FOUND', message: 'Vacina não encontrada ou já anulada' });
      await this.audit.log(tx, { action: 'vet.vaccination.voided', entity: 'vet_vaccination', entityId: id, data: { reason } });
      const [catalogVaccine] = row.vaccineId ? await tx.select({ name: vetVaccines.name }).from(vetVaccines).where(eq(vetVaccines.id, row.vaccineId)) : [];
      return toDto(row, catalogVaccine?.name ?? null);
    });
  }

  /** Reforços vencidos e a vencer até `until`, só a dose mais recente de cada vacina de cada pet vivo. */
  due(until: string): Promise<VaccineDue[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.dueQuery(tx, sql`${until}::date`);
      const ids = rows.filter((r) => r.v.reminderSentAt).map((r) => r.v.id);
      const sent = ids.length
        ? await tx
            .select({ relatedId: notifications.relatedId, status: notifications.status, detail: notifications.detail })
            .from(notifications)
            .where(and(eq(notifications.relatedEntity, 'vet_vaccination'), inArray(notifications.relatedId, ids)))
        : [];
      return rows.map((r) => ({
        id: r.v.id,
        vaccine: r.v.vaccine,
        vaccineName: r.vaccineName ?? r.v.vaccine,
        nextDueOn: r.v.nextDueOn!,
        pet: { id: r.pet.id, name: r.pet.name },
        tutor: { id: r.tutor.id, name: r.tutor.name, phone: r.tutor.phone },
        reminderSentAt: r.v.reminderSentAt?.toISOString() ?? null,
        reminder: reminderOf(sent.filter((n) => n.relatedId === r.v.id)),
      }));
    });
  }

  async sendVaccineReminders() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const { vaccineReminderDays } = await this.settings.getInTx<VetSettings>(tx, MODULE);
          if (!vaccineReminderDays) return;
          const today = sql`(now() at time zone 'America/Sao_Paulo')::date`;
          const rows = await this.dueQuery(tx, sql`${today} + ${vaccineReminderDays}::int`, today);
          for (const r of rows.filter((x) => !x.v.reminderSentAt)) {
            await tx.update(vetVaccinations).set({ reminderSentAt: new Date() }).where(eq(vetVaccinations.id, r.v.id));
            await this.notifications.enqueueInTx(tx, {
              templateKey: 'vet.vaccine_due',
              customerId: r.tutor.id,
              related: { entity: 'vet_vaccination', id: r.v.id },
              data: { pet: { nome: r.pet.name }, vacina: { nome: r.vaccineName ?? r.v.vaccine, data: brDate(r.v.nextDueOn!) } },
            });
          }
        }),
      );
    }
  }

  private dueQuery(tx: Tx, until: ReturnType<typeof sql>, from?: ReturnType<typeof sql>) {
    const later = sql`not exists (
      select 1 from ${vetVaccinations} newer
      where newer.pet_id = ${vetVaccinations.petId}
        and coalesce(newer.vaccine_id::text, lower(newer.vaccine)) = coalesce(${vetVaccinations.vaccineId}::text, lower(${vetVaccinations.vaccine}))
        and newer.voided_at is null and newer.applied_on > ${vetVaccinations.appliedOn})`;
    return tx
      .select({ v: vetVaccinations, vaccineName: vetVaccines.name, pet: { id: pets.id, name: pets.name }, tutor: { id: customers.id, name: customers.name, phone: customers.phone } })
      .from(vetVaccinations)
      .leftJoin(vetVaccines, eq(vetVaccines.id, vetVaccinations.vaccineId))
      .innerJoin(pets, eq(pets.id, vetVaccinations.petId))
      .innerJoin(customers, eq(customers.id, vetVaccinations.customerId))
      .where(
        and(
          isNull(vetVaccinations.voidedAt),
          isNull(pets.deceasedAt),
          isNull(customers.anonymizedAt),
          lte(vetVaccinations.nextDueOn, until),
          from ? gte(vetVaccinations.nextDueOn, from) : undefined,
          later,
        ),
      )
      .orderBy(asc(vetVaccinations.nextDueOn));
  }

  private async petOrFail(tx: Tx, petId: string) {
    const pet = await this.pets.findInTx(tx, petId);
    if (!pet) throw new NotFoundException({ code: 'PET_NOT_FOUND', message: 'Pet não encontrado' });
    return pet;
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: schServices.id }).from(schServices).where(eq(schServices.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(schServices).values(VET_SERVICES.map((s) => ({ ...s, tenantId })));
    await this.seedCatalog(tx, tenantId);
    await this.linkOldVaccinations(tx, tenantId);
  }

  /** Só o que falta (idempotente): o que a clínica renomeou ou juntou não volta. */
  private async seedCatalog(tx: Tx, tenantId: string) {
    const current = await tx.select().from(vetVaccines);
    const missing = defaultVaccines.filter((d) => !matchVaccine(d.name, current));
    if (missing.length) await tx.insert(vetVaccines).values(missing.map((d) => ({ tenantId, name: d.name, nameKey: vaccineKey(d.name), aliases: d.aliases }))).onConflictDoNothing();
  }

  /**
   * Liga ao catálogo as vacinas registradas antes dele (roda na reconciliação do módulo). O texto
   * digitado fica. A mesma vacina repetida na mesma data, como a planilha importada duas vezes, tem
   * a cópia anulada com motivo: continua na carteira, riscada.
   */
  private async linkOldVaccinations(tx: Tx, tenantId: string) {
    const rows = await tx.select().from(vetVaccinations).where(isNull(vetVaccinations.vaccineId)).orderBy(asc(vetVaccinations.createdAt), asc(vetVaccinations.id));
    for (const row of rows) {
      const vaccine = await this.resolveVaccine(tx, tenantId, row.vaccine);
      const [twin] = row.voidedAt
        ? []
        : await tx
            .select({ id: vetVaccinations.id })
            .from(vetVaccinations)
            .where(and(eq(vetVaccinations.petId, row.petId), eq(vetVaccinations.vaccineId, vaccine.id), eq(vetVaccinations.appliedOn, row.appliedOn), isNull(vetVaccinations.voidedAt)));
      await tx
        .update(vetVaccinations)
        .set({ vaccineId: vaccine.id, ...(twin ? { voidedAt: new Date(), voidReason: VOID_DUPLICATE } : {}) })
        .where(eq(vetVaccinations.id, row.id));
    }
  }
}

/** Situação do lembrete pelo melhor resultado entre os canais: "não enviado" só se nenhum teve como sair. */
function reminderOf(sent: { status: ReminderStatus; detail: string | null }[]): VaccineDue['reminder'] {
  if (!sent.length) return null;
  for (const status of ['sent', 'manual', 'queued', 'failed', 'skipped'] as const) {
    const hit = sent.find((n) => n.status === status);
    if (hit) return { status, detail: hit.detail };
  }
  return null;
}

function toDto(r: typeof vetVaccinations.$inferSelect, vaccineName: string | null): Vaccination {
  return {
    id: r.id,
    petId: r.petId,
    vaccine: r.vaccine,
    vaccineId: r.vaccineId,
    vaccineName: vaccineName ?? r.vaccine,
    dose: r.dose,
    batch: r.batch,
    manufacturer: r.manufacturer,
    appliedOn: r.appliedOn,
    nextDueOn: r.nextDueOn,
    appliedBy: r.appliedByName,
    notes: r.notes,
    voided: r.voidedAt ? { at: r.voidedAt.toISOString(), reason: r.voidReason ?? '' } : null,
    createdAt: r.createdAt.toISOString(),
  };
}

const dueQuery = z.object({ until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

@Controller('vet')
@ModuleRoute('vet')
export class VetController {
  constructor(private readonly vet: VetService) {}

  @Get('vaccines')
  @RequirePermission('vet.vaccines.read')
  catalog() {
    return this.vet.catalog();
  }

  @Post('vaccines')
  @RequirePermission('vet.vaccines.write')
  createVaccine(@Body(new ZodPipe(vaccineCatalogInput)) body: VaccineCatalogInput) {
    return this.vet.saveVaccine(null, body);
  }

  @Patch('vaccines/:id')
  @RequirePermission('vet.vaccines.write')
  updateVaccine(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(vaccineCatalogInput)) body: VaccineCatalogInput) {
    return this.vet.saveVaccine(id, body);
  }

  /** Duas vacinas do catálogo que são a mesma: as aplicações passam para `intoId`. */
  @Post('vaccines/:id/merge')
  @HttpCode(200)
  @RequirePermission('vet.vaccines.write')
  mergeVaccine(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(mergeVaccineInput)) body: { intoId: string }) {
    return this.vet.mergeVaccine(id, body.intoId);
  }

  /** Quem escreve no prontuário pode marcar o retorno, mesmo sem acesso geral à marcação da agenda. */
  @Post('pets/:petId/return-appointment')
  @RequireAnyPermission('shared.scheduling.write', 'shared.medical-records.write')
  scheduleReturn(@Param('petId', ParseUUIDPipe) petId: string, @Body(new ZodPipe(returnAppointmentInput)) body: ReturnAppointmentInput) {
    return this.vet.scheduleReturn(petId, body);
  }

  @Get('pets/:petId/vaccinations')
  @RequirePermission('vet.vaccines.read')
  list(@Param('petId', ParseUUIDPipe) petId: string) {
    return this.vet.vaccinations(petId);
  }

  @Post('vaccinations')
  @RequirePermission('vet.vaccines.write')
  add(@Body(new ZodPipe(vaccinationInput)) body: VaccinationInput) {
    return this.vet.addVaccination(body);
  }

  @Post('vaccinations/:id/void')
  @RequirePermission('vet.vaccines.write')
  void(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voidInput)) body: { reason: string }) {
    return this.vet.voidVaccination(id, body.reason);
  }

  @Get('vaccinations/due')
  @RequirePermission('vet.vaccines.read')
  due(@Query(new ZodPipe(dueQuery)) q: { until: string }) {
    return this.vet.due(q.until);
  }
}

@Module({ imports: [NotificationsModule, PetsModule, MedicalRecordsModule, SchedulingModule], controllers: [VetController], providers: [VetService] })
export class VetModule {}
