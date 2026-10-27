import { z } from 'zod';

// Mesmo formato do proponente da integração bancária (repetido aqui: os contratos também vão
// para o navegador, e o pacote raiz de @all/banking traz código do servidor).
const applicantInput = z.object({
  name: z.string().trim().min(3).max(150),
  document: z.string().trim().min(11).max(18),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  monthlyIncome: z.coerce.number().min(0).max(10_000_000).nullish(),
  email: z.string().email().nullish(),
  phone: z.string().max(30).nullish(),
});

export const assetTypes = ['vehicle', 'real_estate', 'heavy', 'services'] as const;
export const assetTypeLabel: Record<(typeof assetTypes)[number], string> = { vehicle: 'Veículos', real_estate: 'Imóveis', heavy: 'Pesados', services: 'Serviços' };

export interface Plan {
  id: string;
  institution: string;
  connectionId: string;
  name: string;
  assetType: (typeof assetTypes)[number];
  creditValue: number;
  termMonths: number;
  adminFeePercent: number;
  reserveFundPercent: number;
  insurancePercent: number;
  /** Parcela mensal: crédito + taxas, sem juros. */
  installment: number;
  /** Custo total sobre o crédito (taxa de administração + fundo de reserva + seguro). */
  totalCost: number;
  active: boolean;
}

export const quotaInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  planId: z.string().uuid('Escolha o plano'),
  applicant: applicantInput,
  /** Data de vencimento desejada para as parcelas. */
  dueDay: z.coerce.number().int().min(1).max(28).default(10),
  /** Vendedor responsável; sem informar, fica quem registrou a venda. */
  sellerId: z.string().uuid().nullish(),
});
export type QuotaInput = z.infer<typeof quotaInput>;

export const sellerInput = z.object({ sellerId: z.string().uuid('Escolha o vendedor') });

/**
 * Por vendedor, cotas vendidas no período (pela data da venda): em análise, aceitas (ativas ou
 * contempladas, com o crédito somado) e perdidas (recusadas ou canceladas).
 */
export interface QuotasSummary {
  from: string;
  to: string;
  sellers: { sellerId: string | null; sellerName: string | null; open: number; won: number; wonValue: number; lost: number }[];
}

export const quotaStatuses = ['proposal', 'active', 'contemplated', 'rejected', 'cancelled'] as const;
export type QuotaStatus = (typeof quotaStatuses)[number];
export const quotaStatusLabel: Record<QuotaStatus, string> = {
  proposal: 'Adesão em análise',
  active: 'Ativa',
  contemplated: 'Contemplada',
  rejected: 'Adesão recusada',
  cancelled: 'Cancelada',
};

export interface Quota {
  id: string;
  number: number;
  customer: { id: string; name: string; phone: string | null };
  plan: { id: string; name: string; institution: string; creditValue: number; termMonths: number; installment: number; assetType: Plan['assetType'] };
  status: QuotaStatus;
  statusMessage: string | null;
  groupCode: string | null;
  quotaNumber: string | null;
  dueDay: number;
  contemplatedOn: string | null;
  contemplationType: 'draw' | 'bid' | null;
  bidPercent: number | null;
  commission: number;
  sellerId: string | null;
  sellerName: string | null;
  createdAt: string;
}

export const assemblyInput = z.object({
  groupCode: z.string().trim().min(1).max(20),
  heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Cotas sorteadas. */
  drawn: z.array(z.string().trim().min(1).max(10)).max(50).default([]),
  /** Cotas contempladas por lance, com o percentual ofertado. */
  bids: z.array(z.object({ quotaNumber: z.string().trim().min(1).max(10), percent: z.coerce.number().min(0).max(100) })).max(50).default([]),
  notes: z.string().trim().max(500).nullish(),
});
export type AssemblyInput = z.infer<typeof assemblyInput>;

export interface Assembly {
  id: string;
  groupCode: string;
  heldOn: string;
  drawn: string[];
  bids: { quotaNumber: string; percent: number }[];
  /** Cotas desta carteira contempladas nesta assembleia. */
  ourWinners: { quotaId: string; customer: string; quotaNumber: string; type: 'draw' | 'bid' }[];
  notes: string | null;
}
