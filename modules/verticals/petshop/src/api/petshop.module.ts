import { AuditService, CustomersService, ModuleHooks, ModuleSettingsService, OutboxHandlers, TenantDb, ZodPipe, coreSchema } from '@all/core';
import type { Tx } from '@all/db';
import { ModuleRoute, RequireAnyPermission, RequirePermission, requestContext } from '@all/module-sdk';
import { NotificationsModule, NotificationsService } from '@all/notifications';
import { STATUS_CHANGED, type AppointmentStatusChanged } from '@all/scheduling';
import { schAppointments, schAppointmentServices, schServices } from '@all/scheduling/schema';
import { pets } from '@all/pets/schema';
import { salesProducts } from '@all/sales/schema';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { petshopPickups } from '../db/schema';
import type { PetshopSettings } from '../manifest';

const MODULE = 'petshop';

/** Tabela inicial de banho e tosa: o preço muda com o porte, então cada porte é um serviço. */
const PETSHOP_SERVICES = [
  { name: 'Banho — porte pequeno', category: 'Banho', durationMin: 60, price: '50.00' },
  { name: 'Banho — porte médio', category: 'Banho', durationMin: 75, price: '65.00' },
  { name: 'Banho — porte grande', category: 'Banho', durationMin: 90, price: '85.00' },
  { name: 'Banho e tosa — porte pequeno', category: 'Banho e tosa', durationMin: 90, price: '80.00' },
  { name: 'Banho e tosa — porte médio', category: 'Banho e tosa', durationMin: 120, price: '100.00' },
  { name: 'Banho e tosa — porte grande', category: 'Banho e tosa', durationMin: 150, price: '130.00' },
  { name: 'Tosa higiênica', category: 'Tosa', durationMin: 30, price: '35.00' },
  { name: 'Hidratação de pelos', category: 'Adicionais', durationMin: 20, price: '30.00' },
  { name: 'Corte de unhas', category: 'Adicionais', durationMin: 15, price: '20.00' },
  { name: 'Escovação de dentes', category: 'Adicionais', durationMin: 10, price: '15.00' },
];

/** Loja: alguns produtos de exemplo, com estoque controlado. */
const PETSHOP_PRODUCTS = [
  { name: 'Ração cães adultos 15 kg', category: 'Rações', unit: 'un', price: '189.90' },
  { name: 'Ração gatos castrados 10 kg', category: 'Rações', unit: 'un', price: '219.90' },
  { name: 'Sachê gatos 85 g', category: 'Rações', unit: 'un', price: '3.49' },
  { name: 'Petisco bifinho 65 g', category: 'Petiscos', unit: 'un', price: '9.90' },
  { name: 'Areia sanitária 4 kg', category: 'Higiene', unit: 'un', price: '24.90' },
  { name: 'Tapete higiênico 30 un', category: 'Higiene', unit: 'pct', price: '59.90' },
  { name: 'Coleira ajustável M', category: 'Acessórios', unit: 'un', price: '34.90' },
  { name: 'Antipulgas cães 10–20 kg', category: 'Farmácia', unit: 'un', price: '89.90' },
] as const;

