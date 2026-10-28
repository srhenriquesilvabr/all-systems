import { z } from 'zod';

export * from './leads';

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
  /** Lead de onde veio a venda: fica ligado à cota e vira venda quando a adesão é aceita. */
  leadId: z.string().uuid().nullish(),
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
  /** Percentual de comissão: o gravado na ativação ou, antes dela, o vigente (plano > administradora > padrão). */
  commissionPercent: number;
  commission: number;
  /** Comissão estornada porque a cota foi cancelada dentro do prazo de estorno. */
  commissionReversed: boolean;
  sellerId: string | null;
  sellerName: string | null;
  activatedAt: string | null;
  cancelledAt: string | null;
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

export const assemblyStatuses = ['scheduled', 'held'] as const;
export type AssemblyStatus = (typeof assemblyStatuses)[number];
export const assemblyStatusLabel: Record<AssemblyStatus, string> = { scheduled: 'Agendada', held: 'Realizada' };

export interface Assembly {
  id: string;
  groupCode: string;
  heldOn: string;
  /** Agendada (sem resultado ainda, recebe lances) ou realizada (com resultado). */
  status: AssemblyStatus;
  drawn: string[];
  bids: { quotaNumber: string; percent: number }[];
  /** Cotas desta carteira contempladas nesta assembleia. */
  ourWinners: { quotaId: string; customer: string; quotaNumber: string; type: 'draw' | 'bid' }[];
  /** Lances das cotas desta carteira para esta assembleia. */
  ourBids: { id: string; quotaId: string; customer: string; quotaNumber: string | null; type: BidType; percent: number; amount: number; status: BidStatus }[];
  notes: string | null;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, 'Data inválida');

/** Agenda a próxima assembleia de um grupo, sem resultado. */
export const assemblyScheduleInput = z.object({
  groupCode: z.string().trim().min(1).max(20),
  heldOn: isoDate,
  notes: z.string().trim().max(500).nullish(),
});
export type AssemblyScheduleInput = z.infer<typeof assemblyScheduleInput>;

/** Remarca uma assembleia agendada. */
export const assemblyUpdateInput = z.object({ heldOn: isoDate.optional(), notes: z.string().trim().max(500).nullish() });

/** Resultado de uma assembleia já agendada. */
export const assemblyResultsInput = assemblyInput.omit({ groupCode: true, heldOn: true });
export type AssemblyResultsInput = z.infer<typeof assemblyResultsInput>;

// ---- Parcelas (acompanhamento; quem cobra é a administradora) ---------------------------------

export const installmentStatuses = ['upcoming', 'paid', 'late', 'cancelled'] as const;
export type InstallmentStatus = (typeof installmentStatuses)[number];
export const installmentStatusLabel: Record<InstallmentStatus, string> = { upcoming: 'A vencer', paid: 'Paga', late: 'Em atraso', cancelled: 'Cancelada' };

export interface Installment {
  id: string;
  seq: number;
  dueOn: string;
  amount: number;
  status: InstallmentStatus;
  paidOn: string | null;
  paidAmount: number | null;
  /** Dias de atraso (0 se não está atrasada). */
  daysLate: number;
  notes: string | null;
  lateNoticeSentAt: string | null;
}

export interface QuotaInstallments {
  quotaId: string;
  /** Parcela mensal do plano e dia de vencimento da cota. */
  monthly: number;
  dueDay: number;
  /** false = cota sem calendário (ativada antes do acompanhamento existir): use "gerar parcelas". */
  generated: boolean;
  total: number;
  paidCount: number;
  paidAmount: number;
  lateCount: number;
  lateAmount: number;
  nextDue: Installment | null;
  items: Installment[];
}

export const installmentPayInput = z.object({
  paidOn: isoDate,
  /** Valor pago informado; sem informar, o da parcela. */
  amount: z.coerce.number().positive().max(10_000_000).nullish(),
  notes: z.string().trim().max(300).nullish(),
});
export type InstallmentPayInput = z.infer<typeof installmentPayInput>;

/** Refaz o calendário (só sem parcelas pagas): primeiro vencimento e, se diferir do plano, quantidade e valor. */
export const installmentsGenerateInput = z.object({
  firstDueOn: isoDate.refine((d) => Number(d.slice(8, 10)) <= 28, 'Vencimento até o dia 28'),
  count: z.coerce.number().int().min(1).max(420).nullish(),
  amount: z.coerce.number().positive().max(10_000_000).nullish(),
});
export type InstallmentsGenerateInput = z.infer<typeof installmentsGenerateInput>;

/** Cota com parcelas vencidas e não pagas (inadimplência). */
export interface LateQuota {
  quota: { id: string; number: number; groupCode: string | null; quotaNumber: string | null; planName: string; institution: string; status: QuotaStatus };
  customer: { id: string; name: string; phone: string | null };
  lateCount: number;
  lateAmount: number;
  oldestDueOn: string;
  /** Dias de atraso da parcela mais antiga. */
  daysLate: number;
  lastNoticeAt: string | null;
  installments: { id: string; seq: number; dueOn: string; amount: number; daysLate: number }[];
}

