import { z } from 'zod';

const money = z.coerce.number().min(0).max(1_000_000_000).multipleOf(0.01);
const count = z.coerce.number().int().min(0).max(100).default(0);

export const propertyTypes = ['apartment', 'house', 'condo_house', 'land', 'commercial', 'office', 'rural'] as const;
export const propertyTypeLabel: Record<(typeof propertyTypes)[number], string> = {
  apartment: 'Apartamento',
  house: 'Casa',
  condo_house: 'Casa em condomínio',
  land: 'Terreno',
  commercial: 'Ponto comercial',
  office: 'Sala comercial',
  rural: 'Rural',
};
export const propertyStatuses = ['available', 'reserved', 'sold', 'rented', 'inactive'] as const;
export type PropertyStatus = (typeof propertyStatuses)[number];
export const propertyStatusLabel: Record<PropertyStatus, string> = { available: 'Disponível', reserved: 'Reservado', sold: 'Vendido', rented: 'Alugado', inactive: 'Fora do mercado' };
export const purposeLabel = { sale: 'Venda', rent: 'Locação', both: 'Venda e locação' } as const;
/** Situações que a equipe escolhe. Reservado, Vendido e Alugado vêm da proposta e do contrato de locação. */
export const manualPropertyStatuses = ['available', 'inactive'] as const satisfies readonly PropertyStatus[];

export const propertyInput = z
  .object({
    purpose: z.enum(['sale', 'rent', 'both']).default('sale'),
    type: z.enum(propertyTypes),
    title: z.string().trim().min(3).max(150),
    ownerId: z.string().uuid('Escolha o proprietário'),
    street: z.string().trim().min(2).max(150),
    number: z.string().trim().max(20).nullish(),
    complement: z.string().trim().max(80).nullish(),
    district: z.string().trim().min(2).max(80),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().length(2).toUpperCase(),
    zip: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido').nullish().or(z.literal('').transform(() => null)),
    areaM2: z.coerce.number().min(0).max(10_000_000).nullish(),
    landM2: z.coerce.number().min(0).max(100_000_000).nullish(),
    bedrooms: count,
    suites: count,
    bathrooms: count,
    parking: count,
    salePrice: money.nullish(),
    rentPrice: money.nullish(),
    condoFee: money.nullish(),
    iptuYearly: money.nullish(),
    /** Aceita financiamento bancário (documentação em dia, sem impedimento). */
    financeable: z.boolean().default(true),
    status: z.enum(propertyStatuses).default('available'),
    description: z.string().trim().max(5000).nullish(),
  })
  .refine((p) => p.purpose === 'rent' || p.salePrice, { message: 'Informe o preço de venda', path: ['salePrice'] })
  .refine((p) => p.purpose === 'sale' || p.rentPrice, { message: 'Informe o valor do aluguel', path: ['rentPrice'] });
export type PropertyInput = z.infer<typeof propertyInput>;

export interface Property extends Omit<PropertyInput, 'ownerId'> {
  id: string;
  code: number;
  owner: { id: string; name: string; phone: string | null };
  photos: { id: string }[];
  pricePerM2: number | null;
  createdAt: string;
}

export const dealInput = z.object({
  customerId: z.string().uuid('Escolha o comprador'),
  propertyId: z.string().uuid(),
  price: money.refine((v) => v > 0, 'Informe o valor da proposta'),
  paymentType: z.enum(['cash', 'financing']).default('financing'),
  downPayment: money.default(0),
  /** Saldo de FGTS usado na compra (só em financiamento habitacional). */
  fgtsAmount: money.default(0),
  commissionPercent: z.coerce.number().min(0).max(20).default(6),
  notes: z.string().trim().max(1000).nullish(),
  /** Corretor responsável; sem informar, fica quem registrou a proposta. */
  brokerId: z.string().uuid().nullish(),
});
export type DealInput = z.infer<typeof dealInput>;

/** Edição da proposta em aberto: valores e condições. Comprador e imóvel não mudam. */
export const dealUpdateInput = dealInput.pick({ price: true, paymentType: true, downPayment: true, fgtsAmount: true, commissionPercent: true, notes: true, brokerId: true });
export type DealUpdateInput = z.infer<typeof dealUpdateInput>;

export const lostReasonKeys = ['price', 'financing_denied', 'bought_other', 'gave_up', 'documentation', 'no_contact', 'other'] as const;
export type LostReasonKey = (typeof lostReasonKeys)[number];
export const lostReasonLabel: Record<LostReasonKey, string> = {
  price: 'Preço',
  financing_denied: 'Financiamento negado',
  bought_other: 'Comprou outro imóvel',
  gave_up: 'Desistiu',
  documentation: 'Documentação',
  no_contact: 'Sem contato',
  other: 'Outro',
};

/** Motivo padronizado; o texto é detalhe opcional, obrigatório só em "outro". */
export const loseInput = z
  .object({ reasonKey: z.enum(lostReasonKeys), reason: z.string().trim().max(300).nullish() })
  .refine((v) => v.reasonKey !== 'other' || (v.reason?.length ?? 0) >= 3, { message: 'Descreva o motivo', path: ['reason'] });
export type LoseInput = z.infer<typeof loseInput>;

export const brokerInput = z.object({ brokerId: z.string().uuid('Escolha o corretor') });

/** Quanto do valor do imóvel os bancos financiam, no máximo (SFH, SAC). */
export const MAX_LTV = 0.8;

export const dealStatuses = ['negotiating', 'credit_analysis', 'credit_approved', 'credit_rejected', 'closed', 'lost'] as const;
export type DealStatus = (typeof dealStatuses)[number];
export const dealStatusLabel: Record<DealStatus, string> = {
  negotiating: 'Proposta em negociação',
  credit_analysis: 'Crédito em análise',
  credit_approved: 'Crédito aprovado',
  credit_rejected: 'Crédito recusado',
  closed: 'Vendido',
  lost: 'Perdida',
};

export interface Deal {
  id: string;
  number: number;
  customer: { id: string; name: string; phone: string | null; email: string | null; document: string | null };
  property: { id: string; code: number; title: string; address: string; askingPrice: number | null; financeable: boolean };
  price: number;
  paymentType: 'cash' | 'financing';
  downPayment: number;
  fgtsAmount: number;
  financedAmount: number;
  commissionPercent: number;
  commission: number;
  status: DealStatus;
  lostReasonKey: LostReasonKey | null;
  /** Detalhe do motivo (nas perdidas antigas, o texto livre). */
  lostReason: string | null;
  lostAt: string | null;
  brokerId: string | null;
  brokerName: string | null;
  notes: string | null;
  closedAt: string | null;
  createdAt: string;
}

/** Por corretor: em aberto agora; vendidas (valor e comissão) e perdidas dentro do período. */
export interface DealsSummary {
  from: string;
  to: string;
  brokers: { brokerId: string | null; brokerName: string | null; open: number; won: number; wonValue: number; wonCommission: number; lost: number }[];
  /** reasonKey nulo = perdidas antigas, sem motivo padronizado. */
  lostByReason: { reasonKey: LostReasonKey | null; count: number }[];
}

export const addressOf = (p: { street: string; number?: string | null; district: string; city: string; state: string }) =>
  `${p.street}${p.number ? `, ${p.number}` : ''} — ${p.district}, ${p.city}/${p.state}`;

export * from './leases';
