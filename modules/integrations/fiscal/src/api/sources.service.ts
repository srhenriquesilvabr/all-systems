import { OutboxHandlers, TenantDb } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  APPOINTMENT_PAYMENT,
  APPOINTMENT_STATUS,
  ORDER_STATUS,
  paymentMethods,
  SALE_CANCELLED,
  SALE_COMPLETED,
  sourceListQuery,
  type AppointmentPaymentEvent,
  type AppointmentStatusEvent,
  type DocType,
  type documentInput,
  type FiscalDocument,
  type FiscalPaymentMethod,
  type FiscalSource,
  type OrderStatusEvent,
  type SaleCancelledEvent,
  type SaleCompletedEvent,
} from '../contracts';
import { fiscalDocuments, fiscalSources } from '../db/schema';
import { FiscalContext } from './context.service';
import { FiscalDocumentsService } from './documents.service';

type SourceRow = typeof fiscalSources.$inferSelect;
type SourceKind = SourceRow['sourceType'];
type ParsedInput = z.infer<typeof documentInput>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });

/**
 * Origens das notas, vindas dos eventos de vendas, agenda e ordens de serviço (outbox). Guarda uma
 * cópia do que a nota precisa e, se a regra estiver ligada, já emite. Os módulos de origem não sabem
 * que este existe.
 */
@Injectable()
export class FiscalSourcesService implements OnModuleInit {
  private readonly logger = new Logger('Fiscal');

  constructor(
    private readonly tdb: TenantDb,
    private readonly ctx: FiscalContext,
    private readonly docs: FiscalDocumentsService,
    private readonly handlers: OutboxHandlers,
  ) {}

  onModuleInit() {
    this.handlers.on<SaleCompletedEvent>(SALE_COMPLETED, 'fiscal.sources.sale', (e) => this.onSale(e.payload));
    this.handlers.on<SaleCancelledEvent>(SALE_CANCELLED, 'fiscal.sources.sale-cancelled', (e) => this.onCancelled('sale', e.payload.saleId, `Venda #${e.payload.number} cancelada`));
    this.handlers.on<AppointmentPaymentEvent>(APPOINTMENT_PAYMENT, 'fiscal.sources.appointment', (e) => this.onAppointmentPayment(e.payload));
    this.handlers.on<AppointmentStatusEvent>(APPOINTMENT_STATUS, 'fiscal.sources.appointment-status', (e) =>
      e.payload.status === 'cancelled' ? this.onCancelled('appointment', e.payload.appointmentId, 'Atendimento cancelado') : Promise.resolve(),
    );
    this.handlers.on<OrderStatusEvent>(ORDER_STATUS, 'fiscal.sources.service-order', (e) => this.onOrderStatus(e.payload));
  }

  // ---- Eventos --------------------------------------------------------------------------------------

  private onSale(e: SaleCompletedEvent) {
    return this.tdb.run(async (tx) => {
      if (!(await this.ctx.isActive(tx))) return;
      const source = await this.upsert(tx, {
        sourceType: 'sale',
        sourceId: e.saleId,
        label: `Venda #${e.number}`,
        customerId: e.customerId,
        occurredAt: new Date(e.soldAt),
        total: e.total,
        status: e.total > 0 ? 'ready' : 'cancelled',
        payload: e as unknown as Record<string, unknown>,
      });
      const s = await this.ctx.settingsInTx(tx);
      if (s.autoSale !== 'off' && source.status === 'ready') await this.autoEmit(tx, source, s.autoSale);
    });
  }

