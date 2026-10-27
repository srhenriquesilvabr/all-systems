import { AuditService, centsToDecimal, coreSchema, CustomersService, FinanceService, ModuleSettingsService, nextSequence, TenantDb, toCents } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  fractionalUnits,
  salePaymentLabel,
  type Product,
  type ProductInput,
  type Sale,
  type SaleInput,
  type SalePaymentMethod,
  type SalesSettings,
  type SalesSummary,
  type StockMove,
  type StockMoveInput,
} from '../contracts';
import { salesItems, salesPayments, salesProducts, salesSales, salesStockMoves } from '../db/schema';

const MODULE = 'shared.sales';
const SOURCE = 'sale';

type ProductRow = typeof salesProducts.$inferSelect;
type MoveKind = (typeof salesStockMoves.$inferInsert)['kind'];

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const dayStart = (date: string) => sql`(${date}::date)::timestamp at time zone 'America/Sao_Paulo'`;
const dayEnd = (date: string) => sql`((${date}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;

@Injectable()
export class SalesService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly finance: FinanceService,
    private readonly customers: CustomersService,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
  ) {}

  // ---- Produtos -------------------------------------------------------------------------------

  listProducts(opts: { q?: string; active?: boolean; lowStock?: boolean; limit: number }): Promise<Product[]> {
    return this.tdb.run(async (tx) => {
      const term = opts.q?.trim();
      const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
      const rows = await tx
        .select()
        .from(salesProducts)
        .where(
          and(
            like ? or(ilike(salesProducts.name, like), eq(salesProducts.barcode, term!), eq(salesProducts.sku, term!), ilike(salesProducts.category, like)) : undefined,
            opts.active === undefined ? undefined : eq(salesProducts.active, opts.active),
            opts.lowStock ? and(eq(salesProducts.trackStock, true), isNotNull(salesProducts.minStock), lte(salesProducts.stock, salesProducts.minStock)) : undefined,
          ),
        )
        .orderBy(asc(salesProducts.name))
        .limit(opts.limit);
      return rows.map(toProduct);
    });
  }

  createProduct(input: ProductInput): Promise<Product> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [row] = await this.guardBarcode(() => tx.insert(salesProducts).values({ ...productRow(input), tenantId }).returning());
      await this.audit.log(tx, { action: 'sales.product.created', entity: 'sales_product', entityId: row!.id });
      return toProduct(row!);
    });
  }

  updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
    return this.tdb.run(async (tx) => {
      const current = await this.productOrFail(tx, id);
      const [row] = await this.guardBarcode(() =>
        tx
          .update(salesProducts)
          .set(productRow({ ...fromProduct(current), ...input }))
          .where(eq(salesProducts.id, id))
          .returning(),
      );
      const changedPrice = input.price !== undefined && toCents(input.price) !== toCents(current.price);
      await this.audit.log(tx, { action: 'sales.product.updated', entity: 'sales_product', entityId: id, data: changedPrice ? { price: { from: Number(current.price), to: input.price } } : undefined });
      return toProduct(row!);
    });
  }

  // ---- Estoque --------------------------------------------------------------------------------

  moves(productId: string): Promise<StockMove[]> {
    return this.tdb.run(async (tx) => {
      await this.productOrFail(tx, productId);
      const rows = await tx
        .select({ m: salesStockMoves, userName: coreSchema.users.name })
        .from(salesStockMoves)
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, salesStockMoves.userId))
        .where(eq(salesStockMoves.productId, productId))
        .orderBy(desc(salesStockMoves.createdAt), desc(salesStockMoves.id))
        .limit(200);
      return rows.map(({ m, userName }) => ({
        id: m.id,
        kind: m.kind,
        quantity: Number(m.quantity),
        balance: Number(m.balance),
        reason: m.reason,
        userName,
        createdAt: m.createdAt.toISOString(),
      }));
    });
  }

  addMove(input: StockMoveInput): Promise<Product> {
    return this.tdb.run(async (tx) => {
      const product = await this.productOrFail(tx, input.productId, true);
      if (!product.trackStock) throw badRequest('STOCK_NOT_TRACKED', 'Este produto não controla estoque');
      checkQuantity(product, input.quantity);
      const delta = input.kind === 'count' ? input.quantity - Number(product.stock) : input.kind === 'loss' ? -input.quantity : input.quantity;
      if (input.kind !== 'count' && input.quantity === 0) throw badRequest('INVALID_QUANTITY', 'Informe a quantidade');
      await this.move(tx, product, input.kind, delta, { unitCost: input.unitCost ?? null, reason: input.reason ?? null });
      if (input.kind === 'purchase' && input.unitCost != null) {
        await tx.update(salesProducts).set({ cost: centsToDecimal(toCents(input.unitCost)) }).where(eq(salesProducts.id, product.id));
      }
      return toProduct(await this.productOrFail(tx, product.id));
    });
  }

  // ---- Vendas ---------------------------------------------------------------------------------

  sell(input: SaleInput): Promise<Sale> {
    const { tenantId, userId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const settings = await this.settings.getInTx<SalesSettings>(tx, MODULE);
      const customer = input.customerId ? await this.customers.findInTx(tx, input.customerId) : undefined;
      if (input.customerId && (!customer || customer.anonymizedAt)) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');

      // Mesma mercadoria em duas linhas vira uma só.
      const merged = new Map<string, number>();
      for (const item of input.items) merged.set(item.productId, Math.round(((merged.get(item.productId) ?? 0) + item.quantity) * 1000) / 1000);
      const products = new Map(
        (await tx.select().from(salesProducts).where(inArray(salesProducts.id, [...merged.keys()])).orderBy(asc(salesProducts.id)).for('update')).map((p) => [p.id, p]),
      );
      const lines = [...merged].map(([productId, quantity]) => {
        const p = products.get(productId);
        if (!p || !p.active) throw badRequest('PRODUCT_NOT_FOUND', 'Produto não encontrado ou inativo');
        checkQuantity(p, quantity);
        return { product: p, quantity, totalCents: Math.round(quantity * toCents(p.price)) };
      });

      const subtotal = lines.reduce((sum, l) => sum + l.totalCents, 0);
      const discount = toCents(input.discount);
      if (discount > subtotal) throw badRequest('INVALID_DISCOUNT', 'O desconto é maior que o total');
      const total = subtotal - discount;
      const paid = input.payments.reduce((sum, p) => sum + toCents(p.amount), 0);
      const cash = input.payments.filter((p) => p.method === 'cash').reduce((sum, p) => sum + toCents(p.amount), 0);
      if (paid < total) throw badRequest('PAYMENT_SHORT', 'O pagamento não cobre o total');
      const change = paid - total;
      if (change > cash) throw badRequest('PAYMENT_OVER', 'Só pagamento em dinheiro pode ter troco');
      if (input.payments.some((p) => p.method === 'on_account') && !customer) throw badRequest('CUSTOMER_REQUIRED', 'Venda fiado precisa de cliente');

      const number = await nextSequence(tx, tenantId, 'sale');
      const [sale] = await tx
        .insert(salesSales)
        .values({
          tenantId,
          number,
          customerId: customer?.id ?? null,
          subtotal: centsToDecimal(subtotal),
          discount: centsToDecimal(discount),
          total: centsToDecimal(total),
          change: centsToDecimal(change),
          notes: input.notes ?? null,
          sellerId: userId ?? null,
        })
        .returning();
      await tx.insert(salesItems).values(
        lines.map((l, position) => ({
          tenantId,
          saleId: sale!.id,
          position,
          productId: l.product.id,
          name: l.product.name,
          unit: l.product.unit,
          quantity: l.quantity.toFixed(3),
          unitPrice: l.product.price,
          total: centsToDecimal(l.totalCents),
        })),
      );
      // Troco sai do dinheiro: o que fica registrado é o que entrou de fato.
      const received = aggregate(input.payments, change);
      await tx.insert(salesPayments).values(received.map((p) => ({ tenantId, saleId: sale!.id, method: p.method, amount: centsToDecimal(p.cents) })));

      for (const l of lines) {
        if (!l.product.trackStock) continue;
        await this.move(tx, l.product, 'sale', -l.quantity, { saleId: sale!.id, blockNegative: settings.blockNegativeStock });
      }
      await this.recordFinance(tx, sale!, received, customer?.id ?? null, settings);
      if (customer) {
        await this.customers.addTimeline(tx, {
          customerId: customer.id,
          moduleKey: MODULE,
          type: 'sale.completed',
          title: `Compra #${number}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total / 100)}`,
          entity: 'sale',
          entityId: sale!.id,
        });
      }
      await this.audit.log(tx, { action: 'sales.sale.completed', entity: 'sale', entityId: sale!.id });
      return this.detailInTx(tx, sale!.id);
    });
  }

  cancel(id: string, reason: string): Promise<Sale> {
    return this.tdb.run(async (tx) => {
      const [sale] = await tx.select().from(salesSales).where(eq(salesSales.id, id)).for('update');
      if (!sale) throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Venda não encontrada' });
      if (sale.status === 'cancelled') throw badRequest('SALE_CANCELLED', 'Esta venda já foi cancelada');
      await tx.update(salesSales).set({ status: 'cancelled', cancelReason: reason, cancelledAt: new Date() }).where(eq(salesSales.id, id));
      const items = await tx.select().from(salesItems).where(eq(salesItems.saleId, id));
      const products = await tx.select().from(salesProducts).where(inArray(salesProducts.id, items.map((i) => i.productId))).orderBy(asc(salesProducts.id)).for('update');
      for (const item of items) {
        const product = products.find((p) => p.id === item.productId)!;
        if (product.trackStock) await this.move(tx, product, 'return', Number(item.quantity), { saleId: id, reason });
      }
      await this.finance.cancelAllBySourceInTx(tx, SOURCE, id);
      await this.audit.log(tx, { action: 'sales.sale.cancelled', entity: 'sale', entityId: id, data: { reason } });
      return this.detailInTx(tx, id);
    });
  }

  get(id: string): Promise<Sale> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  list(opts: { from: string; to: string; customerId?: string; limit: number }): Promise<Sale[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ id: salesSales.id })
        .from(salesSales)
        .where(
          and(
            gte(salesSales.createdAt, dayStart(opts.from)),
            lt(salesSales.createdAt, dayEnd(opts.to)),
            opts.customerId ? eq(salesSales.customerId, opts.customerId) : undefined,
          ),
        )
        .orderBy(desc(salesSales.createdAt))
        .limit(opts.limit);
      return this.detailsInTx(tx, rows.map((r) => r.id));
    });
  }

  /** Fechamento do período: total, ticket médio, por forma de pagamento, por dia e produtos mais vendidos. */
  summary(from: string, to: string): Promise<SalesSummary> {
    return this.tdb.run(async (tx) => {
      const period = and(eq(salesSales.status, 'completed'), gte(salesSales.createdAt, dayStart(from)), lt(salesSales.createdAt, dayEnd(to)));
      const localDay = sql<string>`to_char(${salesSales.createdAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;
      const [byDay, byMethod, top] = await Promise.all([
        tx
          .select({ date: localDay, count: sql<number>`count(*)::int`, total: sql<string>`sum(${salesSales.total})` })
          .from(salesSales)
          .where(period)
          .groupBy(localDay)
          .orderBy(localDay),
        tx
          .select({ method: salesPayments.method, amount: sql<string>`sum(${salesPayments.amount})` })
          .from(salesPayments)
          .innerJoin(salesSales, eq(salesSales.id, salesPayments.saleId))
          .where(period)
          .groupBy(salesPayments.method),
        tx
          .select({ productId: salesItems.productId, name: sql<string>`max(${salesItems.name})`, quantity: sql<string>`sum(${salesItems.quantity})`, total: sql<string>`sum(${salesItems.total})` })
          .from(salesItems)
          .innerJoin(salesSales, eq(salesSales.id, salesItems.saleId))
          .where(period)
          .groupBy(salesItems.productId)
          .orderBy(desc(sql`sum(${salesItems.total})`))
          .limit(10),
      ]);
      const count = byDay.reduce((sum, d) => sum + d.count, 0);
      const total = byDay.reduce((sum, d) => sum + toCents(d.total), 0) / 100;
      return {
        count,
        total,
        averageTicket: count ? Math.round((total / count) * 100) / 100 : 0,
        byMethod: byMethod.map((m) => ({ method: m.method, amount: Number(m.amount) })).sort((a, b) => b.amount - a.amount),
        byDay: byDay.map((d) => ({ date: d.date, count: d.count, total: Number(d.total) })),
        topProducts: top.map((p) => ({ productId: p.productId, name: p.name, quantity: Number(p.quantity), total: Number(p.total) })),
      };
    });
  }

  // ---- internos -------------------------------------------------------------------------------

  /** Muda o saldo e registra o movimento. A linha do produto fica travada até o fim da transação. */
  private async move(
    tx: Tx,
    product: ProductRow,
    kind: MoveKind,
    delta: number,
    opts: { saleId?: string; reason?: string | null; unitCost?: number | null; blockNegative?: boolean } = {},
  ) {
    const { tenantId, userId } = requestContext.requireTenant();
    const [updated] = await tx
      .update(salesProducts)
      .set({ stock: sql`${salesProducts.stock} + ${delta.toFixed(3)}::numeric` })
      .where(eq(salesProducts.id, product.id))
      .returning({ stock: salesProducts.stock });
    if (opts.blockNegative && Number(updated!.stock) < 0) {
      throw new ConflictException({ code: 'OUT_OF_STOCK', message: `Sem estoque suficiente de ${product.name}` });
    }
    await tx.insert(salesStockMoves).values({
      tenantId,
      productId: product.id,
      kind,
      quantity: delta.toFixed(3),
      balance: updated!.stock,
      unitCost: opts.unitCost != null ? centsToDecimal(toCents(opts.unitCost)) : null,
      reason: opts.reason ?? null,
      saleId: opts.saleId ?? null,
      userId: userId ?? null,
    });
  }

  private async recordFinance(tx: Tx, sale: typeof salesSales.$inferSelect, received: { method: SalePaymentMethod; cents: number }[], customerId: string | null, settings: SalesSettings) {
    const today = localToday();
    const cashAccount = await this.finance.defaultAccountId(tx);
    for (const p of received) {
      if (p.cents <= 0) continue;
      const onAccount = p.method === 'on_account';
      await this.finance.recordInTx(tx, {
        kind: 'income',
        status: onAccount ? 'pending' : 'paid',
        description: `Venda #${sale.number} (${salePaymentLabel[p.method]})`,
        amount: p.cents / 100,
        dueDate: today,
        paidAt: onAccount ? null : today,
        accountId: onAccount ? null : p.method === 'cash' ? cashAccount : (settings.bankAccountId ?? cashAccount),
        paymentMethod: onAccount ? null : p.method,
        customerId,
        sourceType: SOURCE,
        sourceId: sale.id,
        categoryKey: 'products',
      });
    }
  }

  private async detailInTx(tx: Tx, id: string): Promise<Sale> {
    const [sale] = await this.detailsInTx(tx, [id]);
    if (!sale) throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Venda não encontrada' });
    return sale;
  }

  private async detailsInTx(tx: Tx, ids: string[]): Promise<Sale[]> {
    if (!ids.length) return [];
    const [sales, items, payments] = await Promise.all([
      tx
        .select({ s: salesSales, customer: { id: customers.id, name: customers.name }, sellerName: coreSchema.users.name })
        .from(salesSales)
        .leftJoin(customers, eq(customers.id, salesSales.customerId))
        .leftJoin(coreSchema.users, eq(coreSchema.users.id, salesSales.sellerId))
        .where(inArray(salesSales.id, ids)),
      tx.select().from(salesItems).where(inArray(salesItems.saleId, ids)).orderBy(asc(salesItems.position)),
      tx.select().from(salesPayments).where(inArray(salesPayments.saleId, ids)).orderBy(asc(salesPayments.id)),
    ]);
    const byId = new Map(sales.map((r) => [r.s.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(({ s, customer, sellerName }) => ({
        id: s.id,
        number: s.number,
        status: s.status,
        customer: customer?.id ? { id: customer.id, name: customer.name } : null,
        items: items
          .filter((i) => i.saleId === s.id)
          .map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), total: Number(i.total) })),
        subtotal: Number(s.subtotal),
        discount: Number(s.discount),
        total: Number(s.total),
        payments: payments.filter((p) => p.saleId === s.id).map((p) => ({ method: p.method, amount: Number(p.amount) })),
        change: Number(s.change),
        notes: s.notes,
        sellerName,
        cancelReason: s.cancelReason,
        createdAt: s.createdAt.toISOString(),
      }));
  }

  private async productOrFail(tx: Tx, id: string, lock = false) {
    const query = tx.select().from(salesProducts).where(eq(salesProducts.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado' });
    return row;
  }

  private async guardBarcode<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
      if (code === '23505') throw new ConflictException({ code: 'BARCODE_TAKEN', message: 'Já existe um produto com este código de barras' });
      throw err;
    }
  }
}

