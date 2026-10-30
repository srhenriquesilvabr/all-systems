import { z } from 'zod';

/**
 * Tabelas de cálculo da folha. Vêm com os valores vigentes conhecidos e ficam nas
 * configurações do módulo: quando o governo publicar a tabela nova, o RH atualiza lá
 * (conferir sempre com a contabilidade).
 *
 * Campos novos entram sempre no nível de cima e com `.default()`: tabelas já guardadas
 * (configuração e cópias nas folhas) continuam válidas e ganham o valor padrão.
 */
export const taxTables = z.object({
  label: z.string().max(120).default('INSS 2026 (Portaria MPS/MF 13/2026) · IRRF maio/2025 + redução da Lei 15.270/2025'),
  /** INSS do empregado, progressivo por faixa; acima da última, teto. */
  inss: z
    .array(z.object({ upTo: z.number().positive(), rate: z.number().min(0).max(1) }))
    .min(1)
    .default([
      { upTo: 1621.0, rate: 0.075 },
      { upTo: 2902.84, rate: 0.09 },
      { upTo: 4354.27, rate: 0.12 },
      { upTo: 8475.55, rate: 0.14 },
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
  /** FGTS do contrato de aprendizagem (Lei 8.036/90, art. 15 §7). */
  fgtsApprenticeRate: z.number().min(0).max(1).default(0.02),
  /** Multa do FGTS na dispensa sem justa causa (Lei 8.036/90, art. 18 §1). */
  fgtsFineRate: z.number().min(0).max(1).default(0.4),
  /** Multa do FGTS na rescisão por acordo (CLT, art. 484-A, I, b). */
  fgtsAgreementFineRate: z.number().min(0).max(1).default(0.2),
  /** Aviso prévio proporcional (Lei 12.506/2011): 30 dias + 3 por ano completo de serviço, até 90. */
  noticeDays: z
    .object({ base: z.number().int().min(0), perYear: z.number().int().min(0), max: z.number().int().min(0) })
    .default({ base: 30, perYear: 3, max: 90 }),
  /** Dias do afastamento por doença pagos pela empresa; dali em diante paga o INSS (Lei 8.213/91, art. 60 §3). */
  sickLeaveCompanyDays: z.number().int().min(0).max(60).default(15),
  /**
   * IRRF do 13º (tributação exclusiva, calculada em separado): se aplica o desconto simplificado
   * e a redução da Lei 15.270/2025. Ligados por padrão; conferir com a contabilidade.
   */
  thirteenthIrrf: z.object({ simplified: z.boolean(), reduction: z.boolean() }).default({ simplified: true, reduction: true }),
});
export type TaxTables = z.infer<typeof taxTables>;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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

/**
 * IRRF pela tabela mensal. `opts` desliga o desconto simplificado ou a redução da Lei 15.270
 * (usado no 13º, conforme `thirteenthIrrf` das tabelas).
 */
export function irrf(
  gross: number,
  inssValue: number,
  dependents: number,
  t: TaxTables,
  opts: { simplified?: boolean; reduction?: boolean } = {},
): { base: number; tax: number; reduction: number; usedSimplified: boolean } {
  const legal = inssValue + dependents * t.dependentDeduction;
  const usedSimplified = opts.simplified !== false && t.simplifiedDiscount > legal;
  const base = Math.max(0, gross - (usedSimplified ? t.simplifiedDiscount : legal));
  const band = t.irrf.find((b) => b.upTo === null || base <= b.upTo) ?? t.irrf[t.irrf.length - 1]!;
  const tax = Math.max(0, base * band.rate - band.deduction);
  let reduction = 0;
  const r = t.irrfReduction;
  if (r.enabled && opts.reduction !== false) {
    if (gross <= r.fullUpTo) reduction = Math.min(tax, r.fullMax);
    else if (gross <= r.partialUpTo) reduction = Math.min(tax, Math.max(0, r.partialBase - r.partialFactor * gross));
  }
  return { base: round2(base), tax: round2(Math.max(0, tax - reduction)), reduction: round2(reduction), usedSimplified };
}

export const fgtsRateOf = (t: TaxTables, apprentice: boolean | undefined) => (apprentice ? t.fgtsApprenticeRate : t.fgtsRate);

// ---- Datas (ISO "AAAA-MM-DD", sem fuso) ---------------------------------------------------------

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const isoAddDays = (iso: string, n: number) => {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Dias corridos de `from` até `to`, contando os dois. */
export const isoDaysInclusive = (from: string, to: string) => Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000) + 1;
export const isoMonthEnd = (iso: string) => {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/** Soma meses mantendo o dia (31/01 + 1 mês = 28/02 ou 29/02). */
export const isoAddMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};
const maxIso = (a: string, b: string) => (a > b ? a : b);
const minIso = (a: string, b: string) => (a < b ? a : b);
/**
 * Dias "comerciais" (mês de 30 dias, como a folha paga): o dia 31 não conta e o último dia de
 * fevereiro vale o que falta para 30 (28/02 = 3 dias; 29/02 = 2).
 */
export const commercialDays = (from: string, to: string) => {
  let total = 0;
  for (let d = from; d <= to; d = isoAddDays(d, 1)) {
    const day = Number(d.slice(8));
    const last = Number(isoMonthEnd(d).slice(8));
    total += day === 31 ? 0 : day === last && last < 30 ? 30 - day + 1 : 1;
  }
  return total;
};
/** Dias de [aStart, aEnd] que caem em [bStart, bEnd] (corridos ou comerciais). */
export const overlapDays = (aStart: string, aEnd: string, bStart: string, bEnd: string, commercial = false) => {
  const s = maxIso(aStart, bStart);
  const e = minIso(aEnd, bEnd);
  if (s > e) return 0;
  return commercial ? commercialDays(s, e) : isoDaysInclusive(s, e);
};
/** Anos completos entre duas datas (aniversário do contrato). */
export const fullYearsBetween = (from: string, to: string) => {
  let years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  if (to.slice(5) < from.slice(5)) years--;
  return Math.max(0, years);
};

/**
 * Calendário do mês para o DSR: domingos + feriados são os dias de repouso; dias úteis são o
 * resto (o sábado conta como dia útil, mesmo sem expediente). Feriado que cai no domingo não
 * deve ser informado de novo.
 */
export function monthCalendar(competence: string, holidays: number) {
  const start = `${competence}-01`;
  const end = isoMonthEnd(start);
  const days = Number(end.slice(8));
  let sundays = 0;
  for (let d = 1; d <= days; d++) if (utc(`${competence}-${String(d).padStart(2, '0')}`).getUTCDay() === 0) sundays++;
  const restDays = sundays + holidays;
  return { days, sundays, holidays, restDays, workingDays: Math.max(0, days - restDays) };
}

// ---- Afastamentos e férias no período ------------------------------------------------------------

export const leaveTypes = ['sick', 'maternity'] as const;
export type LeaveType = (typeof leaveTypes)[number];
export const leaveTypeLabel: Record<LeaveType, string> = { sick: 'Doença (atestado/auxílio)', maternity: 'Licença-maternidade' };
export interface LeaveSpan {
  type: LeaveType;
  startOn: string;
  endOn: string;
}

/**
 * Dias de afastamento num intervalo:
 * - doença: os primeiros 15 dias (configurável) são pagos pela empresa como salário; do 16º em
 *   diante quem paga é o INSS (auxílio por incapacidade) e esses dias saem da folha;
 * - maternidade: a empresa paga o salário-maternidade e deduz o valor das contribuições devidas
 *   (Lei 8.213/91, art. 72 §1º) — na folha aparece separado, como informação para a DCTFWeb.
 * Simplificação: não soma atestados da mesma doença dentro de 60 dias (Decreto 3.048, art. 75 §3º).
 */
export function leaveDaysBetween(leaves: LeaveSpan[], from: string, to: string, companyDays: number, commercial = false) {
  let inssDays = 0;
  let maternityDays = 0;
  for (const l of leaves) {
    if (l.type === 'maternity') maternityDays += overlapDays(l.startOn, l.endOn, from, to, commercial);
    else inssDays += overlapDays(isoAddDays(l.startOn, companyDays), l.endOn, from, to, commercial);
  }
  return { inssDays, maternityDays };
}

/** Dias de férias gozados num intervalo. */
export function vacationDaysBetween(vacations: { startOn: string; days: number }[], from: string, to: string, commercial = false) {
  return vacations.reduce((s, v) => s + overlapDays(v.startOn, isoAddDays(v.startOn, v.days - 1), from, to, commercial), 0);
}

// ---- Holerite mensal ------------------------------------------------------------------------------

export interface PayslipInput {
  salary: number;
  weeklyHours: number;
  /** Dias de contrato no mês (admissão ou desligamento no meio do mês). Mês cheio = 30. */
  daysWorked: number;
  overtime50Hours: number;
  overtime100Hours: number;
  otherEarnings: number;
  otherDeductions: number;
  dependents: number;
  /** Comissões e outras parcelas variáveis que geram DSR e entram nas médias. */
  commissions?: number;
  /** Faltas injustificadas (dias). */
  absences?: number;
  /** Repousos semanais perdidos pelas faltas (Lei 605/49, art. 6º): um por semana com falta. */
  dsrLostDays?: number;
  /** Dias de afastamento pagos pelo INSS (doença a partir do 16º dia). */
  inssLeaveDays?: number;
  /** Dias de licença-maternidade no mês. */
  maternityDays?: number;
  /** Dias de férias gozados no mês (pagos antes, no recibo de férias). */
  vacationDays?: number;
  /** Domingos + feriados do mês (DSR). */
  restDays?: number;
  /** Dias úteis do mês (DSR). */
  workingDays?: number;
  apprentice?: boolean;
}

export interface VacationReceiptInfo {
  startOn: string;
  days: number;
  soldDays: number;
  payBy: string;
  amount: number;
}

export interface Payslip {
  baseSalary: number;
  overtime: number;
  /** Remuneração do mês: base do INSS e do FGTS (proventos − faltas e DSR perdido). */
  gross: number;
  inss: number;
  irrf: number;
  irrfBase: number;
  irrfReduction: number;
  otherDeductions: number;
  net: number;
  /** Encargo da empresa (não sai do salário). */
  fgts: number;
  // Campos abaixo podem faltar em holerites calculados antes desta versão (usar `?? 0`).
  salaryDays?: number;
  commissions?: number;
  dsr?: number;
  /** Salário-maternidade pago pela empresa e compensável na DCTFWeb (informativo). */
  maternity?: number;
  maternityDays?: number;
  inssLeaveDays?: number;
  vacationDays?: number;
  /** Férias gozadas no mês + 1/3: entram na base do INSS/FGTS e são abatidas porque já foram pagas no recibo. */
  vacation?: number;
  absenceDeduction?: number;
  /** Horas extras + comissões + DSR: entra nas médias do 13º e da rescisão. */
  variablePay?: number;
  /** Total de proventos. */
  earnings?: number;
  fgtsRate?: number;
  /** Recibos de férias pagos neste mês (informativo; o pagamento sai pelo lançamento das férias). */
  vacationReceipts?: VacationReceiptInfo[];
  /** 13º salário. */
  installment?: 1 | 2;
  avos?: number;
  variableAverage?: number;
  /** 13º integral (base/12 × avos) na 2ª parcela. */
  thirteenthFull?: number;
  /** Adiantamento (1ª parcela) descontado na 2ª. */
  advance?: number;
}

/**
 * Holerite do mês. Hora = salário ÷ (jornada semanal × 5), a convenção da CLT (44h → 220h).
 *
 * - DSR sobre horas extras e comissões (Lei 605/49, art. 7º; Súmula 172 TST), simplificado:
 *   variáveis ÷ dias úteis × (domingos + feriados).
 * - Faltas injustificadas descontam o dia e o repouso da semana (informado em `dsrLostDays`).
 * - Afastamento pelo INSS sai dos dias pagos; maternidade é paga à parte ("salário-maternidade").
 * - Férias gozadas no mês: os dias saem do salário; o valor (dias + 1/3) entra na base do INSS e
 *   do FGTS do mês e é abatido em seguida, porque já foi pago no recibo de férias. O IRRF das
 *   férias é tributado em separado no pagamento (RIR/2018, art. 682) e fica fora da base mensal;
 *   simplificação: o recibo de férias deste módulo não retém INSS/IRRF.
 */
export function computePayslip(i: PayslipInput, t: TaxTables): Payslip {
  const daily = i.salary / 30;
  const contractDays = Math.min(Math.max(i.daysWorked, 0), 30);
  const inssLeaveDays = Math.min(i.inssLeaveDays ?? 0, contractDays);
  const maternityDays = Math.min(i.maternityDays ?? 0, contractDays - inssLeaveDays);
  const vacationDays = Math.min(i.vacationDays ?? 0, contractDays - inssLeaveDays - maternityDays);
  const salaryDays = contractDays - inssLeaveDays - maternityDays - vacationDays;
  const baseSalary = round2(daily * salaryDays);
  const maternity = round2(daily * maternityDays);
  const vacation = round2(daily * vacationDays * (4 / 3));
  const hourly = i.salary / (i.weeklyHours * 5);
  const overtime = round2(hourly * 1.5 * i.overtime50Hours + hourly * 2 * i.overtime100Hours);
  const commissions = round2(i.commissions ?? 0);
  const dsr = i.workingDays && i.restDays ? round2(((overtime + commissions) / i.workingDays) * i.restDays) : 0;
  const absenceDeduction = round2(daily * ((i.absences ?? 0) + (i.dsrLostDays ?? 0)));
  const earnings = round2(baseSalary + maternity + vacation + overtime + commissions + dsr + i.otherEarnings);
  const gross = round2(Math.max(0, earnings - absenceDeduction));
  const inssValue = inss(gross, t);
  // IRRF do mês sem as férias (tributadas em separado); o INSS deduzido é proporcional.
  const taxable = round2(Math.max(0, gross - vacation));
  const inssShare = gross > 0 ? round2((inssValue * taxable) / gross) : 0;
  const ir = irrf(taxable, inssShare, i.dependents, t);
  const net = round2(gross - vacation - inssValue - ir.tax - i.otherDeductions);
  const fgtsRate = fgtsRateOf(t, i.apprentice);
  return {
    baseSalary,
    overtime,
    gross,
    inss: inssValue,
    irrf: ir.tax,
    irrfBase: ir.base,
    irrfReduction: ir.reduction,
    otherDeductions: round2(i.otherDeductions),
    net,
    fgts: round2(gross * fgtsRate),
    salaryDays,
    commissions,
    dsr,
    maternity,
    maternityDays,
    inssLeaveDays,
    vacationDays,
    vacation,
    absenceDeduction,
    variablePay: round2(overtime + commissions + dsr),
    earnings,
    fgtsRate,
  };
}

// ---- 13º salário ----------------------------------------------------------------------------------

/**
 * Avos do 13º no ano: cada mês com 15 dias ou mais de trabalho conta inteiro (Lei 4.090/62,
 * art. 1º §2º). Dias pagos pelo INSS (doença após o 15º dia) não contam como trabalhados;
 * licença-maternidade conta (a empresa paga e compensa). `end` é o último dia considerado
 * (31/12, data de saída ou fim do aviso indenizado projetado).
 * Simplificação: não desconta o avo de meses com mais de 15 faltas injustificadas.
 */
export function thirteenthAvos(year: number, admission: string, end: string, leaves: LeaveSpan[] = [], companyDays = 15): number {
  let avos = 0;
  for (let m = 1; m <= 12; m++) {
    const mStart = `${year}-${String(m).padStart(2, '0')}-01`;
    const mEnd = isoMonthEnd(mStart);
    const from = maxIso(admission, mStart);
    const to = minIso(end, mEnd);
    if (from > to) continue;
    const worked = isoDaysInclusive(from, to) - leaveDaysBetween(leaves, from, to, companyDays).inssDays;
    if (worked >= 15) avos++;
  }
  return avos;
}

export interface ThirteenthInput {
  salary: number;
  /** Média mensal das variáveis do ano (horas extras, comissões, DSR). */
  variableAverage: number;
  avos: number;
  dependents: number;
  /** 1ª parcela já paga (descontada na 2ª). */
  advance: number;
  apprentice?: boolean;
}

/**
 * 1ª parcela (até 30/11, Lei 4.749/65, art. 2º): metade de (salário + média) ÷ 12 × avos, sem
 * INSS nem IRRF; FGTS sobre o valor pago. Para quem trabalha o ano todo dá metade do salário;
 * para admitidos no ano, os avos são contados até dezembro (projetados).
 *
 * 2ª parcela (até 20/12): 13º integral = (salário + média) ÷ 12 × avos; INSS calculado em
 * separado do salário do mês (Decreto 3.048/99, art. 214 §7º) e IRRF em separado, tributação
 * exclusiva (Lei 7.713/88, art. 26); desconta a 1ª parcela. FGTS sobre o valor desta parcela
 * (integral − adiantamento), de modo que as duas somam o percentual do 13º inteiro.
 */
export function computeThirteenth(installment: 1 | 2, i: ThirteenthInput, t: TaxTables): Payslip {
  const fgtsRate = fgtsRateOf(t, i.apprentice);
  const monthly = i.salary + i.variableAverage;
  const full = round2((monthly / 12) * i.avos);
  const common = { overtime: 0, otherDeductions: 0, installment, avos: i.avos, variableAverage: round2(i.variableAverage), fgtsRate, thirteenthFull: full };
  if (installment === 1) {
    const gross = round2((monthly / 12) * i.avos * 0.5);
    return { ...common, baseSalary: gross, gross, inss: 0, irrf: 0, irrfBase: 0, irrfReduction: 0, net: gross, fgts: round2(gross * fgtsRate), advance: 0, earnings: gross };
  }
  const inssValue = inss(full, t);
  const ir = irrf(full, inssValue, i.dependents, t, t.thirteenthIrrf);
  const advance = round2(Math.min(i.advance, full));
  const net = round2(full - inssValue - ir.tax - advance);
  return {
    ...common,
    baseSalary: full,
    gross: full,
    inss: inssValue,
    irrf: ir.tax,
    irrfBase: ir.base,
    irrfReduction: ir.reduction,
    net,
    fgts: round2((full - advance) * fgtsRate),
    advance,
    earnings: full,
  };
}

// ---- Férias ---------------------------------------------------------------------------------------

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

/** Períodos aquisitivos desde a admissão (12 meses cada), com o saldo de dias de cada um. */
export function acquisitionPeriods(admission: string, today: string, used: { periodStart: string; days: number }[]): AcquisitionPeriod[] {
  const out: AcquisitionPeriod[] = [];
  for (let k = 0; ; k++) {
    const start = addYears(admission, k);
    if (start > today) break;
    const end = isoAddDays(addYears(admission, k + 1), -1);
    const earned = end < today;
    const usedDays = used.filter((u) => u.periodStart === start).reduce((s, u) => s + u.days, 0);
    const grantDeadline = addYears(end, 1);
    out.push({ start, end, grantDeadline, earned, usedDays, balance: earned ? Math.max(0, 30 - usedDays) : 0, overdue: earned && 30 - usedDays > 0 && grantDeadline < today });
  }
  return out;
}

/**
 * Avos de férias proporcionais de um período aquisitivo incompleto: meses completos desde o
 * início + 1 se a fração restante passar de 14 dias (CLT, art. 146, parágrafo único). Máximo 12.
 * Simplificação: não reduz pelos dias de falta (art. 130) nem zera por afastamento > 6 meses (art. 133).
 */
export function vacationAvos(periodStart: string, end: string): number {
  if (end < periodStart) return 0;
  let months = 0;
  while (months < 12 && isoAddMonths(periodStart, months + 1) <= isoAddDays(end, 1)) months++;
  if (months >= 12) return 12;
  const rest = isoDaysInclusive(isoAddMonths(periodStart, months), end);
  return Math.min(12, months + (rest > 14 ? 1 : 0));
}
