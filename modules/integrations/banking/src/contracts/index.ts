import { z } from 'zod';

export * from './finance-math';

export const creditProducts = ['vehicle_financing', 'real_estate_financing', 'consortium'] as const;
export type CreditProduct = (typeof creditProducts)[number];
export const creditProductLabel: Record<CreditProduct, string> = {
  vehicle_financing: 'Financiamento de veículo',
  real_estate_financing: 'Financiamento imobiliário',
  consortium: 'Consórcio',
};

export const proposalStatuses = ['submitted', 'under_review', 'approved', 'rejected', 'cancelled', 'contracted'] as const;
export type ProposalStatus = (typeof proposalStatuses)[number];
export const proposalStatusLabel: Record<ProposalStatus, string> = {
  submitted: 'Enviada',
  under_review: 'Em análise',
  approved: 'Aprovada',
  rejected: 'Recusada',
  cancelled: 'Cancelada',
  contracted: 'Contratada',
};
/** Status em que a instituição ainda vai responder. */
export const pendingStatuses: ProposalStatus[] = ['submitted', 'under_review'];

export const connectionInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    /**
     * simulated: taxas configuradas aqui, decisão automática (demonstração e treinamento).
     * api: API REST da instituição ou de um integrador, no contrato descrito em docs/arquitetura.
     */
    mode: z.enum(['simulated', 'api']).default('simulated'),
    products: z.array(z.enum(creditProducts)).min(1, 'Escolha ao menos um produto'),
    baseUrl: z.string().trim().url('URL inválida').max(300).nullish().or(z.literal('')).transform((v) => v || null),
    clientId: z.string().trim().max(200).nullish(),
    /** Vazio = mantém o atual. */
    clientSecret: z.string().max(500).nullish(),
    webhookSecret: z.string().max(500).nullish(),
    vehicleMonthlyRate: z.coerce.number().min(0).max(20).default(1.99),
    realEstateYearlyRate: z.coerce.number().min(0).max(40).default(11.5),
    tacFee: z.coerce.number().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .refine((c) => c.mode !== 'api' || c.baseUrl, { message: 'Informe a URL da API', path: ['baseUrl'] });
export type ConnectionInput = z.infer<typeof connectionInput>;

export interface BankConnection {
  id: string;
  name: string;
  mode: 'simulated' | 'api';
  products: CreditProduct[];
  baseUrl: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  hasWebhookSecret: boolean;
  vehicleMonthlyRate: number;
  realEstateYearlyRate: number;
  tacFee: number;
  active: boolean;
  /** Endereço que a instituição chama para avisar mudanças de status. */
  webhookUrl: string;
}

export const simulationInput = z.object({
  product: z.enum(['vehicle_financing', 'real_estate_financing']),
  /** Valor a financiar (já sem a entrada). */
  amount: z.coerce.number().positive().max(100_000_000).multipleOf(0.01),
  termMonths: z.coerce.number().int().min(6).max(420),
  assetValue: z.coerce.number().positive().max(100_000_000).optional(),
  system: z.enum(['price', 'sac']).optional(),
});
export type SimulationInput = z.infer<typeof simulationInput>;

export interface Offer {
  connectionId: string;
  institution: string;
  product: CreditProduct;
  amount: number;
  termMonths: number;
  system: 'price' | 'sac';
  monthlyRate: number;
  yearlyRate: number;
  firstInstallment: number;
  lastInstallment: number;
  totalPaid: number;
  cetYearly: number;
  fees: { iof: number; tac: number };
}

export const applicantInput = z.object({
  name: z.string().trim().min(3).max(150),
  document: z.string().trim().min(11).max(18),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  /** Renda mensal declarada: base da análise de comprometimento. */
  monthlyIncome: z.coerce.number().min(0).max(10_000_000).nullish(),
  email: z.string().email().nullish(),
  phone: z.string().max(30).nullish(),
});
export type Applicant = z.infer<typeof applicantInput>;

export const proposalInput = z.object({
  connectionId: z.string().uuid(),
  product: z.enum(creditProducts),
  /** Quem pediu (ex.: negociação de veículo) — para a vertical reagir ao resultado. */
  sourceType: z.string().min(1).max(50),
  sourceId: z.string().uuid(),
  customerId: z.string().uuid(),
  amount: z.coerce.number().positive().max(100_000_000).multipleOf(0.01),
  termMonths: z.coerce.number().int().min(1).max(420),
  system: z.enum(['price', 'sac']).optional(),
  applicant: applicantInput,
  /** Dados do bem ou do plano (modelo, ano, endereço, grupo do consórcio…). */
  details: z.record(z.unknown()).default({}),
});
export type ProposalInput = z.infer<typeof proposalInput>;

export interface Proposal {
  id: string;
  connection: { id: string; name: string };
  product: CreditProduct;
  sourceType: string;
  sourceId: string;
  customerId: string;
  amount: number;
  termMonths: number;
  offer: Offer | null;
  status: ProposalStatus;
  statusMessage: string | null;
  externalId: string | null;
  /** Dados devolvidos pela instituição (valor aprovado, grupo e cota do consórcio…). */
  result: Record<string, unknown>;
  events: { status: ProposalStatus; message: string | null; source: string; at: string }[];
  createdAt: string;
}

/** Evento publicado quando o status de uma proposta muda (envio, consulta ou webhook). */
export const PROPOSAL_UPDATED = 'integration.banking.proposal_updated';
export interface ProposalUpdated {
  proposalId: string;
  status: ProposalStatus;
  sourceType: string;
  sourceId: string;
  customerId: string;
  product: CreditProduct;
  result: Record<string, unknown>;
}

/** Plano de consórcio oferecido por uma administradora. */
export interface ConsortiumPlanOffer {
  externalId: string;
  name: string;
  assetType: 'vehicle' | 'real_estate' | 'services' | 'heavy';
  creditValue: number;
  termMonths: number;
  adminFeePercent: number;
  reserveFundPercent: number;
  insurancePercent: number;
}