  private onAppointmentPayment(e: AppointmentPaymentEvent) {
    return this.tdb.run(async (tx) => {
      if (!(await this.ctx.isActive(tx))) return;
      // Sessão de pacote sai a R$ 0: a nota é a da venda do pacote, não a do atendimento.
      if (e.total <= 0) return;
      const source = await this.upsert(tx, {
        sourceType: 'appointment',
        sourceId: e.appointmentId,
        label: `Atendimento de ${dateFmt.format(new Date(e.startsAt))}${e.professional ? ` com ${e.professional}` : ''}`,
        customerId: e.customerId,
        occurredAt: new Date(e.startsAt),
        total: e.total,
        status: e.paymentStatus === 'paid' ? 'ready' : 'pending',
        payload: e as unknown as Record<string, unknown>,
      });
      const s = await this.ctx.settingsInTx(tx);
      if (s.autoAppointment && source.status === 'ready') await this.autoEmit(tx, source, 'nfse');
    });
  }

  private onOrderStatus(e: OrderStatusEvent) {
    return this.tdb.run(async (tx) => {
      if (!(await this.ctx.isActive(tx))) return;
      if (e.cancelled) return this.cancelInTx(tx, 'service_order', e.orderId, `Ordem nº ${e.number} cancelada`);
      if (e.total <= 0) return;
      const source = await this.upsert(tx, {
        sourceType: 'service_order',
        sourceId: e.orderId,
        label: `Ordem de serviço nº ${e.number}`,
        customerId: e.customerId,
        occurredAt: new Date(),
        total: e.total,
        // Concluída = status final que não é cancelamento (ex.: "Entregue").
        status: e.terminal ? 'ready' : 'pending',
        payload: e as unknown as Record<string, unknown>,
      });
      const s = await this.ctx.settingsInTx(tx);
      if (s.autoServiceOrder && source.status === 'ready') await this.autoEmit(tx, source, 'nfse');
    });
  }

  private onCancelled(sourceType: SourceKind, sourceId: string, reason: string) {
    return this.tdb.run(async (tx) => {
      if (!(await this.ctx.isActive(tx))) return;
      await this.cancelInTx(tx, sourceType, sourceId, reason);
    });
  }

  /**
   * Origem cancelada: rascunho/rejeitada da origem é descartada; nota autorizada recebe um aviso
   * no histórico (cancelar a nota é decisão da equipe, dentro do prazo).
   */
  private async cancelInTx(tx: Tx, sourceType: SourceKind, sourceId: string, reason: string) {
    await tx
      .update(fiscalSources)
      .set({ status: 'cancelled' })
      .where(and(eq(fiscalSources.sourceType, sourceType), eq(fiscalSources.sourceId, sourceId)));
    const docs = await tx
      .select()
      .from(fiscalDocuments)
      .where(and(eq(fiscalDocuments.sourceType, sourceType), eq(fiscalDocuments.sourceId, sourceId), inArray(fiscalDocuments.status, ['draft', 'rejected', 'authorized', 'sending'])));
    for (const doc of docs) {
      if (doc.status === 'draft' || doc.status === 'rejected') await this.docs.discardInTx(tx, doc, reason, 'auto');
      else await this.docs.event(tx, doc, { kind: 'source_cancelled', status: doc.status, source: 'auto', message: `${reason}: cancele a nota fiscal se ainda estiver no prazo.` });
    }
  }

  // ---- Tela -----------------------------------------------------------------------------------------

