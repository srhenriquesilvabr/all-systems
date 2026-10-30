import { AuditService, FinanceService, ModuleHooks, TenantDb, toCents, ZodPipe } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { ModuleRoute, requestContext, RequirePermission } from '@all/module-sdk';
import { NotificationsModule } from '@all/notifications';
import { RegistersService, SalesModule, SalesService, type SalePaymentMethod } from '@all/sales';
import { salesProducts } from '@all/sales/schema';
import { ServiceOrdersModule, ServiceOrdersService, ServiceOrderWorkflows } from '@all/service-orders';
import { soItems, soOrders } from '@all/service-orders/schema';
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  BAKERY_WORKFLOW,
  bakeryOrderInput,
  bakeryOrderUpdate,
  bakeryPaymentInput,
  bakeryWorkflow,
  foldText,
  type BakeryOrder,
  type BakeryOrderInput,
  type BakeryOrderUpdate,
  type BakeryPaymentInput,
  type ProductionPlan,
} from '../contracts';
import { bakeryItemDetails } from '../db/schema';

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
const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
/** Formas do caixa: transferência é conferida como "Outro". */
const registerMethod = (method: BakeryPaymentInput['method']): SalePaymentMethod => (method === 'transfer' ? 'other' : method);
/** Data (YYYY-MM-DD) no fuso de São Paulo. */
const spDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

/** Entre grafias do mesmo item sob medida, mostra a mais cuidada: com acento e sem tudo em maiúsculas. */
const spellingScore = (text: string) => (text !== text.toUpperCase() ? 100 : 0) + (text.match(/[^\x00-\x7f]/g)?.length ?? 0);

