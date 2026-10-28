import { AuditService, centsToDecimal, centsToNumber, CustomersService, FilesService, FinanceService, ModuleSettingsService, TenantDb, toCents, type UploadedFile } from '@all/core';
import { customers, memberships, users } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { ServiceOrdersService } from '@all/service-orders';
import { soOrders } from '@all/service-orders/schema';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  feeMethodLabel,
  formatAddress,
  jobKindLabel,
  mapsUrl,
  periodLabel,
  resolveWindow,
  type CompleteJobInput,
  type DeliveryInput,
  type FailJobInput,
  type FeeMethod,
  type JobAddress,
  type JobKind,
  type JobsQuery,
  type JobUpdateInput,
  type LaundrySettings,
  type LogisticsJob,
  type PickupInput,
  type StartJobInput,
} from '../contracts';
import { laundryLogisticsJobs } from '../db/schema';
import { LAUNDRY_WORKFLOW } from './workflow';

/** Origem da taxa de coleta/entrega no financeiro. */
const FEE_SOURCE = 'laundry_logistics';
/** Dono das fotos do comprovante de entrega em `files`. */
const PHOTO_OWNER = 'laundry_logistics_job';
const MANAGE = 'laundry.logistics.manage';
/** Status da ordem em que ainda dá para agendar a entrega (antes de sair para entrega). */
const ORDER_OPEN = ['received', 'in_process', 'ready'];

type JobRow = typeof laundryLogisticsJobs.$inferSelect;

const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const notFound = () => new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Coleta/entrega não encontrada' });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });

/** Dia (YYYY-MM-DD) de um momento no fuso de São Paulo; sem momento, hoje. */
const spDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const spToday = () => spDay(new Date());
const hhmm = (t: string) => t.slice(0, 5);
const momentFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const shortDay = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
/** Horário informado (a validação aceita até 5 min à frente, relógio do celular adiantado) ou agora. */
const upToNow = (d: Date | undefined) => {
  const now = new Date();
  return d && d < now ? d : now;
};
/**
 * Evento registrado depois (mais de 30 min atrás): o cliente não é avisado — "estamos a caminho"
 * ou "entregue" de algo que já passou só confunde.
 */
const LATE_MS = 30 * 60_000;
const isLate = (at: Date) => Date.now() - at.getTime() > LATE_MS;

/**
 * Coletas e entregas da lavanderia. O escritório (laundry.logistics.manage) agenda, atribui e
 * reagenda; o motorista (laundry.logistics.drive) só vê e movimenta as tarefas atribuídas a ele.
 *
 * Registro do que já aconteceu: a tarefa pode ser criada num dia que já passou, e sair, concluir e
 * "não realizada" aceitam o horário em que aconteceram (nunca no futuro, nunca antes do dia da
 * tarefa, sempre na ordem: tentativa que falhou → saída → conclusão/falha). A taxa recebida na
 * conclusão entra no financeiro nesse dia; o cliente só é avisado do que é de agora.
 */
