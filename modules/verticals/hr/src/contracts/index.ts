import { z } from 'zod';
import { leaveTypes, type AcquisitionPeriod, type LeaveType, type Payslip } from './payroll';
import { noticeOptions, noticeTypes, terminationTypes, type TerminationStatement, type TerminationType } from './termination';

export * from './payroll';
export * from './termination';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const money = (max = 1_000_000) => z.coerce.number().min(0).max(max).multipleOf(0.01);

export const employeeCategories = ['employee', 'apprentice'] as const;
export const employeeCategoryLabel = { employee: 'Empregado', apprentice: 'Jovem aprendiz' } as const;

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
  /** Aprendiz: FGTS de 2% (Lei 8.036/90, art. 15 §7). */
  category: z.enum(employeeCategories).default('employee'),
  /** Fim do contrato de experiência (até 90 dias, CLT art. 445 parágrafo único). */
  experienceEnd: isoDate.nullish(),
  status: z.enum(['active', 'on_leave', 'terminated']).default('active'),
  terminationDate: isoDate.nullish(),
  pixKey: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /**
   * Pessoa da equipe já cadastrada (ex.: um profissional da agenda). Ausente: a pessoa ligada ao
   * colaborador ou, na admissão, a que já tem este CPF; senão, uma pessoa nova. Nome, CPF,
   * nascimento, e-mail e telefone acima são gravados nela.
   */
  teamMemberId: z.string().uuid().nullish(),
  /**
   * Empregador (consultoria de RH): cliente do tipo empresa. Nulo = a própria empresa; ausente na
   * edição = mantém o atual. Só pode mudar enquanto o colaborador não está em nenhuma folha.
   */
  employerCustomerId: z.string().uuid().nullish(),
});
export type EmployeeInput = z.infer<typeof employeeInput>;
export const employeeStatusLabel = { active: 'Ativo', on_leave: 'Afastado', terminated: 'Desligado' } as const;

/** Empregador do colaborador ou da folha: uma empresa-cliente da consultoria (null = a própria empresa). */
export interface EmployerRef {
  id: string;
  name: string;
  /** CNPJ (só dígitos). */
  document: string | null;
}

/** Empresa que pode empregar colaboradores (clientes do tipo empresa), com o resumo do RH dela. */
export interface Employer extends EmployerRef {
  email: string | null;
  phone: string | null;
  activeEmployees: number;
  /** Última folha (mensal, 13º ou rescisões), pela competência. */
  lastPayroll: { id: string; competence: string; type: PayrollType; status: 'draft' | 'closed' } | null;
}

/**
 * GET /hr/employers. `enabled`: o tenant pode ter colaboradores de empresas-clientes (um ramo liga
 * esse recurso no RH, ex.: Consultoria de RH). Sem ele, a lista vem vazia e as telas ficam como antes.
 */
export interface EmployersResponse {
  enabled: boolean;
  items: Employer[];
}

/** Filtro de empregador nas listas: id da empresa-cliente ou "own" (a própria empresa). */
export const employerFilter = z.union([z.literal('own'), z.string().uuid()]).optional();
export type EmployerFilter = z.infer<typeof employerFilter>;

export interface Employee extends EmployeeInput {
  id: string;
  teamMemberId: string;
  employerCustomerId: string | null;
  employer: EmployerRef | null;
  periods: AcquisitionPeriod[];
  vacationBalance: number;
  overdueVacation: boolean;
  /** Rescisão em vigor (termo de rescisão). */
  termination: { id: string; type: TerminationType; terminationDate: string } | null;
  /** Rescisões desfeitas: o termo fica guardado, com o motivo (só na ficha do colaborador). */
  cancelledTerminations: { id: string; terminationDate: string; cancelledAt: string; reason: string | null }[];
  /** Afastamento registrado que cobre hoje: é o que faz a Situação ser Afastado, sem rotina. */
  currentLeave: { type: LeaveType; startOn: string; endOn: string } | null;
  /** Afastado marcado à mão, sem período em Afastamentos (outros motivos). */
  manualLeave: boolean;
  /** Desligado pela edição antiga, sem termo: precisa rescindir de verdade ou voltar a ativo. */
  terminatedWithoutTerm: boolean;
}

