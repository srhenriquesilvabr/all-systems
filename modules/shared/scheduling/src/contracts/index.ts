import { z } from 'zod';

// Contratos compartilhados entre a API e as telas (src/web).

export const appointmentStatuses = ['scheduled', 'confirmed', 'arrived', 'in_service', 'done', 'no_show', 'cancelled'] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const appointmentStatusLabel: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  arrived: 'Chegou',
  in_service: 'Em atendimento',
  done: 'Concluído',
  no_show: 'Faltou',
  cancelled: 'Cancelado',
};

/** Status que encerram o atendimento: não ocupam mais a agenda (exceto concluído, que já passou). */
export const closedStatuses: AppointmentStatus[] = ['done', 'no_show', 'cancelled'];

/** Para onde cada status pode ir. */
export const statusTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'arrived', 'in_service', 'done', 'no_show', 'cancelled'],
  confirmed: ['arrived', 'in_service', 'done', 'no_show', 'cancelled'],
  arrived: ['in_service', 'done', 'cancelled'],
  in_service: ['done'],
  done: [],
  no_show: [],
  cancelled: [],
};

export const weekdayLabel = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (use HH:MM)');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const resourceInput = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['professional', 'room']).default('professional'),
  /** Usuário do sistema que é este profissional (para "minha agenda" e comissões). */
  userId: z.string().uuid().nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#2d4bff'),
  active: z.boolean().default(true),
  serviceIds: z.array(z.string().uuid()).optional(),
  /**
   * Profissional: a pessoa da equipe que ele é. Ausente mantém o vínculo; sem vínculo, o
   * profissional ganha uma pessoa com o nome dele.
   */
  teamMemberId: z.string().uuid().nullish(),
  /**
   * Dados da pessoa (nome, sobrenome, CPF, endereço…), validados pelo core. Só com a permissão
   * `core.team.manage` (dado pessoal); campos ausentes ficam como estão.
   */
  person: z.record(z.unknown()).nullish(),
});
export type ResourceInput = z.infer<typeof resourceInput>;

export const workingHoursInput = z.object({
  hours: z
    .array(z.object({ weekday: z.number().int().min(0).max(6), start: hhmm, end: hhmm }))
    .max(50)
    .refine((list) => list.every((h) => h.start < h.end), 'O início precisa ser antes do fim'),
});

export const timeOffInput = z
  .object({ startsAt: z.coerce.date(), endsAt: z.coerce.date(), reason: z.string().trim().max(200).nullish() })
  .refine((t) => t.startsAt < t.endsAt, 'O início precisa ser antes do fim');

export const serviceInput = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.string().trim().max(40).nullish(),
  durationMin: z.coerce.number().int().min(5).max(12 * 60),
  /** Intervalo depois do serviço (limpeza, preparo da sala). */
  bufferMin: z.coerce.number().int().min(0).max(240).default(0),
  price: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01),
  /** Aparece no agendamento online. */
  online: z.boolean().default(true),
  active: z.boolean().default(true),
  description: z.string().trim().max(500).nullish(),
  /** Precisa de uma sala/equipamento livre (entre as ligadas ao serviço, ou qualquer uma). */
  requiresRoom: z.boolean().default(false),
  /** Profissionais que fazem e salas/equipamentos que servem (nenhum de um tipo = qualquer um). */
  resourceIds: z.array(z.string().uuid()).optional(),
});
export type ServiceInput = z.infer<typeof serviceInput>;

export const appointmentInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  resourceId: z.string().uuid('Escolha o profissional'),
  startsAt: z.coerce.date(),
  serviceIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos um serviço').max(10),
  notes: z.string().trim().max(1000).nullish(),
  /** Para quem é o atendimento, quando não é o próprio cliente (ex.: o pet). Definido pela vertical. */
  subject: z.object({ type: z.string().max(40), id: z.string().max(100), label: z.string().max(120) }).nullish(),
  /** Sala/equipamento reservado junto com o profissional. */
  roomId: z.string().uuid().nullish(),
});
export type AppointmentInput = z.infer<typeof appointmentInput>;

/**
 * Repetição: toda semana, a cada 2 semanas ou todo mês no mesmo dia do mês (meses sem esse dia,
 * como 31 de abril, ficam de fora). Termina depois de N vezes (contando as que não couberem) ou numa data.
 */
