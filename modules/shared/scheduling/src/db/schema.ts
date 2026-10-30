import { customers, teamMembers, users } from '@all/core/schema';
import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** Quem ou o que atende: profissional (cabeleireira, dentista, veterinário) ou sala/equipamento. */
export const schResources = pgTable(
  'sch_resources',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['professional', 'room'] }).notNull().default('professional'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Profissional = pessoa da equipe (core). Só para kind professional; uma pessoa, um profissional. */
    teamMemberId: uuid('team_member_id').references(() => teamMembers.id, { onDelete: 'set null' }),
    color: text('color').notNull().default('#2d4bff'),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sch_resources_team_member_key').on(t.tenantId, t.teamMemberId).where(sql`team_member_id is not null`), tenantIsolation()],
);

export const schServices = pgTable(
  'sch_services',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    category: text('category'),
    durationMin: integer('duration_min').notNull(),
    bufferMin: integer('buffer_min').notNull().default(0),
    price: money('price').notNull(),
    /** Aparece no agendamento online. Desligado até a empresa decidir liberar. */
    online: boolean('online').notNull().default(false),
    active: boolean('active').notNull().default(true),
    description: text('description'),
    /** Só pode ser marcado com uma sala/equipamento livre. */
    requiresRoom: boolean('requires_room').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [tenantIsolation()],
);

/**
 * Quem faz cada serviço (profissionais) e onde pode ser feito (salas/equipamentos). Serviço sem
 * nenhuma linha de um tipo = qualquer recurso daquele tipo.
 */
export const schServiceResources = pgTable(
  'sch_service_resources',
  {
    tenantId: tenantId(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => schServices.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schResources.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.resourceId] }), tenantIsolation()],
);

/** Expediente semanal, no horário local da empresa. Vários intervalos por dia (ex.: pausa do almoço). */
export const schWorkingHours = pgTable(
  'sch_working_hours',
  {
    id: id(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schResources.id, { onDelete: 'cascade' }),
    /** 0 = domingo … 6 = sábado */
    weekday: smallint('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
  },
  (t) => [index('sch_working_hours_resource_idx').on(t.resourceId), tenantIsolation()],
);

/** Folgas, férias, compromissos: horários bloqueados. */
export const schTimeOff = pgTable(
  'sch_time_off',
  {
    id: id(),
    tenantId: tenantId(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schResources.id, { onDelete: 'cascade' }),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    reason: text('reason'),
  },
  (t) => [index('sch_time_off_resource_idx').on(t.resourceId, t.startsAt), tenantIsolation()],
);

/**
 * Atendimentos. A sobreposição de horários do mesmo profissional, e da mesma sala, é impedida
 * pelo próprio banco (constraints EXCLUDE na migration), inclusive entre marcações simultâneas.
 */
export const schAppointments = pgTable(
  'sch_appointments',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schResources.id),
    /** Sala/equipamento reservado junto (opcional). */
    roomId: uuid('room_id').references(() => schResources.id),
    /** Horários criados juntos por repetição. */
    seriesId: uuid('series_id'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    status: text('status', { enum: ['scheduled', 'confirmed', 'arrived', 'in_service', 'done', 'no_show', 'cancelled'] })
      .notNull()
      .default('scheduled'),
    source: text('source', { enum: ['admin', 'online', 'whatsapp'] }).notNull().default('admin'),
    notes: text('notes'),
    /** Para quem é o atendimento, quando não é o próprio cliente (ex.: pet). */
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    subjectLabel: text('subject_label'),
    total: money('total').notNull(),
    paidAmount: money('paid_amount').notNull().default('0'),
    paymentStatus: text('payment_status', { enum: ['pending', 'partial', 'paid'] }).notNull().default('pending'),
    reminderSentAt: ts('reminder_sent_at'),
    confirmedAt: ts('confirmed_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('sch_appointments_resource_idx').on(t.tenantId, t.resourceId, t.startsAt),
    index('sch_appointments_customer_idx').on(t.customerId),
    index('sch_appointments_starts_idx').on(t.tenantId, t.startsAt),
    index('sch_appointments_room_idx').on(t.tenantId, t.roomId, t.startsAt),
    index('sch_appointments_series_idx').on(t.seriesId),
    tenantIsolation(),
  ],
);

/**
 * Serviços do atendimento, com nome, duração e preço do momento da marcação. `price` é o valor
 * cobrado, já sem o desconto (preço de tabela = price + discount). `covered`: coberto por pacote ou
 * tratamento (um ServicePricer definiu o valor), então preço e desconto não mudam à mão.
 */
export const schAppointmentServices = pgTable(
  'sch_appointment_services',
  {
    id: id(),
    tenantId: tenantId(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => schAppointments.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => schServices.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    durationMin: integer('duration_min').notNull(),
    price: money('price').notNull(),
    discount: money('discount').notNull().default('0'),
    covered: boolean('covered').notNull().default(false),
  },
  (t) => [index('sch_appointment_services_appt_idx').on(t.appointmentId), tenantIsolation()],
);

export const schPayments = pgTable(
  'sch_payments',
  {
    id: id(),
    tenantId: tenantId(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => schAppointments.id, { onDelete: 'cascade' }),
    amount: money('amount').notNull(),
    method: text('method').notNull(),
    paidAt: date('paid_at', { mode: 'string' }).notNull(),
    finEntryId: uuid('fin_entry_id'),
    /** Sessão de caixa (shared.sales) em que o recebimento entrou; sem FK: o caixa é opcional. */
    registerSessionId: uuid('register_session_id'),
    userId: uuid('user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sch_payments_appt_idx').on(t.appointmentId), tenantIsolation()],
);
