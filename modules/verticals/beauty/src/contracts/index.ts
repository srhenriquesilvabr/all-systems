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
    lines: { date: string; customer: string; service: string; price: number; rate: number; commission: number }[];
  }[];
}
