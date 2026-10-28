import { AuditService, TenantDb } from '@all/core';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { isSimples, normalizeIcmsSituation, type ProductCode, type ProductCodeInput, type ServiceCode, type ServiceCodeInput } from '../contracts';
import { fiscalProductCodes, fiscalServiceCodes } from '../db/schema';
import { FiscalContext } from './context.service';

const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));
const num = (v: string | null) => (v === null ? null : Number(v));

/** Cadastro fiscal de produtos e serviços (tabelas próprias; os cadastros de vendas e agenda não mudam). */
@Injectable()
export class FiscalCodesService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly ctx: FiscalContext,
    private readonly audit: AuditService,
  ) {}

  listProducts(): Promise<ProductCode[]> {
    return this.tdb.run(async (tx) => (await tx.select().from(fiscalProductCodes).orderBy(asc(fiscalProductCodes.productName))).map(toProduct));
  }

  /** Cria ou atualiza pelo produto (a planilha usa a mesma rota). */
  saveProduct(input: ProductCodeInput): Promise<ProductCode> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const s = await this.ctx.settingsInTx(tx);
      const icmsSituation = normalizeIcmsSituation(input.icmsSituation, s.taxRegime);
      if (!icmsSituation) {
        throw new BadRequestException({
          code: 'VALIDATION',
          message: [isSimples(s.taxRegime) ? 'icmsSituation: no Simples Nacional informe o CSOSN (101, 102, 103, 201, 202, 203, 300, 400, 500 ou 900)' : 'icmsSituation: informe o CST do ICMS (00, 10, 20, 30, 40, 41, 50, 51, 60, 70 ou 90)'],
        });
      }
      const values = {
        productName: input.productName,
        ncm: input.ncm,
        cfop: input.cfop,
        cest: input.cest,
        origin: input.origin,
        icmsSituation,
        icmsRate: pct(input.icmsRate),
        pisCofinsCst: input.pisCofinsCst,
        pisRate: pct(input.pisRate),
        cofinsRate: pct(input.cofinsRate),
        taxUnit: input.taxUnit,
        ibsCbsCst: input.ibsCbsCst,
        classTrib: input.classTrib,
      };
      const [row] = await tx
        .insert(fiscalProductCodes)
        .values({ tenantId, productId: input.productId, ...values })
        .onConflictDoUpdate({ target: [fiscalProductCodes.tenantId, fiscalProductCodes.productId], set: values })
        .returning();
      await this.audit.log(tx, { action: 'fiscal.codes.product_saved', entity: 'fiscal_product_code', entityId: row!.id, data: { productId: input.productId, ncm: input.ncm, cfop: input.cfop, icmsSituation } });
      return toProduct(row!);
    });
  }

  removeProduct(productId: string) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx.delete(fiscalProductCodes).where(eq(fiscalProductCodes.productId, productId)).returning();
      if (!row) throw new NotFoundException({ code: 'CODE_NOT_FOUND', message: 'Produto sem cadastro fiscal' });
      await this.audit.log(tx, { action: 'fiscal.codes.product_removed', entity: 'fiscal_product_code', entityId: row.id, data: { productId } });
    });
  }

  /**
   * Produtos e serviços que já apareceram em vendas/atendimentos e ainda não têm cadastro fiscal.
   * Vem das cópias guardadas nas origens: quem fatura não precisa de acesso ao cadastro de produtos.
   */
  pendingItems(): Promise<{ products: { id: string; name: string; unit: string }[]; services: { refType: string; id: string; name: string }[] }> {
    return this.tdb.run(async (tx) => {
      const products = await tx.execute<{ id: string; name: string; unit: string }>(sql`
        select distinct on (item->>'productId') item->>'productId' as id, item->>'name' as name, coalesce(item->>'unit', 'un') as unit
        from fiscal_sources s, jsonb_array_elements(s.payload->'items') item
        where s.source_type = 'sale' and item->>'productId' is not null
          and not exists (select 1 from fiscal_product_codes c where c.product_id::text = item->>'productId')
        order by item->>'productId', s.occurred_at desc
        limit 500`);
      const services = await tx.execute<{ id: string; name: string }>(sql`
        select distinct on (svc->>'serviceId') svc->>'serviceId' as id, svc->>'name' as name
        from fiscal_sources s, jsonb_array_elements(s.payload->'services') svc
        where s.source_type = 'appointment' and svc->>'serviceId' is not null
          and not exists (select 1 from fiscal_service_codes c where c.ref_type = 'sch_service' and c.ref_id = svc->>'serviceId')
        order by svc->>'serviceId', s.occurred_at desc
        limit 500`);
      const orderItems = await tx.execute<{ ref_type: string; id: string; name: string }>(sql`
        select distinct on (item->>'refType', item->>'refId') item->>'refType' as ref_type, item->>'refId' as id, item->>'description' as name
        from fiscal_sources s, jsonb_array_elements(s.payload->'items') item
        where s.source_type = 'service_order' and item->>'refId' is not null and item->>'refType' is not null
          and not exists (select 1 from fiscal_service_codes c where c.ref_type = item->>'refType' and c.ref_id = item->>'refId')
        order by item->>'refType', item->>'refId', s.occurred_at desc
        limit 500`);
      return {
        products: products.rows,
        services: [...services.rows.map((r) => ({ refType: 'sch_service', id: r.id, name: r.name })), ...orderItems.rows.map((r) => ({ refType: r.ref_type, id: r.id, name: r.name }))],
      };
    });
  }

  listServices(): Promise<ServiceCode[]> {
    return this.tdb.run(async (tx) => (await tx.select().from(fiscalServiceCodes).orderBy(asc(fiscalServiceCodes.serviceName))).map(toService));
  }

  saveService(input: ServiceCodeInput): Promise<ServiceCode> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const values = {
        serviceName: input.serviceName,
        lc116: input.lc116,
        nationalCode: input.nationalCode,
        nbs: input.nbs,
        municipalCode: input.municipalCode,
        issRate: input.issRate.toFixed(2),
        issWithheld: input.issWithheld,
        cnae: input.cnae,
        ibsCbsCst: input.ibsCbsCst,
        classTrib: input.classTrib,
      };
      const [row] = await tx
        .insert(fiscalServiceCodes)
        .values({ tenantId, refType: input.refType, refId: input.refId, ...values })
        .onConflictDoUpdate({ target: [fiscalServiceCodes.tenantId, fiscalServiceCodes.refType, fiscalServiceCodes.refId], set: values })
        .returning();
      await this.audit.log(tx, { action: 'fiscal.codes.service_saved', entity: 'fiscal_service_code', entityId: row!.id, data: { refType: input.refType, refId: input.refId, lc116: input.lc116, issRate: input.issRate } });
      return toService(row!);
    });
  }

  removeService(refType: string, refId: string) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .delete(fiscalServiceCodes)
        .where(and(eq(fiscalServiceCodes.refType, refType), eq(fiscalServiceCodes.refId, refId)))
        .returning();
      if (!row) throw new NotFoundException({ code: 'CODE_NOT_FOUND', message: 'Serviço sem cadastro fiscal' });
      await this.audit.log(tx, { action: 'fiscal.codes.service_removed', entity: 'fiscal_service_code', entityId: row.id, data: { refType, refId } });
    });
  }
}

