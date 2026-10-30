import { z } from 'zod';

const rate = z.coerce.number().min(0).max(100).multipleOf(0.01);

export const commissionRulesInput = z.object({
  /** % padrão do profissional sobre o valor dos serviços. */
  defaultRate: rate,
  /** Exceções por serviço (ex.: coloração paga mais). */
  services: z.array(z.object({ serviceId: z.string().uuid(), rate })).max(200),
});
export type CommissionRulesInput = z.infer<typeof commissionRulesInput>;

export interface CommissionRules {
  resourceId: string;
  defaultRate: number;
  services: { serviceId: string; rate: number }[];
}

export interface CommissionReport {
  period: { from: string; to: string };
  professionals: {
    resourceId: string;
    name: string;
    appointments: number;
    revenue: number;
    commission: number;
    /** Já lançado no financeiro e o que ainda falta lançar. */
    launched: number;
    toLaunch: number;
    /** `rate`: o percentual gravado na conclusão do atendimento. */
    lines: { date: string; customer: string; service: string; price: number; rate: number; commission: number; launched: boolean }[];
  }[];
}

/** A comissão do próprio profissional; `linked` falso = usuário sem cadastro de profissional. */
export interface MyCommission extends CommissionReport {
  linked: boolean;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const commissionPayoutInput = z
  .object({
    from: isoDate,
    to: isoDate,
    /** Um profissional só; ausente = todos com comissão a lançar no período. */
    resourceId: z.string().uuid().optional(),
    dueDate: isoDate,
  })
  .refine((q) => q.from <= q.to, 'Período inválido');
export type CommissionPayoutInput = z.infer<typeof commissionPayoutInput>;

export const cancelPayoutInput = z.object({ reason: z.string().trim().min(3, 'Explique o motivo').max(300) });

export interface CommissionPayout {
  id: string;
  resourceId: string;
  resourceName: string;
  from: string;
  to: string;
  amount: number;
  dueDate: string;
  status: 'open' | 'cancelled';
  /** A despesa já foi paga no financeiro. */
  paid: boolean;
  cancelReason: string | null;
  createdAt: string;
}
