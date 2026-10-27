import { z } from 'zod';

/**
 * Tabelas de cálculo da folha. Vêm com os valores vigentes conhecidos e ficam nas
 * configurações do módulo: quando o governo publicar a tabela nova, o RH atualiza lá
 * (conferir sempre com a contabilidade).
 */
export const taxTables = z.object({
  label: z.string().max(120).default('INSS 2025 · IRRF maio/2025 + redução da Lei 15.270/2025'),
  /** INSS do empregado, progressivo por faixa; acima da última, teto. */
  inss: z
    .array(z.object({ upTo: z.number().positive(), rate: z.number().min(0).max(1) }))
    .min(1)
    .default([
      { upTo: 1518.0, rate: 0.075 },
      { upTo: 2793.88, rate: 0.09 },
      { upTo: 4190.83, rate: 0.12 },
      { upTo: 8157.41, rate: 0.14 },
    ]),
  /** IRRF mensal: alíquota e parcela a deduzir por faixa da base de cálculo. */
  irrf: z
    .array(z.object({ upTo: z.number().positive().nullable(), rate: z.number().min(0).max(1), deduction: z.number().min(0) }))
    .min(1)
    .default([
      { upTo: 2428.8, rate: 0, deduction: 0 },
      { upTo: 2826.65, rate: 0.075, deduction: 182.16 },
      { upTo: 3751.05, rate: 0.15, deduction: 394.16 },
      { upTo: 4664.68, rate: 0.225, deduction: 675.49 },
      { upTo: null, rate: 0.275, deduction: 908.73 },
    ]),
  dependentDeduction: z.number().min(0).default(189.59),
  /** Desconto simplificado mensal: usado quando é maior que as deduções legais. */
  simplifiedDiscount: z.number().min(0).default(607.2),
  /**
   * Redução do IRRF para rendas mais baixas (Lei 15.270/2025, a partir de 2026): até R$ 5.000
   * de rendimentos, zera o imposto (redução de até R$ 312,89); de R$ 5.000,01 a R$ 7.350,
   * redução de R$ 978,62 − 0,133145 × rendimentos.
   */
  irrfReduction: z
    .object({ enabled: z.boolean(), fullUpTo: z.number(), fullMax: z.number(), partialUpTo: z.number(), partialBase: z.number(), partialFactor: z.number() })
    .default({ enabled: true, fullUpTo: 5000, fullMax: 312.89, partialUpTo: 7350, partialBase: 978.62, partialFactor: 0.133145 }),
  fgtsRate: z.number().min(0).max(1).default(0.08),
});
export type TaxTables = z.infer<typeof taxTables>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function inss(gross: number, t: TaxTables): number {
  let total = 0;
  let floor = 0;
  for (const band of t.inss) {
    if (gross <= floor) break;
    total += (Math.min(gross, band.upTo) - floor) * band.rate;
    floor = band.upTo;
  }
  return round2(total);
}

export function irrf(gross: number, inssValue: number, dependents: number, t: TaxTables): { base: number; tax: number; reduction: number; usedSimplified: boolean } {
  const legal = inssValue + dependents * t.dependentDeduction;
  const usedSimplified = t.simplifiedDiscount > legal;
  const base = Math.max(0, gross - (usedSimplified ? t.simplifiedDiscount : legal));
  const band = t.irrf.find((b) => b.upTo === null || base <= b.upTo) ?? t.irrf[t.irrf.length - 1]!;
  const tax = Math.max(0, base * band.rate - band.deduction);
  let reduction = 0;
  const r = t.irrfReduction;
  if (r.enabled) {
    if (gross <= r.fullUpTo) reduction = Math.min(tax, r.fullMax);
    else if (gross <= r.partialUpTo) reduction = Math.min(tax, Math.max(0, r.partialBase - r.partialFactor * gross));
  }
  return { base: round2(base), tax: round2(Math.max(0, tax - reduction)), reduction: round2(reduction), usedSimplified };
}

export interface PayslipInput {
  salary: number;
  weeklyHours: number;
  /** Dias trabalhados no mês (admissão ou desligamento no meio do mês). Mês cheio = 30. */
  daysWorked: number;
  overtime50Hours: number;
  overtime100Hours: number;
  otherEarnings: number;
  otherDeductions: number;
  dependents: number;
}

export interface Payslip {
  baseSalary: number;
  overtime: number;
  gross: number;
  inss: number;
  irrf: number;
  irrfBase: number;
  irrfReduction: number;
  otherDeductions: number;
  net: number;
  /** Encargo da empresa (não sai do salário). */
  fgts: number;
}

/**
 * Holerite do mês. Hora = salário ÷ (jornada semanal × 5), a convenção da CLT (44h → 220h).
 * Não calcula DSR sobre horas extras, adicionais e médias: entram em "outros proventos".
 */
export function computePayslip(i: PayslipInput, t: TaxTables): Payslip {
  const baseSalary = round2((i.salary / 30) * Math.min(Math.max(i.daysWorked, 0), 30));
  const hourly = i.salary / (i.weeklyHours * 5);
  const overtime = round2(hourly * 1.5 * i.overtime50Hours + hourly * 2 * i.overtime100Hours);
  const gross = round2(baseSalary + overtime + i.otherEarnings);
  const inssValue = inss(gross, t);
  const ir = irrf(gross, inssValue, i.dependents, t);
  const net = round2(gross - inssValue - ir.tax - i.otherDeductions);
  return { baseSalary, overtime, gross, inss: inssValue, irrf: ir.tax, irrfBase: ir.base, irrfReduction: ir.reduction, otherDeductions: round2(i.otherDeductions), net, fgts: round2(gross * t.fgtsRate) };
}

/** Férias: remuneração dos dias + 1/3 constitucional; abono pecuniário (dias vendidos) também com 1/3. */
export function vacationPay(salary: number, days: number, soldDays: number) {
  const daily = salary / 30;
  return { vacation: round2(daily * days * (4 / 3)), allowance: round2(daily * soldDays * (4 / 3)) };
}

export interface AcquisitionPeriod {
  start: string;
  end: string;
  /** Fim do prazo para a empresa conceder (12 meses depois do fim do período). */
  grantDeadline: string;
  earned: boolean;
  usedDays: number;
  balance: number;
  overdue: boolean;
}

const addYears = (iso: string, n: number) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;
const minusDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Períodos aquisitivos desde a admissão (12 meses cada), com o saldo de dias de cada um. */
export function acquisitionPeriods(admission: string, today: string, used: { periodStart: string; days: number }[]): AcquisitionPeriod[] {
  const out: AcquisitionPeriod[] = [];
  for (let k = 0; ; k++) {
    const start = addYears(admission, k);
    if (start > today) break;
    const end = minusDay(addYears(admission, k + 1));
    const earned = end < today;
    const usedDays = used.filter((u) => u.periodStart === start).reduce((s, u) => s + u.days, 0);
    const grantDeadline = addYears(end, 1);
    out.push({ start, end, grantDeadline, earned, usedDays, balance: earned ? Math.max(0, 30 - usedDays) : 0, overdue: earned && 30 - usedDays > 0 && grantDeadline < today });
  }
  return out;
}
