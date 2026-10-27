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

export const laundryOrderInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  lines: z.array(orderLineInput).min(1, 'Inclua ao menos uma peça').max(100),
  discount: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01).default(0),
  /** Sem data, usa o maior prazo entre os serviços escolhidos. */
  dueAt: z.coerce.date().nullish(),
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
