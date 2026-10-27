import { AuditService, centsToDecimal, centsToNumber, CustomerDataRegistry, CustomersService, FinanceService, nextSequence, TenantDb, toCents } from '@all/core';
import { customers, users } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { CreateOrderInput, OrderDetail, OrderItemInput, OrderSummary, PaymentInput, ServiceOrderWorkflow, UpdateOrderInput } from '../contracts';
import { paymentMethodLabel } from '../contracts';
import { soItems, soOrders, soPayments, soStatusHistory } from '../db/schema';
import { ServiceOrderWorkflows } from './workflows';

const SOURCE = 'service_order';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });

type OrderRow = typeof soOrders.$inferSelect;

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });

@Injectable()
export class ServiceOrdersService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly workflows: ServiceOrderWorkflows,
    private readonly customers: CustomersService,
    private readonly finance: FinanceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly customerData: CustomerDataRegistry,
  ) {}

  onModuleInit() {
    this.customerData.register({
      moduleKey: 'shared.service-orders',
      export: async (tx, customerId) => {
        const orders = await tx.select().from(soOrders).where(eq(soOrders.customerId, customerId)).orderBy(asc(soOrders.number));
        return Promise.all(orders.map(async (o) => ({ ...toSummary(o, ''), items: await tx.select().from(soItems).where(eq(soItems.orderId, o.id)) })));
      },
      // Os valores ficam (obrigação fiscal); as observações livres podem conter dados pessoais.
      anonymize: async (tx, customerId) => {
        await tx.update(soOrders).set({ notesCustomer: null, notesInternal: null }).where(eq(soOrders.customerId, customerId));
      },
    });
  }

  /** Só os fluxos dos módulos ativos no tenant. */
  listWorkflows(): ServiceOrderWorkflow[] {
    const active = requestContext.require().modules ?? new Set<string>();
    return this.workflows.all().filter((w) => active.has(w.moduleKey));
  }

  list(opts: { status?: string; workflow?: string; customerId?: string; q?: string; limit: number; offset: number }) {
    return this.tdb.run(async (tx) => {
      const where = and(
        opts.status ? eq(soOrders.status, opts.status) : undefined,
        opts.workflow ? eq(soOrders.workflow, opts.workflow) : undefined,
        opts.customerId ? eq(soOrders.customerId, opts.customerId) : undefined,
        searchFilter(opts.q),
      );
      const [rows, totals] = await Promise.all([
        tx
          .select({ order: soOrders, customerName: customers.name })
          .from(soOrders)
          .innerJoin(customers, eq(customers.id, soOrders.customerId))
          .where(where)
          .orderBy(desc(soOrders.receivedAt), desc(soOrders.number))
          .limit(opts.limit)
          .offset(opts.offset),
        tx.select({ total: count() }).from(soOrders).innerJoin(customers, eq(customers.id, soOrders.customerId)).where(where),
      ]);
      return { items: rows.map((r) => toSummary(r.order, r.customerName)), total: totals[0]?.total ?? 0 };
    });
  }

  get(id: string): Promise<OrderDetail> {
    return this.tdb.run((tx) => this.detail(tx, id));
  }

  /** Abertura pelo endpoint genérico: fluxos com tela própria (customCreate) abrem pela vertical. */
  create(input: CreateOrderInput) {
    const workflow = this.workflowOf(input.workflow);
    if (workflow.customCreate) {
      throw badRequest('USE_VERTICAL_ENDPOINT', `Ordens do fluxo "${workflow.label}" são abertas pela tela do módulo`);
    }
    return this.tdb.run((tx) => this.createInTx(tx, input));
  }

  /** Para verticais: abre a ordem dentro da transação delas (que gravam dados extras junto). */
  async createInTx(tx: Tx, input: CreateOrderInput): Promise<OrderDetail> {
    const { tenantId, userId } = requestContext.requireTenant();
    const workflow = this.workflowOf(input.workflow);
    const customer = await this.customers.findInTx(tx, input.customerId);
    if (!customer) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
    if (customer.anonymizedAt) throw badRequest('CUSTOMER_ANONYMIZED', 'Cliente anonimizado não pode abrir ordens');

    // Ordem antiga (registro de histórico): entra com a data informada e não avisa o cliente.
    const receivedAt = input.receivedAt ?? new Date();
    const backdated = toDateOnly(receivedAt) < toDateOnly(new Date());
    if (input.dueAt && toDateOnly(input.dueAt) < toDateOnly(receivedAt)) {
      throw badRequest('DUE_BEFORE_RECEIVED', 'A previsão de entrega não pode ser antes da data de entrada');
    }

    const totals = computeTotals(input.items, input.discount);
    const [order] = await tx
      .insert(soOrders)
      .values({
        tenantId,
        number: await nextSequence(tx, tenantId, 'service_order'),
        workflow: workflow.key,
        status: workflow.initial,
        customerId: customer.id,
        channel: input.channel,
        subtotal: centsToDecimal(totals.subtotal),
        discount: centsToDecimal(totals.discount),
        total: centsToDecimal(totals.total),
        receivedAt,
        dueAt: input.dueAt ?? null,
        notesCustomer: input.notesCustomer ?? null,
        notesInternal: input.notesInternal ?? null,
        createdBy: userId ?? null,
      })
      .returning();
    await this.replaceItems(tx, order!.id, input.items);
    await tx.insert(soStatusHistory).values({ tenantId, orderId: order!.id, toStatus: workflow.initial, userId: userId ?? null, createdAt: receivedAt });

    await this.syncReceivable(tx, order!);
    await this.customers.addTimeline(tx, {
      customerId: customer.id,
      moduleKey: 'shared.service-orders',
      type: 'service_order.created',
      title: `Ordem nº ${order!.number} aberta${backdated ? ` em ${dateOnly.format(receivedAt)}` : ''} (${brl.format(centsToNumber(totals.total))})`,
      entity: 'service_order',
      entityId: order!.id,
    });
    if (!backdated) await this.notify(tx, order!, workflow);
    await this.audit.log(tx, { action: 'service_order.created', entity: 'service_order', entityId: order!.id, data: { number: order!.number } });
    return this.detail(tx, order!.id);
  }

  update(id: string, input: UpdateOrderInput) {
    return this.tdb.run(async (tx) => {
      const order = await this.findOrFail(tx, id, true);
      if (this.statusOf(order)?.terminal) throw badRequest('ORDER_CLOSED', 'Ordem encerrada não pode ser alterada');

      const items = input.items ?? (await this.itemsOf(tx, id));
      const totals = computeTotals(items, input.discount ?? Number(order.discount));
      if (totals.total < toCents(order.paidAmount)) {
        throw badRequest('TOTAL_BELOW_PAID', 'O novo total é menor do que o valor já pago');
      }

      const [updated] = await tx
        .update(soOrders)
        .set({
          subtotal: centsToDecimal(totals.subtotal),
          discount: centsToDecimal(totals.discount),
          total: centsToDecimal(totals.total),
          paymentStatus: paymentStatusOf(toCents(order.paidAmount), totals.total),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          ...(input.notesCustomer !== undefined ? { notesCustomer: input.notesCustomer } : {}),
          ...(input.notesInternal !== undefined ? { notesInternal: input.notesInternal } : {}),
        })
        .where(eq(soOrders.id, id))
        .returning();
      if (input.items) await this.replaceItems(tx, id, input.items);
      await this.syncReceivable(tx, updated!);
      await this.audit.log(tx, { action: 'service_order.updated', entity: 'service_order', entityId: id, data: { fields: Object.keys(input) } });
      return this.detail(tx, id);
    });
  }

  transition(id: string, to: string, reason?: string | null) {
    return this.tdb.run((tx) => this.transitionInTx(tx, id, to, reason));
  }

  /** Para verticais: muda o status na transação delas (ex.: ordem pronta quando todas as peças ficam prontas). */
  /** `notify: false` muda o status sem avisar o cliente (ex.: entrega que falhou e volta para "Pronta"). */
  async transitionInTx(tx: Tx, id: string, to: string, reason?: string | null, opts: { notify?: boolean } = {}): Promise<OrderDetail> {
    const { tenantId, userId } = requestContext.requireTenant();
    const order = await this.findOrFail(tx, id, true);
    const workflow = this.workflowOf(order.workflow);
    if (!(workflow.transitions[order.status] ?? []).includes(to)) {
      throw badRequest('INVALID_TRANSITION', `Não é possível ir de "${labelOf(workflow, order.status)}" para "${labelOf(workflow, to)}"`);
    }
    const target = workflow.statuses.find((s) => s.key === to)!;
    if (target.cancelled && !reason?.trim()) throw badRequest('REASON_REQUIRED', 'Informe o motivo do cancelamento');
    await workflow.beforeTransition?.({ tx, orderId: id, from: order.status, to });

    const [updated] = await tx
      .update(soOrders)
      .set({
        status: to,
        closedAt: target.terminal ? new Date() : null,
        cancelReason: target.cancelled ? reason : null,
      })
      .where(eq(soOrders.id, id))
      .returning();
    await tx.insert(soStatusHistory).values({ tenantId, orderId: id, fromStatus: order.status, toStatus: to, reason: reason ?? null, userId: userId ?? null });

    await this.syncReceivable(tx, updated!);
    await this.customers.addTimeline(tx, {
      customerId: order.customerId,
      moduleKey: 'shared.service-orders',
      type: 'service_order.status_changed',
      title: `Ordem nº ${order.number}: ${target.label}`,
      entity: 'service_order',
      entityId: id,
    });
    if (opts.notify !== false) await this.notify(tx, updated!, workflow);
    await this.audit.log(tx, { action: 'service_order.status_changed', entity: 'service_order', entityId: id, data: { from: order.status, to, reason } });
    return this.detail(tx, id);
  }

  addPayment(id: string, input: PaymentInput) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const order = await this.findOrFail(tx, id, true);
      if (this.statusOf(order)?.cancelled) throw badRequest('ORDER_CANCELLED', 'Ordem cancelada não recebe pagamentos');

      const amount = toCents(input.amount);
      const outstanding = toCents(order.total) - toCents(order.paidAmount);
      if (amount > outstanding) {
        throw badRequest('PAYMENT_EXCEEDS_BALANCE', `O valor passa do saldo em aberto (${brl.format(centsToNumber(outstanding))})`);
      }

      const entry = await this.finance.recordInTx(tx, {
        kind: 'income',
        status: 'paid',
        amount: input.amount,
        description: `Ordem de serviço nº ${order.number} (${paymentMethodLabel[input.method]})`,
        dueDate: input.paidAt,
        paidAt: input.paidAt,
        accountId: input.accountId,
        customerId: order.customerId,
        paymentMethod: input.method,
        sourceType: SOURCE,
        sourceId: order.id,
        categoryKey: 'services',
      });
      await tx.insert(soPayments).values({
        tenantId,
        orderId: id,
        amount: centsToDecimal(amount),
        method: input.method,
        paidAt: input.paidAt,
        finEntryId: entry.id,
        userId,
      });

      const paid = toCents(order.paidAmount) + amount;
      const [updated] = await tx
        .update(soOrders)
        .set({ paidAmount: centsToDecimal(paid), paymentStatus: paymentStatusOf(paid, toCents(order.total)) })
        .where(eq(soOrders.id, id))
        .returning();
      await this.syncReceivable(tx, updated!);
      await this.customers.addTimeline(tx, {
        customerId: order.customerId,
        moduleKey: 'shared.service-orders',
        type: 'service_order.payment',
        title: `Pagamento de ${brl.format(input.amount)} na ordem nº ${order.number}`,
        entity: 'service_order',
        entityId: id,
      });
      await this.audit.log(tx, { action: 'service_order.payment', entity: 'service_order', entityId: id, data: input });
      return this.detail(tx, id);
    });
  }

  // ---- internos -----------------------------------------------------------------------------

  /** O saldo em aberto da ordem vira um único "a receber" no financeiro (zerado se paga ou cancelada). */
  private async syncReceivable(tx: Tx, order: OrderRow) {
    const cancelled = this.statusOf(order)?.cancelled;
    const outstanding = cancelled ? 0 : toCents(order.total) - toCents(order.paidAmount);
    await this.finance.syncReceivableInTx(tx, {
      sourceType: SOURCE,
      sourceId: order.id,
      amountCents: outstanding,
      description: `Ordem de serviço nº ${order.number}`,
      dueDate: toDateOnly(order.dueAt ?? order.receivedAt),
      customerId: order.customerId,
      categoryKey: 'services',
    });
  }

  private async notify(tx: Tx, order: OrderRow, workflow: ServiceOrderWorkflow) {
    const templateKey = workflow.notify?.[order.status];
    if (!templateKey) return;
    const items = await this.itemsOf(tx, order.id);
    await this.notifications.enqueueInTx(tx, {
      templateKey,
      customerId: order.customerId,
      related: { entity: 'service_order', id: order.id },
      data: {
        os: {
          numero: order.number,
          status: labelOf(workflow, order.status),
          total: brl.format(Number(order.total)),
          saldo: brl.format(centsToNumber(toCents(order.total) - toCents(order.paidAmount))),
          previsao: order.dueAt ? dateTime.format(order.dueAt) : 'a combinar',
          itens: items.map((i) => `- ${formatQty(i.quantity)} × ${i.description}`).join('\n'),
        },
      },
    });
  }

  private async replaceItems(tx: Tx, orderId: string, items: OrderItemInput[]) {
    const { tenantId } = requestContext.requireTenant();
    await tx.delete(soItems).where(eq(soItems.orderId, orderId));
    await tx.insert(soItems).values(
      items.map((item, position) => ({
        tenantId,
        orderId,
        position,
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: centsToDecimal(toCents(item.unitPrice)),
        total: centsToDecimal(itemTotal(item)),
        refType: item.refType ?? null,
        refId: item.refId ?? null,
      })),
    );
  }

  private async itemsOf(tx: Tx, orderId: string) {
    const rows = await tx.select().from(soItems).where(eq(soItems.orderId, orderId)).orderBy(asc(soItems.position));
    return rows.map((r) => ({ id: r.id, description: r.description, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice), total: Number(r.total), refType: r.refType, refId: r.refId }));
  }

  async detail(tx: Tx, id: string): Promise<OrderDetail> {
    const order = await this.findOrFail(tx, id);
    const customer = (await this.customers.findInTx(tx, order.customerId))!;
    const [items, payments, history] = await Promise.all([
      this.itemsOf(tx, id),
      tx.select().from(soPayments).where(eq(soPayments.orderId, id)).orderBy(asc(soPayments.createdAt)),
      tx
        .select({ history: soStatusHistory, userName: users.name })
        .from(soStatusHistory)
        .leftJoin(users, eq(users.id, soStatusHistory.userId))
        .where(eq(soStatusHistory.orderId, id))
        .orderBy(asc(soStatusHistory.createdAt), asc(soStatusHistory.id)),
    ]);
    return {
      ...toSummary(order, customer.name),
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      notesCustomer: order.notesCustomer,
      notesInternal: order.notesInternal,
      closedAt: order.closedAt?.toISOString() ?? null,
      cancelReason: order.cancelReason,
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
      items: items.map(({ refType, refId, ...i }) => i),
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method as OrderDetail['payments'][number]['method'],
        paidAt: p.paidAt,
        createdAt: p.createdAt.toISOString(),
      })),
      history: history.map((h) => ({
        id: h.history.id,
        from: h.history.fromStatus,
        to: h.history.toStatus,
        reason: h.history.reason,
        userName: h.userName,
        createdAt: h.history.createdAt.toISOString(),
      })),
    };
  }

  /** `lock` trava a linha: duas mudanças simultâneas na mesma ordem acontecem uma de cada vez. */
  private async findOrFail(tx: Tx, id: string, lock = false) {
    const query = tx.select().from(soOrders).where(eq(soOrders.id, id));
    const [order] = lock ? await query.for('update') : await query;
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Ordem de serviço não encontrada' });
    return order;
  }

  private workflowOf(key: string) {
    const workflow = this.workflows.get(key);
    if (!workflow) throw badRequest('UNKNOWN_WORKFLOW', `Fluxo desconhecido: ${key}`);
    return workflow;
  }

  private statusOf(order: OrderRow) {
    return this.workflows.get(order.workflow)?.statuses.find((s) => s.key === order.status);
  }
}

