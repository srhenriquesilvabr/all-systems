import { AuditService, TenantDb } from '@all/core';
import { requestContext } from '@all/module-sdk';
import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { LaundryService, ServiceInput } from '../contracts';
import { laundryServices } from '../db/schema';

type Row = typeof laundryServices.$inferSelect;

const toDto = (r: Row): LaundryService => ({
  id: r.id,
  name: r.name,
  pricingUnit: r.pricingUnit,
  basePrice: Number(r.basePrice),
  turnaroundHours: r.turnaroundHours,
  active: r.active,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

@Injectable()
export class LaundryServicesService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.tdb.run(async (tx) =>
      (await tx.select().from(laundryServices).orderBy(asc(laundryServices.name))).map(toDto),
    );
  }

  create(input: ServiceInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .insert(laundryServices)
        .values({ ...input, tenantId, basePrice: input.basePrice.toFixed(2) })
        .returning();
      await this.audit.log(tx, { action: 'laundry.service.created', entity: 'laundry_service', entityId: row!.id, data: input });
      return toDto(row!);
    });
  }

  update(id: string, input: Partial<ServiceInput>) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .update(laundryServices)
        .set({ ...input, basePrice: input.basePrice?.toFixed(2) })
        .where(eq(laundryServices.id, id))
        .returning();
      if (!row) throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Serviço não encontrado' });
      await this.audit.log(tx, { action: 'laundry.service.updated', entity: 'laundry_service', entityId: id, data: input });
      return toDto(row);
    });
  }
}