/** Motivo obrigatório das reversões (reabrir folha, desfazer rescisão, reativar): fica na auditoria. */
export const reversalInput = z.object({ reason: z.string().trim().min(3, 'Informe o motivo').max(500) });
export type ReversalInput = z.infer<typeof reversalInput>;

/** O que mudou na ficha depois de abrir a folha: GET /hr/payrolls/:id/pending. */
export interface PayrollPending {
  changes: { itemId: string; employeeId: string; name: string; salary: { from: number; to: number }; dependents: { from: number; to: number } }[];
  /** Colaboradores que pertencem à folha e não estão nela (admitidos depois de abrir ou removidos). */
  missing: { employeeId: string; name: string; position: string; admissionDate: string }[];
}

export const payrollApplyChanges = z.object({
  /** Só estes colaboradores; vazio ou ausente = todos com mudança. */
  itemIds: z.array(z.string().uuid()).max(2000).optional(),
});
export type PayrollApplyChanges = z.infer<typeof payrollApplyChanges>;

export const payrollAddItem = z.object({ employeeId: z.string().uuid() });
export type PayrollAddItem = z.infer<typeof payrollAddItem>;

/** Entrada do histórico de uma folha (vem da auditoria). */
export interface PayrollHistoryEntry {
  id: string;
  action: string;
  data: unknown;
  createdAt: string;
  user: { id: string; name: string } | null;
}

export const payrollItemUpdate = z.object({
  daysWorked: z.coerce.number().int().min(0).max(30),
  overtime50Hours: z.coerce.number().min(0).max(200),
  overtime100Hours: z.coerce.number().min(0).max(200),
  /** Comissões e variáveis: geram DSR e entram nas médias. */
  commissions: money().default(0),
  otherEarnings: money(),
  otherDeductions: money(),
  /** Faltas injustificadas (dias). */
  absences: z.coerce.number().int().min(0).max(30).default(0),
  /** Repousos perdidos pelas faltas (um por semana com falta injustificada). */
  dsrLostDays: z.coerce.number().int().min(0).max(10).default(0),
  notes: z.string().trim().max(500).nullish(),
});
export type PayrollItemUpdate = z.infer<typeof payrollItemUpdate>;

/** Ajuste de um colaborador na folha de 13º: avos e média das variáveis. */
export const thirteenthItemUpdate = z.object({
  avos: z.coerce.number().int().min(0).max(12),
  variableAverage: money(),
  notes: z.string().trim().max(500).nullish(),
});
export type ThirteenthItemUpdate = z.infer<typeof thirteenthItemUpdate>;

export const payrollTypes = ['monthly', 'thirteenth_1', 'thirteenth_2', 'termination'] as const;
export type PayrollType = (typeof payrollTypes)[number];
export const payrollTypeLabel: Record<PayrollType, string> = {
  monthly: 'Folha mensal',
  thirteenth_1: '13º — 1ª parcela',
  thirteenth_2: '13º — 2ª parcela',
  termination: 'Rescisões',
};

export const payrollCreate = z.object({
  competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM'),
  /** Feriados em dias úteis no mês (para o DSR). */
  holidays: z.coerce.number().int().min(0).max(10).default(0),
  /** Empresa-cliente (consultoria de RH); vazio = a própria empresa. */
  employerCustomerId: z.string().uuid().nullish(),
});
export type PayrollCreate = z.infer<typeof payrollCreate>;

export const thirteenthCreate = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  installment: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2)])),
  /** Empresa-cliente (consultoria de RH); vazio = a própria empresa. */
  employerCustomerId: z.string().uuid().nullish(),
});
export type ThirteenthCreate = z.infer<typeof thirteenthCreate>;