// ---- Lances ---------------------------------------------------------------------------------

export const bidTypes = ['free', 'embedded', 'fixed'] as const;
export type BidType = (typeof bidTypes)[number];
export const bidTypeLabel: Record<BidType, string> = { free: 'Livre', embedded: 'Embutido', fixed: 'Fixo' };

export const bidStatuses = ['registered', 'sent', 'won', 'lost', 'void'] as const;
export type BidStatus = (typeof bidStatuses)[number];
export const bidStatusLabel: Record<BidStatus, string> = {
  registered: 'Registrado',
  sent: 'Enviado à administradora',
  won: 'Vencedor',
  lost: 'Perdedor',
  void: 'Sem efeito (contemplada por sorteio)',
};

export const bidInput = z
  .object({
    assemblyId: z.string().uuid('Escolha a assembleia'),
    type: z.enum(bidTypes),
    /** Percentual sobre o crédito; ou o valor, e o outro é calculado. */
    percent: z.coerce.number().positive().max(100).nullish(),
    amount: z.coerce.number().positive().max(100_000_000).nullish(),
    notes: z.string().trim().max(300).nullish(),
  })
  .refine((b) => b.percent != null || b.amount != null, { message: 'Informe o percentual ou o valor do lance', path: ['percent'] });
export type BidInput = z.infer<typeof bidInput>;

/** Só os estados antes do resultado: vencedor/perdedor vêm da assembleia. */
export const bidStatusInput = z.object({ status: z.enum(['registered', 'sent']) });

export interface Bid {
  id: string;
  quotaId: string;
  assembly: { id: string; groupCode: string; heldOn: string; status: AssemblyStatus };
  type: BidType;
  percent: number;
  amount: number;
  status: BidStatus;
  notes: string | null;
  createdAt: string;
}

// ---- Crédito depois da contemplação ---------------------------------------------------------

export const creditStatuses = ['awaiting_docs', 'released', 'acquired'] as const;
export type CreditStatus = (typeof creditStatuses)[number];
export const creditStatusLabel: Record<CreditStatus, string> = { awaiting_docs: 'Aguardando documentação', released: 'Crédito liberado', acquired: 'Bem adquirido' };

export const creditInput = z
  .object({
    status: z.enum(creditStatuses),
    amount: z.coerce.number().positive().max(100_000_000).nullish(),
    releasedOn: isoDate.nullish(),
    assetDescription: z.string().trim().max(300).nullish(),
    acquiredOn: isoDate.nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .superRefine((c, ctx) => {
    if (c.status !== 'awaiting_docs' && !c.releasedOn) ctx.addIssue({ code: 'custom', path: ['releasedOn'], message: 'Informe quando o crédito foi liberado' });
    if (c.status === 'acquired' && !c.assetDescription) ctx.addIssue({ code: 'custom', path: ['assetDescription'], message: 'Descreva o bem adquirido' });
  });
export type CreditInput = z.infer<typeof creditInput>;

export interface CreditUsage {
  quotaId: string;
  status: CreditStatus;
  amount: number;
  releasedOn: string | null;
  assetDescription: string | null;
  acquiredOn: string | null;
  notes: string | null;
  updatedAt: string;
}

// ---- Grupos ---------------------------------------------------------------------------------

export interface Group {
  /** null = grupo ainda sem cadastro (só conhecido pelas cotas). */
  id: string | null;
  connectionId: string;
  institution: string;
  plan: { id: string; name: string } | null;
  groupCode: string;
  members: number | null;
  /** Meses restantes hoje (o informado, descontados os meses desde então). */
  monthsRemaining: number | null;
  notes: string | null;
  assembliesHeld: number;
  /** Lance vencedor médio, mínimo e máximo nas assembleias lançadas (percentual do crédito). */
  averageWinningBid: number | null;
  minWinningBid: number | null;
  maxWinningBid: number | null;
  nextAssembly: { id: string; heldOn: string } | null;
  /** Cotas da carteira neste grupo (ativas ou contempladas). */
  ourQuotas: number;
}

export const groupInput = z.object({
  planId: z.string().uuid('Escolha o plano'),
  groupCode: z.string().trim().min(1).max(20),
  members: z.coerce.number().int().min(1).max(100_000).nullish(),
  monthsRemaining: z.coerce.number().int().min(0).max(420).nullish(),
  notes: z.string().trim().max(500).nullish(),
});
export type GroupInput = z.infer<typeof groupInput>;

// ---- Comissões ------------------------------------------------------------------------------

export interface CommissionTable {
  /** Padrão do módulo (configurações), usado quando nem plano nem administradora têm percentual. */
  defaultPercent: number;
  reversalMonths: number;
  institutions: {
    connectionId: string;
    institution: string;
    percent: number | null;
    plans: { id: string; name: string; creditValue: number; termMonths: number; active: boolean; percent: number | null; effectivePercent: number }[];
  }[];
}

export const commissionRateInput = z.object({ percent: z.coerce.number().min(0).max(20).nullable() });
