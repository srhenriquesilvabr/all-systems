import { AuditService, centsToDecimal, CoreConfig, coreSchema, CustomerDataRegistry, CustomersService, FinanceService, ModuleSettingsService, nextSequence, OutboxService, TenantDb, toCents } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { salesSchema, SalesService, type SalesSettings } from '@all/sales';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  brl,
  deliveryFeeFor,
  effectivePrice,
  formatAddress,
  formatQuantity,
  fractionalUnits,
  lineCents,
  nextStatuses,
  normalizePhone,
  openStatuses,
  orderStatusLabel,
  STORE,
  type AdminOrderInput,
  type ConsentRecord,
  type DeliveryAddress,
  type Fulfillment,
  type Order,
  type OrderStatus,
  type OrderSummary,
  type PaymentMode,
  type SalePaymentMethod,
  type StoreSettings,
} from '../contracts';
import { storeListings, storeOrderEvents, storeOrderItems, storeOrders } from '../db/schema';
import { currentTenant, FINANCE_SOURCE, moduleActive, ORDER_PLACED, ORDER_SEQUENCE, ORDER_STATUS_CHANGED, reservedByProduct, salesProducts, storeUrl, type OrderRow } from './shared';

const NOTIFICATIONS = 'shared.notifications';
const SALES = 'shared.sales';

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });

/** Dados do pedido que vêm da vitrine ou da tela de lançamento. */
export interface PlaceInput {
  name: string;
  phone: string;
  email: string | null;
  fulfillment: Fulfillment;
  address?: DeliveryAddress | null;
  notes?: string | null;
  items: { productId: string; quantity: number }[];
  paymentMode: PaymentMode;
}

interface PlaceOptions {
  source: 'public' | 'admin';
  settings: StoreSettings;
  consent: ConsentRecord | null;
  ipHash: string | null;
  customerId?: string | null;
}

export type ItemRow = typeof storeOrderItems.$inferSelect;