  list(q: z.infer<typeof sourceListQuery>): Promise<FiscalSource[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ s: fiscalSources, customer: { id: customers.id, name: customers.name }, doc: { id: fiscalDocuments.id, status: fiscalDocuments.status, type: fiscalDocuments.type, number: fiscalDocuments.number } })
        .from(fiscalSources)
        .leftJoin(customers, eq(customers.id, fiscalSources.customerId))
        .leftJoin(fiscalDocuments, eq(fiscalDocuments.id, fiscalSources.documentId))
        .where(
          and(
            q.status === 'all' ? undefined : eq(fiscalSources.status, q.status),
            q.sourceType ? eq(fiscalSources.sourceType, q.sourceType) : undefined,
            q.withoutDocument ? or(isNull(fiscalSources.documentId), inArray(fiscalDocuments.status, ['cancelled', 'discarded'])) : undefined,
          ),
        )
        .orderBy(desc(fiscalSources.occurredAt))
        .limit(q.limit);
      return rows.map(({ s, customer, doc }) => ({
        id: s.id,
        sourceType: s.sourceType,
        sourceId: s.sourceId,
        label: s.label,
        customer: customer?.id ? { id: customer.id, name: customer.name } : null,
        occurredAt: s.occurredAt.toISOString(),
        total: Number(s.total),
        status: s.status,
        suggestedType: s.sourceType === 'sale' ? 'nfce' : 'nfse',
        document: doc?.id ? { id: doc.id, status: doc.status, type: doc.type, number: doc.number } : null,
        autoError: s.autoError,
      }));
    });
  }

  /** "Gerar nota" a partir da origem: monta o rascunho com o cadastro fiscal (não envia). */
  createDocument(id: string, type: DocType): Promise<FiscalDocument> {
    return this.tdb.run(async (tx) => {
      const [source] = await tx.select().from(fiscalSources).where(eq(fiscalSources.id, id)).for('update');
      if (!source) throw new NotFoundException({ code: 'SOURCE_NOT_FOUND', message: 'Origem não encontrada' });
      if (source.status === 'cancelled') throw new BadRequestException({ code: 'SOURCE_CANCELLED', message: 'A origem foi cancelada' });
      const doc = await this.draftInTx(tx, source, type, 'user');
      return this.docs.detailInTx(tx, doc.id);
    });
  }

  // ---- internos -------------------------------------------------------------------------------------

  private async draftInTx(tx: Tx, source: SourceRow, type: DocType, by: 'user' | 'auto') {
    const open = await this.docs.openDocumentForSource(tx, source.sourceType, source.sourceId);
    if (open) throw new ConflictException({ code: 'SOURCE_HAS_DOCUMENT', message: `Esta origem já tem nota (${open.status === 'authorized' ? 'autorizada' : 'em andamento'})`, documentId: open.id });
    const input = this.inputFrom(source, type);
    const doc = await this.docs.createInTx(tx, input, { sourceType: source.sourceType, sourceId: source.sourceId, sourceLabel: source.label }, by);
    await this.docs.linkSource(tx, source.sourceType, source.sourceId, doc.id);
    return doc;
  }

  /**
   * Emissão automática, num savepoint: se faltar cadastro fiscal (ou outra validação), nada da nota
   * fica gravado e a origem mostra o motivo em "A emitir".
   */
  private async autoEmit(tx: Tx, source: SourceRow, type: DocType) {
    if (source.documentId) return;
    try {
      await tx.transaction(async (sp) => {
        const doc = await this.draftInTx(sp, source, type, 'auto');
        await this.docs.issueInTx(sp, doc, 'auto');
      });
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
      const body = err.getResponse() as { message?: string | string[] };
      const message = Array.isArray(body?.message) ? body.message.join('; ') : String(body?.message ?? err.message);
      this.logger.log(`Emissão automática de ${source.label} não saiu: ${message}`);
      await tx.update(fiscalSources).set({ autoError: message.slice(0, 1000) }).where(eq(fiscalSources.id, source.id));
    }
  }

  private async upsert(tx: Tx, v: { sourceType: SourceKind; sourceId: string; label: string; customerId: string | null; occurredAt: Date; total: number; status: SourceRow['status']; payload: Record<string, unknown> }) {
    const { tenantId } = requestContext.requireTenant();
    const [row] = await tx
      .insert(fiscalSources)
      .values({ tenantId, ...v, total: v.total.toFixed(2) })
      .onConflictDoUpdate({
        target: [fiscalSources.tenantId, fiscalSources.sourceType, fiscalSources.sourceId],
        // Cancelada não volta a ficar pronta por um evento atrasado.
        set: { label: v.label, customerId: v.customerId, total: v.total.toFixed(2), payload: v.payload, status: sql`case when ${fiscalSources.status} = 'cancelled' then 'cancelled' else ${v.status} end` },
      })
      .returning();
    return row!;
  }

  /** Itens e pagamentos da nota a partir da cópia guardada da origem. */
  private inputFrom(source: SourceRow, type: DocType): ParsedInput {
    const base = { type, customerId: source.customerId, recipient: null, nature: null, additionalInfo: null, serviceDate: null };
    if (source.sourceType === 'sale') {
      const e = source.payload as unknown as SaleCompletedEvent;
      if (type === 'nfse') throw new BadRequestException({ code: 'ITEM_KIND', message: 'Venda de mercadoria sai em NFC-e ou NF-e' });
      const discounts = spread(e.discount, e.items.map((i) => i.total));
      return {
        ...base,
        items: e.items.map((i, n) => ({ ...productLine(i), discount: discounts[n]! })),
        payments: e.payments.map((p) => ({ method: (paymentMethods as readonly string[]).includes(p.method) ? (p.method as FiscalPaymentMethod) : 'other', amount: p.amount })),
      };
    }
    if (type !== 'nfse') throw new BadRequestException({ code: 'ITEM_KIND', message: 'Serviço sai em NFS-e' });
    if (source.sourceType === 'appointment') {
      const e = source.payload as unknown as AppointmentPaymentEvent;
      const lines = e.services.length ? e.services : [{ serviceId: null, name: 'Atendimento', price: e.total }];
      const prices = scale(lines.map((l) => l.price), e.total);
      return {
        ...base,
        serviceDate: e.startsAt.slice(0, 10),
        items: lines.map((l, n) => serviceLine({ refType: 'sch_service', refId: l.serviceId, description: l.name, quantity: 1, unitPrice: prices[n]! })),
        payments: [],
      };
    }
    const e = source.payload as unknown as OrderStatusEvent;
    const discounts = spread(e.discount, e.items.map((i) => i.total));
    return {
      ...base,
      items: e.items.map((i, n) => serviceLine({ refType: i.refType ?? 'so_item', refId: i.refId, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, discount: discounts[n] })),
      payments: [],
    };
  }
}

