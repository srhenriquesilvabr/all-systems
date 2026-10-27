import { z } from 'zod';

// ---- Locação: contratos, mensalidades, reajustes e extrato do proprietário --------------------

const money = z.coerce.number().min(0).max(1_000_000_000).multipleOf(0.01);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const realEstateSettings = z.object({
  /** Dias depois do vencimento do aluguel para o repasse ao proprietário. */
  payoutDelayDays: z.coerce.number().int().min(0).max(30).default(5),
  /** Quantos dias antes do vencimento o inquilino é lembrado (0 = não lembrar). */
  rentReminderDays: z.coerce.number().int().min(0).max(15).default(3),
  /** Com quantos dias de antecedência o reajuste aparece na lista de pendentes. */
  adjustmentNoticeDays: z.coerce.number().int().min(0).max(90).default(30),
});
export type RealEstateSettings = z.infer<typeof realEstateSettings>;

export const leaseStatuses = ['active', 'ended', 'terminated'] as const;
export type LeaseStatus = (typeof leaseStatuses)[number];
export const leaseStatusLabel: Record<LeaseStatus, string> = { active: 'Ativo', ended: 'Encerrado', terminated: 'Rescindido' };

export const adjustmentIndexes = ['igpm', 'ipca', 'fixed', 'none'] as const;
export type AdjustmentIndex = (typeof adjustmentIndexes)[number];
export const adjustmentIndexLabel: Record<AdjustmentIndex, string> = { igpm: 'IGP-M', ipca: 'IPCA', fixed: 'Percentual fixo', none: 'Sem reajuste' };

export const guaranteeTypes = ['deposit', 'guarantor', 'insurance', 'capitalization', 'none'] as const;
export type GuaranteeType = (typeof guaranteeTypes)[number];
export const guaranteeTypeLabel: Record<GuaranteeType, string> = {
  deposit: 'Caução',
  guarantor: 'Fiador',
  insurance: 'Seguro-fiança',
  capitalization: 'Título de capitalização',
  none: 'Sem garantia',
};

export const extraKinds = ['condo', 'iptu', 'fine', 'repair', 'other'] as const;
export type ExtraKind = (typeof extraKinds)[number];
export const extraKindLabel: Record<ExtraKind, string> = { condo: 'Condomínio', iptu: 'IPTU', fine: 'Multa', repair: 'Reparo', other: 'Outra cobrança' };

/** Lei do Inquilinato (8.245/91), art. 38: a caução em dinheiro não passa de três aluguéis. */
export const MAX_DEPOSIT_RENTS = 3;

function validCpf(input: string): boolean {
  const cpf = input.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export const leaseInput = z
  .object({
    propertyId: z.string().uuid('Escolha o imóvel'),
    renterId: z.string().uuid('Escolha o inquilino'),
    startDate: isoDate,
    termMonths: z.coerce.number().int().min(1).max(240).default(30),
    rent: money.refine((v) => v > 0, 'Informe o valor do aluguel'),
    /** Dia do vencimento; nos meses mais curtos, vence no último dia do mês. */
    dueDay: z.coerce.number().int().min(1).max(31).default(10),
    condoFee: money.default(0),
    iptuMonthly: money.default(0),
    adjustmentIndex: z.enum(adjustmentIndexes).default('igpm'),
    adjustmentPercent: z.coerce.number().min(0).max(30).nullish(),
    /** Sem informar, o mês de início do contrato. */
    adjustmentMonth: z.coerce.number().int().min(1).max(12).nullish(),
    guaranteeType: z.enum(guaranteeTypes).default('none'),
    guaranteeAmount: money.nullish(),
    guarantorName: text(150),
    guarantorDocument: z
      .string()
      .max(20)
      .nullish()
      .transform((v) => (v ? v.replace(/\D/g, '') : null)),
    guaranteeProvider: text(150),
    guaranteeNumber: text(60),
    adminFeePercent: z.coerce.number().min(0).max(50).default(10),
    notes: text(2000),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.adjustmentIndex === 'fixed' && !v.adjustmentPercent) issue('adjustmentPercent', 'Informe o percentual do reajuste');
    if (v.guaranteeType === 'deposit') {
      if (!v.guaranteeAmount) issue('guaranteeAmount', 'Informe o valor da caução');
      else if (v.guaranteeAmount > v.rent * MAX_DEPOSIT_RENTS) issue('guaranteeAmount', `A caução não pode passar de ${MAX_DEPOSIT_RENTS} aluguéis (Lei do Inquilinato, art. 38)`);
    }
    if (v.guaranteeType === 'guarantor') {
      if (!v.guarantorName || v.guarantorName.length < 3) issue('guarantorName', 'Informe o nome do fiador');
      if (!v.guarantorDocument || !validCpf(v.guarantorDocument)) issue('guarantorDocument', 'CPF do fiador inválido');
    }
    if (v.guaranteeType === 'insurance') {
      if (!v.guaranteeProvider) issue('guaranteeProvider', 'Informe a seguradora');
      if (!v.guaranteeNumber) issue('guaranteeNumber', 'Informe o número da apólice');
    }
    if (v.guaranteeType === 'capitalization' && !v.guaranteeNumber) issue('guaranteeNumber', 'Informe o número do título');
  });
export type LeaseInput = z.infer<typeof leaseInput>;

