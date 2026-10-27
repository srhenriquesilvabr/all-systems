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

  type LaundryOrderInput,
  type Piece,
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
    this.workflows.register(laundryWorkflow);
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
      const serviceIds = [...new Set(input.lines.map((l) => l.serviceId))];
      const services = new Map(
        (await tx.select().from(laundryServices).where(inArray(laundryServices.id, serviceIds))).map((s) => [s.id, s]),
      );
      const garmentIds = [...new Set(input.lines.map((l) => l.garmentTypeId).filter((g): g is string => !!g))];
      const garments = new Map(
        garmentIds.length
          ? (await tx.select().from(laundryGarmentTypes).where(inArray(laundryGarmentTypes.id, garmentIds))).map((g) => [g.id, g])
          : [],
      );

      const items: OrderItemInput[] = [];
      const details: Omit<typeof laundryItemDetails.$inferInsert, 'itemId' | 'tenantId' | 'orderId' | 'tagCode'>[] = [];
      for (const line of input.lines) {
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

      const receivedAt = input.receivedAt ?? new Date();
      const dueAt = input.dueAt ?? (await this.defaultDueAt(tx, receivedAt, [...services.values()].map((s) => s.turnaroundHours)));
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

  /** Peças das ordens que ainda estão em produção, das mais urgentes para as menos. */
  production(): Promise<ProductionPiece[]> {
    return this.tdb.run((tx) => this.productionWhere(tx, inArray(soOrders.status, IN_PRODUCTION)));
  }

  /** Leitura da etiqueta (digitada ou por leitor de código). */
  async byTag(tag: string): Promise<ProductionPiece> {
    const [piece] = await this.tdb.run((tx) => this.productionWhere(tx, eq(laundryItemDetails.tagCode, tag.trim())));
    if (!piece) throw new NotFoundException({ code: 'PIECE_NOT_FOUND', message: `Nenhuma peça com a etiqueta ${tag}` });
    return piece;
  }

  // ---- internos -----------------------------------------------------------------------------

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