@Injectable()
export class BakeryService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly hooks: ModuleHooks,
    private readonly workflows: ServiceOrderWorkflows,
    private readonly orders: ServiceOrdersService,
    private readonly sales: SalesService,
    private readonly registers: RegistersService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.workflows.register({
      ...bakeryWorkflow,
      // Item ligado a produto baixa o estoque quando sai da loja: até lá, a encomenda pode ser cancelada.
      afterTransition: async ({ tx, orderId, number, to, at }) => {
        if (to === 'delivered') await this.moveStockInTx(tx as Tx, orderId, number, at);
      },
      // Inscrição e baixa de estoque ficam presas ao item: refazer a lista perderia as duas.
      beforeUpdate: ({ input }) => {
        if (input.items) throw badRequest('ITEMS_MANAGED', 'Os itens da encomenda não mudam depois de registrada: cancele e registre outra');
      },
    });
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
  }

  /** Encomenda: itens do catálogo (com o preço do cadastro como sugestão) ou sob medida. */
  createOrder(input: BakeryOrderInput) {
    return this.tdb.run(async (tx) => {
      // Encomenda nova não tem retirada no passado; ao registrar uma antiga, a retirada só não pode ser antes do pedido.
      const receivedAt = input.receivedAt ?? new Date();
      if (spDate(receivedAt) < spDate(new Date())) {
        if (spDate(input.dueAt) < spDate(receivedAt)) throw new BadRequestException({ code: 'DUE_BEFORE_RECEIVED', message: 'A retirada não pode ser antes da data do pedido' });
      } else if (input.dueAt.getTime() < Date.now() - 60 * 60_000) {
        throw new BadRequestException({ code: 'DUE_IN_PAST', message: 'A retirada não pode ser no passado' });
      }
      const ids = input.items.map((i) => i.productId).filter((id): id is string => !!id);
      const found = ids.length ? await tx.select({ id: salesProducts.id }).from(salesProducts).where(inArray(salesProducts.id, ids)) : [];
      if (found.length !== new Set(ids).size) throw new BadRequestException({ code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado' });
      const order = await this.orders.createInTx(tx, {
        customerId: input.customerId,
        workflow: BAKERY_WORKFLOW,
        channel: 'counter',
        items: input.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, refType: i.productId ? 'sales_product' : null, refId: i.productId ?? null })),
        discount: input.discount,
        dueAt: input.dueAt,
        receivedAt,
        notesCustomer: input.notesCustomer ?? null,
        notesInternal: input.notesInternal ?? null,
      });
      const { tenantId } = requestContext.requireTenant();
      const inscribed = order.items.flatMap((item, i) => (input.items[i]?.inscription ? [{ itemId: item.id, tenantId, orderId: order.id, inscription: input.items[i]!.inscription! }] : []));
      if (inscribed.length) await tx.insert(bakeryItemDetails).values(inscribed);
      return order;
    });
  }

  get(id: string): Promise<BakeryOrder> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  /**
   * Retirada, observações e escrita. A retirada não vai para o passado, a não ser que a encomenda já
   * esteja atrasada e continue no mesmo dia; não muda depois de encerrada (regra da ordem).
   */
  update(id: string, input: BakeryOrderUpdate): Promise<BakeryOrder> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const current = await this.detailInTx(tx, id);
      if (input.dueAt && input.dueAt.getTime() < Date.now() - 60 * 60_000 && spDate(input.dueAt) !== (current.order.dueAt && spDate(new Date(current.order.dueAt)))) {
        throw badRequest('DUE_IN_PAST', 'A retirada não pode ser no passado');
      }
      await this.orders.updateInTx(tx, id, { dueAt: input.dueAt, notesCustomer: input.notesCustomer, notesInternal: input.notesInternal });
      const known = new Set(current.items.map((i) => i.id));
      for (const { itemId, inscription } of input.inscriptions ?? []) {
        if (!known.has(itemId)) throw badRequest('ITEM_NOT_FOUND', 'Item não encontrado nesta encomenda');
        await tx
          .insert(bakeryItemDetails)
          .values({ itemId, tenantId, orderId: id, inscription })
          .onConflictDoUpdate({ target: bakeryItemDetails.itemId, set: { inscription } });
      }
      await this.audit.log(tx, { action: 'bakery.order.updated', entity: 'service_order', entityId: id, data: { dueAt: input.dueAt?.toISOString(), inscriptions: input.inscriptions?.length ?? 0 } });
      return this.detailInTx(tx, id);
    });
  }

  /**
   * Pagamento da encomenda (sinal ou restante). Um lançamento só no financeiro; com o caixa informado,
   * o valor entra também na conferência da sessão aberta, sem novo lançamento (mesma regra do PDV:
   * a de hoje com o caixa fechado é recusada).
   */
  pay(id: string, input: BakeryPaymentInput): Promise<BakeryOrder> {
    return this.tdb.run(async (tx) => {
      await this.detailInTx(tx, id);
      const today = spDate(new Date());
      if (input.paidAt > today) throw badRequest('INVALID_DATE', 'A data do pagamento não pode ser no futuro');
      const occurredAt = input.paidAt === today ? new Date() : new Date(`${input.paidAt}T23:59:00-03:00`);
      const sessionId = input.registerId ? await this.registers.sessionForSaleInTx(tx, { registerId: input.registerId, required: false, soldAt: occurredAt }) : null;
      if (input.registerId && !sessionId) throw badRequest('REGISTER_CLOSED', 'Este caixa não estava aberto nesse dia: tire a opção de entrar no caixa ou abra o caixa');
      // O dinheiro que entra na gaveta está na conta Caixa, como nas vendas.
      const accountId = (sessionId && input.method === 'cash' ? null : input.accountId) ?? (await this.finance.defaultAccountId(tx));
      if (!accountId) throw badRequest('ACCOUNT_REQUIRED', 'Escolha a conta do financeiro');
      const { order, paymentId } = await this.orders.addPaymentInTx(tx, id, { amount: input.amount, method: input.method, accountId, paidAt: input.paidAt });
      if (sessionId) {
        await this.registers.addServiceReceiptInTx(tx, {
          sessionId,
          method: registerMethod(input.method),
          amountCents: toCents(input.amount),
          reason: `Encomenda nº ${order.number}`,
          occurredAt,
          sourceType: 'so_payment',
          sourceId: paymentId,
        });
      }
      return this.detailInTx(tx, id);
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
      const details = items.length ? await tx.select().from(bakeryItemDetails).where(inArray(bakeryItemDetails.itemId, items.map((i) => i.id))) : [];
      const inscriptionOf = new Map(details.map((d) => [d.itemId, d.inscription]));
      const totals = await this.productionTotals(tx, items, new Set(orders.filter((o) => o.o.status !== 'ready').map((o) => o.o.id)));
      return {
        date,
        orders: orders.map(({ o, customer }) => ({
          id: o.id,
          number: o.number,
          status: o.status,
          customer,
          dueAt: o.dueAt!.toISOString(),
          items: items.filter((i) => i.orderId === o.id).map((i) => ({ description: i.description, quantity: Number(i.quantity), inscription: inscriptionOf.get(i.id) ?? null })),
          notes: o.notesInternal,
        })),
        totals,
      };
    });
  }

  /**
   * Soma do que falta fazer (sem as encomendas prontas). Item do catálogo soma pelo produto, mesmo
   * com a descrição mudada; sob medida, pelo texto sem diferenciar acento e maiúscula; e o sob medida
   * com o nome de um produto da lista entra na linha dele.
   */
  private async productionTotals(tx: Tx, items: (typeof soItems.$inferSelect)[], pendingOrders: Set<string>) {
    const pending = items.filter((i) => pendingOrders.has(i.orderId));
    const productIds = [...new Set(pending.filter((i) => i.refType === 'sales_product' && i.refId).map((i) => i.refId!))];
    const products = productIds.length ? await tx.select({ id: salesProducts.id, name: salesProducts.name }).from(salesProducts).where(inArray(salesProducts.id, productIds)) : [];
    const productName = new Map(products.map((p) => [p.id, p.name]));
    const byFoldedName = new Map(products.map((p) => [foldText(p.name), p.id]));
    const lines = new Map<string, { description: string; quantity: number }>();
    for (const i of pending) {
      const productId = i.refType === 'sales_product' && i.refId && productName.has(i.refId) ? i.refId : byFoldedName.get(foldText(i.description));
      const key = productId ? `p:${productId}` : `t:${foldText(i.description)}`;
      const line = lines.get(key) ?? { description: productId ? productName.get(productId)! : i.description, quantity: 0 };
      if (!productId && spellingScore(i.description) > spellingScore(line.description)) line.description = i.description;
      line.quantity = Math.round((line.quantity + Number(i.quantity)) * 1000) / 1000;
      lines.set(key, line);
    }
    return [...lines.values()].sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
  }

  /**
   * Baixa o estoque dos itens ligados a produto, uma vez por item: a marca em bakery_item_details só é
   * gravada por quem chega primeiro. Não bloqueia saldo negativo: a encomenda já está saindo da loja.
   */
  private async moveStockInTx(tx: Tx, orderId: string, number: number, at: Date) {
    const { tenantId } = requestContext.requireTenant();
    const items = await tx
      .select()
      .from(soItems)
      .where(and(eq(soItems.orderId, orderId), eq(soItems.refType, 'sales_product')))
      .orderBy(asc(soItems.refId));
    for (const item of items) {
      const [claimed] = await tx
        .insert(bakeryItemDetails)
        .values({ itemId: item.id, tenantId, orderId, stockMovedAt: at })
        .onConflictDoUpdate({ target: bakeryItemDetails.itemId, set: { stockMovedAt: at }, setWhere: isNull(bakeryItemDetails.stockMovedAt) })
        .returning({ itemId: bakeryItemDetails.itemId });
      if (claimed && item.refId) await this.sales.consumeInTx(tx, item.refId, Number(item.quantity), { kind: 'order', reason: `Encomenda nº ${number}`, occurredAt: at });
    }
  }

  private async detailInTx(tx: Tx, id: string): Promise<BakeryOrder> {
    const order = await this.orders.detail(tx, id);
    if (order.workflow !== BAKERY_WORKFLOW) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Encomenda não encontrada' });
    const [items, details] = await Promise.all([
      tx.select({ id: soItems.id, refType: soItems.refType, refId: soItems.refId }).from(soItems).where(eq(soItems.orderId, id)),
      tx.select().from(bakeryItemDetails).where(eq(bakeryItemDetails.orderId, id)),
    ]);
    const detailOf = new Map(details.map((d) => [d.itemId, d]));
    return {
      order,
      items: order.items.map((i) => {
        const row = items.find((x) => x.id === i.id);
        const d = detailOf.get(i.id);
        return { id: i.id, inscription: d?.inscription ?? null, productId: row?.refType === 'sales_product' ? row.refId : null, stockMovedAt: d?.stockMovedAt?.toISOString() ?? null };
      }),
    };
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

  @Get('orders/:id')
  @RequirePermission('shared.service-orders.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.bakery.get(id);
  }

  @Patch('orders/:id')
  @RequirePermission('shared.service-orders.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(bakeryOrderUpdate)) body: BakeryOrderUpdate) {
    return this.bakery.update(id, body);
  }

  /** Sinal ou restante; com o caixa informado, entra também na conferência dele (sem duplicar o financeiro). */
  @Post('orders/:id/payments')
  @RequirePermission('shared.service-orders.payments')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(bakeryPaymentInput)) body: BakeryPaymentInput) {
    return this.bakery.pay(id, body);
  }

  @Get('production')
  @RequirePermission('shared.service-orders.read')
  production(@Query(new ZodPipe(dateQuery)) q: { date: string }) {
    return this.bakery.production(q.date);
  }
}

@Module({ imports: [ServiceOrdersModule, NotificationsModule, SalesModule], controllers: [BakeryController], providers: [BakeryService] })
export class BakeryModule {}
