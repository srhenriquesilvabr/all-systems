import { z } from 'zod';

// Contratos compartilhados entre a API e as telas (src/web).

export const pricingUnits = ['piece', 'kg', 'sqm'] as const;
export type PricingUnit = (typeof pricingUnits)[number];

export const pricingUnitLabel: Record<PricingUnit, string> = {
  piece: 'por peça',
  kg: 'por kg',
  sqm: 'por m²',
};

export const serviceInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome do serviço').max(80),
  pricingUnit: z.enum(pricingUnits),
  /** Em reais, com até 2 casas decimais. */
  basePrice: z.coerce.number().min(0).max(100_000).multipleOf(0.01, 'Use no máximo 2 casas decimais'),
  turnaroundHours: z.coerce.number().int().min(1).max(24 * 60),
  active: z.boolean().default(true),
});
export type ServiceInput = z.infer<typeof serviceInput>;

export const serviceUpdate = serviceInput.partial();

export interface LaundryService extends ServiceInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export const laundrySettings = z.object({
  /** Prazo usado quando nenhum serviço da ordem informa o seu (em horas). */
  defaultTurnaroundHours: z.number().int().min(1).max(24 * 60).default(48),
  /** Exige ao menos uma foto da peça antes de ela sair de "Recebida" (a foto só existe depois de a ordem abrir). */
  requirePiecePhotos: z.boolean().default(false),
  /** Taxas padrão de coleta e entrega (em reais), sugeridas ao agendar. */
  pickupFee: z.number().min(0).max(10_000).multipleOf(0.01).default(0),
  deliveryFee: z.number().min(0).max(10_000).multipleOf(0.01).default(0),
});
export type LaundrySettings = z.infer<typeof laundrySettings>;

// ---- Peças e ordens ---------------------------------------------------------------------------

/** Etapas de produção de uma peça, na ordem. */
export const pieceStatuses = ['received', 'washing', 'drying', 'ironing', 'ready'] as const;
export type PieceStatus = (typeof pieceStatuses)[number];
export const pieceStatusLabel: Record<PieceStatus, string> = {
  received: 'Recebida',
  washing: 'Lavagem',
  drying: 'Secagem',
  ironing: 'Passadoria',
  ready: 'Pronta',
};

export const orderLineInput = z.object({
  serviceId: z.string().uuid('Escolha o serviço'),
  garmentTypeId: z.string().uuid().nullish(),
  /** Peças: cada uma vira um item com etiqueta. Em serviços por kg/m², é só informativo. */
  quantity: z.coerce.number().int().min(1).max(200).default(1),
  weightKg: z.coerce.number().positive().max(500).multipleOf(0.001).nullish(),
  areaSqm: z.coerce.number().positive().max(500).multipleOf(0.01).nullish(),
  color: z.string().trim().max(40).nullish(),
  brand: z.string().trim().max(40).nullish(),
  /** Avarias que a peça já tinha ao chegar (manchas, rasgos). Protege a lavanderia. */
  intakeNotes: z.string().trim().max(500).nullish(),
});
export type OrderLineInput = z.infer<typeof orderLineInput>;

const spToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Mesma regra da ordem de serviço: 'YYYY-MM-DD' (hoje = agora; outro dia = meio-dia em SP) ou data e hora; nunca no futuro. */
const receivedAtInput = z
  .string()
  .trim()
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? (v === spToday() ? new Date() : new Date(`${v}T12:00:00-03:00`)) : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), 'Data de entrada inválida')
  .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'A data de entrada não pode ser no futuro');

export const laundryOrderInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  lines: z.array(orderLineInput).min(1, 'Inclua ao menos uma peça').max(100),
  discount: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01).default(0),
  /** Sem data, usa o maior prazo entre os serviços escolhidos, contado da entrada. */
  dueAt: z.coerce.date().nullish(),
  /** Quando as peças chegaram. Sem data, é agora; data passada registra uma ordem antiga. */
  receivedAt: receivedAtInput.optional(),
  notesCustomer: z.string().trim().max(2000).nullish(),
  notesInternal: z.string().trim().max(2000).nullish(),
  /** Coleta concluída que trouxe estas peças: fica ligada à ordem. */
  pickupJobId: z.string().uuid().nullish(),
});
export type LaundryOrderInput = z.infer<typeof laundryOrderInput>;

