import { z } from 'zod';
import type { AcquisitionPeriod, Payslip } from './payroll';

export * from './payroll';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const employeeInput = z.object({
  name: z.string().trim().min(3).max(150),
  cpf: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length === 11, 'CPF deve ter 11 dígitos'),
  birthDate: isoDate.nullish(),
  email: z.string().trim().email().nullish().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(30).nullish(),
  position: z.string().trim().min(2).max(80),
  department: z.string().trim().max(80).nullish(),
  admissionDate: isoDate,
  salary: z.coerce.number().positive().max(1_000_000).multipleOf(0.01),
  weeklyHours: z.coerce.number().int().min(1).max(44).default(44),
  dependents: z.coerce.number().int().min(0).max(20).default(0),
  status: z.enum(['active', 'on_leave', 'terminated']).default('active'),
  terminationDate: isoDate.nullish(),
  pixKey: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type EmployeeInput = z.infer<typeof employeeInput>;
export const employeeStatusLabel = { active: 'Ativo', on_leave: 'Afastado', terminated: 'Desligado' } as const;

export interface Employee extends EmployeeInput {
  id: string;
  periods: AcquisitionPeriod[];
  vacationBalance: number;
  overdueVacation: boolean;
}

export const payrollItemUpdate = z.object({
  daysWorked: z.coerce.number().int().min(0).max(30),
  overtime50Hours: z.coerce.number().min(0).max(200),
  overtime100Hours: z.coerce.number().min(0).max(200),
  otherEarnings: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01),
  otherDeductions: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01),
  notes: z.string().trim().max(500).nullish(),
});
export type PayrollItemUpdate = z.infer<typeof payrollItemUpdate>;

export interface PayrollItem extends PayrollItemUpdate, Payslip {
  id: string;
  employee: { id: string; name: string; cpf: string; position: string; admissionDate: string; dependents: number };
  salary: number;
}

export interface Payroll {
  id: string;
  competence: string;
  status: 'draft' | 'closed';
  closedAt: string | null;
  tablesLabel: string;
  totals: { gross: number; inss: number; irrf: number; net: number; fgts: number; employees: number };
  items: PayrollItem[];
}

export const vacationInput = z.object({
  employeeId: z.string().uuid(),
  /** Período aquisitivo de onde saem os dias (início do período). */
  periodStart: isoDate,
  startOn: isoDate,
  days: z.coerce.number().int().min(5, 'Cada período de férias tem pelo menos 5 dias').max(30),
  /** Abono pecuniário: até 1/3 (10 dias) pode ser vendido. */
  soldDays: z.coerce.number().int().min(0).max(10).default(0),
});
export type VacationInput = z.infer<typeof vacationInput>;

export interface Vacation {
  id: string;
  periodStart: string;
  startOn: string;
  endOn: string;
  days: number;
  soldDays: number;
  status: 'scheduled' | 'cancelled';
  pay: { vacation: number; allowance: number };
  /** Pagamento até 2 dias antes do início (CLT, art. 145). */
  payBy: string;
}
