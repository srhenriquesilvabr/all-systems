import { ModuleHooks, TenantDb, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import { NotificationsModule } from '@all/notifications';
import { salesProducts } from '@all/sales/schema';
import { ServiceOrdersModule, ServiceOrdersService, ServiceOrderWorkflows } from '@all/service-orders';
import { soItems, soOrders } from '@all/service-orders/schema';
import { BadRequestException, Body, Controller, Get, Injectable, Module, OnModuleInit, Post, Query } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BAKERY_WORKFLOW, bakeryOrderInput, bakeryWorkflow, type BakeryOrderInput, type ProductionPlan } from '../contracts';

const MODULE = 'bakery';

/** Catálogo inicial: pães e frios por quilo (balança), o resto por unidade. */
const PRODUCTS = [
  { name: 'Pão francês', category: 'Pães', unit: 'kg', price: '16.90', trackStock: false },
  { name: 'Pão de queijo', category: 'Pães', unit: 'kg', price: '49.90', trackStock: false },
  { name: 'Pão de forma caseiro', category: 'Pães', unit: 'un', price: '12.90', trackStock: false },
  { name: 'Sonho', category: 'Doces', unit: 'un', price: '6.50', trackStock: false },
  { name: 'Bolo de cenoura com chocolate (fatia)', category: 'Doces', unit: 'un', price: '9.00', trackStock: false },
  { name: 'Coxinha', category: 'Salgados', unit: 'un', price: '7.50', trackStock: false },
  { name: 'Café expresso', category: 'Cafeteria', unit: 'un', price: '5.50', trackStock: false },
  { name: 'Pingado', category: 'Cafeteria', unit: 'un', price: '6.50', trackStock: false },
  { name: 'Presunto fatiado', category: 'Frios', unit: 'kg', price: '49.90', trackStock: true },
  { name: 'Queijo muçarela fatiado', category: 'Frios', unit: 'kg', price: '54.90', trackStock: true },
  { name: 'Leite integral 1 L', category: 'Mercearia', unit: 'un', price: '5.49', trackStock: true },
  { name: 'Refrigerante lata 350 ml', category: 'Bebidas', unit: 'un', price: '5.50', trackStock: true },
] as const;

const dayStart = (date: string) => sql`(${date}::date)::timestamp at time zone 'America/Sao_Paulo'`;
const dayEnd = (date: string) => sql`((${date}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;

@Injectable()
export class BakeryService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly workflows: ServiceOrderWorkflows,
    private readonly orders: ServiceOrdersService,
  ) {}

  onModuleInit() {
    this.workflows.register(bakeryWorkflow);
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
  }

  /** Encomenda: itens do catálogo (com o preço do cadastro como sugestão) ou sob medida. */
  createOrder(input: BakeryOrderInput) {
    return this.tdb.run(async (tx) => {
      if (input.dueAt.getTime() < Date.now() - 60 * 60_000) throw new BadRequestException({ code: 'DUE_IN_PAST', message: 'A retirada não pode ser no passado' });
      const ids = input.items.map((i) => i.productId).filter((id): id is string => !!id);
      const found = ids.length ? await tx.select({ id: salesProducts.id }).from(salesProducts).where(inArray(salesProducts.id, ids)) : [];
      if (found.length !== new Set(ids).size) throw new BadRequestException({ code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado' });
      return this.orders.createInTx(tx, {
        customerId: input.customerId,
        workflow: BAKERY_WORKFLOW,
        channel: 'counter',
        items: input.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, refType: i.productId ? 'sales_product' : null, refId: i.productId ?? null })),
        discount: input.discount,
        dueAt: input.dueAt,
        notesCustomer: input.notesCustomer ?? null,
        notesInternal: input.notesInternal ?? null,
      });
    });
  }

  /** Encomendas com retirada no dia (ainda não retiradas nem canceladas) e o total de cada item a produzir. */
  production(date: string): Promise<ProductionPlan> {
    return this.tdb.run(async (tx) => {
      const orders = await tx
        .select({ o: soOrders, customer: customers.name })
        .from(soOrders)
        .innerJoin(customers, eq(customers.id, soOrders.customerId))
        .where(
          and(
            eq(soOrders.workflow, BAKERY_WORKFLOW),
            notInArray(soOrders.status, ['delivered', 'cancelled']),
            gte(soOrders.dueAt, dayStart(date)),
            lt(soOrders.dueAt, dayEnd(date)),
          ),
        )
        .orderBy(asc(soOrders.dueAt));
      const items = orders.length
        ? await tx
            .select()
            .from(soItems)
            .where(inArray(soItems.orderId, orders.map((o) => o.o.id)))
            .orderBy(asc(soItems.position))
        : [];
      const totals = new Map<string, number>();
      for (const i of items) totals.set(i.description, (totals.get(i.description) ?? 0) + Number(i.quantity));
      return {
        date,
        orders: orders.map(({ o, customer }) => ({
          id: o.id,
          number: o.number,
          status: o.status,
          customer,
          dueAt: o.dueAt!.toISOString(),
          items: items.filter((i) => i.orderId === o.id).map((i) => ({ description: i.description, quantity: Number(i.quantity) })),
          notes: o.notesInternal,
        })),
        totals: [...totals].map(([description, quantity]) => ({ description, quantity })).sort((a, b) => a.description.localeCompare(b.description, 'pt-BR')),
      };
    });
  }

  private async seed(tx: Tx, tenantId: string) {
    const [any] = await tx.select({ id: salesProducts.id }).from(salesProducts).where(eq(salesProducts.tenantId, tenantId)).limit(1);
    if (!any) await tx.insert(salesProducts).values(PRODUCTS.map((p) => ({ ...p, tenantId })));
  }
}

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

@Controller('bakery')
@ModuleRoute('bakery')
export class BakeryController {
  constructor(private readonly bakery: BakeryService) {}

  @Post('orders')
  @RequirePermission('shared.service-orders.write')
  create(@Body(new ZodPipe(bakeryOrderInput)) body: BakeryOrderInput) {
    return this.bakery.createOrder(body);
  }

  @Get('production')
  @RequirePermission('shared.service-orders.read')
  production(@Query(new ZodPipe(dateQuery)) q: { date: string }) {
    return this.bakery.production(q.date);
  }
}

@Module({ imports: [ServiceOrdersModule, NotificationsModule], controllers: [BakeryController], providers: [BakeryService] })
export class BakeryModule {}