/** Pedidos da loja: criação (vitrine e equipe), fluxo de estados, reserva de estoque e conclusão em venda. */
@Injectable()
export class StoreOrdersService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: ModuleSettingsService,
    private readonly customers: CustomersService,
    private readonly finance: FinanceService,
    private readonly sales: SalesService,
    private readonly notifications: NotificationsService,
    private readonly customerData: CustomerDataRegistry,
    private readonly config: CoreConfig,
  ) {}

  onModuleInit() {
    // LGPD: os pedidos ligados ao cliente entram na exportação e são mascarados na anonimização
    // (valores e itens ficam, como nas vendas).
    this.customerData.register({
      moduleKey: STORE,
      export: (tx, customerId) =>
        tx
          .select({
            numero: storeOrders.number,
            data: storeOrders.createdAt,
            situacao: storeOrders.status,
            nome: storeOrders.customerName,
            telefone: storeOrders.customerPhone,
            email: storeOrders.customerEmail,
            endereco: storeOrders.address,
            total: storeOrders.total,
            consentimento: storeOrders.consent,
          })
          .from(storeOrders)
          .where(eq(storeOrders.customerId, customerId)),
      anonymize: async (tx, customerId) => {
        await tx
          .update(storeOrders)
          .set({ customerName: '[removido a pedido do titular]', customerPhone: null, customerEmail: null, address: null, notes: null })
          .where(eq(storeOrders.customerId, customerId));
      },
    });
  }

  // ---- Consulta -------------------------------------------------------------------------------

  list(q: { status?: OrderStatus | 'open'; q?: string; limit: number }): Promise<OrderSummary[]> {
    return this.tdb.run(async (tx) => {
      const term = q.q?.trim();
      const digits = term?.replace(/\D/g, '') ?? '';
      const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
      const rows = await tx
        .select({ o: storeOrders, itemsCount: sql<number>`(select count(*)::int from store_order_items i where i.order_id = "store_orders"."id")` })
        .from(storeOrders)
        .where(
          and(
            q.status === 'open' ? inArray(storeOrders.status, [...openStatuses]) : q.status ? eq(storeOrders.status, q.status) : undefined,
            like
              ? or(
                  ilike(storeOrders.customerName, like),
                  digits.length >= 4 ? ilike(storeOrders.customerPhone, `%${digits}%`) : undefined,
                  /^\d{1,9}$/.test(term!) ? eq(storeOrders.number, Number(term)) : undefined,
                )
              : undefined,
          ),
        )
        .orderBy(desc(storeOrders.createdAt))
        .limit(q.limit);
      return rows.map(({ o, itemsCount }) => toSummary(o, itemsCount));
    });
  }

  get(id: string): Promise<Order> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  // ---- Criação --------------------------------------------------------------------------------

  /** Pedido lançado pela equipe (telefone, balcão, redes sociais). */
  create(input: AdminOrderInput): Promise<Order> {
    return this.tdb.run(async (tx) => {
      const settings = await this.settings.getInTx<StoreSettings>(tx, STORE);
      if (input.customerId) {
        const customer = await this.customers.findInTx(tx, input.customerId);
        if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
      }
      const { order } = await this.placeInTx(tx, input, { source: 'admin', settings, consent: null, ipHash: null, customerId: input.customerId ?? null });
      return this.detailInTx(tx, order.id);
    });
  }

  /**
   * Grava o pedido com preços e estoque conferidos no servidor (o carrinho do navegador só diz o
   * que e quanto). Na vitrine, só produtos publicados e com estoque disponível entram.
   */
  async placeInTx(tx: Tx, input: PlaceInput, opts: PlaceOptions): Promise<{ order: OrderRow; items: ItemRow[] }> {
    const { tenantId, userId } = requestContext.requireTenant();
    const isPublic = opts.source === 'public';
    const phone = normalizePhone(input.phone);
    if (!phone) throw badRequest('INVALID_PHONE', 'Informe o celular com DDD');
    if (isPublic && input.fulfillment === 'pickup' && !opts.settings.pickup.enabled) throw badRequest('PICKUP_DISABLED', 'Esta loja não está fazendo retirada no local');
    if (isPublic && input.fulfillment === 'delivery' && !opts.settings.delivery.enabled) throw badRequest('DELIVERY_DISABLED', 'Esta loja não está fazendo entregas');
    const address = input.fulfillment === 'delivery' ? (input.address ?? null) : null;
    if (input.fulfillment === 'delivery' && !address) throw badRequest('ADDRESS_REQUIRED', 'Informe o endereço de entrega');

    // Mesmo produto em duas linhas vira uma só.
    const merged = new Map<string, number>();
    for (const item of input.items) merged.set(item.productId, Math.round(((merged.get(item.productId) ?? 0) + item.quantity) * 1000) / 1000);
    const ids = [...merged.keys()];
    const found = await tx
      .select({ p: salesProducts, l: storeListings })
      .from(salesProducts)
      .leftJoin(storeListings, eq(storeListings.productId, salesProducts.id))
      .where(inArray(salesProducts.id, ids));
    const byId = new Map(found.map((r) => [r.p.id, r]));
    const reserved = isPublic ? await reservedByProduct(tx, ids) : new Map<string, number>();

    const lines = ids.map((productId) => {
      const quantity = merged.get(productId)!;
      const row = byId.get(productId);
      if (!row || !row.p.active || (isPublic && !row.l?.visible)) throw badRequest('PRODUCT_UNAVAILABLE', 'Um dos produtos não está mais à venda. Atualize o carrinho.');
      const { p, l } = row;
      const name = l?.title || p.name;
      if (!fractionalUnits.includes(p.unit) && !Number.isInteger(quantity)) throw badRequest('INVALID_QUANTITY', `${name} é vendido em quantidade inteira`);
      if (isPublic && p.trackStock) {
        const available = Number(p.stock) - (reserved.get(p.id) ?? 0);
        if (quantity > available) {
          throw new ConflictException({
            code: 'OUT_OF_STOCK',
            message: available > 0 ? `Só temos ${formatQuantity(available, p.unit)} de ${name}` : `${name} esgotou`,
            productId: p.id,
          });
        }
      }
      const regular = Number(p.price);
      const unitPrice = effectivePrice(regular, { promoPrice: l?.promoPrice == null ? null : Number(l.promoPrice), promoUntil: l?.promoUntil ?? null });
      return { p, name, quantity, unitPrice, regular, cents: lineCents(quantity, unitPrice) };
    });

    const subtotal = lines.reduce((sum, l) => sum + l.cents, 0);
    let fee = 0;
    if (input.fulfillment === 'delivery') {
      const forDistrict = deliveryFeeFor(opts.settings.delivery, address!.district);
      if (forDistrict === null && isPublic) throw badRequest('DISTRICT_NOT_SERVED', 'Ainda não entregamos neste bairro. Escolha a retirada ou fale com a loja.');
      fee = toCents(forDistrict ?? 0);
      if (isPublic && subtotal < toCents(opts.settings.delivery.minOrder)) {
        throw badRequest('MIN_ORDER', `O pedido mínimo para entrega é ${brl(opts.settings.delivery.minOrder)}`);
      }
    }

    const number = await nextSequence(tx, tenantId, ORDER_SEQUENCE);
    const [order] = await tx
      .insert(storeOrders)
      .values({
        tenantId,
        number,
        source: opts.source,
        customerName: input.name,
        customerPhone: phone,
        customerEmail: input.email || null,
        customerId: opts.customerId ?? null,
        fulfillment: input.fulfillment,
        address,
        paymentMode: input.paymentMode,
        subtotal: centsToDecimal(subtotal),
        deliveryFee: centsToDecimal(fee),
        total: centsToDecimal(subtotal + fee),
        notes: input.notes || null,
        consent: opts.consent,
        ipHash: opts.ipHash,
        createdBy: isPublic ? null : (userId ?? null),
      })
      .returning();
    const items = await tx
      .insert(storeOrderItems)
      .values(
        lines.map((l, position) => ({
          tenantId,
          orderId: order!.id,
          productId: l.p.id,
          position,
          name: l.name,
          unit: l.p.unit,
          quantity: l.quantity.toFixed(3),
          unitPrice: centsToDecimal(toCents(l.unitPrice)),
          regularPrice: centsToDecimal(toCents(l.regular)),
          total: centsToDecimal(l.cents),
        })),
      )
      .returning();
    await this.event(tx, order!.id, 'new', isPublic ? 'Pedido recebido pela loja online' : 'Pedido lançado pela equipe', isPublic ? null : undefined);
    await this.outbox.publish(tx, ORDER_PLACED, { orderId: order!.id, number });
    await this.audit.log(tx, { action: 'store.order.placed', entity: 'store_order', entityId: order!.id, data: { number, source: opts.source }, ...(isPublic ? { userId: null } : {}) });
    return { order: order!, items };
  }

  // ---- Fluxo ----------------------------------------------------------------------------------

  /**
   * Confirma / prepara / despacha. Sair de "novo" reserva o estoque: com o bloqueio de venda sem
   * estoque ligado no PDV, recusa o que não há; desligado, confirma e avisa.
   */
  async setStatus(id: string, status: OrderStatus): Promise<Order> {
    const customerId = await this.linkCustomer(id);
    return this.tdb.run(async (tx) => {
      const order = await this.lockOrder(tx, id);
      if (!nextStatuses(order.status, order.fulfillment).includes(status) || status === 'completed') {
        throw badRequest('INVALID_STATUS', `Um pedido "${orderStatusLabel[order.status]}" não pode ir para "${orderStatusLabel[status]}"`);
      }
      const warnings = order.status === 'new' ? await this.reserveInTx(tx, order) : [];
      const now = new Date();
      const [updated] = await tx
        .update(storeOrders)
        .set({ status, customerId: order.customerId ?? customerId, confirmedAt: order.confirmedAt ?? now })
        .where(eq(storeOrders.id, id))
        .returning();
      await this.event(tx, id, status, order.status === 'new' && status !== 'confirmed' ? `${orderStatusLabel[status]} (confirmado e com estoque reservado)` : orderStatusLabel[status]);
      if (order.status === 'new' && updated!.customerId) {
        await this.customers.addTimeline(tx, {
          customerId: updated!.customerId,
          moduleKey: STORE,
          type: 'store.order.confirmed',
          title: `Pedido nº ${order.number} da loja online: ${brl(Number(order.total))}`,
          entity: 'store_order',
          entityId: id,
        });
      }
      await this.changed(tx, updated!, order.status);
      return { ...(await this.detailInTx(tx, id)), warnings };
    });
  }

  /** Conclui: vira venda do PDV (estoque e financeiro como no caixa) com o cliente ligado. */
  async complete(id: string, input: { paymentMethod: SalePaymentMethod; registerId?: string | null }): Promise<Order> {
    const customerId = await this.linkCustomer(id);
    return this.tdb.run(async (tx) => {
      const order = await this.lockOrder(tx, id);
      if (order.status === 'completed' || order.status === 'cancelled') throw badRequest('ORDER_CLOSED', `Este pedido já está ${orderStatusLabel[order.status].toLowerCase()}`);
      const customer = order.customerId ?? customerId;
      if (input.paymentMethod === 'on_account' && !customer) throw badRequest('CUSTOMER_REQUIRED', 'Venda fiado precisa de cliente com telefone ou e-mail');
      const items = await tx.select().from(storeOrderItems).where(eq(storeOrderItems.orderId, id)).orderBy(asc(storeOrderItems.position));

      // Mesmas regras do caixa (estoque, sessão de caixa, financeiro), com o preço do pedido.
      const sale = await this.sales.sellInTx(
        tx,
        {
          customerId: customer,
          items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
          discount: 0,
          payments: [{ method: input.paymentMethod, amount: Number(order.subtotal) }],
          notes: `Pedido nº ${order.number} da loja online`,
          registerId: input.registerId ?? null,
        },
        { unitPrices: new Map(items.map((i) => [i.productId, Number(i.unitPrice)])) },
      );

      // Taxa de entrega: receita de serviço, fora da venda (não é produto).
      if (toCents(order.deliveryFee) > 0) {
        const salesSettings = await this.settings.getInTx<SalesSettings>(tx, SALES);
        const cashAccount = await this.finance.defaultAccountId(tx);
        const onAccount = input.paymentMethod === 'on_account';
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        await this.finance.recordInTx(tx, {
          kind: 'income',
          status: onAccount ? 'pending' : 'paid',
          description: `Taxa de entrega do pedido nº ${order.number} da loja`,
          amount: Number(order.deliveryFee),
          dueDate: day,
          paidAt: onAccount ? null : day,
          accountId: onAccount ? null : input.paymentMethod === 'cash' ? cashAccount : (salesSettings.bankAccountId ?? cashAccount),
          paymentMethod: onAccount ? null : input.paymentMethod,
          customerId: customer,
          sourceType: FINANCE_SOURCE,
          sourceId: id,
          categoryKey: 'services',
        });
      }

      const [updated] = await tx
        .update(storeOrders)
        .set({
          status: 'completed',
          saleId: sale.id,
          customerId: customer,
          completedAt: new Date(),
          confirmedAt: order.confirmedAt ?? new Date(),
          paymentMethod: input.paymentMethod,
          paymentStatus: order.paymentStatus === 'paid' || input.paymentMethod !== 'on_account' ? 'paid' : 'pending',
        })
        .where(eq(storeOrders.id, id))
        .returning();
      await this.event(tx, id, 'completed', `Concluído: venda nº ${sale.number}`);
      await this.audit.log(tx, { action: 'store.order.completed', entity: 'store_order', entityId: id, data: { saleId: sale.id, paymentMethod: input.paymentMethod } });
      await this.changed(tx, updated!, order.status);
      return this.detailInTx(tx, id);
    });
  }

  /** Cancela com motivo; a reserva de estoque deixa de valer (ela é calculada pelos pedidos em aberto). */
  cancel(id: string, reason: string): Promise<Order> {
    return this.tdb.run(async (tx) => {
      const order = await this.lockOrder(tx, id);
      if (order.status === 'completed') {
        throw badRequest('ORDER_COMPLETED', 'Pedido concluído já virou venda: cancele a venda em Vendas, se for o caso');
      }
      if (order.status === 'cancelled') throw badRequest('ORDER_CLOSED', 'Este pedido já está cancelado');
      const [updated] = await tx.update(storeOrders).set({ status: 'cancelled', cancelReason: reason, cancelledAt: new Date() }).where(eq(storeOrders.id, id)).returning();
      await this.event(tx, id, 'cancelled', `Cancelado: ${reason}`);
      await this.audit.log(tx, { action: 'store.order.cancelled', entity: 'store_order', entityId: id, data: { reason, from: order.status } });
      await this.changed(tx, updated!, order.status, reason);
      return this.detailInTx(tx, id);
    });
  }

  /**
   * Pagamento online confirmado pelo provedor (ponto de extensão; ver payments.ts). Idempotente:
   * a mesma confirmação de novo não muda nada.
   */
  async markPaidInTx(tx: Tx, orderId: string, reference: string): Promise<void> {
    const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, orderId)).for('update');
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Pedido não encontrado' });
    if (order.paymentStatus === 'paid') return;
    await tx.update(storeOrders).set({ paymentStatus: 'paid', paymentReference: reference }).where(eq(storeOrders.id, orderId));
    await this.event(tx, orderId, null, `Pagamento online confirmado (${reference})`, null);
    await this.audit.log(tx, { action: 'store.order.paid', entity: 'store_order', entityId: orderId, data: { reference }, userId: null });
  }

  // ---- internos -------------------------------------------------------------------------------

  /**
   * Confere a reserva dos itens contra o saldo do PDV menos o que outros pedidos já seguram. As
   * confirmações da empresa passam uma de cada vez (trava da transação), então duas não reservam o
   * mesmo último item.
   */
  private async reserveInTx(tx: Tx, order: OrderRow): Promise<string[]> {
    const { tenantId } = requestContext.requireTenant();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`store.reserve:${tenantId}`}))`);
    const items = await tx.select().from(storeOrderItems).where(eq(storeOrderItems.orderId, order.id));
    const ids = items.map((i) => i.productId);
    const [products, reserved, salesSettings] = await Promise.all([
      tx.select().from(salesProducts).where(inArray(salesProducts.id, ids)),
      reservedByProduct(tx, ids, order.id),
      this.settings.getInTx<SalesSettings>(tx, SALES),
    ]);
    const warnings: string[] = [];
    for (const item of items) {
      const p = products.find((x) => x.id === item.productId);
      if (!p?.trackStock) continue;
      const available = Number(p.stock) - (reserved.get(p.id) ?? 0);
      const quantity = Number(item.quantity);
      if (quantity <= available) continue;
      const message = `${item.name}: pedido ${formatQuantity(quantity, item.unit)}, disponível ${formatQuantity(Math.max(available, 0), item.unit)}`;
      if (salesSettings.blockNegativeStock) throw new ConflictException({ code: 'OUT_OF_STOCK', message: `Sem estoque para confirmar. ${message}` });
      warnings.push(`Estoque insuficiente (o PDV permite vender sem estoque). ${message}`);
    }
    return warnings;
  }

  /**
   * Cliente do pedido no cadastro: pelo celular, depois pelo e-mail; sem cadastro, cria um. Roda
   * antes da transação do pedido (o cadastro tem a transação dele), como no agendamento online.
   */
  private async linkCustomer(orderId: string): Promise<string | null> {
    const [order] = await this.tdb.run((tx) => tx.select().from(storeOrders).where(eq(storeOrders.id, orderId)));
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Pedido não encontrado' });
    if (order.customerId || order.status === 'completed' || order.status === 'cancelled') return order.customerId;
    if (!order.customerPhone && !order.customerEmail) return null;
    if (order.customerPhone) {
      const byPhone = (await this.customers.findDuplicates({ phone: order.customerPhone })).find((d) => d.matchedOn.includes('phone'));
      if (byPhone) return byPhone.id;
    }
    if (order.customerEmail) {
      const byEmail = (await this.customers.findDuplicates({ email: order.customerEmail })).find((d) => d.matchedOn.includes('email'));
      if (byEmail) return byEmail.id;
    }
    try {
      const created = await this.customers.create({ type: 'person', name: order.customerName, phone: order.customerPhone, email: order.customerEmail }, { allowDuplicates: true });
      return created.id;
    } catch {
      // Dado que o cadastro recusa (ex.: telefone fora do padrão): o pedido segue sem cliente ligado.
      return null;
    }
  }

  private async lockOrder(tx: Tx, id: string): Promise<OrderRow> {
    const [order] = await tx.select().from(storeOrders).where(eq(storeOrders.id, id)).for('update');
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Pedido não encontrado' });
    return order;
  }

  /** Histórico do pedido. `userId` null = cliente/sistema; sem informar, quem está logado. */
  private async event(tx: Tx, orderId: string, status: OrderStatus | null, text: string, userId?: string | null) {
    const ctx = requestContext.requireTenant();
    await tx.insert(storeOrderEvents).values({ tenantId: ctx.tenantId, orderId, status, text, userId: userId === undefined ? (ctx.userId ?? null) : userId });
  }

  /** Depois de mudar o estado: evento no outbox, auditoria (exceto concluir/cancelar, que já registram) e aviso ao cliente. */
  private async changed(tx: Tx, order: OrderRow, from: OrderStatus, reason?: string) {
    await this.outbox.publish(tx, ORDER_STATUS_CHANGED, { orderId: order.id, number: order.number, from, to: order.status });
    if (order.status !== 'completed' && order.status !== 'cancelled') {
      await this.audit.log(tx, { action: 'store.order.status_changed', entity: 'store_order', entityId: order.id, data: { from, to: order.status } });
    }
    await this.notify(tx, order, reason);
  }

  /** Aviso ao cliente pelo módulo de notificações (e-mail/WhatsApp), só se ele estiver ativo e o pedido tiver cliente. */
  private async notify(tx: Tx, order: OrderRow, reason?: string) {
    if (!order.customerId || order.status === 'new') return;
    if (!(await moduleActive(tx, NOTIFICATIONS))) return;
    const { tenantId } = requestContext.requireTenant();
    const [items, settings, tenant] = await Promise.all([
      tx.select().from(storeOrderItems).where(eq(storeOrderItems.orderId, order.id)).orderBy(asc(storeOrderItems.position)),
      this.settings.getInTx<StoreSettings>(tx, STORE),
      currentTenant(tx, tenantId),
    ]);
    const pickup = [settings.pickup.address, settings.pickup.hours].filter(Boolean).join(' — ');
    await this.notifications.enqueueInTx(tx, {
      templateKey: `store.order.${order.status}`,
      customerId: order.customerId,
      related: { entity: 'store_order', id: order.id },
      data: {
        pedido: {
          numero: order.number,
          total: brl(Number(order.total)),
          itens: items.map((i) => `${formatQuantity(Number(i.quantity), i.unit)} ${i.name} — ${brl(Number(i.total))}`).join('\n'),
          entrega: order.fulfillment === 'delivery' ? (order.address ? `Entrega em: ${formatAddress(order.address)}.` : 'Entrega no endereço informado.') : pickup ? `Retirada: ${pickup}.` : 'Retirada no local.',
          motivo: reason ?? order.cancelReason ?? '',
        },
        loja: { link: tenant.slug ? storeUrl(this.config.adminUrl, tenant.slug) : '' },
      },
    });
  }

  async detailInTx(tx: Tx, id: string): Promise<Order> {
    const [row] = await tx
      .select({ o: storeOrders, customerName: customers.name, saleNumber: salesSchema.salesSales.number })
      .from(storeOrders)
      .leftJoin(customers, eq(customers.id, storeOrders.customerId))
      .leftJoin(salesSchema.salesSales, eq(salesSchema.salesSales.id, storeOrders.saleId))
      .where(eq(storeOrders.id, id));
    if (!row) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Pedido não encontrado' });
    const [items, events] = await Promise.all([
      tx.select().from(storeOrderItems).where(eq(storeOrderItems.orderId, id)).orderBy(asc(storeOrderItems.position)),
      tx
        .select({ e: storeOrderEvents, userName: coreSchema.users.name })
        .from(storeOrderEvents)
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, storeOrderEvents.userId))
        .where(eq(storeOrderEvents.orderId, id))
        .orderBy(asc(storeOrderEvents.createdAt), asc(storeOrderEvents.id)),
    ]);
    const o = row.o;
    return {
      ...toSummary(o, items.length),
      customerEmail: o.customerEmail,
      customer: o.customerId && row.customerName ? { id: o.customerId, name: row.customerName } : null,
      address: o.address,
      notes: o.notes,
      items: items.map((i) => ({
        productId: i.productId,
        name: i.name,
        unit: i.unit,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        regularPrice: Number(i.regularPrice),
        total: Number(i.total),
      })),
      subtotal: Number(o.subtotal),
      deliveryFee: Number(o.deliveryFee),
      saleId: o.saleId,
      saleNumber: row.saleNumber ?? null,
      paymentMethod: o.paymentMethod,
      paymentReference: o.paymentReference,
      cancelReason: o.cancelReason,
      consent: o.consent,
      confirmedAt: o.confirmedAt?.toISOString() ?? null,
      completedAt: o.completedAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      events: events.map(({ e, userName }) => ({ id: e.id, status: e.status, text: e.text, userName, createdAt: e.createdAt.toISOString() })),
      next: nextStatuses(o.status, o.fulfillment).filter((s) => s !== 'completed'),
    };
  }
}

function toSummary(o: OrderRow, itemsCount: number): OrderSummary {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    source: o.source,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    fulfillment: o.fulfillment,
    paymentMode: o.paymentMode,
    paymentStatus: o.paymentStatus,
    total: Number(o.total),
    itemsCount,
    createdAt: o.createdAt.toISOString(),
  };
}
