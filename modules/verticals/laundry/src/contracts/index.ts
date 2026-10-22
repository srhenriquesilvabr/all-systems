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
