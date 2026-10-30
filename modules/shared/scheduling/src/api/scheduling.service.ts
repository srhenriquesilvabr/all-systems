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
  splitName,
  TEAM_MEMBER_ENDED,
  TeamLinksRegistry,
  TeamService,
  TenantDb,
  coreSchema,
  localToday,
  toCents,
  type TeamMemberEnded,
} from '@all/core';
import { customers } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { NotificationsService } from '@all/notifications';
import { RegistersService, type SalePaymentMethod } from '@all/sales';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import {
  appointmentStatusLabel,
  closedStatuses,
  MAX_OCCURRENCES,
  statusTransitions,
  type Appointment,
  type AppointmentEditInput,
  type AppointmentInput,
  type AppointmentRoomOptions,
  type AppointmentSeriesInput,
  type AppointmentStatus,
  type AvailabilitySlots,
  type BookingSubjectField,
  type Resource,
  type ResourceInput,
  type RoomDistributionResult,
  type SchedulingSettings,
  type SeriesResult,
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
import { addMinutes, freeSlots, localToUtc, seriesDates, utcToLocal, weekdayOf, type Interval } from './time';

const MODULE = 'shared.scheduling';
const SOURCE = 'appointment';
export const STATUS_CHANGED = 'shared.scheduling.status_changed';
/** Pagamento registrado num atendimento, com os serviços (a nota de serviço sai daqui: integration.fiscal). */
export const PAYMENT_RECORDED = 'shared.scheduling.payment_recorded';
/** Nome da constraint EXCLUDE de sala (SQL na migration). */
const ROOM_CONSTRAINT = 'sch_appointments_room_no_overlap';
/** Status que liberam o horário (mesma regra das constraints). */
const RELEASED: AppointmentStatus[] = ['cancelled', 'no_show'];
const room = alias(schResources, 'room');

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
  /** O serviço saiu de um horário já marcado: desfaz o que `price` reservou para ele. */
  release?(tx: Tx, ctx: { appointmentId: string; serviceId: string }): Promise<void>;
}

/**
 * Reação de outro módulo à mudança de situação, na mesma transação (ex.: o salão grava o percentual
 * da comissão ao concluir). Só roda nas empresas com o módulo dono ativo. O que puder esperar usa o
 * evento STATUS_CHANGED.
 */
export interface AppointmentStatusHook {
  moduleKey: string;
  onStatus(tx: Tx, ctx: { appointmentId: string; resourceId: string; status: AppointmentStatus }): Promise<void>;
}

/**
 * "Para quem é" no agendamento online (ex.: o pet): campos extras na página pública e como
 * transformá-los no subject do horário. Registrado por outro módulo (a agenda não importa nenhum);
 * vale o primeiro cujo módulo está ativo na empresa.
 */
export interface BookingSubjectProvider {
  moduleKey: string;
  label: string;
  fields: BookingSubjectField[];
  /** Roda na transação da marcação, com o cliente já encontrado/criado. */
  resolve(tx: Tx, ctx: { customerId: string; values: Record<string, string> }): Promise<{ type: string; id: string; label: string }>;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const roomTaken = (message = 'Esta sala/equipamento já está ocupado neste horário') => new ConflictException({ code: 'ROOM_TAKEN', message });
/** Forma de pagamento da agenda na conferência do caixa (transferência entra em "Outras"). */
const registerMethod = (method: string): SalePaymentMethod => (['cash', 'pix', 'credit_card', 'debit_card'].includes(method) ? (method as SalePaymentMethod) : 'other');
const roomRequired = () => badRequest('ROOM_REQUIRED', 'Um dos serviços deste atendimento exige sala/equipamento: escolha outra sala em vez de deixar sem');
/** Quantos atendimentos "distribuir salas" grava por vez (o resto fica para a próxima rodada). */
const MAX_ROOM_DISTRIBUTION = 500;

type AppointmentRow = typeof schAppointments.$inferSelect;

@Injectable()
export class SchedulingService implements OnModuleInit {
  private readonly pricers: ServicePricer[] = [];
  private readonly statusHooks: AppointmentStatusHook[] = [];
  private readonly bookingSubjects: BookingSubjectProvider[] = [];
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
    private readonly team: TeamService,
    private readonly teamLinks: TeamLinksRegistry,
    private readonly registers: RegistersService,
  ) {}