@Injectable()
export class LaundryLogisticsService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly orders: ServiceOrdersService,
    private readonly customers: CustomersService,
    private readonly files: FilesService,
    private readonly finance: FinanceService,
    private readonly notifications: NotificationsService,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Taxas padrão (para quem agenda e não acessa as configurações do módulo). */
  async defaults(): Promise<{ pickupFee: number; deliveryFee: number }> {
    const s = await this.tdb.run((tx) => this.settings.getInTx<LaundrySettings>(tx, 'laundry'));
    return { pickupFee: s.pickupFee, deliveryFee: s.deliveryFee };
  }

  /** Quadro do escritório. Sem filtro de data/ordem/cliente/status, mostra o dia de hoje. */
  list(q: JobsQuery): Promise<LogisticsJob[]> {
    const t = laundryLogisticsJobs;
    const unfiltered = !q.date && !q.from && !q.to && !q.orderId && !q.customerId && !q.status;
    const where = and(
      q.date || unfiltered ? eq(t.date, q.date ?? spToday()) : undefined,
      q.from ? gte(t.date, q.from) : undefined,
      q.to ? lte(t.date, q.to) : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.kind ? eq(t.kind, q.kind) : undefined,
      q.driverId === 'none' ? isNull(t.driverUserId) : q.driverId ? eq(t.driverUserId, q.driverId) : undefined,
      q.orderId ? eq(t.orderId, q.orderId) : undefined,
      q.customerId ? eq(t.customerId, q.customerId) : undefined,
    );
    return this.tdb.run((tx) => this.jobsWhere(tx, where));
  }

  /** "Minhas rotas": as tarefas do dia atribuídas a quem pergunta, mais as que ficaram em rota. */
  myRoute(date?: string): Promise<LogisticsJob[]> {
    const { userId } = requestContext.require();
    const t = laundryLogisticsJobs;
    return this.tdb.run((tx) =>
      this.jobsWhere(tx, and(eq(t.driverUserId, userId), ne(t.status, 'cancelled'), or(eq(t.date, date ?? spToday()), eq(t.status, 'en_route')))),
    );
  }

  get(id: string): Promise<LogisticsJob> {
    return this.tdb.run(async (tx) => {
      await this.findForAction(tx, id);
      return this.jobOrFail(tx, id);
    });
  }

  schedulePickup(input: PickupInput): Promise<LogisticsJob> {
    return this.tdb.run(async (tx) => {
      const job = await this.insertJob(tx, 'pickup', input.customerId, null, input);
      return this.jobOrFail(tx, job.id);
    });
  }

  /** "Entregar no endereço": agenda a entrega de uma ordem (antes de ela sair para entrega). */
  scheduleDelivery(orderId: string, input: DeliveryInput): Promise<LogisticsJob> {
    return this.tdb.run(async (tx) => {
      const order = await this.laundryOrder(tx, orderId, true);
      if (!ORDER_OPEN.includes(order.status)) {
        throw badRequest('ORDER_NOT_OPEN', `A ordem nº ${order.number} já saiu para entrega, foi entregue ou foi cancelada`);
      }
      const [open] = await tx
        .select({ id: laundryLogisticsJobs.id })
        .from(laundryLogisticsJobs)
        .where(and(eq(laundryLogisticsJobs.orderId, orderId), eq(laundryLogisticsJobs.kind, 'delivery'), inArray(laundryLogisticsJobs.status, ['scheduled', 'en_route', 'failed'])));
      if (open) throw new ConflictException({ code: 'DELIVERY_EXISTS', message: `A ordem nº ${order.number} já tem uma entrega em aberto` });

      const job = await this.insertJob(tx, 'delivery', order.customerId, order, input);
      return this.jobOrFail(tx, job.id);
    });
  }

  /** Atribuir motorista, reagendar (inclusive o que não deu certo), mudar endereço, taxa ou observação. */
  update(id: string, input: JobUpdateInput): Promise<LogisticsJob> {
    return this.tdb.run(async (tx) => {
      const job = await this.findForAction(tx, id, true);
      if (job.status !== 'scheduled' && job.status !== 'failed') {
        throw badRequest('JOB_LOCKED', 'Só dá para alterar coletas/entregas agendadas ou não realizadas');
      }
      const patch: Partial<typeof laundryLogisticsJobs.$inferInsert> = {};

      if (input.driverUserId !== undefined) {
        if (input.driverUserId) await this.assertMember(tx, input.driverUserId);
        patch.driverUserId = input.driverUserId;
      }
      if (input.address !== undefined) patch.address = this.assertAddress(input.address);
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.date !== undefined) {
        if (input.date !== job.date) this.assertReschedule(job, input.date);
        patch.date = input.date;
      }
      if (input.period !== undefined || input.windowStart !== undefined || input.windowEnd !== undefined) {
        const w = resolveWindow(input);
        if ('error' in w) throw badRequest('INVALID_WINDOW', w.error);
        Object.assign(patch, w);
      }
      const windowChanged =
        (patch.date !== undefined && patch.date !== job.date) ||
        (patch.windowStart !== undefined && (patch.windowStart !== hhmm(job.windowStart) || patch.windowEnd !== hhmm(job.windowEnd)));
      // Reagendar (informar a data) o que não deu certo põe a tarefa de volta na rota, mesmo que no mesmo dia.
      const retry = job.status === 'failed' && (windowChanged || input.date !== undefined);
      if (retry) {
        patch.status = 'scheduled';
        patch.startedAt = null;
      }
      const rescheduled = windowChanged || retry;
      const feeChanged = input.fee !== undefined && toCents(input.fee) !== toCents(job.fee);
      if (feeChanged) patch.fee = centsToDecimal(toCents(input.fee!));

      const [updated] = await tx
        .update(laundryLogisticsJobs)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(laundryLogisticsJobs.id, id))
        .returning();
      // Vencimento da taxa acompanha a data; valor novo substitui o "a receber" (se ainda não foi pago).
      if (feeChanged || rescheduled) await this.syncFee(tx, updated!, { failIfPaid: feeChanged });
      if (rescheduled) await this.notifyScheduled(tx, updated!);
      await this.audit.log(tx, { action: rescheduled ? 'laundry.logistics.rescheduled' : 'laundry.logistics.updated', entity: 'laundry_logistics_job', entityId: id, data: input });
      return this.jobOrFail(tx, id);
    });
  }

  /** Motorista saiu: a entrega leva a ordem para "Saiu para entrega" (e o cliente é avisado). */
  start(id: string, input: StartJobInput = {}): Promise<LogisticsJob> {
    const { userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const job = await this.findForAction(tx, id, true);
      if (job.status !== 'scheduled') throw badRequest('INVALID_JOB_STATUS', 'Só coletas/entregas agendadas podem sair para a rota');
      const at = upToNow(input.occurredAt);
      this.assertMoment(job, at, !!input.occurredAt);

      if (job.kind === 'delivery') {
        const order = await this.laundryOrder(tx, job.orderId!, true);
        this.assertAfterOrder(order, at);
        if (order.status === 'ready') await this.orders.transitionInTx(tx, order.id, 'out_for_delivery', null, { at, notify: !isLate(at) });
        else if (order.status !== 'out_for_delivery') throw badRequest('ORDER_NOT_READY', `A ordem nº ${order.number} ainda não está pronta para entrega`);
      } else if (!isLate(at)) {
        await this.notifications.enqueueInTx(tx, {
          templateKey: 'laundry.pickup.on_the_way',
          customerId: job.customerId,
          related: { entity: PHOTO_OWNER, id: job.id },
          data: await this.templateData(tx, job),
        });
      }
      const [updated] = await tx
        .update(laundryLogisticsJobs)
        .set({ status: 'en_route', startedAt: at, driverUserId: job.driverUserId ?? userId })
        .where(eq(laundryLogisticsJobs.id, id))
        .returning();
      await this.audit.log(tx, { action: 'laundry.logistics.started', entity: 'laundry_logistics_job', entityId: id, data: input.occurredAt ? { occurredAt: at.toISOString() } : undefined });
      return this.jobOrFail(tx, updated!.id);
    });
  }

  /**
   * Concluída. Entrega: exige quem recebeu e marca a ordem como entregue (foto do comprovante é
   * opcional, enviada à parte). Coleta: exige a quantidade de peças; a ordem é aberta no balcão.
   */
  complete(id: string, input: CompleteJobInput): Promise<LogisticsJob> {
    return this.tdb.run(async (tx) => {
      const job = await this.findForAction(tx, id, true);
      if (job.status !== 'scheduled' && job.status !== 'en_route') throw badRequest('INVALID_JOB_STATUS', 'Esta coleta/entrega não está em aberto');
      const at = upToNow(input.occurredAt);
      this.assertMoment(job, at, !!input.occurredAt);

      let title: string;
      if (job.kind === 'delivery') {
        if (!input.receiverName) throw badRequest('RECEIVER_REQUIRED', 'Informe o nome de quem recebeu');
        const order = await this.laundryOrder(tx, job.orderId!, true);
        this.assertAfterOrder(order, at);
        if (order.status === 'ready' || order.status === 'out_for_delivery') await this.orders.transitionInTx(tx, order.id, 'delivered', null, { at, notify: !isLate(at) });
        else if (order.status !== 'delivered') throw badRequest('ORDER_NOT_READY', `A ordem nº ${order.number} não está pronta para entrega`);
        title = `Entrega da ordem nº ${order.number} concluída (recebido por ${input.receiverName})`;
      } else {
        if (!input.itemsCount) throw badRequest('ITEMS_REQUIRED', 'Informe quantas peças foram coletadas');
        title = `Coleta concluída: ${input.itemsCount} peça(s)`;
      }
      if (spDay(at) < spToday()) title += ` em ${shortDay.format(at)}`;

      const notes = input.notes ? [job.notes, `Na conclusão: ${input.notes}`].filter(Boolean).join('\n') : job.notes;
      const [updated] = await tx
        .update(laundryLogisticsJobs)
        .set({
          status: 'done',
          completedAt: at,
          startedAt: job.startedAt ?? at,
          receiverName: job.kind === 'delivery' ? input.receiverName : null,
          itemsCount: job.kind === 'pickup' ? input.itemsCount : null,
          notes,
          failReason: null,
        })
        .where(eq(laundryLogisticsJobs.id, id))
        .returning();
      if (input.feeMethod && toCents(job.fee) > 0) await this.settleFee(tx, updated!, input.feeMethod, at);

      await this.customers.addTimeline(tx, {
        customerId: job.customerId,
        moduleKey: 'laundry',
        type: `laundry.${job.kind}.done`,
        title,
        entity: 'laundry_logistics_job',
        entityId: id,
      });
      await this.audit.log(tx, { action: 'laundry.logistics.completed', entity: 'laundry_logistics_job', entityId: id, data: input });
      return this.jobOrFail(tx, id);
    });
  }

  /** Não deu (cliente ausente, endereço errado…): registra o motivo; a ordem volta para "Pronta". */
  fail(id: string, input: FailJobInput): Promise<LogisticsJob> {
    const { reason } = input;
    return this.tdb.run(async (tx) => {
      const job = await this.findForAction(tx, id, true);
      if (job.status !== 'scheduled' && job.status !== 'en_route') throw badRequest('INVALID_JOB_STATUS', 'Esta coleta/entrega não está em aberto');
      const at = upToNow(input.occurredAt);
      this.assertMoment(job, at, !!input.occurredAt);
      await this.returnOrderToShop(tx, job, `Entrega não realizada: ${reason}`, at);
      await tx
        .update(laundryLogisticsJobs)
        .set({ status: 'failed', failReason: reason, failedAt: at, attempts: job.attempts + 1 })
        .where(eq(laundryLogisticsJobs.id, id));
      await this.customers.addTimeline(tx, {
        customerId: job.customerId,
        moduleKey: 'laundry',
        type: `laundry.${job.kind}.failed`,
        title: `${jobKindLabel[job.kind]} não realizada${spDay(at) < spToday() ? ` em ${shortDay.format(at)}` : ''}: ${reason}`,
        entity: 'laundry_logistics_job',
        entityId: id,
      });
      await this.audit.log(tx, { action: 'laundry.logistics.failed', entity: 'laundry_logistics_job', entityId: id, data: { reason, ...(input.occurredAt ? { occurredAt: at.toISOString() } : {}) } });
      return this.jobOrFail(tx, id);
    });
  }

  cancel(id: string, reason?: string | null): Promise<LogisticsJob> {
    return this.tdb.run(async (tx) => {
      const job = await this.findForAction(tx, id, true);
      if (job.status === 'done' || job.status === 'cancelled') throw badRequest('INVALID_JOB_STATUS', 'Esta coleta/entrega já foi encerrada');
      await this.returnOrderToShop(tx, job, `Entrega cancelada${reason ? `: ${reason}` : ''}`);
      const [updated] = await tx
        .update(laundryLogisticsJobs)
        .set({ status: 'cancelled', cancelReason: reason ?? null })
        .where(eq(laundryLogisticsJobs.id, id))
        .returning();
      await this.syncFee(tx, updated!);
      await this.audit.log(tx, { action: 'laundry.logistics.cancelled', entity: 'laundry_logistics_job', entityId: id, data: { reason } });
      return this.jobOrFail(tx, id);
    });
  }

  /** Liga uma coleta concluída à ordem aberta depois no balcão. */
  linkOrder(id: string, orderId: string): Promise<LogisticsJob> {
    return this.tdb.run(async (tx) => {
      const order = await this.laundryOrder(tx, orderId);
      await this.linkPickupInTx(tx, id, order);
      return this.jobOrFail(tx, id);
    });
  }

  /** Para o balcão: a ordem aberta a partir de uma coleta fica ligada a ela (na mesma transação). */
  async linkPickupInTx(tx: Tx, jobId: string, order: { id: string; number: number; customerId: string }) {
    const [job] = await tx.select().from(laundryLogisticsJobs).where(eq(laundryLogisticsJobs.id, jobId)).for('update');
    if (!job || job.kind !== 'pickup') throw new NotFoundException({ code: 'PICKUP_NOT_FOUND', message: 'Coleta não encontrada' });
    if (job.status !== 'done') throw badRequest('PICKUP_NOT_DONE', 'A coleta ainda não foi concluída');
    if (job.orderId) throw new ConflictException({ code: 'PICKUP_ALREADY_LINKED', message: 'Esta coleta já está ligada a uma ordem' });
    if (job.customerId !== order.customerId) throw badRequest('CUSTOMER_MISMATCH', 'A ordem é de outro cliente');
    const [taken] = await tx
      .select({ id: laundryLogisticsJobs.id })
      .from(laundryLogisticsJobs)
      .where(and(eq(laundryLogisticsJobs.orderId, order.id), eq(laundryLogisticsJobs.kind, 'pickup')));
    if (taken) throw new ConflictException({ code: 'ORDER_ALREADY_LINKED', message: `A ordem nº ${order.number} já veio de outra coleta` });
    await tx.update(laundryLogisticsJobs).set({ orderId: order.id }).where(eq(laundryLogisticsJobs.id, jobId));
    await this.audit.log(tx, { action: 'laundry.logistics.linked', entity: 'laundry_logistics_job', entityId: jobId, data: { orderId: order.id } });
  }

  addPhoto(id: string, file: UploadedFile) {
    return this.tdb.run(async (tx) => {
      await this.findForAction(tx, id);
      return this.files.saveImageInTx(tx, file, { entity: PHOTO_OWNER, id });
    });
  }

  removePhoto(id: string, fileId: string) {
    return this.tdb.run(async (tx) => {
      await this.findForAction(tx, id);
      await this.files.removeInTx(tx, fileId, { entity: PHOTO_OWNER, id });
    });
  }

  // ---- LGPD ---------------------------------------------------------------------------------

  async exportFor(tx: Tx, customerId: string) {
    return (await this.jobsWhere(tx, eq(laundryLogisticsJobs.customerId, customerId))).map(({ photos, customer, ...j }) => ({ ...j, photos: photos.length }));
  }

  /** Endereço, observações e quem recebeu são dados pessoais; datas, status e taxas ficam. */
  async anonymizeFor(tx: Tx, customerId: string) {
    await tx
      .update(laundryLogisticsJobs)
      .set({ address: {}, notes: null, receiverName: null, failReason: null, cancelReason: null })
      .where(eq(laundryLogisticsJobs.customerId, customerId));
  }

  // ---- internos -----------------------------------------------------------------------------

  private async insertJob(
    tx: Tx,
    kind: JobKind,
    customerId: string,
    order: { id: string; number: number } | null,
    input: Omit<DeliveryInput, 'customerId'>,
  ): Promise<JobRow> {
    const { tenantId, userId } = requestContext.require();
    const customer = await this.customers.findInTx(tx, customerId);
    if (!customer) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
    if (customer.anonymizedAt) throw badRequest('CUSTOMER_ANONYMIZED', 'Cliente anonimizado não pode ter coletas/entregas');
    // Dia que já passou: registro de uma coleta/entrega que já aconteceu (sem aviso ao cliente).
    const past = input.date < spToday();
    const w = resolveWindow(input);
    if ('error' in w) throw badRequest('INVALID_WINDOW', w.error);
    if (input.driverUserId) await this.assertMember(tx, input.driverUserId);

    const address = this.assertAddress(input.address ?? (customer.address as JobAddress | null) ?? {});
    const settings = await this.settings.getInTx<LaundrySettings>(tx, 'laundry');
    const fee = input.fee ?? (kind === 'pickup' ? settings.pickupFee : settings.deliveryFee);

    const [job] = await tx
      .insert(laundryLogisticsJobs)
      .values({
        tenantId,
        kind,
        customerId,
        orderId: order?.id ?? null,
        address,
        date: input.date,
        ...w,
        fee: centsToDecimal(toCents(fee)),
        notes: input.notes ?? null,
        driverUserId: input.driverUserId ?? null,
        createdBy: userId,
      })
      .returning();
    await this.syncFee(tx, job!);
    await this.notifyScheduled(tx, job!);
    await this.customers.addTimeline(tx, {
      customerId,
      moduleKey: 'laundry',
      type: `laundry.${kind}.scheduled`,
      title: `${jobKindLabel[kind]} ${past ? 'registrada em' : 'agendada para'} ${dayFmt.format(dayAsDate(input.date))}${order ? ` (ordem nº ${order.number})` : ''}`,
      entity: 'laundry_logistics_job',
      entityId: job!.id,
    });
    await this.audit.log(tx, { action: `laundry.${kind}.scheduled`, entity: 'laundry_logistics_job', entityId: job!.id, data: { orderId: order?.id, date: input.date, fee } });
    return job!;
  }

  /** Entrega que não aconteceu/foi cancelada depois de sair: a ordem volta para "Pronta" (na loja). */
  private async returnOrderToShop(tx: Tx, job: JobRow, reason: string, at?: Date) {
    if (job.kind !== 'delivery' || !job.orderId) return;
    const [order] = await tx.select({ status: soOrders.status }).from(soOrders).where(eq(soOrders.id, job.orderId));
    // Volta para "Pronta" sem o aviso de "peças prontas para retirada": a entrega só foi remarcada.
    if (order?.status === 'out_for_delivery') await this.orders.transitionInTx(tx, job.orderId, 'ready', reason, { notify: false, at });
  }

  /** A taxa vira um "a receber" próprio (um por tarefa), que o financeiro pode baixar. */
  private async syncFee(tx: Tx, job: JobRow, opts: { failIfPaid?: boolean } = {}) {
    const entries = await this.finance.listBySourceInTx(tx, FEE_SOURCE, job.id);
    if (entries.some((e) => e.status === 'paid')) {
      if (opts.failIfPaid) throw badRequest('FEE_ALREADY_PAID', 'A taxa já foi recebida e não pode mais ser alterada');
      return;
    }
    await this.finance.cancelPendingBySourceInTx(tx, FEE_SOURCE, job.id);
    const cents = toCents(job.fee);
    if (job.status === 'cancelled' || cents <= 0) return;
    await this.finance.recordInTx(tx, {
      kind: 'income',
      status: 'pending',
      amount: centsToNumber(cents),
      description: await this.feeDescription(tx, job),
      dueDate: job.date,
      customerId: job.customerId,
      sourceType: FEE_SOURCE,
      sourceId: job.id,
      categoryKey: 'services',
      settleInFinance: true,
    });
  }

  /** O motorista recebeu a taxa na entrega/coleta: o "a receber" vira recebido, no dia em que aconteceu. */
  private async settleFee(tx: Tx, job: JobRow, method: FeeMethod, at: Date) {
    const entries = await this.finance.listBySourceInTx(tx, FEE_SOURCE, job.id);
    if (entries.some((e) => e.status === 'paid')) return;
    const accountId = await this.finance.defaultAccountId(tx);
    if (!accountId) throw badRequest('NO_ACCOUNT', 'Cadastre uma conta (caixa) no financeiro para registrar a taxa recebida');
    await this.finance.cancelPendingBySourceInTx(tx, FEE_SOURCE, job.id);
    const day = spDay(at);
    await this.finance.recordInTx(tx, {
      kind: 'income',
      status: 'paid',
      amount: centsToNumber(toCents(job.fee)),
      description: `${await this.feeDescription(tx, job)} (${feeMethodLabel[method]})`,
      dueDate: day,
      paidAt: day,
      accountId,
      customerId: job.customerId,
      paymentMethod: method,
      sourceType: FEE_SOURCE,
      sourceId: job.id,
      categoryKey: 'services',
    });
  }

  private async feeDescription(tx: Tx, job: JobRow) {
    if (job.kind === 'pickup') return `Taxa de coleta (${dayFmt.format(dayAsDate(job.date))})`;
    const [order] = await tx.select({ number: soOrders.number }).from(soOrders).where(eq(soOrders.id, job.orderId!));
    return `Taxa de entrega — ordem nº ${order?.number ?? ''}`;
  }

  /** Aviso de agendamento; tarefa de um dia que já passou (registro do que aconteceu) não avisa. */
  private async notifyScheduled(tx: Tx, job: JobRow) {
    if (job.date < spToday()) return;
    await this.notifications.enqueueInTx(tx, {
      templateKey: job.kind === 'pickup' ? 'laundry.pickup.scheduled' : 'laundry.delivery.scheduled',
      customerId: job.customerId,
      related: { entity: PHOTO_OWNER, id: job.id },
      data: await this.templateData(tx, job),
    });
  }

  private async templateData(tx: Tx, job: JobRow) {
    const [order] = job.orderId ? await tx.select({ number: soOrders.number }).from(soOrders).where(eq(soOrders.id, job.orderId)) : [];
    const window = `${hhmm(job.windowStart)} às ${hhmm(job.windowEnd)}`;
    return {
      os: { numero: order?.number ?? '' },
      logistica: {
        data: dayFmt.format(dayAsDate(job.date)),
        janela: job.period ? `${periodLabel[job.period]} (${window})` : window,
        endereco: formatAddress(job.address),
        taxa: toCents(job.fee) > 0 ? brl.format(Number(job.fee)) : 'sem custo',
      },
    };
  }

  /** Tarefa que quem pergunta pode ver/mexer: o escritório vê todas; o motorista, as dele. */
  private async findForAction(tx: Tx, id: string, lock = false): Promise<JobRow> {
    const { userId, permissions } = requestContext.require();
    const query = tx.select().from(laundryLogisticsJobs).where(eq(laundryLogisticsJobs.id, id));
    const [job] = lock ? await query.for('update') : await query;
    if (!job) throw notFound();
    if (!permissions?.has(MANAGE) && job.driverUserId !== userId) throw notFound();
    return job;
  }

  private async laundryOrder(tx: Tx, id: string, lock = false) {
    const query = tx.select().from(soOrders).where(eq(soOrders.id, id));
    const [order] = lock ? await query.for('update') : await query;
    if (!order || order.workflow !== LAUNDRY_WORKFLOW) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Ordem de lavanderia não encontrada' });
    return order;
  }

  private async assertMember(tx: Tx, userId: string) {
    const { tenantId } = requestContext.require();
    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, 'active')));
    if (!member) throw badRequest('DRIVER_NOT_FOUND', 'Motorista não encontrado na equipe');
  }

  private assertAddress(address: JobAddress): JobAddress {
    const clean = Object.fromEntries(Object.entries(address).filter(([, v]) => typeof v === 'string' && v.trim())) as JobAddress;
    if (!clean.street && !clean.zip) throw badRequest('ADDRESS_REQUIRED', 'Informe o endereço (rua ou CEP): o cliente não tem endereço cadastrado');
    return clean;
  }

  /**
   * Remarcar para um dia que já passou só vale para a tentativa que não deu certo: registra a nova
   * tentativa, que já aconteceu (e não pode ser antes do dia da que falhou). Uma tarefa agendada que
   * ainda não aconteceu não vai para o passado — ficaria "atrasada" sem nunca ter sido feita; para
   * registrar uma coleta/entrega antiga, cria-se outra com a data passada.
   */
  private assertReschedule(job: JobRow, date: string) {
    if (date >= spToday()) return;
    if (job.status !== 'failed') {
      throw badRequest('DATE_IN_PAST', 'Só uma tentativa que não deu certo pode ser remarcada para um dia que já passou. Para registrar uma coleta/entrega antiga, agende uma nova com a data passada.');
    }
    if (job.failedAt && date < spDay(job.failedAt)) {
      throw badRequest('DATE_BEFORE_FAILURE', `A nova tentativa não pode ser antes da que não deu certo (${shortDay.format(job.failedAt)})`);
    }
  }

  /**
   * Horário de saída, conclusão ou falha: na ordem dos eventos (depois da tentativa que falhou e da
   * saída para a rota). Informado pela pessoa, também não antes do dia da tarefa; sem horário (agora),
   * vale como sempre valeu — inclusive concluir antes do dia agendado.
   */
  private assertMoment(job: JobRow, at: Date, informed: boolean) {
    if (informed && spDay(at) < job.date) {
      throw badRequest('BEFORE_JOB_DATE', `A data não pode ser antes do dia da ${jobKindLabel[job.kind].toLowerCase()} (${shortDay.format(dayAsDate(job.date))})`);
    }
    if (job.startedAt && at < job.startedAt) throw badRequest('BEFORE_START', `Não pode ser antes da saída para a rota (${momentFmt.format(job.startedAt)})`);
    if (job.failedAt && at < job.failedAt) throw badRequest('BEFORE_FAILURE', `Não pode ser antes da tentativa que não deu certo (${momentFmt.format(job.failedAt)})`);
  }

  /** A entrega (saída e conclusão) não pode ser antes da entrada da ordem na lavanderia. */
  private assertAfterOrder(order: { number: number; receivedAt: Date }, at: Date) {
    if (at < order.receivedAt) throw badRequest('BEFORE_ORDER', `A entrega não pode ser antes da entrada da ordem nº ${order.number} (${momentFmt.format(order.receivedAt)})`);
  }

  private async jobOrFail(tx: Tx, id: string): Promise<LogisticsJob> {
    const [job] = await this.jobsWhere(tx, eq(laundryLogisticsJobs.id, id));
    if (!job) throw notFound();
    return job;
  }

  private async jobsWhere(tx: Tx, where: SQL | undefined): Promise<LogisticsJob[]> {
    const t = laundryLogisticsJobs;
    const rows = await tx
      .select({
        job: t,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerEmail: customers.email,
        driverName: users.name,
        orderNumber: soOrders.number,
        orderStatus: soOrders.status,
        orderTotal: soOrders.total,
        orderPaid: soOrders.paidAmount,
      })
      .from(t)
      .innerJoin(customers, eq(customers.id, t.customerId))
      .leftJoin(users, eq(users.id, t.driverUserId))
      .leftJoin(soOrders, eq(soOrders.id, t.orderId))
      .where(where)
      .orderBy(asc(t.date), asc(t.windowStart), sql`${t.status} = 'en_route' desc`, asc(t.createdAt))
      .limit(500);
    if (!rows.length) return [];

    const ids = rows.map((r) => r.job.id);
    const [entries, photos] = await Promise.all([this.finance.listBySourceInTx(tx, FEE_SOURCE, ids), this.files.listByOwners(tx, PHOTO_OWNER, ids)]);

    return rows.map(({ job: j, ...r }) => {
      const fees = entries.filter((e) => e.sourceId === j.id);
      return {
        id: j.id,
        kind: j.kind,
        status: j.status,
        customer: { id: j.customerId, name: r.customerName, phone: r.customerPhone, email: r.customerEmail },
        order:
          j.orderId && r.orderNumber !== null
            ? { id: j.orderId, number: r.orderNumber, status: r.orderStatus!, total: Number(r.orderTotal), paidAmount: Number(r.orderPaid) }
            : null,
        address: j.address,
        addressText: formatAddress(j.address),
        mapsUrl: mapsUrl(j.address),
        date: j.date,
        period: j.period,
        windowStart: hhmm(j.windowStart),
        windowEnd: hhmm(j.windowEnd),
        fee: Number(j.fee),
        feeStatus: fees.some((e) => e.status === 'paid') ? 'paid' : fees.some((e) => e.status === 'pending') ? 'pending' : null,
        notes: j.notes,
        driver: j.driverUserId && r.driverName ? { id: j.driverUserId, name: r.driverName } : null,
        itemsCount: j.itemsCount,
        receiverName: j.receiverName,
        startedAt: j.startedAt?.toISOString() ?? null,
        completedAt: j.completedAt?.toISOString() ?? null,
        failedAt: j.failedAt?.toISOString() ?? null,
        failReason: j.failReason,
        attempts: j.attempts,
        cancelReason: j.cancelReason,
        photos: photos.filter((f) => f.ownerId === j.id).map((f) => ({ id: f.id, filename: f.filename })),
        createdAt: j.createdAt.toISOString(),
      };
    });
  }
}

/** 'YYYY-MM-DD' como meio-dia em SP (formata o dia certo em qualquer fuso do servidor). */
const dayAsDate = (day: string) => new Date(`${day}T12:00:00-03:00`);
