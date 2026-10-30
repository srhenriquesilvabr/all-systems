import { AuditService, CustomerDataRegistry, CustomersService, FilesService, ModuleSettingsService, TenantDb, type UploadedFile } from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { ServiceOrdersService, ServiceOrderWorkflows, type OrderDetail, type OrderItemInput } from '@all/service-orders';
import { soItems, soOrders } from '@all/service-orders/schema';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  pieceStatuses,

  type AddPiecesInput,
  type LaundryOrderInput,
  type LaundryOrderUpdate,
  type LaundrySettings,
  type Piece,
  type PieceUpdate,
  type PieceStatus,
  type ProductionPiece,
} from '../contracts';
import { laundryGarmentTypes, laundryItemDetails, laundryPieceEvents, laundryServices } from '../db/schema';
import { LaundryCatalogService } from './catalog.service';
import { LaundryLogisticsService } from './logistics.service';
import { LAUNDRY_WORKFLOW, laundryWorkflow } from './workflow';

const PHOTO_OWNER = 'laundry_item';
/** Status da ordem em que as peças ainda estão na produção. */
const IN_PRODUCTION = ['received', 'in_process'];

export interface LaundryOrderDetail {
  order: OrderDetail;
  pieces: Piece[];
}

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const kg = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

@Injectable()
export class LaundryOrdersService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly orders: ServiceOrdersService,
    private readonly workflows: ServiceOrderWorkflows,
    private readonly catalog: LaundryCatalogService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly customers: CustomersService,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
    private readonly customerData: CustomerDataRegistry,
    private readonly logistics: LaundryLogisticsService,
  ) {}

  onModuleInit() {
    this.workflows.register({
      ...laundryWorkflow,
      // Ordem cancelada não tem o que entregar: a entrega agendada cai junto, na mesma transação.
      afterTransition: async ({ tx, orderId, to, reason }) => {
        if (to === 'cancelled') await this.logistics.cancelForOrderInTx(tx as Tx, orderId, reason ?? null);
      },
    });
    this.customerData.register({
      moduleKey: 'laundry',
      export: async (tx, customerId) => ({
        pieces: (await this.piecesWhere(tx, eq(soOrders.customerId, customerId))).map(({ photos, ...p }) => ({ ...p, photos: photos.length })),
        logistics: await this.logistics.exportFor(tx, customerId),
      }),
      anonymize: (tx, customerId) => this.logistics.anonymizeFor(tx, customerId),
    });
  }

  /** Abertura no balcão: cada peça cobrada por unidade vira um item com etiqueta própria. */
  create(input: LaundryOrderInput): Promise<LaundryOrderDetail> {
    return this.tdb.run(async (tx) => {
      const { items, details, services } = await this.expandLines(tx, input.lines);

      const receivedAt = input.receivedAt ?? new Date();
      const dueAt = input.dueAt ?? (await this.defaultDueAt(tx, receivedAt, services.map((s) => s.turnaroundHours)));
      const order = await this.orders.createInTx(tx, {
        customerId: input.customerId,
        workflow: LAUNDRY_WORKFLOW,
        channel: 'counter',
        items,
        discount: input.discount,
        dueAt,
        receivedAt,
        notesCustomer: input.notesCustomer,
        notesInternal: input.notesInternal,
      });

      const { tenantId } = requestContext.requireTenant();
      await tx.insert(laundryItemDetails).values(
        order.items.map((item, i) => ({
          ...details[i]!,
          itemId: item.id,
          tenantId,
          orderId: order.id,
          tagCode: `${order.number}-${String(i + 1).padStart(2, '0')}`,
          statusChangedAt: receivedAt,
        })),
      );
      if (input.pickupJobId) await this.logistics.linkPickupInTx(tx, input.pickupJobId, { id: order.id, number: order.number, customerId: order.customer.id });
      await this.audit.log(tx, { action: 'laundry.order.created', entity: 'service_order', entityId: order.id, data: { pieces: items.length, pickupJobId: input.pickupJobId ?? undefined } });
      return this.detailInTx(tx, order.id);
    });
  }

  get(orderId: string) {
    return this.tdb.run((tx) => this.detailInTx(tx, orderId));
  }

  /** Previsão, desconto e observações. A regra de cada situação está no fluxo (workflow.ts). */
  update(orderId: string, input: LaundryOrderUpdate): Promise<LaundryOrderDetail> {
    return this.tdb.run(async (tx) => {
      await this.detailInTx(tx, orderId);
      await this.orders.updateInTx(tx, orderId, input);
      return this.detailInTx(tx, orderId);
    });
  }

  /** Mais peças numa ordem que ainda está na produção. A etiqueta continua de onde parou (nunca reaproveita). */
  addPieces(orderId: string, lines: AddPiecesInput['lines']): Promise<LaundryOrderDetail> {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      const order = await this.orderInProduction(tx, orderId);
      const { items, details } = await this.expandLines(tx, lines);
      const added = await this.orders.changeItemsInTx(tx, orderId, { add: items });
      const existing = await tx.select({ tagCode: laundryItemDetails.tagCode }).from(laundryItemDetails).where(eq(laundryItemDetails.orderId, orderId));
      const last = existing.reduce((max, p) => Math.max(max, Number(p.tagCode.split('-').pop()) || 0), 0);
      await tx.insert(laundryItemDetails).values(
        added.map((item, i) => ({
          ...details[i]!,
          itemId: item.id,
          tenantId,
          orderId,
          tagCode: `${order.number}-${String(last + i + 1).padStart(2, '0')}`,
        })),
      );
      await this.audit.log(tx, { action: 'laundry.order.pieces_added', entity: 'service_order', entityId: orderId, data: { pieces: added.length } });
      return this.detailInTx(tx, orderId);
    });
  }

  /** Só sai a peça que ainda não começou: depois disso, a etapa e o retrabalho são histórico. */
  removePiece(orderId: string, itemId: string): Promise<LaundryOrderDetail> {
    return this.tdb.run(async (tx) => {
      await this.orderInProduction(tx, orderId);
      const [piece] = await tx.select().from(laundryItemDetails).where(and(eq(laundryItemDetails.itemId, itemId), eq(laundryItemDetails.orderId, orderId))).for('update');
      if (!piece) throw new NotFoundException({ code: 'PIECE_NOT_FOUND', message: 'Peça não encontrada' });
      if (piece.status !== 'received' || piece.reworkCount > 0 || piece.incidentAt) {
        throw badRequest('PIECE_STARTED', `A peça ${piece.tagCode} já foi trabalhada e não pode sair da ordem`);
      }
      const photos = await this.files.listByOwners(tx, PHOTO_OWNER, [itemId]);
      await this.orders.changeItemsInTx(tx, orderId, { removeIds: [itemId] });
      for (const photo of photos) await this.files.removeInTx(tx, photo.id, { entity: PHOTO_OWNER, id: itemId });
      await this.audit.log(tx, { action: 'laundry.order.piece_removed', entity: 'service_order', entityId: orderId, data: { itemId, tagCode: piece.tagCode } });
      // Se era a única que faltava, a ordem fica pronta (e o cliente é avisado).
      await this.syncOrderStatus(tx, orderId);
      return this.detailInTx(tx, orderId);
    });
  }

  /** Cor, marca e avarias: não mudam preço nem etiqueta. Vale até a ordem sair da loja. */
  updatePiece(itemId: string, input: PieceUpdate) {
    return this.tdb.run(async (tx) => {
      const [piece] = await tx.select().from(laundryItemDetails).where(eq(laundryItemDetails.itemId, itemId)).for('update');
      if (!piece) throw new NotFoundException({ code: 'PIECE_NOT_FOUND', message: 'Peça não encontrada' });
      const [order] = await tx.select({ status: soOrders.status, number: soOrders.number }).from(soOrders).where(eq(soOrders.id, piece.orderId));
      if (!['received', 'in_process', 'ready'].includes(order!.status)) throw badRequest('ORDER_CLOSED', `A ordem nº ${order!.number} já saiu da produção`);
      await tx
        .update(laundryItemDetails)
        .set({
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.intakeNotes !== undefined ? { intakeNotes: input.intakeNotes } : {}),
        })
        .where(eq(laundryItemDetails.itemId, itemId));
      await this.audit.log(tx, { action: 'laundry.piece.updated', entity: 'service_order', entityId: piece.orderId, data: { itemId, fields: Object.keys(input) } });
      return (await this.piecesWhere(tx, eq(laundryItemDetails.itemId, itemId)))[0]!;
    });
  }

  /** Avança (ou volta, em retrabalho) as peças de etapa; a ordem acompanha sozinha. */
  movePieces(itemIds: string[], status: PieceStatus) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const rows = await tx.select().from(laundryItemDetails).where(inArray(laundryItemDetails.itemId, itemIds)).for('update');
      if (rows.length !== new Set(itemIds).size) throw new NotFoundException({ code: 'PIECE_NOT_FOUND', message: 'Peça não encontrada' });

      const orderIds = [...new Set(rows.map((r) => r.orderId))];
      const closed = await tx
        .select({ number: soOrders.number })
        .from(soOrders)
        .where(and(inArray(soOrders.id, orderIds), sql`${soOrders.status} not in ('received', 'in_process', 'ready')`));
      if (closed.length) throw badRequest('ORDER_CLOSED', `A ordem nº ${closed[0]!.number} já saiu da produção`);
      await this.assertPhotos(tx, rows, status);

      for (const row of rows) {
        if (row.status === status) continue;
        const backwards = pieceStatuses.indexOf(status) < pieceStatuses.indexOf(row.status);
        await tx
          .update(laundryItemDetails)
          .set({ status, statusChangedAt: new Date(), ...(backwards ? { reworkCount: row.reworkCount + 1 } : {}) })
          .where(eq(laundryItemDetails.itemId, row.itemId));
        await tx.insert(laundryPieceEvents).values({
          tenantId,
          itemId: row.itemId,
          kind: backwards ? 'rework' : 'status',
          fromStatus: row.status,
          toStatus: status,
          userId,
        });
      }
      for (const orderId of orderIds) await this.syncOrderStatus(tx, orderId);
      return this.piecesWhere(tx, inArray(laundryItemDetails.itemId, itemIds));
    });
  }

  /** Avaria, mancha que não saiu, peça trocada…: registra e avisa o cliente. */
  reportIncident(itemId: string, notes: string) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [piece] = await this.piecesWhere(tx, eq(laundryItemDetails.itemId, itemId));
      if (!piece) throw new NotFoundException({ code: 'PIECE_NOT_FOUND', message: 'Peça não encontrada' });
      const [order] = await tx.select().from(soOrders).where(eq(soOrders.id, piece.orderId));

      await tx.update(laundryItemDetails).set({ incidentNotes: notes, incidentAt: new Date() }).where(eq(laundryItemDetails.itemId, itemId));
      await tx.insert(laundryPieceEvents).values({ tenantId, itemId, kind: 'incident', notes, userId });
      await this.customers.addTimeline(tx, {
        customerId: order!.customerId,
        moduleKey: 'laundry',
        type: 'laundry.incident',
        title: `Ocorrência na peça ${piece.tagCode}: ${notes}`,
        entity: 'service_order',
        entityId: order!.id,
      });
      await this.notifications.enqueueInTx(tx, {
        templateKey: 'laundry.item.incident',
        customerId: order!.customerId,
        related: { entity: 'service_order', id: order!.id },
        data: { os: { numero: order!.number }, peca: { descricao: piece.description, etiqueta: piece.tagCode }, ocorrencia: notes },
      });
      await this.audit.log(tx, { action: 'laundry.incident', entity: 'service_order', entityId: order!.id, data: { itemId, notes } });
      return (await this.piecesWhere(tx, eq(laundryItemDetails.itemId, itemId)))[0]!;
    });
  }

  addPhoto(itemId: string, file: UploadedFile) {
    return this.tdb.run(async (tx) => {
      await this.pieceOrFail(tx, itemId);
      return this.files.saveImageInTx(tx, file, { entity: PHOTO_OWNER, id: itemId });
    });
  }

  removePhoto(itemId: string, fileId: string) {
    return this.tdb.run((tx) => this.files.removeInTx(tx, fileId, { entity: PHOTO_OWNER, id: itemId }));
  }

  /**
   * Peças das ordens que ainda estão em produção, das mais urgentes para as menos. Com `includeReady`,
   * também as das ordens prontas e ainda na loja, para dar retrabalho pelo quadro.
   */
  production(includeReady = false): Promise<ProductionPiece[]> {
    return this.tdb.run((tx) => this.productionWhere(tx, inArray(soOrders.status, includeReady ? [...IN_PRODUCTION, 'ready'] : IN_PRODUCTION)));
  }

  /** Leitura da etiqueta (digitada ou por leitor de código). */
  async byTag(tag: string): Promise<ProductionPiece> {
    const [piece] = await this.tdb.run((tx) => this.productionWhere(tx, eq(laundryItemDetails.tagCode, tag.trim())));
    if (!piece) throw new NotFoundException({ code: 'PIECE_NOT_FOUND', message: `Nenhuma peça com a etiqueta ${tag}` });
    return piece;
  }

  // ---- internos -----------------------------------------------------------------------------

  /** Cada linha do balcão vira itens e detalhes: por peça, um por unidade; por kg/m², um só. */
  private async expandLines(tx: Tx, lines: LaundryOrderInput['lines']) {
    const serviceIds = [...new Set(lines.map((l) => l.serviceId))];
    const services = new Map((await tx.select().from(laundryServices).where(inArray(laundryServices.id, serviceIds))).map((s) => [s.id, s]));
    const garmentIds = [...new Set(lines.map((l) => l.garmentTypeId).filter((g): g is string => !!g))];
    const garments = new Map(garmentIds.length ? (await tx.select().from(laundryGarmentTypes).where(inArray(laundryGarmentTypes.id, garmentIds))).map((g) => [g.id, g]) : []);

    const items: OrderItemInput[] = [];
    const details: Omit<typeof laundryItemDetails.$inferInsert, 'itemId' | 'tenantId' | 'orderId' | 'tagCode'>[] = [];
    for (const line of lines) {
      const service = services.get(line.serviceId);
      if (!service?.active) throw badRequest('SERVICE_NOT_FOUND', 'Serviço inexistente ou inativo');
      const garment = line.garmentTypeId ? garments.get(line.garmentTypeId) : undefined;
      if (line.garmentTypeId && !garment) throw badRequest('GARMENT_NOT_FOUND', 'Tipo de peça não encontrado');

      const base = { serviceId: service.id, garmentTypeId: garment?.id ?? null, color: line.color ?? null, brand: line.brand ?? null, intakeNotes: line.intakeNotes ?? null };
      const ref = { refType: 'laundry_service', refId: service.id };

      if (service.pricingUnit === 'piece') {
        const unitPrice = (await this.catalog.unitPriceCents(tx, service, garment?.id)) / 100;
        const description = [garment?.name, service.name].filter(Boolean).join(' — ') + (line.color ? ` (${line.color})` : '');
        for (let i = 0; i < line.quantity; i++) {
          items.push({ description, quantity: 1, unitPrice, ...ref });
          details.push({ ...base, piecesCount: 1 });
        }
      } else {
        const measure = service.pricingUnit === 'kg' ? line.weightKg : line.areaSqm;
        if (!measure) throw badRequest('MEASURE_REQUIRED', service.pricingUnit === 'kg' ? `Informe o peso para "${service.name}"` : `Informe a área para "${service.name}"`);
        const unit = service.pricingUnit === 'kg' ? 'kg' : 'm²';
        items.push({
          description: `${service.name}${garment ? ` — ${garment.name}` : ''} (${kg.format(measure)} ${unit}, ${line.quantity} peça${line.quantity > 1 ? 's' : ''})`,
          quantity: measure,
          unitPrice: Number(service.basePrice),
          ...ref,
        });
        details.push({ ...base, piecesCount: line.quantity, weightKg: service.pricingUnit === 'kg' ? String(measure) : null });
      }
    }
    return { items, details, services: [...services.values()] };
  }

  /** Incluir ou tirar peças: só com a ordem Recebida ou Em produção. Trava a ordem. */
  private async orderInProduction(tx: Tx, orderId: string) {
    const [order] = await tx.select().from(soOrders).where(eq(soOrders.id, orderId)).for('update');
    if (!order || order.workflow !== LAUNDRY_WORKFLOW) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Ordem de lavanderia não encontrada' });
    if (!IN_PRODUCTION.includes(order.status)) throw badRequest('ORDER_NOT_IN_PRODUCTION', `A ordem nº ${order.number} já está pronta ou encerrada: as peças não mudam mais`);
    return order;
  }

  /** Com a exigência ligada, a peça só sai de "Recebida" depois de fotografada. */
  private async assertPhotos(tx: Tx, rows: (typeof laundryItemDetails.$inferSelect)[], status: PieceStatus) {
    const leaving = rows.filter((r) => r.status === 'received' && status !== 'received');
    if (!leaving.length) return;
    const settings = await this.settings.getInTx<LaundrySettings>(tx, 'laundry');
    if (!settings.requirePiecePhotos) return;
    const photos = await this.files.listByOwners(tx, PHOTO_OWNER, leaving.map((r) => r.itemId));
    const missing = leaving.filter((r) => !photos.some((f) => f.ownerId === r.itemId));
    if (missing.length) {
      const tags = missing.slice(0, 5).map((r) => r.tagCode).join(', ');
      throw badRequest('PHOTO_REQUIRED', `Fotografe a peça antes de iniciar: ${tags}${missing.length > 5 ? ` e mais ${missing.length - 5}` : ''}`);
    }
  }

  /** A ordem segue as peças: começou a produção → "Em produção"; todas prontas → "Pronta". */
  private async syncOrderStatus(tx: Tx, orderId: string) {
    const [order] = await tx.select({ status: soOrders.status }).from(soOrders).where(eq(soOrders.id, orderId));
    const pieces = await tx.select({ status: laundryItemDetails.status }).from(laundryItemDetails).where(eq(laundryItemDetails.orderId, orderId));
    let status = order!.status;
    const allReady = pieces.every((p) => p.status === 'ready');
    const started = pieces.some((p) => p.status !== 'received');

    if (status === 'received' && started) status = (await this.orders.transitionInTx(tx, orderId, 'in_process')).status;
    if (status === 'in_process' && allReady) status = (await this.orders.transitionInTx(tx, orderId, 'ready')).status;
    // Retrabalho depois de pronta: a ordem volta para a produção (e o cliente não é avisado de novo até ficar pronta).
    if (status === 'ready' && !allReady) await this.orders.transitionInTx(tx, orderId, 'in_process');
  }

  private async detailInTx(tx: Tx, orderId: string): Promise<LaundryOrderDetail> {
    const order = await this.orders.detail(tx, orderId);
    if (order.workflow !== LAUNDRY_WORKFLOW) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Ordem de lavanderia não encontrada' });
    return { order, pieces: await this.piecesWhere(tx, eq(laundryItemDetails.orderId, orderId)) };
  }

  private async pieceOrFail(tx: Tx, itemId: string) {
    const [row] = await tx.select({ itemId: laundryItemDetails.itemId }).from(laundryItemDetails).where(eq(laundryItemDetails.itemId, itemId));
    if (!row) throw new NotFoundException({ code: 'PIECE_NOT_FOUND', message: 'Peça não encontrada' });
  }

  private async piecesWhere(tx: Tx, where: ReturnType<typeof eq>): Promise<Piece[]> {
    const rows = await this.pieceQuery(tx).where(where).orderBy(asc(soItems.orderId), asc(soItems.position));
    return this.withPhotos(tx, rows.map(toPiece));
  }

  private async productionWhere(tx: Tx, where: ReturnType<typeof eq>): Promise<ProductionPiece[]> {
    const rows = await this.pieceQuery(tx)
      .where(where)
      .orderBy(sql`${soOrders.dueAt} asc nulls last`, asc(soOrders.number), asc(soItems.position));
    const pieces = await this.withPhotos(tx, rows.map(toPiece));
    return pieces.map((p, i) => ({
      ...p,
      orderNumber: rows[i]!.orderNumber,
      customerName: rows[i]!.customerName,
      dueAt: rows[i]!.dueAt?.toISOString() ?? null,
    }));
  }

  private pieceQuery(tx: Tx) {
    return tx
      .select({
        details: laundryItemDetails,
        description: soItems.description,
        serviceName: laundryServices.name,
        pricingUnit: laundryServices.pricingUnit,
        garmentName: laundryGarmentTypes.name,
        orderNumber: soOrders.number,
        dueAt: soOrders.dueAt,
        customerName: customers.name,
      })
      .from(laundryItemDetails)
      .innerJoin(soItems, eq(soItems.id, laundryItemDetails.itemId))
      .innerJoin(soOrders, eq(soOrders.id, laundryItemDetails.orderId))
      .innerJoin(customers, eq(customers.id, soOrders.customerId))
      .innerJoin(laundryServices, eq(laundryServices.id, laundryItemDetails.serviceId))
      .leftJoin(laundryGarmentTypes, eq(laundryGarmentTypes.id, laundryItemDetails.garmentTypeId))
      .$dynamic();
  }

  private async withPhotos<T extends Piece>(tx: Tx, pieces: T[]): Promise<T[]> {
    const photos = await this.files.listByOwners(tx, PHOTO_OWNER, pieces.map((p) => p.itemId));
    return pieces.map((p) => ({
      ...p,
      photos: photos.filter((f) => f.ownerId === p.itemId).map((f) => ({ id: f.id, filename: f.filename })),
    }));
  }

  private async defaultDueAt(tx: Tx, receivedAt: Date, turnarounds: number[]) {
    const settings = await this.settings.getInTx<{ defaultTurnaroundHours: number }>(tx, 'laundry');
    const hours = Math.max(...turnarounds, 0) || settings.defaultTurnaroundHours;
    return new Date(receivedAt.getTime() + hours * 3600_000);
  }
}

type PieceRow = {
  details: typeof laundryItemDetails.$inferSelect;
  description: string;
  serviceName: string;
  pricingUnit: 'piece' | 'kg' | 'sqm';
  garmentName: string | null;
};

function toPiece(r: PieceRow): Piece {
  const d = r.details;
  return {
    itemId: d.itemId,
    orderId: d.orderId,
    tagCode: d.tagCode,
    description: r.description,
    serviceId: d.serviceId,
    serviceName: r.serviceName,
    pricingUnit: r.pricingUnit,
    garmentTypeId: d.garmentTypeId,
    garmentName: r.garmentName,
    color: d.color,
    brand: d.brand,
    intakeNotes: d.intakeNotes,
    incidentNotes: d.incidentNotes,
    incidentAt: d.incidentAt?.toISOString() ?? null,
    weightKg: d.weightKg === null ? null : Number(d.weightKg),
    piecesCount: d.piecesCount,
    status: d.status,
    reworkCount: d.reworkCount,
    statusChangedAt: d.statusChangedAt.toISOString(),
    photos: [],
  };
}