const toProduct = (r: typeof fiscalProductCodes.$inferSelect): ProductCode => ({
  id: r.id,
  productId: r.productId,
  productName: r.productName,
  ncm: r.ncm,
  cfop: r.cfop,
  cest: r.cest,
  origin: r.origin,
  icmsSituation: r.icmsSituation,
  icmsRate: num(r.icmsRate),
  pisCofinsCst: r.pisCofinsCst,
  pisRate: num(r.pisRate),
  cofinsRate: num(r.cofinsRate),
  taxUnit: r.taxUnit,
  ibsCbsCst: r.ibsCbsCst,
  classTrib: r.classTrib,
  updatedAt: r.updatedAt.toISOString(),
});

const toService = (r: typeof fiscalServiceCodes.$inferSelect): ServiceCode => ({
  id: r.id,
  refType: r.refType,
  refId: r.refId,
  serviceName: r.serviceName,
  lc116: r.lc116,
  nationalCode: r.nationalCode,
  nbs: r.nbs,
  municipalCode: r.municipalCode,
  issRate: Number(r.issRate),
  issWithheld: r.issWithheld,
  cnae: r.cnae,
  ibsCbsCst: r.ibsCbsCst,
  classTrib: r.classTrib,
  updatedAt: r.updatedAt.toISOString(),
});
