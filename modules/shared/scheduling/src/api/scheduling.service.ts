import {
  AuditService,
  centsToDecimal,
  centsToNumber,
  CustomerDataRegistry,
  CustomersService,
  FinanceService,
  ModuleSettingsService,
  OutboxHandlers,
  OutboxService,
  ScheduledJobs,
  TenantDb,
  coreSchema,
  toCents,
} from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import {
  appointmentStatusLabel,
  statusTransitions,
  type Appointment,
  type AppointmentInput,
  type AppointmentStatus,
  type AvailabilitySlots,
  type Resource,
  type ResourceInput,
  type SchedulingSettings,
  type Service,
  type ServiceInput,
} from '../contracts';
import {
  schAppointments,
  schAppointmentServices,
  schPayments,
  schResources,
  schServiceResources,
  schServices,
  schTimeOff,
  schWorkingHours,
} from '../db/schema';
import { addMinutes, freeSlots, localToUtc, utcToLocal, weekdayOf } from './time';

const MODULE = 'shared.scheduling';
const SOURCE = 'appointment';
export const STATUS_CHANGED = 'shared.scheduling.status_changed';

/** Evento publicado a cada mudança de status de um atendimento. */
export interface AppointmentStatusChanged {
  appointmentId: string;
  status: AppointmentStatus;
  customerId: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
}
/**
 * Ajuste de preço de um serviço ao marcar (ex.: sessão coberta por pacote vira R$ 0). Registrado
 * por verticais; só roda nas empresas com o módulo dono ativo. Chamado com o horário já gravado,
 * então pode reservar algo ligado a ele.
 */
export interface ServicePricer {
  moduleKey: string;
  price(tx: Tx, ctx: { appointmentId: string; customerId: string; serviceId: string; price: number }): Promise<{ price: number; label?: string } | null>;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const badRequest = (code: string, message: string) => new BadRequestException({ code, message });

type AppointmentRow = typeof schAppointments.$inferSelect;

@Injectable()
export class SchedulingService implements OnModuleInit {
  private readonly pricers: ServicePricer[] = [];
  private readonly logger = new Logger('Agenda');

  constructor(
    private readonly tdb: TenantDb,
    private readonly customers: CustomersService,
    private readonly finance: FinanceService,
    private readonly notifications: NotificationsService,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
    private readonly jobs: ScheduledJobs,
    private readonly handlers: OutboxHandlers,
    private readonly outbox: OutboxService,
    private readonly customerData: CustomerDataRegistry,
  ) {}

  onModuleInit() {
    this.jobs.every('scheduling.reminders', 5 * 60_000, () => this.sendReminders());
    // Resposta do cliente pelo botão do WhatsApp ("Confirmar"/"Cancelar" do lembrete).
    this.handlers.on<{ payload?: string }>('integration.whatsapp.reply', 'scheduling.whatsapp-reply', (e) => this.handleReply(e.payload.payload));
    this.customerData.register({
      moduleKey: MODULE,
      export: async (tx, customerId) => {
        const rows = await tx.select().from(schAppointments).where(eq(schAppointments.customerId, customerId)).orderBy(asc(schAppointments.startsAt));
        return rows.map((r) => ({ startsAt: r.startsAt, status: r.status, total: Number(r.total), subject: r.subjectLabel, notes: r.notes }));
      },
      anonymize: async (tx, customerId) => {
        await tx.update(schAppointments).set({ notes: null }).where(eq(schAppointments.customerId, customerId));
      },
    });
  }

  // ---- Profissionais e salas ----------------------------------------------------------------

