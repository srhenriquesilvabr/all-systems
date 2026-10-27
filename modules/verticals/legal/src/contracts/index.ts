import { z } from 'zod';
import { parseCnj } from './cnj';

export * from './cnj';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const money = z.coerce.number().min(0).max(100_000_000).multipleOf(0.01);

export const caseAreas = ['civil', 'labor', 'family', 'criminal', 'social_security', 'tax', 'consumer', 'business', 'other'] as const;
export const caseAreaLabel: Record<(typeof caseAreas)[number], string> = {
  civil: 'Cível',
  labor: 'Trabalhista',
  family: 'Família e sucessões',
  criminal: 'Criminal',
  social_security: 'Previdenciário',
  tax: 'Tributário',
  consumer: 'Consumidor',
  business: 'Empresarial',
  other: 'Outra',
};

export const caseStatuses = ['active', 'suspended', 'settled', 'won', 'lost', 'archived'] as const;
export type CaseStatus = (typeof caseStatuses)[number];
export const caseStatusLabel: Record<CaseStatus, string> = {
  active: 'Em andamento',
  suspended: 'Suspenso',
  settled: 'Acordo',
  won: 'Encerrado — procedente',
  lost: 'Encerrado — improcedente',
  archived: 'Arquivado',
};

export const caseRoles = ['plaintiff', 'defendant', 'third_party', 'advisory'] as const;
export const caseRoleLabel: Record<(typeof caseRoles)[number], string> = {
  plaintiff: 'Autor',
  defendant: 'Réu',
  third_party: 'Terceiro interessado',
  advisory: 'Consultivo (sem processo)',
};

export const caseInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  /** Número CNJ. Vazio em casos consultivos ou ainda não distribuídos. */
  number: z
    .string()
    .trim()
    .max(30)
    .nullish()
    .transform((v, ctx) => {
      if (!v) return null;
      const parsed = parseCnj(v);
      if (!parsed) ctx.addIssue({ code: 'custom', message: 'Número CNJ inválido (confira os dígitos)' });
      return parsed;
    }),
  title: z.string().trim().min(3, 'Dê um título ao caso').max(200),
  area: z.enum(caseAreas).default('civil'),
  role: z.enum(caseRoles).default('plaintiff'),
  court: z.string().trim().max(200).nullish(),
  opposingParty: z.string().trim().max(200).nullish(),
  claimValue: money.nullish(),
  responsibleUserId: z.string().uuid().nullish(),
  status: z.enum(caseStatuses).default('active'),
  notes: z.string().trim().max(5000).nullish(),
});
export type CaseInput = z.infer<typeof caseInput>;

export interface LegalCase {
  id: string;
  customer: { id: string; name: string };
  number: string | null;
  title: string;
  area: (typeof caseAreas)[number];
  role: (typeof caseRoles)[number];
  court: string | null;
  opposingParty: string | null;
  claimValue: number | null;
  responsible: { id: string; name: string } | null;
  status: CaseStatus;
  notes: string | null;
  nextDeadline: { id: string; title: string; dueOn: string } | null;
  createdAt: string;
}

export const updateInput = z.object({
  occurredOn: isoDate,
  description: z.string().trim().min(3, 'Descreva o andamento').max(5000),
});

export interface CaseUpdate {
  id: string;
  occurredOn: string;
  description: string;
  author: string | null;
  createdAt: string;
}

export const deadlineInput = z.object({
  caseId: z.string().uuid(),
  title: z.string().trim().min(3, 'Descreva o prazo').max(200),
  dueOn: isoDate,
  /** Avisar a equipe quantos dias antes. */
  alertDays: z.coerce.number().int().min(0).max(30).default(3),
  assignedUserId: z.string().uuid().nullish(),
  notes: z.string().trim().max(1000).nullish(),
});
export type DeadlineInput = z.infer<typeof deadlineInput>;

export interface Deadline {
  id: string;
  case: { id: string; number: string | null; title: string };
  title: string;
  dueOn: string;
  alertDays: number;
  assigned: { id: string; name: string } | null;
  status: 'open' | 'done';
  doneAt: string | null;
  notes: string | null;
}

export const feeKinds = ['fixed', 'monthly', 'success'] as const;
export const feeKindLabel: Record<(typeof feeKinds)[number], string> = { fixed: 'Valor fixo', monthly: 'Mensal', success: 'Êxito (percentual)' };

export const feeInput = z
  .object({
    caseId: z.string().uuid(),
    kind: z.enum(feeKinds),
    description: z.string().trim().max(200).nullish(),
    /** Fixo: valor total; mensal: valor de cada mês. */
    amount: money.nullish(),
    installments: z.coerce.number().int().min(1).max(60).default(1),
    firstDueOn: isoDate.nullish(),
    successPercent: z.coerce.number().min(0.01).max(100).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'success' && !v.successPercent) ctx.addIssue({ code: 'custom', path: ['successPercent'], message: 'Informe o percentual de êxito' });
    if (v.kind !== 'success' && !v.amount) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Informe o valor' });
    if (v.kind !== 'success' && !v.firstDueOn) ctx.addIssue({ code: 'custom', path: ['firstDueOn'], message: 'Informe o primeiro vencimento' });
  });
export type FeeInput = z.infer<typeof feeInput>;

export const successInput = z.object({ obtainedAmount: money.refine((v) => v > 0, 'Informe o valor obtido'), dueOn: isoDate });

export interface Fee {
  id: string;
  kind: (typeof feeKinds)[number];
  description: string | null;
  amount: number | null;
  installments: number;
  successPercent: number | null;
  status: 'active' | 'settled' | 'cancelled';
  receivable: { total: number; paid: number; open: number };
  createdAt: string;
}
