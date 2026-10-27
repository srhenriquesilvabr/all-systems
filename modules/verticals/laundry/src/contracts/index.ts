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
  pricingMode: z.enum(['per_piece', 'per_kg', 'mixed']).default('mixed'),
  defaultTurnaroundHours: z.number().int().default(48),
  requirePhotosOnReceive: z.boolean().default(true),
});

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
});
export type LaundryOrderInput = z.infer<typeof laundryOrderInput>;

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
  byService: { serviceName: string; quantity: number; revenue: number }[];
  byOperator: { userName: string; moves: number }[];
}