  listResources(): Promise<Resource[]> {
    return this.tdb.run(async (tx) => {
      const [rows, links, hours] = await Promise.all([
        tx.select().from(schResources).orderBy(asc(schResources.name)),
        tx.select().from(schServiceResources),
        tx.select().from(schWorkingHours).orderBy(asc(schWorkingHours.weekday), asc(schWorkingHours.startTime)),
      ]);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        userId: r.userId,
        color: r.color,
        active: r.active,
        serviceIds: links.filter((l) => l.resourceId === r.id).map((l) => l.serviceId),
        hours: hours.filter((h) => h.resourceId === r.id).map((h) => ({ weekday: h.weekday, start: h.startTime, end: h.endTime })),
      }));
    });
  }

  saveResource(id: string | null, input: ResourceInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const { serviceIds, ...data } = input;
      let resourceId = id;
      if (id) {
        const [row] = await tx.update(schResources).set(data).where(eq(schResources.id, id)).returning({ id: schResources.id });
        if (!row) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Profissional não encontrado' });
      } else {
        resourceId = (await tx.insert(schResources).values({ ...data, tenantId }).returning({ id: schResources.id }))[0]!.id;
        // Expediente inicial comum (seg–sex 9h–18h com almoço, sábado 9h–13h); ajustável depois.
        await tx.insert(schWorkingHours).values(defaultHours().map((h) => ({ ...h, tenantId, resourceId: resourceId! })));
      }
      if (serviceIds) {
        await tx.delete(schServiceResources).where(eq(schServiceResources.resourceId, resourceId!));
        if (serviceIds.length) await tx.insert(schServiceResources).values(serviceIds.map((serviceId) => ({ tenantId, serviceId, resourceId: resourceId! })));
      }
      await this.audit.log(tx, { action: id ? 'scheduling.resource.updated' : 'scheduling.resource.created', entity: 'sch_resource', entityId: resourceId!, data: input });
      return { id: resourceId! };
    });
  }

  setWorkingHours(resourceId: string, hours: { weekday: number; start: string; end: string }[]) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      await this.resourceOrFail(tx, resourceId);
      await tx.delete(schWorkingHours).where(eq(schWorkingHours.resourceId, resourceId));
      if (hours.length) {
        await tx.insert(schWorkingHours).values(hours.map((h) => ({ tenantId, resourceId, weekday: h.weekday, startTime: h.start, endTime: h.end })));
      }
      await this.audit.log(tx, { action: 'scheduling.hours.updated', entity: 'sch_resource', entityId: resourceId });
    });
  }

  listTimeOff(from: Date, to: Date) {
    return this.tdb.run((tx) =>
      tx
        .select()
        .from(schTimeOff)
        .where(and(lt(schTimeOff.startsAt, to), sql`${schTimeOff.endsAt} > ${from}`))
        .orderBy(asc(schTimeOff.startsAt)),
    );
  }

  addTimeOff(resourceId: string, input: { startsAt: Date; endsAt: Date; reason?: string | null }) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      await this.resourceOrFail(tx, resourceId);
      const [row] = await tx.insert(schTimeOff).values({ tenantId, resourceId, ...input, reason: input.reason ?? null }).returning();
      return row!;
    });
  }

  removeTimeOff(id: string) {
    return this.tdb.run(async (tx) => {
      const deleted = await tx.delete(schTimeOff).where(eq(schTimeOff.id, id)).returning({ id: schTimeOff.id });
      if (!deleted.length) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bloqueio não encontrado' });
    });
  }

  // ---- Serviços -------------------------------------------------------------------------------

  listServices(): Promise<Service[]> {
    return this.tdb.run(async (tx) => {
      const [rows, links] = await Promise.all([tx.select().from(schServices).orderBy(asc(schServices.category), asc(schServices.name)), tx.select().from(schServiceResources)]);
      return rows.map((s) => toServiceDto(s, links.filter((l) => l.serviceId === s.id).map((l) => l.resourceId)));
    });
  }

  saveService(id: string | null, input: ServiceInput) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const { resourceIds, price, ...data } = input;
      const values = { ...data, price: centsToDecimal(toCents(price)) };
      let serviceId = id;
      if (id) {
        const [row] = await tx.update(schServices).set(values).where(eq(schServices.id, id)).returning({ id: schServices.id });
        if (!row) throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Serviço não encontrado' });
      } else {
        serviceId = (await tx.insert(schServices).values({ ...values, tenantId }).returning({ id: schServices.id }))[0]!.id;
      }
      if (resourceIds) {
        await tx.delete(schServiceResources).where(eq(schServiceResources.serviceId, serviceId!));
        if (resourceIds.length) await tx.insert(schServiceResources).values(resourceIds.map((resourceId) => ({ tenantId, serviceId: serviceId!, resourceId })));
      }
      await this.audit.log(tx, { action: id ? 'scheduling.service.updated' : 'scheduling.service.created', entity: 'sch_service', entityId: serviceId!, data: input });
      return { id: serviceId! };
    });
  }

  // ---- Horários livres ------------------------------------------------------------------------

  availability(opts: { date: string; serviceIds: string[]; resourceId?: string; online?: boolean }): Promise<AvailabilitySlots[]> {
    return this.tdb.run(async (tx) => {
      const settings = await this.settings.getInTx<SchedulingSettings>(tx, MODULE);
      const services = await this.servicesOrFail(tx, opts.serviceIds, opts.online);
      const duration = services.reduce((sum, s) => sum + s.durationMin + s.bufferMin, 0);
      const resources = await this.eligibleResources(tx, services.map((s) => s.id), opts.resourceId);
      if (!resources.length) return [];

      const dayStart = localToUtc(opts.date, '00:00');
      const dayEnd = addMinutes(dayStart, 24 * 60);
      const ids = resources.map((r) => r.id);
      const [hours, busyAppointments, timeOff] = await Promise.all([
        tx.select().from(schWorkingHours).where(and(inArray(schWorkingHours.resourceId, ids), eq(schWorkingHours.weekday, weekdayOf(opts.date)))),
        tx
          .select({ resourceId: schAppointments.resourceId, start: schAppointments.startsAt, end: schAppointments.endsAt })
          .from(schAppointments)
          .where(
            and(
              inArray(schAppointments.resourceId, ids),
              lt(schAppointments.startsAt, dayEnd),
              sql`${schAppointments.endsAt} > ${dayStart}`,
              notInArray(schAppointments.status, ['cancelled', 'no_show']),
            ),
          ),
        tx
          .select({ resourceId: schTimeOff.resourceId, start: schTimeOff.startsAt, end: schTimeOff.endsAt })
          .from(schTimeOff)
          .where(and(inArray(schTimeOff.resourceId, ids), lt(schTimeOff.startsAt, dayEnd), sql`${schTimeOff.endsAt} > ${dayStart}`)),
      ]);

      const now = new Date();
      const notBefore = opts.online ? addMinutes(now, settings.onlineMinNoticeHours * 60) : now;
      return resources.map((r) => ({
        resourceId: r.id,
        resourceName: r.name,
        slots: freeSlots({
          date: opts.date,
          hours: hours.filter((h) => h.resourceId === r.id).map((h) => ({ start: h.startTime, end: h.endTime })),
          busy: [...busyAppointments, ...timeOff].filter((b) => b.resourceId === r.id),
          durationMin: duration,
          stepMin: settings.slotMinutes,
          notBefore,
        }),
      }));
    });
  }

  // ---- Atendimentos ---------------------------------------------------------------------------

  listAppointments(opts: { from: Date; to: Date; resourceId?: string; customerId?: string }): Promise<Appointment[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ a: schAppointments, resourceName: schResources.name, customer: { id: customers.id, name: customers.name, phone: customers.phone, email: customers.email } })
        .from(schAppointments)
        .innerJoin(schResources, eq(schResources.id, schAppointments.resourceId))
        .innerJoin(customers, eq(customers.id, schAppointments.customerId))
        .where(
          and(
            opts.customerId ? undefined : lt(schAppointments.startsAt, opts.to),
            opts.customerId ? undefined : gte(schAppointments.endsAt, opts.from),
            opts.resourceId ? eq(schAppointments.resourceId, opts.resourceId) : undefined,
            opts.customerId ? eq(schAppointments.customerId, opts.customerId) : undefined,
          ),
        )
        .orderBy(asc(schAppointments.startsAt));
      const services = rows.length
        ? await tx.select().from(schAppointmentServices).where(inArray(schAppointmentServices.appointmentId, rows.map((r) => r.a.id)))
        : [];
      return rows.map((r) => toAppointmentDto(r.a, r.resourceName, r.customer, services.filter((s) => s.appointmentId === r.a.id)));
    });
  }

  get(id: string) {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  create(input: AppointmentInput, opts: { source?: 'admin' | 'online' | 'whatsapp'; online?: boolean } = {}) {
    return this.tdb.run((tx) => this.createInTx(tx, input, opts));
  }

  async createInTx(tx: Tx, input: AppointmentInput, opts: { source?: 'admin' | 'online' | 'whatsapp'; online?: boolean } = {}): Promise<Appointment> {
    const { tenantId, userId } = requestContext.requireTenant();
    const customer = await this.customers.findInTx(tx, input.customerId);
    if (!customer || customer.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
    const resource = await this.resourceOrFail(tx, input.resourceId);
    if (!resource.active) throw badRequest('RESOURCE_INACTIVE', 'Profissional inativo');
    const services = await this.servicesOrFail(tx, input.serviceIds, opts.online);
    const eligible = await this.eligibleResources(tx, services.map((s) => s.id), resource.id);
    if (!eligible.length) throw badRequest('RESOURCE_NOT_ELIGIBLE', `${resource.name} não faz todos os serviços escolhidos`);

    const duration = services.reduce((sum, s) => sum + s.durationMin + s.bufferMin, 0);
    const endsAt = addMinutes(input.startsAt, duration);

    const appointment = await this.insertAppointment(tx, {
      tenantId,
      customerId: customer.id,
      resourceId: resource.id,
      startsAt: input.startsAt,
      endsAt,
      source: opts.source ?? 'admin',
      notes: input.notes ?? null,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      subjectLabel: input.subject?.label ?? null,
      total: '0',
      createdBy: userId ?? null,
    });
    const lines = await this.priceLines(tx, appointment.id, customer.id, services);
    await tx.insert(schAppointmentServices).values(lines.map((l) => ({ ...l, tenantId, appointmentId: appointment.id })));
    const total = lines.reduce((sum, l) => sum + toCents(l.price), 0);
    await tx.update(schAppointments).set({ total: centsToDecimal(total) }).where(eq(schAppointments.id, appointment.id));

    const local = utcToLocal(input.startsAt);
    await this.customers.addTimeline(tx, {
      customerId: customer.id,
      moduleKey: MODULE,
      type: 'appointment.booked',
      title: `Horário marcado: ${services.map((s) => s.name).join(', ')} em ${formatDate(local.date)} às ${local.time}`,
      entity: 'appointment',
      entityId: appointment.id,
    });
    await this.notify(tx, appointment.id, 'shared.scheduling.booked');
    await this.audit.log(tx, { action: 'appointment.created', entity: 'appointment', entityId: appointment.id, data: { source: opts.source ?? 'admin' } });
    return this.detailInTx(tx, appointment.id);
  }

  /** Verticais registram ajustes de preço (ver ServicePricer). */
  registerPricer(pricer: ServicePricer) {
    this.pricers.push(pricer);
  }

  private async priceLines(tx: Tx, appointmentId: string, customerId: string, services: { id: string; name: string; durationMin: number; bufferMin: number; price: string }[]) {
    const active = this.pricers.length
      ? new Set((await tx.select({ key: coreSchema.tenantModules.moduleKey }).from(coreSchema.tenantModules).where(eq(coreSchema.tenantModules.status, 'active'))).map((r) => r.key))
      : new Set<string>();
    const pricers = this.pricers.filter((p) => active.has(p.moduleKey));
    const lines = [];
    for (const s of services) {
      let line = { serviceId: s.id, name: s.name, durationMin: s.durationMin + s.bufferMin, price: s.price };
      for (const pricer of pricers) {
        const adjusted = await pricer.price(tx, { appointmentId, customerId, serviceId: s.id, price: Number(s.price) });
        if (adjusted) {
          line = { ...line, price: centsToDecimal(toCents(adjusted.price)), name: adjusted.label ? `${s.name} (${adjusted.label})` : s.name };
          break;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  reschedule(id: string, input: { startsAt: Date; resourceId?: string }) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      if (current.status !== 'scheduled' && current.status !== 'confirmed') {
        throw badRequest('APPOINTMENT_STARTED', 'Só horários ainda não iniciados podem ser remarcados');
      }
      const resourceId = input.resourceId ?? current.resourceId;
      if (resourceId !== current.resourceId) {
        const serviceIds = (await tx.select().from(schAppointmentServices).where(eq(schAppointmentServices.appointmentId, id)))
          .map((s) => s.serviceId)
          .filter((s): s is string => !!s);
        if (!(await this.eligibleResources(tx, serviceIds, resourceId)).length) throw badRequest('RESOURCE_NOT_ELIGIBLE', 'Este profissional não faz todos os serviços do atendimento');
      }
      const duration = current.endsAt.getTime() - current.startsAt.getTime();
      await this.guardOverlap(() =>
        tx
          .update(schAppointments)
          .set({ startsAt: input.startsAt, endsAt: new Date(input.startsAt.getTime() + duration), resourceId, reminderSentAt: null, confirmedAt: null, status: 'scheduled' })
          .where(eq(schAppointments.id, id)),
      );
      await this.notify(tx, id, 'shared.scheduling.rescheduled');
      await this.audit.log(tx, { action: 'appointment.rescheduled', entity: 'appointment', entityId: id, data: { from: current.startsAt, to: input.startsAt } });
      return this.detailInTx(tx, id);
    });
  }

  setStatus(id: string, status: AppointmentStatus, reason?: string | null) {
    return this.tdb.run((tx) => this.setStatusInTx(tx, id, status, reason));
  }

  async setStatusInTx(tx: Tx, id: string, status: AppointmentStatus, reason?: string | null, opts: { notifyCancel?: boolean } = {}) {
    const current = await this.findOrFail(tx, id, true);
    if (current.status === status) return this.detailInTx(tx, id);
    if (!statusTransitions[current.status].includes(status)) {
      throw badRequest('INVALID_TRANSITION', `Não é possível ir de "${appointmentStatusLabel[current.status]}" para "${appointmentStatusLabel[status]}"`);
    }
    if (status === 'cancelled' && !reason?.trim()) throw badRequest('REASON_REQUIRED', 'Informe o motivo do cancelamento');

    const [updated] = await tx
      .update(schAppointments)
      .set({
        status,
        confirmedAt: status === 'confirmed' ? new Date() : current.confirmedAt,
        cancelledAt: status === 'cancelled' ? new Date() : null,
        cancelReason: status === 'cancelled' ? reason : null,
      })
      .where(eq(schAppointments.id, id))
      .returning();
    await this.syncReceivable(tx, updated!);
    await this.customers.addTimeline(tx, {
      customerId: current.customerId,
      moduleKey: MODULE,
      type: `appointment.${status}`,
      title: `Atendimento de ${formatDate(utcToLocal(current.startsAt).date)}: ${appointmentStatusLabel[status]}${reason ? ` (${reason})` : ''}`,
      entity: 'appointment',
      entityId: id,
    });
    if (status === 'cancelled' && opts.notifyCancel !== false) await this.notify(tx, id, 'shared.scheduling.cancelled');
    // Para as verticais reagirem (ex.: pet shop avisa que o pet está pronto quando o banho termina).
    await this.outbox.publish(tx, STATUS_CHANGED, {
      appointmentId: id,
      status,
      customerId: current.customerId,
      subjectType: current.subjectType,
      subjectId: current.subjectId,
      subjectLabel: current.subjectLabel,
    });
    await this.audit.log(tx, { action: `appointment.${status}`, entity: 'appointment', entityId: id, data: reason ? { reason } : undefined });
    return this.detailInTx(tx, id);
  }

  addPayment(id: string, input: { amount: number; method: string; accountId: string; paidAt: string }) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const a = await this.findOrFail(tx, id, true);
      if (a.status === 'cancelled' || a.status === 'no_show') throw badRequest('APPOINTMENT_CLOSED', 'Atendimento cancelado não recebe pagamento');
      const amount = toCents(input.amount);
      const outstanding = toCents(a.total) - toCents(a.paidAmount);
      if (amount > outstanding) throw badRequest('PAYMENT_EXCEEDS_BALANCE', `O valor passa do saldo em aberto (${brl.format(centsToNumber(outstanding))})`);

      const entry = await this.finance.recordInTx(tx, {
        kind: 'income',
        status: 'paid',
        amount: input.amount,
        description: `Atendimento de ${formatDate(utcToLocal(a.startsAt).date)}`,
        dueDate: input.paidAt,
        paidAt: input.paidAt,
        accountId: input.accountId,
        customerId: a.customerId,
        paymentMethod: input.method,
        sourceType: SOURCE,
        sourceId: a.id,
        categoryKey: 'services',
      });
      await tx.insert(schPayments).values({ tenantId, appointmentId: id, amount: centsToDecimal(amount), method: input.method, paidAt: input.paidAt, finEntryId: entry.id, userId });
      const paid = toCents(a.paidAmount) + amount;
      const [updated] = await tx
        .update(schAppointments)
        .set({ paidAmount: centsToDecimal(paid), paymentStatus: paid >= toCents(a.total) ? 'paid' : 'partial' })
        .where(eq(schAppointments.id, id))
        .returning();
      await this.syncReceivable(tx, updated!);
      await this.audit.log(tx, { action: 'appointment.payment', entity: 'appointment', entityId: id, data: input });
      return this.detailInTx(tx, id);
    });
  }

  /** Lembretes: roda no worker a cada 5 min, para todas as empresas com a agenda ativa. */
  async sendReminders() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const { reminderHours } = await this.settings.getInTx<SchedulingSettings>(tx, MODULE);
          if (!reminderHours) return;
          const now = new Date();
          const due = await tx
            .select({ id: schAppointments.id })
            .from(schAppointments)
            .where(
              and(
                inArray(schAppointments.status, ['scheduled', 'confirmed']),
                isNull(schAppointments.reminderSentAt),
                gte(schAppointments.startsAt, now),
                lt(schAppointments.startsAt, addMinutes(now, reminderHours * 60)),
                // Marcado já dentro da janela do lembrete: a mensagem de "horário marcado" basta.
                lt(schAppointments.createdAt, sql`${schAppointments.startsAt} - make_interval(hours => ${reminderHours})`),
              ),
            );
          for (const { id } of due) {
            await tx.update(schAppointments).set({ reminderSentAt: now }).where(eq(schAppointments.id, id));
            await this.notify(tx, id, 'shared.scheduling.reminder');
          }
          if (due.length) this.logger.log(`${due.length} lembrete(s) enviados (tenant ${tenantId})`);
        }),
      );
    }
  }

  // ---- internos -------------------------------------------------------------------------------

  private async handleReply(payload?: string) {
    const match = payload?.match(/^scheduling:(confirm|cancel):([0-9a-f-]{36})$/);
    if (!match) return;
    const [, action, id] = match;
    await this.tdb.run(async (tx) => {
      const [a] = await tx.select().from(schAppointments).where(eq(schAppointments.id, id!));
      if (!a || !['scheduled', 'confirmed'].includes(a.status)) return;
      if (action === 'confirm' && a.status === 'scheduled') await this.setStatusInTx(tx, a.id, 'confirmed');
      if (action === 'cancel') await this.setStatusInTx(tx, a.id, 'cancelled', 'Cancelado pelo cliente pelo WhatsApp');
    });
  }

  private async notify(tx: Tx, appointmentId: string, templateKey: string) {
    const detail = await this.detailInTx(tx, appointmentId);
    const local = utcToLocal(new Date(detail.startsAt));
    await this.notifications.enqueueInTx(tx, {
      templateKey,
      customerId: detail.customer.id,
      related: { entity: 'appointment', id: appointmentId },
      data: {
        agendamento: {
          id: detail.id,
          data: formatDate(local.date),
          hora: local.time,
          servicos: detail.services.map((s) => s.name).join(', '),
          profissional: detail.resourceName,
          total: brl.format(detail.total),
        },
      },
    });
  }

  /** O saldo de um atendimento concluído vira um "a receber"; cancelado ou falta zera. */
  private async syncReceivable(tx: Tx, a: AppointmentRow) {
    const charge = a.status === 'done' || toCents(a.paidAmount) > 0;
    const outstanding = a.status === 'cancelled' || a.status === 'no_show' || !charge ? 0 : toCents(a.total) - toCents(a.paidAmount);
    await this.finance.syncReceivableInTx(tx, {
      sourceType: SOURCE,
      sourceId: a.id,
      amountCents: outstanding,
      description: `Atendimento de ${formatDate(utcToLocal(a.startsAt).date)}`,
      dueDate: utcToLocal(a.startsAt).date,
      customerId: a.customerId,
      categoryKey: 'services',
    });
  }

  private async insertAppointment(tx: Tx, values: typeof schAppointments.$inferInsert) {
    const [row] = await this.guardOverlap(() => tx.insert(schAppointments).values(values).returning());
    return row!;
  }

  /** A constraint EXCLUDE do banco recusa horários sobrepostos do mesmo profissional. */
  private async guardOverlap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
      if (code === '23P01') throw new ConflictException({ code: 'SLOT_TAKEN', message: 'Este horário já está ocupado para este profissional' });
      throw err;
    }
  }

  private async detailInTx(tx: Tx, id: string): Promise<Appointment> {
    const [row] = await tx
      .select({ a: schAppointments, resourceName: schResources.name, customer: { id: customers.id, name: customers.name, phone: customers.phone, email: customers.email } })
      .from(schAppointments)
      .innerJoin(schResources, eq(schResources.id, schAppointments.resourceId))
      .innerJoin(customers, eq(customers.id, schAppointments.customerId))
      .where(eq(schAppointments.id, id));
    if (!row) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Atendimento não encontrado' });
    const services = await tx.select().from(schAppointmentServices).where(eq(schAppointmentServices.appointmentId, id));
    return toAppointmentDto(row.a, row.resourceName, row.customer, services);
  }

  private async findOrFail(tx: Tx, id: string, lock = false) {
    const q = tx.select().from(schAppointments).where(eq(schAppointments.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Atendimento não encontrado' });
    return row;
  }

  private async resourceOrFail(tx: Tx, id: string) {
    const [row] = await tx.select().from(schResources).where(eq(schResources.id, id));
    if (!row) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Profissional não encontrado' });
    return row;
  }

  private async servicesOrFail(tx: Tx, ids: string[], online?: boolean) {
    const rows = await tx.select().from(schServices).where(inArray(schServices.id, ids));
    const usable = rows.filter((s) => s.active && (!online || s.online));
    if (usable.length !== new Set(ids).size) throw badRequest('SERVICE_NOT_FOUND', 'Serviço inexistente ou indisponível');
    // Mantém a ordem escolhida.
    return ids.map((sid) => usable.find((s) => s.id === sid)!);
  }

  /** Profissionais ativos que fazem todos os serviços (serviço sem vínculo = qualquer profissional). */
  private async eligibleResources(tx: Tx, serviceIds: string[], resourceId?: string) {
    const [resources, links] = await Promise.all([
      tx
        .select()
        .from(schResources)
        .where(and(eq(schResources.active, true), resourceId ? eq(schResources.id, resourceId) : eq(schResources.kind, 'professional')))
        .orderBy(asc(schResources.name)),
      tx.select().from(schServiceResources).where(inArray(schServiceResources.serviceId, serviceIds)),
    ]);
    return resources.filter((r) =>
      serviceIds.every((sid) => {
        const allowed = links.filter((l) => l.serviceId === sid);
        return !allowed.length || allowed.some((l) => l.resourceId === r.id);
      }),
    );
  }
}

function defaultHours() {
  const weekdays = [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startTime: '09:00', endTime: '12:00' },
    { weekday, startTime: '13:00', endTime: '18:00' },
  ]);
  return [...weekdays, { weekday: 6, startTime: '09:00', endTime: '13:00' }];
}

const formatDate = (iso: string) => iso.split('-').reverse().join('/');

function toServiceDto(s: typeof schServices.$inferSelect, resourceIds: string[]): Service {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    durationMin: s.durationMin,
    bufferMin: s.bufferMin,
    price: Number(s.price),
    online: s.online,
    active: s.active,
    description: s.description,
    resourceIds,
  };
}

function toAppointmentDto(
  a: AppointmentRow,
  resourceName: string,
  customer: Appointment['customer'],
  services: (typeof schAppointmentServices.$inferSelect)[],
): Appointment {
  return {
    id: a.id,
    customer,
    resourceId: a.resourceId,
    resourceName,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    source: a.source,
    notes: a.notes,
    subject: a.subjectType && a.subjectId ? { type: a.subjectType, id: a.subjectId, label: a.subjectLabel ?? '' } : null,
    services: services.map((s) => ({ serviceId: s.serviceId, name: s.name, durationMin: s.durationMin, price: Number(s.price) })),
    total: Number(a.total),
    paidAmount: Number(a.paidAmount),
    paymentStatus: a.paymentStatus,
    confirmedAt: a.confirmedAt?.toISOString() ?? null,
    cancelReason: a.cancelReason,
    createdAt: a.createdAt.toISOString(),
  };
}