export const leaseExtraInput = z.object({
  kind: z.enum(extraKinds),
  description: text(150),
  amount: money.refine((v) => v > 0, 'Informe o valor'),
  dueDate: isoDate,
  /** O valor recebido vai inteiro para o proprietário (ex.: condomínio, IPTU). */
  passToOwner: z.boolean().default(false),
});
export type LeaseExtraInput = z.infer<typeof leaseExtraInput>;

export const terminateLeaseInput = z.object({
  /** Entrega das chaves. No fim do prazo ou depois, o contrato fica "encerrado"; antes, "rescindido". */
  date: isoDate,
  reason: text(500),
  /** Multa rescisória cobrada do inquilino. */
  fine: z
    .object({
      amount: money.refine((v) => v > 0, 'Informe o valor da multa'),
      dueDate: isoDate.nullish(),
      passToOwner: z.boolean().default(true),
    })
    .nullish(),
});
export type TerminateLeaseInput = z.infer<typeof terminateLeaseInput>;

export const applyAdjustmentInput = z.object({
  /** Variação do índice no período, em %. Pode ser negativa. Índice fixo: sem informar, usa o do contrato. */
  percent: z.coerce.number().min(-30).max(50).nullish(),
});
export type ApplyAdjustmentInput = z.infer<typeof applyAdjustmentInput>;
export const skipAdjustmentInput = z.object({ notes: text(300) });
export const extendLeaseInput = z.object({ months: z.coerce.number().int().min(1).max(120) });

/** Situação do valor cobrado do inquilino, pelo financeiro. */
export type ReceiptStatus = 'pending' | 'overdue' | 'paid' | 'cancelled';
export const receiptStatusLabel: Record<ReceiptStatus, string> = { pending: 'Em aberto', overdue: 'Atrasado', paid: 'Recebido', cancelled: 'Cancelado' };
export type PayoutStatus = 'pending' | 'paid' | 'cancelled';
export const payoutStatusLabel: Record<PayoutStatus, string> = { pending: 'A repassar', paid: 'Repassado', cancelled: 'Cancelado' };

export interface LeaseCharge {
  id: string;
  seq: number;
  /** Primeiro dia do mês de uso. */
  periodStart: string;
  dueDate: string;
  payoutDate: string;
  rent: number;
  condoFee: number;
  iptu: number;
  /** Cobrado do inquilino: aluguel + condomínio + IPTU. */
  total: number;
  adminFee: number;
  payout: number;
  status: 'active' | 'cancelled';
  receipt: ReceiptStatus;
  receivedAt: string | null;
  payoutStatus: PayoutStatus | null;
  payoutPaidAt: string | null;
}

export interface LeaseExtra {
  id: string;
  kind: ExtraKind;
  description: string;
  amount: number;
  dueDate: string;
  passToOwner: boolean;
  status: 'active' | 'cancelled';
  receipt: ReceiptStatus;
}

export type AdjustmentStatus = 'pending' | 'applied' | 'skipped';
export const adjustmentStatusLabel: Record<AdjustmentStatus, string> = { pending: 'Pendente', applied: 'Aplicado', skipped: 'Não aplicado' };

export interface LeaseAdjustment {
  id: string;
  leaseId: string;
  dueOn: string;
  index: AdjustmentIndex;
  percent: number | null;
  previousRent: number;
  newRent: number | null;
  status: AdjustmentStatus;
  notes: string | null;
  appliedAt: string | null;
  /** Na lista de reajustes: de qual contrato é. */
  lease?: { number: number; propertyCode: number; propertyTitle: string; renterName: string; rent: number };
}

export interface Lease {
  id: string;
  number: number;
  status: LeaseStatus;
  property: { id: string; code: number; title: string; address: string };
  renter: { id: string; name: string; phone: string | null; email: string | null; document: string | null };
  owner: { id: string; name: string; phone: string | null; document: string | null };
  startDate: string;
  termMonths: number;
  endDate: string;
  initialRent: number;
  rent: number;
  dueDay: number;
  condoFee: number;
  iptuMonthly: number;
  adjustmentIndex: AdjustmentIndex;
  adjustmentPercent: number | null;
  adjustmentMonth: number;
  guaranteeType: GuaranteeType;
  guaranteeAmount: number | null;
  guarantorName: string | null;
  guarantorDocument: string | null;
  guaranteeProvider: string | null;
  guaranteeNumber: string | null;
  adminFeePercent: number;
  notes: string | null;
  terminatedOn: string | null;
  terminationReason: string | null;
  /** Aluguel em aberto mais antigo. */
  nextCharge: { dueDate: string; amount: number; overdue: boolean } | null;
  overdueCount: number;
  createdAt: string;
}

export interface LeaseDetail extends Lease {
  charges: LeaseCharge[];
  extras: LeaseExtra[];
  adjustments: LeaseAdjustment[];
}

export interface OwnerStatementLine {
  leaseId: string;
  leaseNumber: number;
  propertyCode: number;
  propertyTitle: string;
  renterName: string;
  description: string;
  dueDate: string;
  /** Cobrado do inquilino. */
  amount: number;
  receipt: ReceiptStatus;
  receivedAt: string | null;
  adminFee: number;
  payout: number;
  payoutDate: string;
  payoutStatus: PayoutStatus | null;
  payoutPaidAt: string | null;
}

/** Extrato do proprietário: aluguéis e cobranças repassadas que vencem no mês. */
export interface OwnerStatement {
  owner: { id: string; name: string; document: string | null };
  month: string;
  lines: OwnerStatementLine[];
  totals: { charged: number; received: number; adminFee: number; payout: number; payoutPaid: number };
}
