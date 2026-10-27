import { AuditService, centsToDecimal, ModuleHooks, TenantDb, toCents } from '@all/core';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { GarmentType } from '../contracts';
import { laundryGarmentTypes, laundryServicePrices, laundryServices } from '../db/schema';

const DEFAULT_GARMENTS = [
  'Camisa', 'Camiseta', 'Calça', 'Bermuda', 'Saia', 'Vestido', 'Blusa', 'Paletó', 'Terno',
  'Casaco', 'Jaqueta', 'Edredom', 'Cobertor', 'Lençol', 'Toalha', 'Cortina', 'Tapete',
];

const DEFAULT_SERVICES = [
  { name: 'Lavar e passar', pricingUnit: 'piece' as const, basePrice: '14.90', turnaroundHours: 48 },
  { name: 'Só passar', pricingUnit: 'piece' as const, basePrice: '8.90', turnaroundHours: 24 },
  { name: 'Lavagem a seco', pricingUnit: 'piece' as const, basePrice: '29.90', turnaroundHours: 72 },
  { name: 'Lavagem por quilo', pricingUnit: 'kg' as const, basePrice: '19.90', turnaroundHours: 48 },
];

@Injectable()
export class LaundryCatalogService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
    private readonly hooks: ModuleHooks,
  ) {}

  onModuleInit() {
    this.hooks.register('laundry', { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
  }

  listGarmentTypes(): Promise<GarmentType[]> {
    return this.tdb.run((tx) =>
      tx
        .select({ id: laundryGarmentTypes.id, name: laundryGarmentTypes.name, active: laundryGarmentTypes.active })
        .from(laundryGarmentTypes)
        .orderBy(asc(laundryGarmentTypes.name)),
    );
  }

  createGarmentType(name: string) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [row] = await tx.insert(laundryGarmentTypes).values({ tenantId, name }).onConflictDoNothing().returning();
      if (!row) throw new ConflictException({ code: 'GARMENT_EXISTS', message: 'Este tipo de peça já existe' });
      await this.audit.log(tx, { action: 'laundry.garment.created', entity: 'laundry_garment_type', entityId: row.id, data: { name } });
      return row;
    });
  }

  updateGarmentType(id: string, input: { name?: string; active?: boolean }) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx.update(laundryGarmentTypes).set(input).where(eq(laundryGarmentTypes.id, id)).returning();
      if (!row) throw new NotFoundException({ code: 'GARMENT_NOT_FOUND', message: 'Tipo de peça não encontrado' });
      await this.audit.log(tx, { action: 'laundry.garment.updated', entity: 'laundry_garment_type', entityId: id, data: input });
      return row;
    });
  }

  /** Preços do serviço por tipo de peça. Sem preço próprio, vale o preço base do serviço. */
  prices(serviceId: string) {
    return this.tdb.run(async (tx) => {
      await this.serviceOrFail(tx, serviceId);
      const rows = await tx.select().from(laundryServicePrices).where(eq(laundryServicePrices.serviceId, serviceId));
      return rows.map((r) => ({ garmentTypeId: r.garmentTypeId, price: Number(r.price) }));
    });
  }

  setPrices(serviceId: string, prices: { garmentTypeId: string; price: number }[]) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      await this.serviceOrFail(tx, serviceId);
      const garmentIds = [...new Set(prices.map((p) => p.garmentTypeId))];
      if (garmentIds.length) {
        const found = await tx.select({ id: laundryGarmentTypes.id }).from(laundryGarmentTypes).where(inArray(laundryGarmentTypes.id, garmentIds));
        if (found.length !== garmentIds.length) throw new NotFoundException({ code: 'GARMENT_NOT_FOUND', message: 'Tipo de peça não encontrado' });
      }
      await tx.delete(laundryServicePrices).where(eq(laundryServicePrices.serviceId, serviceId));
      if (prices.length) {
        await tx
          .insert(laundryServicePrices)
          .values(prices.map((p) => ({ tenantId, serviceId, garmentTypeId: p.garmentTypeId, price: centsToDecimal(toCents(p.price)) })));
      }
      await this.audit.log(tx, { action: 'laundry.prices.updated', entity: 'laundry_service', entityId: serviceId, data: { count: prices.length } });
    });
  }

  /** Preço unitário (em centavos) de um serviço para um tipo de peça. */
  async unitPriceCents(tx: Tx, service: typeof laundryServices.$inferSelect, garmentTypeId?: string | null): Promise<number> {
    if (garmentTypeId) {
      const [row] = await tx
        .select({ price: laundryServicePrices.price })
        .from(laundryServicePrices)
        .where(and(eq(laundryServicePrices.serviceId, service.id), eq(laundryServicePrices.garmentTypeId, garmentTypeId)));
      if (row) return toCents(row.price);
    }
    return toCents(service.basePrice);
  }

  private async serviceOrFail(tx: Tx, id: string) {
    const [service] = await tx.select().from(laundryServices).where(eq(laundryServices.id, id));
    if (!service) throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Serviço não encontrado' });
    return service;
  }

  /** Tipos de peça e serviços iniciais, só se o tenant ainda não tiver nenhum (idempotente). */
  private async seed(tx: Tx, tenantId: string) {
    const [garment] = await tx.select({ id: laundryGarmentTypes.id }).from(laundryGarmentTypes).where(eq(laundryGarmentTypes.tenantId, tenantId)).limit(1);
    if (!garment) await tx.insert(laundryGarmentTypes).values(DEFAULT_GARMENTS.map((name) => ({ tenantId, name })));

    const [service] = await tx.select({ id: laundryServices.id }).from(laundryServices).where(eq(laundryServices.tenantId, tenantId)).limit(1);
    if (!service) await tx.insert(laundryServices).values(DEFAULT_SERVICES.map((s) => ({ ...s, tenantId })));
  }
}
