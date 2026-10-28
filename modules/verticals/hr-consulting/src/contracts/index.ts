import { z } from 'zod';

export const feeModes = ['none', 'per_employee', 'fixed'] as const;
export type FeeMode = (typeof feeModes)[number];
export const feeModeLabel: Record<FeeMode, string> = {
  none: 'Sem honorário automático',
  per_employee: 'Por colaborador na folha',
  fixed: 'Valor fixo por folha',
};

const money = z.coerce.number().min(0).max(1_000_000).multipleOf(0.01);

/** Honorários da consultoria para uma empresa atendida (PUT /hr-consulting/clients/:customerId). */
export const clientFeeInput = z
  .object({
    feeMode: z.enum(feeModes),
    feeAmount: money.default(0),
    feeDueDay: z.coerce.number().int().min(1).max(28).default(10),
    thirteenthFee: z.boolean().default(false),
    terminationFee: money.default(0),
    notes: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => v.feeMode === 'none' || v.feeAmount > 0, { message: 'Informe o valor do honorário', path: ['feeAmount'] });
export type ClientFeeInput = z.infer<typeof clientFeeInput>;

export interface ClientFee extends ClientFeeInput {
  customerId: string;
  notes: string | null;
}

/** Origem dos lançamentos de honorários no financeiro. */
export const FEE_SOURCE = 'hrc_fee';

/** Valor do honorário de uma folha com `employees` colaboradores (0 = não lança). */
export function feeFor(fee: Pick<ClientFee, 'feeMode' | 'feeAmount'>, employees: number): number {
  if (fee.feeMode === 'fixed') return fee.feeAmount;
  if (fee.feeMode === 'per_employee') return Math.round(fee.feeAmount * employees * 100) / 100;
  return 0;
}

/** Como o honorário aparece nas telas: "R$ 45,00 por colaborador", "R$ 1.200,00 por folha". */
export function feeSummary(fee: Pick<ClientFee, 'feeMode' | 'feeAmount'> | null | undefined, formatMoney: (v: number) => string): string {
  if (!fee || fee.feeMode === 'none') return '—';
  return fee.feeMode === 'per_employee' ? `${formatMoney(fee.feeAmount)} por colaborador` : `${formatMoney(fee.feeAmount)} por folha`;
}
