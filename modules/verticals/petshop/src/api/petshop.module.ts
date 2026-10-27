import { ModuleHooks, ModuleSettingsService, OutboxHandlers, TenantDb, coreSchema } from '@all/core';
import type { Tx } from '@all/db';
import { NotificationsModule, NotificationsService } from '@all/notifications';
import { STATUS_CHANGED, type AppointmentStatusChanged } from '@all/scheduling';
import { schAppointmentServices, schServices } from '@all/scheduling/schema';
import { pets } from '@all/pets/schema';
import { salesProducts } from '@all/sales/schema';
import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    this.handlers.on<AppointmentStatusChanged>(STATUS_CHANGED, 'petshop.ready', (e) => this.onStatusChanged(e.payload));
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

@Module({ imports: [NotificationsModule], providers: [PetshopService] })
export class PetshopModule {}