const emptyCodes = {
  ncm: null,
  cfop: null,
  cest: null,
  origin: null,
  icmsSituation: null,
  icmsRate: null,
  pisCofinsCst: null,
  pisRate: null,
  cofinsRate: null,
  taxUnit: null,
  lc116: null,
  nationalCode: null,
  nbs: null,
  municipalCode: null,
  issRate: null,
  issWithheld: null,
  ibsCbsCst: null,
  classTrib: null,
};

function productLine(i: SaleCompletedEvent['items'][number]): ParsedInput['items'][number] {
  return { ...emptyCodes, kind: 'product', refType: 'sales_product', refId: i.productId, code: i.productId.slice(0, 8).toUpperCase(), description: i.name, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, discount: 0 };
}

function serviceLine(l: { refType: string; refId: string | null; description: string; quantity: number; unitPrice: number; discount?: number }): ParsedInput['items'][number] {
  return { ...emptyCodes, kind: 'service', refType: l.refType, refId: l.refId, code: '', description: l.description, quantity: l.quantity, unit: 'UN', unitPrice: l.unitPrice, discount: l.discount ?? 0 };
}

/** Rateia um desconto do total entre os itens, proporcional ao valor (o último fica com o arredondamento). */
export function spread(amount: number, bases: number[]): number[] {
  const total = bases.reduce((a, b) => a + b, 0);
  if (!amount || !total) return bases.map(() => 0);
  const out = bases.map((b) => round2((amount * b) / total));
  out[out.length - 1] = round2(out[out.length - 1]! + amount - out.reduce((a, b) => a + b, 0));
  return out;
}

/** Ajusta preços para somar o total cobrado (atendimento com preço diferente do tabelado). */
export function scale(prices: number[], total: number): number[] {
  const sum = prices.reduce((a, b) => a + b, 0);
  if (!sum) return prices.map((_, i) => (i === 0 ? total : 0));
  const out = prices.map((p) => round2((p * total) / sum));
  out[out.length - 1] = round2(out[out.length - 1]! + total - out.reduce((a, b) => a + b, 0));
  return out;
}