export const recurrenceFrequencies = ['weekly', 'biweekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof recurrenceFrequencies)[number];
export const recurrenceLabel: Record<RecurrenceFrequency, string> = {
  weekly: 'Toda semana',
  biweekly: 'A cada 2 semanas',
  monthly: 'Todo mês (mesmo dia)',
};
export const MAX_OCCURRENCES = 52;
export const recurrenceInput = z
  .object({
    frequency: z.enum(recurrenceFrequencies),
    count: z.number().int().min(2).max(MAX_OCCURRENCES).nullish(),
    until: isoDate.nullish(),
  })
  .refine((r) => !!r.count !== !!r.until, 'Informe quantas vezes ou até quando repetir');
export type RecurrenceInput = z.infer<typeof recurrenceInput>;

export const appointmentSeriesInput = appointmentInput.extend({ recurrence: recurrenceInput });
export type AppointmentSeriesInput = z.infer<typeof appointmentSeriesInput>;

export const cancelSeriesInput = z.object({ reason: z.string().trim().min(1, 'Informe o motivo do cancelamento').max(300) });

export const rescheduleInput = z.object({
  startsAt: z.coerce.date(),
  resourceId: z.string().uuid().optional(),
  /**
   * Sala no novo horário: ausente = mantém a atual se estiver livre (senão, outra livre que sirva);
   * null = sem sala (não vale se algum serviço exige sala).
   */
  roomId: z.string().uuid().nullish(),
});
/** Define, troca (id) ou remove (null) a sala/equipamento de um atendimento já marcado. */
export const appointmentRoomInput = z.object({ roomId: z.string().uuid().nullable() });
export const appointmentRoomsQuery = z.object({ startsAt: z.coerce.date().optional() });
export const statusInput = z.object({ status: z.enum(appointmentStatuses), reason: z.string().trim().max(300).nullish() });

export const availabilityQuery = z.object({
  date: isoDate,
  serviceIds: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(10)),
  resourceId: z.string().uuid().optional(),
});

export const paymentMethods = ['cash', 'pix', 'credit_card', 'debit_card', 'transfer', 'other'] as const;
export const appointmentPaymentInput = z.object({
  amount: z.coerce.number().positive().max(1_000_000).multipleOf(0.01),
  method: z.enum(paymentMethods),
  accountId: z.string().uuid(),
  paidAt: isoDate,
});

export const onlineBookingInput = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  phone: z.string().trim().min(10, 'Informe o celular com DDD').max(20),
  email: z.string().trim().email().max(254).nullish().or(z.literal('')),
  resourceId: z.string().uuid(),
  startsAt: z.coerce.date(),
  serviceIds: z.array(z.string().uuid()).min(1).max(5),
  notes: z.string().trim().max(500).nullish(),
  /** Campos de "para quem é" pedidos pela página (ex.: nome e espécie do pet), por chave. */
  subjectFields: z.record(z.string().max(40), z.string().trim().max(120)).nullish(),
});

export const schedulingSettings = z.object({
  /** Quantas horas antes enviar o lembrete (0 = não enviar). */
  reminderHours: z.number().int().min(0).max(168).default(24),
  onlineBooking: z.boolean().default(false),
  /** Antecedência mínima para marcar online. */
  onlineMinNoticeHours: z.number().int().min(0).max(168).default(2),
  /** Até quantos dias à frente o cliente pode marcar online. */
  onlineMaxDays: z.number().int().min(1).max(180).default(30),
  slotMinutes: z.number().int().min(5).max(60).default(15),
});
export type SchedulingSettings = z.infer<typeof schedulingSettings>;

// ---- respostas da API ----------------------------------------------------------------------

export interface Resource {
  id: string;
  name: string;
  kind: 'professional' | 'room';
  userId: string | null;
  /** Pessoa da equipe (só profissionais). */
  teamMemberId: string | null;
  color: string;
  active: boolean;
  serviceIds: string[];
  hours: { weekday: number; start: string; end: string }[];
}

export interface Service {
  id: string;
  name: string;
  category: string | null;
  durationMin: number;
  bufferMin: number;
  price: number;
  online: boolean;
  active: boolean;
  description: string | null;
  requiresRoom: boolean;
  resourceIds: string[];
}

export interface Appointment {
  id: string;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  resourceId: string;
  resourceName: string;
  roomId: string | null;
  roomName: string | null;
  /** Horários marcados juntos, com repetição, compartilham a série. */
  seriesId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: 'admin' | 'online' | 'whatsapp';
  notes: string | null;
  subject: { type: string; id: string; label: string } | null;
  services: { serviceId: string | null; name: string; durationMin: number; price: number }[];
  total: number;
  paidAmount: number;
  paymentStatus: 'pending' | 'partial' | 'paid';
  confirmedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface AvailabilitySlots {
  resourceId: string;
  resourceName: string;
  slots: string[];
}

/** Salas que servem para os serviços de um atendimento, e se cada uma está livre no horário. */
export interface AppointmentRoomOptions {
  /** Algum serviço do atendimento exige sala (não pode ficar sem). */
  requiresRoom: boolean;
  roomId: string | null;
  rooms: { id: string; name: string; free: boolean }[];
}

/** Resultado de "distribuir salas": atendimentos futuros que exigem sala e estavam sem. */
export interface RoomDistributionResult {
  assigned: number;
  /** Os que ficaram sem sala livre adequada. */
  unassigned: { id: string; startsAt: string; customerName: string; resourceName: string; services: string[] }[];
  /** Além do limite desta rodada; rodar de novo continua. */
  remaining: number;
}

export interface SeriesResult {
  seriesId: string;
  created: Appointment[];
  /** Datas (locais) que não couberam na agenda e o porquê. */
  skipped: { date: string; time: string; reason: string }[];
}

/** Campo extra do agendamento online definido por outro módulo (ex.: nome e espécie do pet). */
export interface BookingSubjectField {
  key: string;
  label: string;
  required?: boolean;
  maxLength?: number;
  /** Com opções, vira uma lista de escolha. */
  options?: { value: string; label: string }[];
}