/** Edição da ordem: previsão, desconto e observações. As peças têm rotas próprias. */
export const laundryOrderUpdate = z.object({
  discount: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01).optional(),
  dueAt: z.coerce.date().nullish(),
  notesCustomer: z.string().trim().max(2000).nullish(),
  notesInternal: z.string().trim().max(2000).nullish(),
});
export type LaundryOrderUpdate = z.infer<typeof laundryOrderUpdate>;

export const addPiecesInput = z.object({ lines: z.array(orderLineInput).min(1, 'Inclua ao menos uma peça').max(100) });
export type AddPiecesInput = z.infer<typeof addPiecesInput>;

/** Dados da peça que não mudam o preço nem a etiqueta. */
export const pieceUpdate = z.object({
  color: z.string().trim().max(40).nullish(),
  brand: z.string().trim().max(40).nullish(),
  intakeNotes: z.string().trim().max(500).nullish(),
});
export type PieceUpdate = z.infer<typeof pieceUpdate>;

export const pieceStatusInput = z.object({ status: z.enum(pieceStatuses) });
export const bulkStatusInput = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(200), status: z.enum(pieceStatuses) });
export const incidentInput = z.object({ notes: z.string().trim().min(5, 'Descreva o ocorrido').max(500) });

export interface Piece {
  itemId: string;
  orderId: string;
  tagCode: string;
  description: string;
  serviceId: string;
  serviceName: string;
  pricingUnit: PricingUnit;
  garmentTypeId: string | null;
  garmentName: string | null;
  color: string | null;
  brand: string | null;
  intakeNotes: string | null;
  incidentNotes: string | null;
  incidentAt: string | null;
  weightKg: number | null;
  piecesCount: number;
  status: PieceStatus;
  reworkCount: number;
  statusChangedAt: string;
  photos: { id: string; filename: string }[];
}

/** Peça no quadro de produção: com o que é preciso para priorizar. */
export interface ProductionPiece extends Piece {
  orderNumber: number;
  customerName: string;
  dueAt: string | null;
}

export interface GarmentType {
  id: string;
  name: string;
  active: boolean;
}

export interface LaundryReport {
  period: { from: string; to: string };
  delivered: { total: number; onTime: number; withDueDate: number; avgHours: number | null };
  overdueOpen: { id: string; number: number; customerName: string; dueAt: string; status: string }[];
  piecesReady: number;
  reworks: number;
  incidents: number;
  /** Uma linha por serviço: a quantidade está na unidade de cobrança dele; o valor é o contratado, antes do desconto da ordem. */
  byService: { serviceName: string; unit: PricingUnit; quantity: number; contracted: number }[];
  byOperator: { userName: string; moves: number }[];
}

/** Quantidade de um serviço no relatório: "12 peças", "5,5 kg", "3 m²". */
export function formatServiceQuantity(quantity: number, unit: PricingUnit) {
  const n = quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  if (unit === 'piece') return `${n} ${quantity === 1 ? 'peça' : 'peças'}`;
  return `${n} ${unit === 'kg' ? 'kg' : 'm²'}`;
}

// ---- Coleta e entrega -------------------------------------------------------------------------

export const jobKinds = ['pickup', 'delivery'] as const;
export type JobKind = (typeof jobKinds)[number];
export const jobKindLabel: Record<JobKind, string> = { pickup: 'Coleta', delivery: 'Entrega' };

