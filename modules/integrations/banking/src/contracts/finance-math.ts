/**
 * Matemática de financiamento usada na simulação (e conferida nos testes). Taxas em fração
 * (1,89% ao mês = 0.0189). Valores em reais com centavos arredondados só na saída.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Taxa anual equivalente a uma mensal (juros compostos). */
export const yearlyFromMonthly = (i: number) => (1 + i) ** 12 - 1;
/** Taxa mensal equivalente a uma anual. */
export const monthlyFromYearly = (y: number) => (1 + y) ** (1 / 12) - 1;

/** Tabela Price: parcela fixa. */
export function pricePayment(principal: number, i: number, n: number): number {
  if (i === 0) return principal / n;
  return (principal * i) / (1 - (1 + i) ** -n);
}

/** SAC: amortização constante, parcela decrescente. */
export function sacSchedule(principal: number, i: number, n: number) {
  const amortization = principal / n;
  const payments = Array.from({ length: n }, (_, k) => amortization + (principal - amortization * k) * i);
  return { first: payments[0]!, last: payments[n - 1]!, total: payments.reduce((a, b) => a + b, 0), payments };
}

/**
 * Taxa interna de retorno mensal: a taxa que iguala o valor recebido pelo cliente ao valor
 * presente das parcelas. É a base do CET (custo efetivo total), que inclui tarifas e IOF.
 */
export function monthlyIrr(received: number, payments: number[]): number {
  const pv = (r: number) => payments.reduce((sum, p, k) => sum + p / (1 + r) ** (k + 1), 0);
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > received) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * IOF de operação de crédito para pessoa física: 0,38% fixo + 0,0082% ao dia sobre o principal,
 * com o diário limitado a 365 dias. Aproximação sobre o valor total (o cálculo oficial é por parcela).
 */
export function iofEstimate(principal: number, termMonths: number): number {
  return principal * (0.0038 + 0.000082 * Math.min(termMonths * 30, 365));
}

export interface FinancingQuote {
  system: 'price' | 'sac';
  financed: number;
  monthlyRate: number;
  yearlyRate: number;
  firstInstallment: number;
  lastInstallment: number;
  totalPaid: number;
  /** Custo efetivo total, ao ano. */
  cetYearly: number;
  fees: { iof: number; tac: number };
}

/**
 * Cotação completa. O cliente recebe `amount`; tarifa e IOF são financiados junto, então
 * entram nas parcelas e o CET fica acima da taxa nominal.
 */
export function quote(input: { amount: number; termMonths: number; monthlyRate: number; system: 'price' | 'sac'; tac?: number; iof?: boolean }): FinancingQuote {
  const tac = input.tac ?? 0;
  const iof = input.iof ? iofEstimate(input.amount, input.termMonths) : 0;
  const financed = input.amount + tac + iof;
  const i = input.monthlyRate;
  const n = input.termMonths;
  const payments = input.system === 'price' ? Array.from({ length: n }, () => pricePayment(financed, i, n)) : sacSchedule(financed, i, n).payments;
  const cetMonthly = monthlyIrr(input.amount, payments);
  return {
    system: input.system,
    financed: round2(financed),
    monthlyRate: i,
    yearlyRate: yearlyFromMonthly(i),
    firstInstallment: round2(payments[0]!),
    lastInstallment: round2(payments[n - 1]!),
    totalPaid: round2(payments.reduce((a, b) => a + b, 0)),
    cetYearly: yearlyFromMonthly(cetMonthly),
    fees: { iof: round2(iof), tac: round2(tac) },
  };
}

/** Parcela de consórcio: sem juros; crédito + taxa de administração + fundo de reserva, dividido pelo prazo. */
export function consortiumInstallment(credit: number, termMonths: number, adminFeePercent: number, reserveFundPercent: number, insurancePercent = 0): number {
  return round2((credit * (1 + (adminFeePercent + reserveFundPercent) / 100)) / termMonths + (credit * insurancePercent) / 100);
}
