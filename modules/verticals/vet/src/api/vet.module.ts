import { AuditService, ModuleHooks, ModuleSettingsService, ScheduledJobs, TenantDb, ZodPipe, coreSchema } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { MedicalRecordsModule, MedicalRecordsService } from '@all/medical-records';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { NotificationsModule, NotificationsService } from '@all/notifications';
import { PetsModule, PetsService } from '@all/pets';
import { pets } from '@all/pets/schema';
import { schServices } from '@all/scheduling/schema';
import { Body, Controller, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { vaccinationInput, vetForms, voidInput, type Vaccination, type VaccinationInput, type VaccineDue } from '../contracts';
import { vetVaccinations } from '../db/schema';
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
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    for (const form of vetForms) this.records.registerForm(form);
    // O prontuário veterinário é do pet; o responsável (para LGPD e contato) é o tutor.
    this.records.registerSubject('pet', async (tx, id) => {
      const pet = await this.pets.findInTx(tx, id);
      return pet && { customerId: pet.customerId, label: pet.name };
    });
    this.jobs.every('vet.vaccine-reminders', 60 * 60_000, () => this.sendVaccineReminders());
  }

  vaccinations(petId: string): Promise<Vaccination[]> {
    return this.tdb.run(async (tx) => {
      await this.petOrFail(tx, petId);
      const rows = await tx.select().from(vetVaccinations).where(eq(vetVaccinations.petId, petId)).orderBy(desc(vetVaccinations.appliedOn), desc(vetVaccinations.id));
      return rows.map(toDto);
    });
  }

  addVaccination(input: VaccinationInput): Promise<Vaccination> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const pet = await this.petOrFail(tx, input.petId);
      const [user] = await tx.select({ name: coreSchema.users.name }).from(coreSchema.users).where(eq(coreSchema.users.id, userId!));
      const [row] = await tx
        .insert(vetVaccinations)
        .values({
          tenantId,
          petId: pet.id,
          customerId: pet.customerId,
          vaccine: input.vaccine,
          dose: input.dose ?? null,
          batch: input.batch ?? null,
          manufacturer: input.manufacturer ?? null,
          appliedOn: input.appliedOn,
          nextDueOn: input.nextDueOn,
          appliedById: userId ?? null,
          appliedByName: user?.name ?? 'Usuário',
          notes: input.notes ?? null,
        })
        .returning();
      await this.audit.log(tx, { action: 'vet.vaccination.created', entity: 'vet_vaccination', entityId: row!.id });
      return toDto(row!);
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
      return toDto(row);
    });
  }

  /** Reforços vencidos e a vencer até `until`, só a dose mais recente de cada vacina de cada pet vivo. */
  due(until: string): Promise<VaccineDue[]> {
    return this.tdb.run(async (tx) => {
      const rows = await this.dueQuery(tx, sql`${until}::date`);
      return rows.map((r) => ({
        id: r.v.id,
        vaccine: r.v.vaccine,
        nextDueOn: r.v.nextDueOn!,
        pet: { id: r.pet.id, name: r.pet.name },
        tutor: { id: r.tutor.id, name: r.tutor.name, phone: r.tutor.phone },
        reminderSentAt: r.v.reminderSentAt?.toISOString() ?? null,
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
              data: { pet: { nome: r.pet.name }, vacina: { nome: r.v.vaccine, data: brDate(r.v.nextDueOn!) } },
            });
          }
        }),
      );
    }
  }

  private dueQuery(tx: Tx, until: ReturnType<typeof sql>, from?: ReturnType<typeof sql>) {
    const later = sql`not exists (
      select 1 from ${vetVaccinations} newer
      where newer.pet_id = ${vetVaccinations.petId} and newer.vaccine = ${vetVaccinations.vaccine}
        and newer.voided_at is null and newer.applied_on > ${vetVaccinations.appliedOn})`;
    return tx
      .select({ v: vetVaccinations, pet: { id: pets.id, name: pets.name }, tutor: { id: customers.id, name: customers.name, phone: customers.phone } })
      .from(vetVaccinations)
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
  }
}

function toDto(r: typeof vetVaccinations.$inferSelect): Vaccination {
  return {
    id: r.id,
    petId: r.petId,
    vaccine: r.vaccine,
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

@Module({ imports: [NotificationsModule, PetsModule, MedicalRecordsModule], controllers: [VetController], providers: [VetService] })
export class VetModule {}