  onModuleInit() {
    this.jobs.every('scheduling.reminders', 5 * 60_000, () => this.sendReminders());
    // Resposta do cliente pelo botão do WhatsApp ("Confirmar"/"Cancelar" do lembrete).
    this.handlers.on<{ payload?: string }>('integration.whatsapp.reply', 'scheduling.whatsapp-reply', (e) => this.handleReply(e.payload.payload));
    // Pessoa da equipe encerrada (rescisão no RH ou data de encerramento no cadastro).
    this.handlers.on<TeamMemberEnded>(TEAM_MEMBER_ENDED, 'scheduling.team-member-ended', (e) => this.deactivateEnded(e.payload.teamMemberId));
    this.teamLinks.register({
      moduleKey: MODULE,
      find: async (tx, ids) =>
        (
          await tx
            .select({ teamMemberId: schResources.teamMemberId, active: schResources.active })
            .from(schResources)
            .where(inArray(schResources.teamMemberId, ids))
        ).map((r) => ({ teamMemberId: r.teamMemberId!, label: 'Profissional da agenda', path: '/agenda/profissionais', active: r.active })),
    });
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
        teamMemberId: r.teamMemberId,
        color: r.color,
        active: r.active,
        serviceIds: links.filter((l) => l.resourceId === r.id).map((l) => l.serviceId),
        hours: hours.filter((h) => h.resourceId === r.id).map((h) => ({ weekday: h.weekday, start: h.startTime, end: h.endTime })),
      }));
    });
  }

  /**
   * Profissional = pessoa da equipe: vincula a uma pessoa já cadastrada (teamMemberId) ou cria uma
   * com o nome do profissional; `person` grava os dados pessoais junto (exige core.team.manage).
   * Pessoa com encerramento já passado deixa o profissional inativo.
   */
  saveResource(id: string | null, input: ResourceInput) {
    const ctx = requestContext.require();
    const { tenantId } = ctx;
    return this.tdb.run(async (tx) => {
      const { serviceIds, person, teamMemberId, ...data } = input;
      const current = id ? await this.resourceOrFail(tx, id) : null;
      let memberId: string | null = null;
      if (data.kind === 'professional') {
        if (person && !ctx.permissions?.has('core.team.manage')) {
          throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Você não tem permissão para editar os dados pessoais da equipe', missing: ['core.team.manage'] });
        }
        const patch = person ? this.team.parse(person, true) : {};
        memberId = teamMemberId !== undefined ? teamMemberId : (current?.teamMemberId ?? null);
        let member;
        if (memberId) {
          member = await this.team.findOrFailInTx(tx, memberId);
          const [other] = await tx
            .select({ id: schResources.id })
            .from(schResources)
            .where(and(eq(schResources.teamMemberId, memberId), id ? ne(schResources.id, id) : undefined));
          if (other) throw new ConflictException({ code: 'TEAM_MEMBER_TAKEN', message: 'Esta pessoa já é outro profissional da agenda' });
          if (person) member = await this.team.saveInTx(tx, memberId, patch);
        } else {
          member = await this.team.saveInTx(tx, null, { ...splitName(data.name), ...(data.userId ? { userId: data.userId } : {}), ...patch });
        }
        memberId = member.id;
        if (member.endedOn && member.endedOn < localToday()) data.active = false;
      }
      const values = { ...data, teamMemberId: memberId };
      let resourceId = id;
      if (id) {
        await tx.update(schResources).set(values).where(eq(schResources.id, id));
      } else {
        resourceId = (await tx.insert(schResources).values({ ...values, tenantId }).returning({ id: schResources.id }))[0]!.id;
        // Expediente inicial comum (seg–sex 9h–18h com almoço, sábado 9h–13h); ajustável depois.
        await tx.insert(schWorkingHours).values(defaultHours().map((h) => ({ ...h, tenantId, resourceId: resourceId! })));
      }
      if (serviceIds) {
        await tx.delete(schServiceResources).where(eq(schServiceResources.resourceId, resourceId!));
        if (serviceIds.length) await tx.insert(schServiceResources).values(serviceIds.map((serviceId) => ({ tenantId, serviceId, resourceId: resourceId! })));
      }
      // Os dados pessoais ficam na auditoria do cadastro da pessoa (core), não aqui.
      await this.audit.log(tx, {
        action: id ? 'scheduling.resource.updated' : 'scheduling.resource.created',
        entity: 'sch_resource',
        entityId: resourceId!,
        data: { ...values, serviceIds, personFields: person ? Object.keys(person) : undefined },
      });
      return { id: resourceId!, teamMemberId: memberId };
    });
  }

  /** Evento do core: a pessoa saiu da empresa. O profissional dela sai da agenda (fica inativo). */
  private deactivateEnded(teamMemberId: string) {
    return this.tdb.run(async (tx) => {
      const member = await this.team.findInTx(tx, teamMemberId);
      // Entrega repetida ou data alterada depois: só desativa se o encerramento ainda está no passado.
      if (!member?.endedOn || member.endedOn >= localToday()) return;
      const rows = await tx
        .update(schResources)
        .set({ active: false })
        .where(and(eq(schResources.teamMemberId, teamMemberId), eq(schResources.active, true)))
        .returning({ id: schResources.id });
      for (const r of rows) {
        await this.audit.log(tx, { action: 'scheduling.resource.deactivated', entity: 'sch_resource', entityId: r.id, data: { reason: 'team_member_ended', endedOn: member.endedOn } });
      }
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

  /** Liga no link os serviços da lista e desliga os demais. */
  setOnlineServices(serviceIds: string[]) {
    return this.tdb.run(async (tx) => {
      const rows = await tx.select({ id: schServices.id }).from(schServices);
      const known = new Set(rows.map((r) => r.id));
      if (serviceIds.some((id) => !known.has(id))) throw badRequest('SERVICE_NOT_FOUND', 'Serviço inexistente');
      const chosen = new Set(serviceIds);
      const on = rows.filter((r) => chosen.has(r.id)).map((r) => r.id);
      const off = rows.filter((r) => !chosen.has(r.id)).map((r) => r.id);
      if (on.length) await tx.update(schServices).set({ online: true }).where(inArray(schServices.id, on));
      if (off.length) await tx.update(schServices).set({ online: false }).where(inArray(schServices.id, off));
      await this.audit.log(tx, { action: 'scheduling.services.online_updated', entity: 'sch_service', data: { serviceIds } });
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
              notInArray(schAppointments.status, RELEASED),
            ),
          ),
        tx
          .select({ resourceId: schTimeOff.resourceId, start: schTimeOff.startsAt, end: schTimeOff.endsAt })
          .from(schTimeOff)
          .where(and(inArray(schTimeOff.resourceId, ids), lt(schTimeOff.startsAt, dayEnd), sql`${schTimeOff.endsAt} > ${dayStart}`)),
      ]);

      // Serviço que precisa de sala: o horário só vale se alguma sala que serve estiver livre.
      const needsRoom = services.some((s) => s.requiresRoom);
      const rooms = needsRoom ? await this.eligibleResources(tx, services.map((s) => s.id), undefined, 'room') : [];
      const roomBusy = needsRoom ? await this.busyIntervals(tx, rooms.map((r) => r.id), dayStart, dayEnd) : [];
      const roomFree = (time: string) => {
        const start = localToUtc(opts.date, time);
        const end = addMinutes(start, duration);
        return rooms.some((r) => !roomBusy.some((b) => b.resourceId === r.id && b.start < end && b.end > start));
      };

      const now = new Date();
      const notBefore = opts.online ? addMinutes(now, settings.onlineMinNoticeHours * 60) : now;
      return resources.map((r) => {
        const slots = freeSlots({
          date: opts.date,
          hours: hours.filter((h) => h.resourceId === r.id).map((h) => ({ start: h.startTime, end: h.endTime })),
          busy: [...busyAppointments, ...timeOff].filter((b) => b.resourceId === r.id),
          durationMin: duration,
          stepMin: settings.slotMinutes,
          notBefore,
        });
        return { resourceId: r.id, resourceName: r.name, slots: needsRoom ? slots.filter(roomFree) : slots };
      });
    });
  }

  // ---- Atendimentos ---------------------------------------------------------------------------

  listAppointments(opts: { from: Date; to: Date; resourceId?: string; customerId?: string }): Promise<Appointment[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select(appointmentColumns)
        .from(schAppointments)
        .innerJoin(schResources, eq(schResources.id, schAppointments.resourceId))
        .innerJoin(customers, eq(customers.id, schAppointments.customerId))
        .leftJoin(room, eq(room.id, schAppointments.roomId))
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
      return rows.map((r) => toAppointmentDto(r.a, r.resourceName, r.roomName, r.customer, services.filter((s) => s.appointmentId === r.a.id)));
    });
  }

  get(id: string) {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  create(input: AppointmentInput, opts: { source?: 'admin' | 'online' | 'whatsapp'; online?: boolean } = {}) {
    return this.tdb.run((tx) => this.createInTx(tx, input, { ...opts, checkSchedule: true }));
  }

  async createInTx(
    tx: Tx,
    input: AppointmentInput,
    opts: { source?: 'admin' | 'online' | 'whatsapp'; online?: boolean; seriesId?: string; notify?: boolean; checkSchedule?: boolean } = {},
  ): Promise<Appointment> {
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
    const scheduleOverride = opts.checkSchedule ? await this.guardSchedule(tx, resource.id, input.startsAt, endsAt, input.overrideSchedule) : null;
    const roomId = await this.pickRoom(tx, services, input.roomId ?? null, input.startsAt, endsAt);

    const appointment = await this.insertAppointment(tx, {
      tenantId,
      customerId: customer.id,
      resourceId: resource.id,
      roomId,
      seriesId: opts.seriesId ?? null,
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
    if (opts.notify !== false) await this.notify(tx, appointment.id, 'shared.scheduling.booked');
    await this.audit.log(tx, {
      action: 'appointment.created',
      entity: 'appointment',
      entityId: appointment.id,
      data: { source: opts.source ?? 'admin', ...(opts.seriesId ? { seriesId: opts.seriesId } : {}), ...(scheduleOverride ? { scheduleOverride } : {}) },
    });
    return this.detailInTx(tx, appointment.id);
  }

  /**
   * Série com repetição, numa transação só. Cada data passa pelo mesmo caminho de um horário
   * avulso (preço, pacotes, histórico); as que não cabem (profissional ocupado, bloqueio, fora do
   * expediente, sala ocupada) ficam de fora e voltam na resposta. O cliente recebe uma mensagem só.
   */
  createSeries(input: AppointmentSeriesInput): Promise<SeriesResult> {
    return this.tdb.run(async (tx) => {
      const { recurrence, ...base } = input;
      const resource = await this.resourceOrFail(tx, base.resourceId);
      const services = await this.servicesOrFail(tx, base.serviceIds);
      const duration = services.reduce((sum, s) => sum + s.durationMin + s.bufferMin, 0);
      const first = utcToLocal(base.startsAt);
      const seriesId = randomUUID();
      const created: Appointment[] = [];
      const skipped: SeriesResult['skipped'] = [];

      for (const { date, exists } of seriesDates(first.date, recurrence, MAX_OCCURRENCES)) {
        if (!exists) {
          skipped.push({ date, time: first.time, reason: `O mês não tem dia ${Number(date.slice(8))}` });
          continue;
        }
        const startsAt = localToUtc(date, first.time);
        const reason = await this.conflictReason(tx, resource.id, startsAt, addMinutes(startsAt, duration), base.roomId ?? null);
        if (reason) {
          skipped.push({ date, time: first.time, reason });
          continue;
        }
        try {
          // Savepoint: um conflito de última hora (constraint) desfaz só esta data.
          created.push(await tx.transaction((sp) => this.createInTx(sp, { ...base, startsAt }, { seriesId, notify: false })));
        } catch (err) {
          if (!(err instanceof ConflictException)) throw err;
          const body = err.getResponse() as { message?: string };
          skipped.push({ date, time: first.time, reason: body.message ?? 'Horário ocupado' });
        }
      }
      if (!created.length) throw new ConflictException({ code: 'SERIES_EMPTY', message: 'Nenhuma das datas coube na agenda', skipped });

      if (created.length === 1) await this.notify(tx, created[0]!.id, 'shared.scheduling.booked');
      else await this.notifySeries(tx, created, 'shared.scheduling.series_booked');
      await this.audit.log(tx, { action: 'appointment.series_created', entity: 'appointment', entityId: created[0]!.id, data: { seriesId, recurrence, created: created.length, skipped: skipped.length } });
      return { seriesId, created, skipped };
    });
  }

  /** Cancela este horário e os seguintes da mesma série que ainda não aconteceram. */
  cancelSeries(id: string, reason: string) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id, true);
      if (!current.seriesId) throw badRequest('NOT_IN_SERIES', 'Este horário não faz parte de uma série');
      if (!reason.trim()) throw badRequest('REASON_REQUIRED', 'Informe o motivo do cancelamento');
      const rows = await tx
        .select({ id: schAppointments.id })
        .from(schAppointments)
        .where(
          and(
            eq(schAppointments.seriesId, current.seriesId),
            gte(schAppointments.startsAt, current.startsAt),
            inArray(schAppointments.status, ['scheduled', 'confirmed', 'arrived']),
          ),
        )
        .orderBy(asc(schAppointments.startsAt));
      if (!rows.length) throw badRequest('NOTHING_TO_CANCEL', 'Não há horários em aberto nesta série a partir deste');

      const cancelled: Appointment[] = [];
      for (const r of rows) cancelled.push(await this.setStatusInTx(tx, r.id, 'cancelled', reason, { notifyCancel: false }));
      if (cancelled.length === 1) await this.notify(tx, cancelled[0]!.id, 'shared.scheduling.cancelled');
      else await this.notifySeries(tx, cancelled, 'shared.scheduling.series_cancelled');
      return { cancelled: cancelled.length };
    });
  }

  /** Verticais registram ajustes de preço (ver ServicePricer). */
  registerPricer(pricer: ServicePricer) {
    this.pricers.push(pricer);
  }

  /** Outros módulos registram o "para quem é" do agendamento online (ver BookingSubjectProvider). */
  registerBookingSubject(provider: BookingSubjectProvider) {
    if (!this.bookingSubjects.some((p) => p.moduleKey === provider.moduleKey)) this.bookingSubjects.push(provider);
  }

  bookingSubjectFor(activeModules: ReadonlySet<string>): BookingSubjectProvider | null {
    return this.bookingSubjects.find((p) => activeModules.has(p.moduleKey)) ?? null;
  }

  /**
   * Um módulo passa a cobrir um serviço já marcado (ex.: a taxa do tratamento cobre a instalação):
   * a linha fica sem custo e o total acompanha. Devolve false se já há pagamento que passaria do
   * novo total ou se o atendimento encerrou: aí é decisão de quem está cobrando.
   */
  async coverServiceInTx(tx: Tx, appointmentId: string, serviceId: string, label: string): Promise<boolean> {
    const a = await this.findOrFail(tx, appointmentId, true);
    if (closedStatuses.includes(a.status)) return false;
    const [line] = await tx
      .select()
      .from(schAppointmentServices)
      .where(and(eq(schAppointmentServices.appointmentId, appointmentId), eq(schAppointmentServices.serviceId, serviceId)));
    if (!line) return false;
    const total = toCents(a.total) - toCents(line.price);
    if (total < toCents(a.paidAmount)) return false;
    await tx.update(schAppointmentServices).set({ price: '0', discount: '0', covered: true, name: `${line.name} (${label})` }).where(eq(schAppointmentServices.id, line.id));
    const [updated] = await tx.update(schAppointments).set({ total: centsToDecimal(total) }).where(eq(schAppointments.id, appointmentId)).returning();
    await this.syncReceivable(tx, updated!);
    await this.audit.log(tx, { action: 'appointment.service_covered', entity: 'appointment', entityId: appointmentId, data: { serviceId, label, price: Number(line.price) } });
    return true;
  }

  /** Outros módulos reagem à mudança de situação na mesma transação (ver AppointmentStatusHook). */
  registerStatusHook(hook: AppointmentStatusHook) {
    this.statusHooks.push(hook);
  }

  private async activeModules(tx: Tx) {
    return new Set((await tx.select({ key: coreSchema.tenantModules.moduleKey }).from(coreSchema.tenantModules).where(eq(coreSchema.tenantModules.status, 'active'))).map((r) => r.key));
  }

  private async priceLines(tx: Tx, appointmentId: string, customerId: string, services: { id: string; name: string; durationMin: number; bufferMin: number; price: string }[]) {
    const active = this.pricers.length ? await this.activeModules(tx) : new Set<string>();
    const pricers = this.pricers.filter((p) => active.has(p.moduleKey));
    const lines = [];
    for (const s of services) {
      let line = { serviceId: s.id, name: s.name, durationMin: s.durationMin + s.bufferMin, price: s.price, covered: false };
      for (const pricer of pricers) {
        const adjusted = await pricer.price(tx, { appointmentId, customerId, serviceId: s.id, price: Number(s.price) });
        if (adjusted) {
          line = { ...line, price: centsToDecimal(toCents(adjusted.price)), name: adjusted.label ? `${s.name} (${adjusted.label})` : s.name, covered: true };
          break;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  reschedule(id: string, input: { startsAt: Date; resourceId?: string; roomId?: string | null; overrideSchedule?: boolean }) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id, true);
      if (current.status !== 'scheduled' && current.status !== 'confirmed') {
        throw badRequest('APPOINTMENT_STARTED', 'Só horários ainda não iniciados podem ser remarcados');
      }
      const svc = await this.appointmentServiceInfo(tx, id);
      const resourceId = input.resourceId ?? current.resourceId;
      if (resourceId !== current.resourceId) {
        if (!(await this.eligibleResources(tx, svc.serviceIds, resourceId)).length) throw badRequest('RESOURCE_NOT_ELIGIBLE', 'Este profissional não faz todos os serviços do atendimento');
      }
      const duration = current.endsAt.getTime() - current.startsAt.getTime();
      const endsAt = new Date(input.startsAt.getTime() + duration);
      const scheduleOverride = await this.guardSchedule(tx, resourceId, input.startsAt, endsAt, input.overrideSchedule);
      const roomId = await this.rescheduleRoom(tx, current, svc, input.roomId, input.startsAt, endsAt);
      await this.guardOverlap(() =>
        tx
          .update(schAppointments)
          .set({ startsAt: input.startsAt, endsAt, resourceId, roomId, reminderSentAt: null, confirmedAt: null, status: 'scheduled' })
          .where(eq(schAppointments.id, id)),
      );
      await this.notify(tx, id, 'shared.scheduling.rescheduled');
      await this.audit.log(tx, {
        action: 'appointment.rescheduled',
        entity: 'appointment',
        entityId: id,
        data: { from: current.startsAt, to: input.startsAt, ...(roomId !== current.roomId ? { roomFrom: current.roomId, roomTo: roomId } : {}), ...(scheduleOverride ? { scheduleOverride } : {}) },
      });
      return this.detailInTx(tx, id);
    });
  }

  /**
   * Troca profissional, serviços, preço, desconto, sala ou observação de um horário ainda aberto,
   * no mesmo início e com as validações da marcação. Linha mantida guarda o preço dela; serviço novo
   * passa pelos ajustes de preço (pacote, tratamento). Linha coberta por pacote não muda de valor.
   */
  editAppointment(id: string, input: AppointmentEditInput) {
    const ctx = requestContext.require();
    const { tenantId } = ctx;
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id, true);
      if (closedStatuses.includes(current.status)) throw badRequest('APPOINTMENT_CLOSED', 'Atendimento concluído, cancelado ou com falta não pode ser alterado');
      const lines = await tx.select().from(schAppointmentServices).where(eq(schAppointmentServices.appointmentId, id));
      const fixed = lines.filter((l) => !l.serviceId);
      const wanted: { serviceId: string; price?: number; discount?: number }[] = input.services ?? lines.filter((l) => l.serviceId).map((l) => ({ serviceId: l.serviceId! }));
      if (new Set(wanted.map((w) => w.serviceId)).size !== wanted.length) throw badRequest('SERVICE_REPEATED', 'O mesmo serviço apareceu duas vezes');
      const lineOf = new Map(lines.filter((l) => l.serviceId).map((l) => [l.serviceId!, l]));
      const removed = lines.filter((l) => l.serviceId && !wanted.some((w) => w.serviceId === l.serviceId));
      const addedIds = wanted.filter((w) => !lineOf.has(w.serviceId)).map((w) => w.serviceId);

      // Profissional: ativo e que faz todos os serviços que ficam.
      const resourceId = input.resourceId ?? current.resourceId;
      const serviceIds = wanted.map((w) => w.serviceId);
      if (resourceId !== current.resourceId) {
        const resource = await this.resourceOrFail(tx, resourceId);
        if (resource.kind !== 'professional' || !resource.active) throw badRequest('RESOURCE_INACTIVE', 'Profissional inativo');
      }
      if (resourceId !== current.resourceId || addedIds.length) {
        const [resource] = await tx.select({ name: schResources.name }).from(schResources).where(eq(schResources.id, resourceId));
        if (!(await this.eligibleResources(tx, serviceIds, resourceId)).length) throw badRequest('RESOURCE_NOT_ELIGIBLE', `${resource?.name ?? 'Este profissional'} não faz todos os serviços escolhidos`);
      }

      // Valores: `price` e `discount` são de tabela e desconto; o banco guarda o cobrado e o desconto.
      const added = addedIds.length ? await this.priceLines(tx, id, current.customerId, await this.servicesOrFail(tx, addedIds)) : [];
      let valuesChanged = false;
      const net = (service: string, gross: number, discount: number) => {
        if (discount > gross) throw badRequest('DISCOUNT_EXCEEDS_PRICE', `O desconto passa do preço de ${service}`);
        return gross - discount;
      };
      const keep: { row: (typeof lines)[number]; price: number; discount: number }[] = [];
      const fresh: ((typeof added)[number] & { discount: number })[] = [];
      for (const w of wanted) {
        const row = lineOf.get(w.serviceId);
        if (row) {
          const before = { discount: toCents(row.discount), gross: toCents(row.price) + toCents(row.discount) };
          const gross = w.price === undefined ? before.gross : toCents(w.price);
          const discount = w.discount === undefined ? before.discount : toCents(w.discount);
          if (gross !== before.gross || discount !== before.discount) {
            if (row.covered) throw badRequest('LINE_COVERED', `${row.name}: o valor vem do pacote ou do tratamento e não muda à mão`);
            valuesChanged = true;
          }
          keep.push({ row, price: net(row.name, gross, discount), discount });
        } else {
          const line = added.find((l) => l.serviceId === w.serviceId)!;
          const custom = w.price !== undefined || w.discount !== undefined;
          if (custom && line.covered) throw badRequest('LINE_COVERED', `${line.name}: o valor vem do pacote ou do tratamento e não muda à mão`);
          if (custom) valuesChanged = true;
          const discount = toCents(w.discount ?? 0);
          fresh.push({ ...line, price: centsToDecimal(net(line.name, w.price === undefined ? toCents(line.price) : toCents(w.price), discount)), discount });
        }
      }
      if (valuesChanged && !ctx.permissions?.has('shared.scheduling.payments')) {
        throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Você não tem permissão para mudar preço ou desconto', missing: ['shared.scheduling.payments'] });
      }
      const totalCents = [...fixed.map((l) => toCents(l.price)), ...keep.map((k) => k.price), ...fresh.map((f) => toCents(f.price))].reduce((a, b) => a + b, 0);
      const paid = toCents(current.paidAmount);
      if (totalCents < paid) throw badRequest('TOTAL_BELOW_PAID', `O novo total fica abaixo do que já foi pago (${brl.format(centsToNumber(paid))})`);

      // Agenda: mesmo início; o fim acompanha a duração dos serviços.
      const durationMin = [...fixed, ...keep.map((k) => k.row), ...fresh].reduce((sum, l) => sum + l.durationMin, 0);
      const endsAt = addMinutes(current.startsAt, durationMin);
      const scheduleMoved = resourceId !== current.resourceId || endsAt.getTime() !== current.endsAt.getTime();
      const scheduleOverride = scheduleMoved ? await this.guardSchedule(tx, resourceId, current.startsAt, endsAt, input.overrideSchedule) : null;

      const after = await tx.select({ requiresRoom: schServices.requiresRoom }).from(schServices).where(inArray(schServices.id, serviceIds));
      const svc = { serviceIds, requiresRoom: after.some((r) => r.requiresRoom) };
      // A sala atual só fica se ainda servir para os serviços.
      const roomKeeps = current.roomId && (await this.eligibleResources(tx, serviceIds, current.roomId, 'room')).length ? current.roomId : null;
      const roomId =
        input.roomId === undefined && !scheduleMoved && !addedIds.length && !removed.length
          ? current.roomId
          : await this.rescheduleRoom(tx, { ...current, roomId: roomKeeps }, svc, input.roomId, current.startsAt, endsAt);

      if (removed.length) {
        const active = await this.activeModules(tx);
        for (const l of removed) {
          for (const pricer of this.pricers.filter((p) => active.has(p.moduleKey))) await pricer.release?.(tx, { appointmentId: id, serviceId: l.serviceId! });
        }
        await tx.delete(schAppointmentServices).where(inArray(schAppointmentServices.id, removed.map((l) => l.id)));
      }
      for (const k of keep) {
        await tx.update(schAppointmentServices).set({ price: centsToDecimal(k.price), discount: centsToDecimal(k.discount) }).where(eq(schAppointmentServices.id, k.row.id));
      }
      if (fresh.length) await tx.insert(schAppointmentServices).values(fresh.map((f) => ({ ...f, discount: centsToDecimal(f.discount), tenantId, appointmentId: id })));

      const [updated] = await this.guardOverlap(() =>
        tx
          .update(schAppointments)
          .set({
            resourceId,
            roomId,
            endsAt,
            total: centsToDecimal(totalCents),
            paymentStatus: paid === 0 ? 'pending' : paid >= totalCents ? 'paid' : 'partial',
            ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
          })
          .where(eq(schAppointments.id, id))
          .returning(),
      );
      await this.syncReceivable(tx, updated!);
      if (resourceId !== current.resourceId || addedIds.length > 0 || removed.length > 0) {
        await this.customers.addTimeline(tx, {
          customerId: current.customerId,
          moduleKey: MODULE,
          type: 'appointment.updated',
          title: `Horário de ${formatDate(utcToLocal(current.startsAt).date)} alterado`,
          entity: 'appointment',
          entityId: id,
        });
        await this.notify(tx, id, 'shared.scheduling.rescheduled');
      }
      await this.audit.log(tx, {
        action: 'appointment.updated',
        entity: 'appointment',
        entityId: id,
        data: {
          resource: { from: current.resourceId, to: resourceId },
          total: { from: Number(current.total), to: centsToNumber(totalCents) },
          services: { before: lines.map((l) => ({ serviceId: l.serviceId, price: Number(l.price), discount: Number(l.discount) })), after: wanted },
          ...(roomId !== current.roomId ? { room: { from: current.roomId, to: roomId } } : {}),
          ...(scheduleOverride ? { scheduleOverride } : {}),
        },
      });
      return this.detailInTx(tx, id);
    });
  }

  // ---- Sala de atendimentos já marcados ----------------------------------------------------------

  /** Salas que servem para os serviços do atendimento e se estão livres (no horário dele ou em `startsAt`). */
  roomOptions(id: string, startsAt?: Date): Promise<AppointmentRoomOptions> {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id);
      const svc = await this.appointmentServiceInfo(tx, id);
      const start = startsAt ?? current.startsAt;
      const end = new Date(start.getTime() + current.endsAt.getTime() - current.startsAt.getTime());
      const rooms = await this.eligibleResources(tx, svc.serviceIds, undefined, 'room');
      const busy = await this.busyIntervals(tx, rooms.map((r) => r.id), start, end, id);
      return {
        requiresRoom: svc.requiresRoom,
        roomId: current.roomId,
        rooms: rooms.map((r) => ({ id: r.id, name: r.name, free: !busy.some((b) => b.resourceId === r.id) })),
      };
    });
  }

  /**
   * Define, troca (roomId) ou remove (null) a sala de um atendimento, no mesmo horário. A sala
   * precisa servir para os serviços e estar livre; serviço que exige sala não fica sem.
   */
  setRoom(id: string, roomId: string | null) {
    return this.tdb.run(async (tx) => {
      const current = await this.findOrFail(tx, id, true);
      if (closedStatuses.includes(current.status)) throw badRequest('APPOINTMENT_CLOSED', 'Atendimento cancelado, concluído ou com falta não muda de sala');
      if (current.roomId === roomId) return this.detailInTx(tx, id);
      const svc = await this.appointmentServiceInfo(tx, id);
      if (!roomId && svc.requiresRoom) throw roomRequired();
      if (roomId) await this.checkRoom(tx, svc.serviceIds, roomId, current.startsAt, current.endsAt, id);
      await this.guardOverlap(() => tx.update(schAppointments).set({ roomId }).where(eq(schAppointments.id, id)));
      await this.audit.log(tx, { action: 'appointment.room_changed', entity: 'appointment', entityId: id, data: { from: current.roomId, to: roomId } });
      return this.detailInTx(tx, id);
    });
  }

  /**
   * Atendimentos futuros (a partir de agora) que exigem sala e estão sem: cada um, em ordem de
   * horário, recebe a primeira sala livre que serve. Os que não têm sala livre voltam na lista.
   */
  distributeRooms(): Promise<RoomDistributionResult> {
    return this.tdb.run(async (tx) => {
      const needsRoom = tx
        .select({ id: schAppointmentServices.appointmentId })
        .from(schAppointmentServices)
        .innerJoin(schServices, eq(schServices.id, schAppointmentServices.serviceId))
        .where(eq(schServices.requiresRoom, true));
      const pending = await tx
        .select({ a: schAppointments, resourceName: schResources.name, customerName: customers.name })
        .from(schAppointments)
        .innerJoin(schResources, eq(schResources.id, schAppointments.resourceId))
        .innerJoin(customers, eq(customers.id, schAppointments.customerId))
        .where(and(isNull(schAppointments.roomId), gte(schAppointments.startsAt, new Date()), notInArray(schAppointments.status, closedStatuses), inArray(schAppointments.id, needsRoom)))
        .orderBy(asc(schAppointments.startsAt), asc(schAppointments.createdAt));
      const result: RoomDistributionResult = { assigned: 0, unassigned: [], remaining: 0 };
      if (!pending.length) return result;

      const lines = await tx
        .select({ appointmentId: schAppointmentServices.appointmentId, serviceId: schAppointmentServices.serviceId, name: schAppointmentServices.name })
        .from(schAppointmentServices)
        .where(inArray(schAppointmentServices.appointmentId, pending.map((p) => p.a.id)));
      // Salas que servem, por combinação de serviços (poucas combinações diferentes).
      const eligible = new Map<string, { id: string }[]>();
      const optionsOf = new Map<string, { id: string }[]>();
      for (const p of pending) {
        const serviceIds = lines.filter((l) => l.appointmentId === p.a.id && l.serviceId).map((l) => l.serviceId!);
        const key = [...serviceIds].sort().join(',');
        if (!eligible.has(key)) eligible.set(key, await this.eligibleResources(tx, serviceIds, undefined, 'room'));
        optionsOf.set(p.a.id, eligible.get(key)!);
      }
      const roomIds = [...new Set([...eligible.values()].flat().map((r) => r.id))];
      const from = pending[0]!.a.startsAt;
      const to = new Date(Math.max(...pending.map((p) => p.a.endsAt.getTime())));
      const busy = await this.busyIntervals(tx, roomIds, from, to);

      for (const [i, p] of pending.entries()) {
        if (result.assigned >= MAX_ROOM_DISTRIBUTION) {
          result.remaining = pending.length - i;
          break;
        }
        const { startsAt, endsAt } = p.a;
        const room = optionsOf.get(p.a.id)!.find((r) => !busy.some((b) => b.resourceId === r.id && b.start < endsAt && b.end > startsAt));
        if (room) {
          try {
            // Savepoint: um conflito de última hora (constraint) desfaz só este atendimento.
            const updated = await tx.transaction((sp) =>
              this.guardOverlap(() =>
                sp
                  .update(schAppointments)
                  .set({ roomId: room.id })
                  .where(and(eq(schAppointments.id, p.a.id), isNull(schAppointments.roomId)))
                  .returning({ id: schAppointments.id }),
              ),
            );
            if (updated.length) {
              busy.push({ resourceId: room.id, start: startsAt, end: endsAt });
              await this.audit.log(tx, { action: 'appointment.room_changed', entity: 'appointment', entityId: p.a.id, data: { from: null, to: room.id, auto: true } });
              result.assigned++;
            }
            continue;
          } catch (err) {
            if (!(err instanceof ConflictException)) throw err;
          }
        }
        result.unassigned.push({
          id: p.a.id,
          startsAt: startsAt.toISOString(),
          customerName: p.customerName,
          resourceName: p.resourceName,
          services: lines.filter((l) => l.appointmentId === p.a.id).map((l) => l.name),
        });
      }
      return result;
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
    if (this.statusHooks.length) {
      const active = await this.activeModules(tx);
      for (const hook of this.statusHooks.filter((h) => active.has(h.moduleKey))) await hook.onStatus(tx, { appointmentId: id, resourceId: current.resourceId, status });
    }
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

  /**
   * Recebimento de um atendimento: um lançamento pago no financeiro, na data informada (padrão hoje,
   * nunca no futuro). Com caixa escolhido, entra também na sessão aberta dele, só para a conferência
   * do fechamento: o financeiro já tem o lançamento, e o caixa não lança de novo (ADR-040).
   */
  addPayment(id: string, input: { amount: number; method: string; accountId?: string | null; paidAt?: string; registerId?: string | null }) {
    const { tenantId, userId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const a = await this.findOrFail(tx, id, true);
      if (a.status === 'cancelled' || a.status === 'no_show') throw badRequest('APPOINTMENT_CLOSED', 'Atendimento cancelado não recebe pagamento');
      const today = localToday();
      const paidAt = input.paidAt ?? today;
      if (paidAt > today) throw badRequest('INVALID_DATE', 'A data do pagamento não pode ser no futuro');
      const amount = toCents(input.amount);
      const outstanding = toCents(a.total) - toCents(a.paidAmount);
      if (amount > outstanding) throw badRequest('PAYMENT_EXCEEDS_BALANCE', `O valor passa do saldo em aberto (${brl.format(centsToNumber(outstanding))})`);

      // Mesma regra da venda: a de hoje com o caixa fechado é recusada; a de outro dia só entra se a
      // sessão daquele dia ainda estiver aberta (o dinheiro dela ainda vai ser conferido).
      let registerSessionId: string | null = null;
      const occurredAt = paidAt === today ? new Date() : localToUtc(paidAt, '23:59');
      if (input.registerId) {
        if (!(await this.activeModules(tx)).has('shared.sales')) throw badRequest('REGISTER_UNAVAILABLE', 'O caixa (PDV) não está ativo nesta empresa');
        registerSessionId = await this.registers.sessionForSaleInTx(tx, { registerId: input.registerId, required: false, soldAt: occurredAt });
      }
      // O dinheiro que entra na gaveta está na conta Caixa, como nas vendas.
      const accountId = (registerSessionId && input.method === 'cash' ? null : input.accountId) ?? (await this.finance.defaultAccountId(tx));
      if (!accountId) throw badRequest('ACCOUNT_REQUIRED', 'Escolha a conta do financeiro');

      const entry = await this.finance.recordInTx(tx, {
        kind: 'income',
        status: 'paid',
        amount: input.amount,
        description: `Atendimento de ${formatDate(utcToLocal(a.startsAt).date)}`,
        dueDate: paidAt,
        paidAt,
        accountId,
        customerId: a.customerId,
        paymentMethod: input.method,
        sourceType: SOURCE,
        sourceId: a.id,
        categoryKey: 'services',
      });
      const [payment] = await tx
        .insert(schPayments)
        .values({ tenantId, appointmentId: id, amount: centsToDecimal(amount), method: input.method, paidAt, finEntryId: entry.id, registerSessionId, userId })
        .returning({ id: schPayments.id });
      if (registerSessionId) {
        await this.registers.addServiceReceiptInTx(tx, {
          sessionId: registerSessionId,
          method: registerMethod(input.method),
          amountCents: amount,
          reason: `Atendimento de ${formatDate(utcToLocal(a.startsAt).date)}`,
          occurredAt,
          sourceType: 'sch_payment',
          sourceId: payment!.id,
        });
      }
      const paid = toCents(a.paidAmount) + amount;
      const [updated] = await tx
        .update(schAppointments)
        .set({ paidAmount: centsToDecimal(paid), paymentStatus: paid >= toCents(a.total) ? 'paid' : 'partial' })
        .where(eq(schAppointments.id, id))
        .returning();
      await this.syncReceivable(tx, updated!);
      await this.audit.log(tx, { action: 'appointment.payment', entity: 'appointment', entityId: id, data: { ...input, paidAt, accountId, registerSessionId } });
      const detail = await this.detailInTx(tx, id);
      await this.outbox.publish(tx, PAYMENT_RECORDED, {
        appointmentId: id,
        customerId: a.customerId,
        amount: input.amount,
        method: input.method,
        paidAt,
        status: detail.status,
        paymentStatus: detail.paymentStatus,
        total: detail.total,
        paidAmount: detail.paidAmount,
        startsAt: detail.startsAt,
        professional: detail.resourceName,
        services: detail.services,
      });
      return detail;
    });
  }

  /** Caixas do PDV com sessão aberta agora, para o pagamento na agenda (vazio sem o módulo de vendas). */
  async paymentRegisters(): Promise<{ id: string; name: string }[]> {
    const active = await this.tdb.run((tx) => this.activeModules(tx));
    if (!active.has('shared.sales')) return [];
    const { registers } = await this.registers.overview();
    return registers.filter((r) => r.active && r.openSession).map((r) => ({ id: r.id, name: r.name }));
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

  /** As constraints EXCLUDE do banco recusam horários sobrepostos do mesmo profissional ou da mesma sala. */
  private async guardOverlap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string };
      if ((e.cause?.code ?? e.code) === '23P01') {
        if ((e.cause?.constraint ?? e.constraint) === ROOM_CONSTRAINT) throw roomTaken();
        throw new ConflictException({ code: 'SLOT_TAKEN', message: 'Este horário já está ocupado para este profissional' });
      }
      throw err;
    }
  }

  /**
   * Sala do horário: a escolhida (precisa servir para os serviços e estar livre) ou, se algum
   * serviço exige sala e nenhuma foi escolhida, a primeira livre entre as que servem.
   */
  private async pickRoom(tx: Tx, services: { id: string; requiresRoom: boolean }[], roomId: string | null, start: Date, end: Date): Promise<string | null> {
    const serviceIds = services.map((s) => s.id);
    if (roomId) return this.checkRoom(tx, serviceIds, roomId, start, end);
    if (!services.some((s) => s.requiresRoom)) return null;
    const free = await this.freeRoom(tx, serviceIds, start, end);
    if (!free) throw roomTaken('Nenhuma sala/equipamento livre neste horário');
    return free.id;
  }

  /** A sala escolhida é uma sala ativa, serve para os serviços e está livre no período. */
  private async checkRoom(tx: Tx, serviceIds: string[], roomId: string, start: Date, end: Date, exceptAppointmentId?: string): Promise<string> {
    const [r] = await tx.select().from(schResources).where(eq(schResources.id, roomId));
    if (!r || r.kind !== 'room' || !r.active) throw badRequest('ROOM_NOT_FOUND', 'Sala/equipamento não encontrado ou inativo');
    if (!(await this.eligibleResources(tx, serviceIds, roomId, 'room')).length) throw badRequest('ROOM_NOT_ELIGIBLE', `${r.name} não serve para todos os serviços escolhidos`);
    if ((await this.busyIntervals(tx, [roomId], start, end, exceptAppointmentId)).length) throw roomTaken(`${r.name} já tem reserva neste horário`);
    return roomId;
  }

  /** Primeira sala livre no período, entre as que servem para os serviços (ou null). */
  private async freeRoom(tx: Tx, serviceIds: string[], start: Date, end: Date, exceptAppointmentId?: string) {
    const rooms = await this.eligibleResources(tx, serviceIds, undefined, 'room');
    const busy = await this.busyIntervals(tx, rooms.map((r) => r.id), start, end, exceptAppointmentId);
    return rooms.find((r) => !busy.some((b) => b.resourceId === r.id)) ?? null;
  }

  /**
   * Sala ao remarcar: a escolhida (conferida); null = sem sala; sem escolha, a atual se estiver livre
   * no novo horário, senão outra livre que sirva para os serviços — ou recusa, dizendo por quê.
   */
  private async rescheduleRoom(
    tx: Tx,
    current: AppointmentRow,
    svc: { serviceIds: string[]; requiresRoom: boolean },
    roomId: string | null | undefined,
    start: Date,
    end: Date,
  ): Promise<string | null> {
    if (roomId === null) {
      if (svc.requiresRoom) throw roomRequired();
      return null;
    }
    if (roomId) return this.checkRoom(tx, svc.serviceIds, roomId, start, end, current.id);
    if (current.roomId && !(await this.busyIntervals(tx, [current.roomId], start, end, current.id)).length) return current.roomId;
    if (!current.roomId && !svc.requiresRoom) return null;
    const free = await this.freeRoom(tx, svc.serviceIds, start, end, current.id);
    if (free) return free.id;
    if (!current.roomId) throw roomTaken('Nenhuma sala/equipamento livre que sirva para os serviços neste horário. Escolha outro horário.');
    const [r] = await tx.select({ name: schResources.name }).from(schResources).where(eq(schResources.id, current.roomId));
    throw roomTaken(
      `${r?.name ?? 'A sala/equipamento'} já tem reserva no novo horário e não há outra sala/equipamento livre que sirva para os serviços. Escolha outro horário${svc.requiresRoom ? '' : ' ou remarque sem sala'}.`,
    );
  }

  /** Serviços do atendimento que ainda existem e se algum deles exige sala. */
  private async appointmentServiceInfo(tx: Tx, appointmentId: string) {
    const rows = await tx
      .select({ serviceId: schAppointmentServices.serviceId, requiresRoom: schServices.requiresRoom })
      .from(schAppointmentServices)
      .leftJoin(schServices, eq(schServices.id, schAppointmentServices.serviceId))
      .where(eq(schAppointmentServices.appointmentId, appointmentId));
    return { serviceIds: rows.map((r) => r.serviceId).filter((s): s is string => !!s), requiresRoom: rows.some((r) => r.requiresRoom === true) };
  }

  /** Ocupação de salas no período: horários que as reservam e bloqueios delas. */
  private async busyIntervals(tx: Tx, roomIds: string[], from: Date, to: Date, exceptAppointmentId?: string): Promise<(Interval & { resourceId: string })[]> {
    if (!roomIds.length) return [];
    const [appointments, timeOff] = await Promise.all([
      tx
        .select({ resourceId: schAppointments.roomId, start: schAppointments.startsAt, end: schAppointments.endsAt })
        .from(schAppointments)
        .where(
          and(
            inArray(schAppointments.roomId, roomIds),
            lt(schAppointments.startsAt, to),
            sql`${schAppointments.endsAt} > ${from}`,
            notInArray(schAppointments.status, RELEASED),
            exceptAppointmentId ? ne(schAppointments.id, exceptAppointmentId) : undefined,
          ),
        ),
      tx
        .select({ resourceId: schTimeOff.resourceId, start: schTimeOff.startsAt, end: schTimeOff.endsAt })
        .from(schTimeOff)
        .where(and(inArray(schTimeOff.resourceId, roomIds), lt(schTimeOff.startsAt, to), sql`${schTimeOff.endsAt} > ${from}`)),
    ]);
    return [...appointments.map((a) => ({ ...a, resourceId: a.resourceId! })), ...timeOff];
  }

  /** Expediente e folga do profissional no período: o motivo de não caber, ou null. */
  private async scheduleConflict(tx: Tx, resourceId: string, start: Date, end: Date): Promise<string | null> {
    const local = utcToLocal(start);
    const hours = await tx
      .select()
      .from(schWorkingHours)
      .where(and(eq(schWorkingHours.resourceId, resourceId), eq(schWorkingHours.weekday, weekdayOf(local.date))));
    if (!hours.some((h) => localToUtc(local.date, h.startTime) <= start && end <= localToUtc(local.date, h.endTime))) return 'Fora do expediente';
    const [off] = await tx
      .select({ id: schTimeOff.id })
      .from(schTimeOff)
      .where(and(eq(schTimeOff.resourceId, resourceId), lt(schTimeOff.startsAt, end), sql`${schTimeOff.endsAt} > ${start}`))
      .limit(1);
    return off ? 'Profissional de folga ou com horário bloqueado' : null;
  }

  /**
   * Marcação fora do expediente ou em folga é recusada. A exceção é consciente: quem configura a
   * agenda confirma "marcar mesmo assim", e o motivo fica na auditoria (devolvido para quem grava).
   */
  private async guardSchedule(tx: Tx, resourceId: string, start: Date, end: Date, override?: boolean): Promise<string | null> {
    const reason = await this.scheduleConflict(tx, resourceId, start, end);
    if (!reason) return null;
    if (!override) throw new ConflictException({ code: 'OUTSIDE_SCHEDULE', message: `${reason} neste horário` });
    if (!requestContext.require().permissions?.has('shared.scheduling.manage')) {
      throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Só quem configura a agenda pode marcar fora do expediente ou em folga', missing: ['shared.scheduling.manage'] });
    }
    return reason;
  }

  /** Por que uma data da série não cabe (ou null se cabe): expediente, bloqueio, outro horário, sala. */
  private async conflictReason(tx: Tx, resourceId: string, start: Date, end: Date, roomId: string | null): Promise<string | null> {
    const schedule = await this.scheduleConflict(tx, resourceId, start, end);
    if (schedule) return schedule;
    const [taken] = await tx
      .select({ id: schAppointments.id })
      .from(schAppointments)
      .where(
        and(
          eq(schAppointments.resourceId, resourceId),
          lt(schAppointments.startsAt, end),
          sql`${schAppointments.endsAt} > ${start}`,
          notInArray(schAppointments.status, RELEASED),
        ),
      )
      .limit(1);
    if (taken) return 'Profissional já tem horário marcado';
    if (roomId && (await this.busyIntervals(tx, [roomId], start, end)).length) return 'Sala/equipamento ocupado';
    return null;
  }

  /** Uma mensagem só para vários horários da mesma série (marcados ou cancelados). */
  private async notifySeries(tx: Tx, list: Appointment[], templateKey: string) {
    const first = list[0]!;
    const local = utcToLocal(new Date(first.startsAt));
    await this.notifications.enqueueInTx(tx, {
      templateKey,
      customerId: first.customer.id,
      related: { entity: 'appointment', id: first.id },
      data: {
        agendamento: {
          id: first.id,
          data: formatDate(local.date),
          hora: local.time,
          servicos: first.services.map((s) => s.name).join(', '),
          profissional: first.resourceName,
          total: brl.format(first.total),
          datas: list.map((a) => formatDate(utcToLocal(new Date(a.startsAt)).date)).join(', '),
          quantidade: String(list.length),
        },
      },
    });
  }

  private async detailInTx(tx: Tx, id: string): Promise<Appointment> {
    const [row] = await tx
      .select(appointmentColumns)
      .from(schAppointments)
      .innerJoin(schResources, eq(schResources.id, schAppointments.resourceId))
      .innerJoin(customers, eq(customers.id, schAppointments.customerId))
      .leftJoin(room, eq(room.id, schAppointments.roomId))
      .where(eq(schAppointments.id, id));
    if (!row) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Atendimento não encontrado' });
    const services = await tx.select().from(schAppointmentServices).where(eq(schAppointmentServices.appointmentId, id));
    return toAppointmentDto(row.a, row.resourceName, row.roomName, row.customer, services);
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

  /**
   * Profissionais (ou salas) ativos que servem para todos os serviços. Vale o vínculo do mesmo
   * tipo: serviço sem profissional ligado = qualquer profissional; sem sala ligada = qualquer sala.
   */
  private async eligibleResources(tx: Tx, serviceIds: string[], resourceId?: string, kind: 'professional' | 'room' = 'professional') {
    const [resources, links] = await Promise.all([
      tx
        .select()
        .from(schResources)
        .where(and(eq(schResources.active, true), resourceId ? eq(schResources.id, resourceId) : eq(schResources.kind, kind)))
        .orderBy(asc(schResources.name)),
      tx
        .select({ serviceId: schServiceResources.serviceId, resourceId: schServiceResources.resourceId, kind: schResources.kind })
        .from(schServiceResources)
        .innerJoin(schResources, eq(schResources.id, schServiceResources.resourceId))
        .where(inArray(schServiceResources.serviceId, serviceIds)),
    ]);
    return resources.filter((r) =>
      serviceIds.every((sid) => {
        const allowed = links.filter((l) => l.serviceId === sid && l.kind === r.kind);
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
    requiresRoom: s.requiresRoom,
    resourceIds,
  };
}

const appointmentColumns = {
  a: schAppointments,
  resourceName: schResources.name,
  roomName: room.name,
  customer: { id: customers.id, name: customers.name, phone: customers.phone, email: customers.email },
};

function toAppointmentDto(
  a: AppointmentRow,
  resourceName: string,
  roomName: string | null,
  customer: Appointment['customer'],
  services: (typeof schAppointmentServices.$inferSelect)[],
): Appointment {
  return {
    id: a.id,
    customer,
    resourceId: a.resourceId,
    resourceName,
    roomId: a.roomId,
    roomName: a.roomId ? roomName : null,
    seriesId: a.seriesId,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    source: a.source,
    notes: a.notes,
    subject: a.subjectType && a.subjectId ? { type: a.subjectType, id: a.subjectId, label: a.subjectLabel ?? '' } : null,
    services: services.map((s) => ({ serviceId: s.serviceId, name: s.name, durationMin: s.durationMin, price: Number(s.price), discount: Number(s.discount), covered: s.covered })),
    total: Number(a.total),
    paidAmount: Number(a.paidAmount),
    paymentStatus: a.paymentStatus,
    confirmedAt: a.confirmedAt?.toISOString() ?? null,
    cancelReason: a.cancelReason,
    createdAt: a.createdAt.toISOString(),
  };
}