export const payrollRecalculate = z.object({
  holidays: z.coerce.number().int().min(0).max(10).optional(),
  /** Troca a cópia das tabelas guardada na folha aberta pelas tabelas atuais do RH. */
  useCurrentTables: z.boolean().optional(),
});

export interface PayrollItem extends PayrollItemUpdate, Payslip {
  id: string;
  commissions: number;
  employee: { id: string; name: string; cpf: string; position: string; admissionDate: string; dependents: number; category: 'employee' | 'apprentice' };
  salary: number;
  /** Rescisão (só na folha de rescisões). */
  terminationId?: string | null;
}

export interface Payroll {
  id: string;
  competence: string;
  type: PayrollType;
  /** Empresa-cliente da folha; null = a própria empresa (só esta lança salários e encargos no financeiro). */
  employer: EmployerRef | null;
  status: 'draft' | 'closed';
  closedAt: string | null;
  tablesLabel: string;
  holidays: number;
  calendar: { days: number; sundays: number; restDays: number; workingDays: number };
  totals: { gross: number; inss: number; irrf: number; net: number; fgts: number; employees: number; maternity: number };
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
  /** "taken" (gozadas) é derivado: marcadas cujo fim já passou. */
  status: 'scheduled' | 'taken' | 'cancelled';
  pay: { vacation: number; allowance: number };
  /** Pagamento até 2 dias antes do início (CLT, art. 145). */
  payBy: string;
}

export const leaveInput = z
  .object({
    employeeId: z.string().uuid(),
    type: z.enum(leaveTypes),
    startOn: isoDate,
    /** Maternidade: vazio = 120 dias. */
    endOn: isoDate.nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.type === 'maternity' || !!v.endOn, { message: 'Informe o fim do afastamento', path: ['endOn'] })
  .refine((v) => !v.endOn || v.endOn >= v.startOn, { message: 'O fim deve ser depois do início', path: ['endOn'] });
export type LeaveInput = z.infer<typeof leaveInput>;

export interface Leave {
  id: string;
  type: LeaveType;
  startOn: string;
  endOn: string;
  days: number;
  /** Dias pagos pela empresa (doença: até o 15º; maternidade: todos, compensados no INSS). */
  companyDays: number;
  /** Dias pagos pelo INSS (doença a partir do 16º). */
  inssDays: number;
  notes: string | null;
}

export const terminationInput = z
  .object({
    type: z.enum(terminationTypes),
    /** Último dia trabalhado (data de afastamento). */
    terminationDate: isoDate,
    notice: z.enum(noticeTypes),
    /** Último salário (vazio = o do cadastro). */
    salary: z.coerce.number().positive().max(1_000_000).multipleOf(0.01).optional(),
    /** Média mensal das variáveis (vazio = calculada pelas folhas fechadas dos últimos 12 meses). */
    variableAverage: money().optional(),
    /** Saldo do FGTS pelo extrato (vazio = estimado pelas folhas registradas). */
    fgtsBalance: money(100_000_000).optional(),
    otherEarnings: money().default(0),
    otherDeductions: money().default(0),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((v) => noticeOptions[v.type].includes(v.notice), { message: 'Forma de aviso prévio não se aplica a este tipo de rescisão', path: ['notice'] });
export type TerminationInput = z.infer<typeof terminationInput>;

export interface TerminationDetail extends TerminationStatement {
  id: string | null;
  employee: { id: string; name: string; cpf: string; position: string; category: 'employee' | 'apprentice'; pixKey: string | null; employer: EmployerRef | null };
  /** Férias marcadas depois da saída: canceladas ao confirmar (viram férias indenizadas). */
  cancelledVacations: { id: string; startOn: string; days: number }[];
  notes: string | null;
  createdAt: string | null;
}
