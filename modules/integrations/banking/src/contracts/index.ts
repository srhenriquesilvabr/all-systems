import { z } from 'zod';

export * from './finance-math';
export * from './catalog';
import { catalogByKey } from './catalog';

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

export const connectionModes = ['simulated', 'api', 'manual'] as const;
export type ConnectionMode = (typeof connectionModes)[number];
export const connectionModeLabel: Record<ConnectionMode, string> = { simulated: 'Simulação', api: 'API', manual: 'Manual (sem API)' };

/**
 * Adaptador do modo `api`: o REST genérico (contrato publicado em docs/arquitetura/10) ou o
 * adaptador próprio da administradora do catálogo (esqueleto até o contrato chegar).
 */
export const connectionAdapters = ['generic_rest', 'vendor'] as const;
export type ConnectionAdapter = (typeof connectionAdapters)[number];

/** Plano cadastrado à mão numa conexão `manual` (a administradora não tem API para listar). */
export const manualPlanInput = z.object({
  externalId: z.string().trim().max(60).nullish(),
  name: z.string().trim().min(2).max(80),
  assetType: z.enum(['vehicle', 'real_estate', 'services', 'heavy']),
  creditValue: z.coerce.number().positive().max(100_000_000),
  termMonths: z.coerce.number().int().min(1).max(420),
  adminFeePercent: z.coerce.number().min(0).max(100),
  reserveFundPercent: z.coerce.number().min(0).max(100).default(0),
  insurancePercent: z.coerce.number().min(0).max(10).default(0),
});
export type ManualPlanInput = z.infer<typeof manualPlanInput>;

export const connectionInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    /** Administradora/banco do catálogo (vazio = outra instituição, fora do catálogo). */
    catalogKey: z
      .string()
      .trim()
      .max(40)
      .nullish()
      .transform((v) => v || null),
    /**
     * simulated: taxas configuradas aqui, decisão automática (demonstração e treinamento).
     * api: API REST da instituição (contrato genérico) ou adaptador próprio da administradora.
     * manual: sem API; a equipe registra o envio e a resposta, e o sistema acompanha igual.
     */
    mode: z.enum(connectionModes).default('simulated'),
    adapter: z.enum(connectionAdapters).default('generic_rest'),
    products: z.array(z.enum(creditProducts)).min(1, 'Escolha ao menos um produto'),
    baseUrl: z.string().trim().url('URL inválida').max(300).nullish().or(z.literal('')).transform((v) => v || null),
    clientId: z.string().trim().max(200).nullish(),
    /** Vazio = mantém o atual. */
    clientSecret: z.string().max(500).nullish(),
    webhookSecret: z.string().max(500).nullish(),
    vehicleMonthlyRate: z.coerce.number().min(0).max(20).default(1.99),
    realEstateYearlyRate: z.coerce.number().min(0).max(40).default(11.5),
    tacFee: z.coerce.number().min(0).max(10_000).default(0),
    /** Só no modo manual: planos de consórcio informados pela administradora. */
    manualPlans: z.array(manualPlanInput).max(60).default([]),
    active: z.boolean().default(true),
  })
  .refine((c) => !c.catalogKey || catalogByKey(c.catalogKey), { message: 'Administradora fora do catálogo', path: ['catalogKey'] })
  .refine((c) => c.mode !== 'api' || c.adapter !== 'generic_rest' || c.baseUrl, { message: 'Informe a URL da API', path: ['baseUrl'] })
  .refine((c) => c.mode !== 'api' || c.adapter !== 'vendor' || c.catalogKey, { message: 'O adaptador próprio exige escolher a administradora do catálogo', path: ['adapter'] });
export type ConnectionInput = z.infer<typeof connectionInput>;

export interface BankConnection {
  id: string;
  name: string;
  catalogKey: string | null;
  mode: ConnectionMode;
  adapter: ConnectionAdapter;
  products: CreditProduct[];
  baseUrl: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  hasWebhookSecret: boolean;
  vehicleMonthlyRate: number;
  realEstateYearlyRate: number;
  tacFee: number;
  manualPlans: ManualPlanInput[];
  active: boolean;
  /** Endereço que a instituição chama para avisar mudanças de status. */
  webhookUrl: string;
}

/**
 * Resposta registrada pela equipe numa conexão `manual` (o que a administradora respondeu no
 * portal, por e-mail ou por arquivo). Na adesão de consórcio aprovada, grupo e cota são obrigatórios.
 */
export const manualStatusInput = z.object({
  status: z.enum(['under_review', 'approved', 'rejected', 'cancelled', 'contracted']),
  message: z.string().trim().max(300).nullish(),
  /** Protocolo/número da proposta na administradora. */
  externalId: z.string().trim().max(60).nullish(),
  groupCode: z.string().trim().max(20).nullish(),
  quotaNumber: z.string().trim().max(10).nullish(),
  approvedAmount: z.coerce.number().positive().max(100_000_000).nullish(),
});
export type ManualStatusInput = z.infer<typeof manualStatusInput>;

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
  connection: { id: string; name: string; mode: ConnectionMode };
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