/** Soma por forma de pagamento e desconta o troco do dinheiro. */
function aggregate(payments: SaleInput['payments'], changeCents: number) {
  const sums = new Map<SalePaymentMethod, number>();
  for (const p of payments) sums.set(p.method, (sums.get(p.method) ?? 0) + toCents(p.amount));
  if (changeCents) sums.set('cash', (sums.get('cash') ?? 0) - changeCents);
  return [...sums].filter(([, cents]) => cents > 0).map(([method, cents]) => ({ method, cents }));
}

function checkQuantity(product: { name: string; unit: ProductRow['unit'] }, quantity: number) {
  if (!fractionalUnits.includes(product.unit) && !Number.isInteger(quantity)) {
    throw badRequest('INVALID_QUANTITY', `${product.name} é vendido em quantidade inteira`);
  }
}

function productRow(input: ProductInput) {
  return {
    name: input.name,
    sku: input.sku || null,
    barcode: input.barcode || null,
    category: input.category || null,
    unit: input.unit,
    price: centsToDecimal(toCents(input.price)),
    cost: input.cost != null ? centsToDecimal(toCents(input.cost)) : null,
    trackStock: input.trackStock,
    minStock: input.minStock != null ? input.minStock.toFixed(3) : null,
    active: input.active,
  };
}

function fromProduct(p: ProductRow): ProductInput {
  return {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    category: p.category,
    unit: p.unit,
    price: Number(p.price),
    cost: p.cost === null ? null : Number(p.cost),
    trackStock: p.trackStock,
    minStock: p.minStock === null ? null : Number(p.minStock),
    active: p.active,
  };
}

function toProduct(p: ProductRow): Product {
  return { id: p.id, ...fromProduct(p), cost: p.cost === null ? null : Number(p.cost), minStock: p.minStock === null ? null : Number(p.minStock), stock: Number(p.stock), createdAt: p.createdAt.toISOString() };
}