function toSummary(o: OrderRow, customerName: string): OrderSummary {
  return {
    id: o.id,
    number: o.number,
    workflow: o.workflow,
    status: o.status,
    channel: o.channel,
    customer: { id: o.customerId, name: customerName },
    total: Number(o.total),
    paidAmount: Number(o.paidAmount),
    paymentStatus: o.paymentStatus,
    dueAt: o.dueAt?.toISOString() ?? null,
    receivedAt: o.receivedAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
  };
}

const itemTotal = (item: Pick<OrderItemInput, 'quantity' | 'unitPrice'>) => Math.round(item.quantity * toCents(item.unitPrice));

function computeTotals(items: Pick<OrderItemInput, 'quantity' | 'unitPrice'>[], discount: number) {
  const subtotal = items.reduce((sum, i) => sum + itemTotal(i), 0);
  const discountCents = toCents(discount);
  if (discountCents > subtotal) throw badRequest('DISCOUNT_TOO_HIGH', 'O desconto é maior que o valor dos itens');
  return { subtotal, discount: discountCents, total: subtotal - discountCents };
}

function paymentStatusOf(paid: number, total: number): 'pending' | 'partial' | 'paid' {
  if (paid <= 0) return total === 0 ? 'paid' : 'pending';
  return paid >= total ? 'paid' : 'partial';
}

const labelOf = (wf: ServiceOrderWorkflow, status: string) => wf.statuses.find((s) => s.key === status)?.label ?? status;

const formatQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString('pt-BR'));

/** Data (YYYY-MM-DD) no fuso de São Paulo. */
function toDateOnly(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

function searchFilter(q?: string): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  const asNumber = /^\d+$/.test(term) ? Number(term) : undefined;
  return or(
    asNumber !== undefined && asNumber < 2 ** 31 ? eq(soOrders.number, asNumber) : undefined,
    ilike(customers.name, `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`),
  );
}