/** agendada → em rota → concluída / não realizada (com motivo; pode ser reagendada) · cancelada. */
export const jobStatuses = ['scheduled', 'en_route', 'done', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof jobStatuses)[number];
export const jobStatusLabel: Record<JobStatus, string> = {
  scheduled: 'Agendada',
  en_route: 'Em rota',
  done: 'Concluída',
  failed: 'Não realizada',
  cancelled: 'Cancelada',
};
export const jobStatusTone: Record<JobStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'brand'> = {
  scheduled: 'neutral',
  en_route: 'brand',
  done: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const jobPeriods = ['morning', 'afternoon', 'evening'] as const;
export type JobPeriod = (typeof jobPeriods)[number];
/** Janela de cada período (HH:MM). Guardada também na tarefa, para ordenar a rota. */
export const periodWindow: Record<JobPeriod, [string, string]> = {
  morning: ['08:00', '12:00'],
  afternoon: ['12:00', '18:00'],
  evening: ['18:00', '21:00'],
};
export const periodLabel: Record<JobPeriod, string> = { morning: 'Manhã', afternoon: 'Tarde', evening: 'Noite' };

/** Mesmo formato do endereço do cadastro do cliente, mais um ponto de referência. */
export interface JobAddress {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  reference?: string;
}

export const jobAddressInput = z.object({
  zip: z.string().trim().max(9).optional(),
  street: z.string().trim().max(200).optional(),
  number: z.string().trim().max(20).optional(),
  complement: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(2).optional(),
  reference: z.string().trim().max(200).optional(),
});

/** "Rua X, 10 — apto 3 — Bairro, Cidade/UF — CEP" */
export function formatAddress(a: JobAddress | null | undefined): string {
  if (!a) return '';
  const street = [a.street, a.number].filter(Boolean).join(', ');
  const city = [a.city, a.state].filter(Boolean).join('/');
  return [street, a.complement, [a.district, city].filter(Boolean).join(', '), a.zip].filter(Boolean).join(' — ');
}

/** Link de navegação (abre o app do Google Maps no celular). */
export function mapsUrl(a: JobAddress | null | undefined): string | null {
  const text = formatAddress(a ? { ...a, complement: undefined, reference: undefined } : a);
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null;
}

/** Links de ligação e WhatsApp a partir do telefone em E.164 (+5511999998888). */
export function phoneLinks(phone: string | null | undefined): { tel: string; whatsapp: string } | null {
  const digits = phone?.replace(/\D/g, '');
  if (!digits) return null;
  return { tel: `tel:+${digits}`, whatsapp: `https://wa.me/${digits}` };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (use HH:MM)');
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data');
const fee = z.coerce.number().min(0).max(10_000).multipleOf(0.01, 'Use no máximo 2 casas decimais');

type WindowFields = { period?: JobPeriod | null; windowStart?: string | null; windowEnd?: string | null };

/** Período (manhã/tarde/noite) ou horário de/até. Devolve a janela ou a mensagem de erro. */
export function resolveWindow(w: WindowFields): { period: JobPeriod | null; windowStart: string; windowEnd: string } | { error: string } {
  if (w.period) return { period: w.period, windowStart: periodWindow[w.period][0], windowEnd: periodWindow[w.period][1] };
  if (!w.windowStart || !w.windowEnd) return { error: 'Informe o período ou o horário (de/até)' };
  if (w.windowStart >= w.windowEnd) return { error: 'O horário final deve ser depois do inicial' };
  return { period: null, windowStart: w.windowStart, windowEnd: w.windowEnd };
}

const scheduleFields = {
  /** Sem endereço, usa o do cadastro do cliente. */
  address: jobAddressInput.nullish(),
  /** Dia da tarefa. Dia que já passou registra uma coleta/entrega que já aconteceu (sem aviso ao cliente). */
  date: isoDay,
  period: z.enum(jobPeriods).nullish(),
  windowStart: hhmm.nullish(),
  windowEnd: hhmm.nullish(),
  /** Sem taxa, usa a padrão das configurações da lavanderia. */
  fee: fee.nullish(),
  driverUserId: z.string().uuid().nullish(),
  notes: z.string().trim().max(1000).nullish(),
};

const windowRefine = (v: WindowFields, ctx: z.RefinementCtx) => {
  const w = resolveWindow(v);
  if ('error' in w) ctx.addIssue({ code: z.ZodIssueCode.custom, message: w.error, path: ['period'] });
};

export const pickupInput = z.object({ customerId: z.string().uuid('Escolha o cliente'), ...scheduleFields }).superRefine(windowRefine);
export type PickupInput = z.infer<typeof pickupInput>;

/** "Entregar no endereço", a partir da ordem. */
export const deliveryInput = z.object(scheduleFields).superRefine(windowRefine);
export type DeliveryInput = z.infer<typeof deliveryInput>;

/**
 * Atribuir motorista, reagendar, mudar endereço/taxa. Mudar a janela pede o período ou o horário
 * completo. Uma tarefa "não realizada" volta a "agendada" quando recebe uma nova data.
 *
 * Dia que já passou só para a tarefa "não realizada" (registrar a nova tentativa, que já aconteceu,
 * a partir do dia da que falhou). A tarefa agendada que ainda não aconteceu não volta para o passado:
 * para registrar uma coleta/entrega antiga, crie outra com a data passada.
 */
export const jobUpdateInput = z.object({
  address: jobAddressInput.optional(),
  date: isoDay.optional(),
  period: z.enum(jobPeriods).nullish(),
  windowStart: hhmm.nullish(),
  windowEnd: hhmm.nullish(),
  fee: fee.optional(),
  driverUserId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type JobUpdateInput = z.infer<typeof jobUpdateInput>;

/**
 * Quando aconteceu (saída, conclusão, não realizada), para registrar depois: 'YYYY-MM-DD' (hoje =
 * agora; outro dia = meio-dia em SP) ou data e hora. Sem data, é agora; nunca no futuro.
 */
const occurredAtInput = z
  .string()
  .trim()
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? (v === spToday() ? new Date() : new Date(`${v}T12:00:00-03:00`)) : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), 'Data inválida')
  .refine((d) => Number.isNaN(d.getTime()) || d.getTime() <= Date.now() + 5 * 60_000, 'A data não pode ser no futuro');

export const feeMethods = ['cash', 'pix', 'credit_card', 'debit_card', 'other'] as const;
export type FeeMethod = (typeof feeMethods)[number];
export const feeMethodLabel: Record<FeeMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  other: 'Outro',
};

export const completeJobInput = z.object({
  /** Entrega: quem recebeu (comprovante). */
  receiverName: z.string().trim().min(2, 'Informe quem recebeu').max(120).nullish(),
  /** Coleta: quantas peças vieram (a conferência peça a peça é no balcão). */
  itemsCount: z.coerce.number().int().min(1, 'Informe quantas peças foram coletadas').max(999).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /** O motorista recebeu a taxa na hora: dá baixa no financeiro com esta forma de pagamento (na data da conclusão). */
  feeMethod: z.enum(feeMethods).nullish(),
  /**
   * Entrega: o motorista recebeu o saldo da ordem (ou parte dele). Vira um pagamento da ordem, na
   * data da conclusão e na conta de caixa padrão. Exige `laundry.logistics.receive` ou
   * `shared.service-orders.payments`.
   */
  balancePayment: z
    .object({
      amount: z.coerce.number().positive('Informe o valor recebido').max(1_000_000).multipleOf(0.01, 'Use no máximo 2 casas decimais'),
      method: z.enum(feeMethods),
    })
    .nullish(),
  /** Quando foi concluída; sem data, é agora. Não antes do dia da tarefa nem da saída. */
  occurredAt: occurredAtInput.optional(),
});
export type CompleteJobInput = z.infer<typeof completeJobInput>;

/** Saída para a rota; sem data, é agora. */
export const startJobInput = z.object({ occurredAt: occurredAtInput.optional() }).default({});
export type StartJobInput = z.infer<typeof startJobInput>;

export const failJobInput = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo').max(500),
  /** Quando a tentativa não deu certo; sem data, é agora. */
  occurredAt: occurredAtInput.optional(),
});
export type FailJobInput = z.infer<typeof failJobInput>;
export const cancelJobInput = z.object({ reason: z.string().trim().max(500).nullish() });
export const linkOrderInput = z.object({ orderId: z.string().uuid() });

export const jobsQuery = z.object({
  date: isoDay.optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  status: z.enum(jobStatuses).optional(),
  kind: z.enum(jobKinds).optional(),
  /** Id do motorista, ou "none" para as tarefas sem motorista. */
  driverId: z.union([z.string().uuid(), z.literal('none')]).optional(),
  orderId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});
export type JobsQuery = z.infer<typeof jobsQuery>;

export interface LogisticsJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  order: { id: string; number: number; status: string; total: number; paidAmount: number } | null;
  address: JobAddress;
  addressText: string;
  mapsUrl: string | null;
  date: string;
  period: JobPeriod | null;
  windowStart: string;
  windowEnd: string;
  fee: number;
  /** Situação da taxa no financeiro (null = sem taxa). */
  feeStatus: 'pending' | 'paid' | null;
  notes: string | null;
  driver: { id: string; name: string } | null;
  itemsCount: number | null;
  receiverName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Última tentativa que não deu certo (continua preenchida depois de reagendar). */
  failedAt: string | null;
  failReason: string | null;
  /** Tentativas que não deram certo (a tarefa pode ter sido reagendada depois). */
  attempts: number;
  cancelReason: string | null;
  photos: { id: string; filename: string }[];
  createdAt: string;
}