@Injectable()
export class PetshopService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly handlers: OutboxHandlers,
    private readonly settings: ModuleSettingsService,
    private readonly notifications: NotificationsService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    this.handlers.on<AppointmentStatusChanged>(STATUS_CHANGED, 'petshop.ready', (e) => this.onStatusChanged(e.payload));
  }

  /** Saídas registradas dos horários de um período, para o quadro. */
  pickups(from: Date, to: Date) {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ appointmentId: petshopPickups.appointmentId, pickedUpAt: petshopPickups.pickedUpAt, userName: coreSchema.users.name })
        .from(petshopPickups)
        .innerJoin(schAppointments, eq(schAppointments.id, petshopPickups.appointmentId))
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, petshopPickups.pickedUpBy))
        .where(and(gte(schAppointments.startsAt, from), lte(schAppointments.startsAt, to)));
      return rows.map((r) => ({ appointmentId: r.appointmentId, pickedUpAt: r.pickedUpAt.toISOString(), userName: r.userName }));
    });
  }

  /** O tutor buscou o pet: só depois de pronto, uma vez por horário. */
  registerPickup(appointmentId: string) {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const appointment = await this.appointmentOrFail(tx, appointmentId);
      if (appointment.status !== 'done') throw new BadRequestException({ code: 'NOT_READY', message: 'O pet ainda não está pronto para ser buscado' });
      const [row] = await tx
        .insert(petshopPickups)
        .values({ appointmentId, tenantId, pickedUpBy: userId ?? null })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException({ code: 'ALREADY_PICKED_UP', message: 'A saída deste pet já foi registrada' });
      await this.customers.addTimeline(tx, {
        customerId: appointment.customerId,
        moduleKey: MODULE,
        type: 'petshop.picked_up',
        title: `${appointment.subjectLabel ?? 'Pet'} buscado(a) pelo tutor`,
        entity: 'appointment',
        entityId: appointmentId,
      });
      await this.audit.log(tx, { action: 'petshop.picked_up', entity: 'appointment', entityId: appointmentId });
      return { appointmentId, pickedUpAt: row.pickedUpAt.toISOString() };
    });
  }

  /** Marcou no pet errado: desfaz (fica na auditoria). */
  undoPickup(appointmentId: string) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx.delete(petshopPickups).where(eq(petshopPickups.appointmentId, appointmentId)).returning();
      if (!row) throw new NotFoundException({ code: 'PICKUP_NOT_FOUND', message: 'Saída não encontrada' });
      await this.audit.log(tx, { action: 'petshop.pickup_undone', entity: 'appointment', entityId: appointmentId, data: { pickedUpAt: row.pickedUpAt.toISOString() } });
    });
  }

  /** Horário marcado sem pet: escolhe depois, pelo quadro, antes de concluir (é o que faz o aviso sair). */
  setPet(appointmentId: string, petId: string) {
    return this.tdb.run(async (tx) => {
      const appointment = await this.appointmentOrFail(tx, appointmentId);
      if (['done', 'no_show', 'cancelled'].includes(appointment.status)) throw new BadRequestException({ code: 'APPOINTMENT_CLOSED', message: 'Este horário já foi encerrado' });
      const [pet] = await tx.select({ id: pets.id, name: pets.name, customerId: pets.customerId }).from(pets).where(eq(pets.id, petId));
      if (!pet || pet.customerId !== appointment.customerId) throw new BadRequestException({ code: 'PET_NOT_FOUND', message: 'Este pet não é do cliente do horário' });
      await tx.update(schAppointments).set({ subjectType: 'pet', subjectId: pet.id, subjectLabel: pet.name }).where(eq(schAppointments.id, appointmentId));
      await this.audit.log(tx, { action: 'petshop.appointment_pet', entity: 'appointment', entityId: appointmentId, data: { petId } });
      return { id: pet.id, name: pet.name };
    });
  }

  private async appointmentOrFail(tx: Tx, id: string) {
    const [row] = await tx.select().from(schAppointments).where(eq(schAppointments.id, id));
    if (!row) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Horário não encontrado' });
    return row;
  }

  /** Atendimento de um pet concluído: avisa o tutor que pode buscar. */
  private onStatusChanged(e: AppointmentStatusChanged) {
    if (e.status !== 'done' || e.subjectType !== 'pet' || !e.subjectId) return Promise.resolve();
    return this.tdb.run(async (tx) => {
      if (!(await isActive(tx, MODULE))) return;
      const settings = await this.settings.getInTx<PetshopSettings>(tx, MODULE);
      if (!settings.notifyReady) return;
      const [pet] = await tx.select({ name: pets.name }).from(pets).where(eq(pets.id, e.subjectId!));
      const services = await tx
        .select({ name: schAppointmentServices.name })
        .from(schAppointmentServices)
        .where(eq(schAppointmentServices.appointmentId, e.appointmentId));
      await this.notifications.enqueueInTx(tx, {
        templateKey: 'petshop.ready',
        customerId: e.customerId,
        related: { entity: 'appointment', id: e.appointmentId },
        data: { pet: { nome: pet?.name ?? e.subjectLabel ?? 'Seu pet' }, agendamento: { id: e.appointmentId, servicos: services.map((s) => s.name).join(', ') } },
      });
    });
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: schServices.id }).from(schServices).where(eq(schServices.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(schServices).values(PETSHOP_SERVICES.map((s) => ({ ...s, tenantId })));
    const [anyProduct] = await tx.select({ id: salesProducts.id }).from(salesProducts).where(eq(salesProducts.tenantId, tenantId)).limit(1);
    if (!anyProduct) await tx.insert(salesProducts).values(PETSHOP_PRODUCTS.map((p) => ({ ...p, tenantId })));
  }
}

async function isActive(tx: Tx, key: string) {
  const [row] = await tx
    .select({ status: coreSchema.tenantModules.status })
    .from(coreSchema.tenantModules)
    .where(and(eq(coreSchema.tenantModules.moduleKey, key), eq(coreSchema.tenantModules.status, 'active')));
  return !!row;
}

const rangeQuery = z.object({ from: z.coerce.date(), to: z.coerce.date() });
const petBody = z.object({ petId: z.string().uuid('Escolha o pet') });

@Controller('petshop')
@ModuleRoute(MODULE)
export class PetshopController {
  constructor(private readonly petshop: PetshopService) {}

  @Get('pickups')
  @RequirePermission('shared.scheduling.read')
  pickups(@Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.petshop.pickups(q.from, q.to);
  }

  @Post('appointments/:id/pickup')
  @RequirePermission('shared.scheduling.status')
  pickup(@Param('id', ParseUUIDPipe) id: string) {
    return this.petshop.registerPickup(id);
  }

  @Delete('appointments/:id/pickup')
  @HttpCode(204)
  @RequirePermission('shared.scheduling.status')
  undoPickup(@Param('id', ParseUUIDPipe) id: string) {
    return this.petshop.undoPickup(id);
  }

  @Post('appointments/:id/pet')
  @HttpCode(200)
  @RequireAnyPermission('shared.scheduling.write', 'shared.scheduling.status')
  setPet(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(petBody)) body: z.infer<typeof petBody>) {
    return this.petshop.setPet(id, body.petId);
  }
}

@Module({ imports: [NotificationsModule], controllers: [PetshopController], providers: [PetshopService] })
export class PetshopModule {}
