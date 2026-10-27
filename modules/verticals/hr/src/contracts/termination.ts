import {
  acquisitionPeriods,
  fgtsRateOf,
  fullYearsBetween,
  inss,
  irrf,
  isoAddDays,
  isoDaysInclusive,
  isoMonthEnd,
  round2,
  thirteenthAvos,
  vacationAvos,
  type LeaveSpan,
  type TaxTables,
} from './payroll';

export const terminationTypes = ['without_cause', 'resignation', 'just_cause', 'experience_end', 'agreement'] as const;
export type TerminationType = (typeof terminationTypes)[number];
export const terminationTypeLabel: Record<TerminationType, string> = {
  without_cause: 'Dispensa sem justa causa',
  resignation: 'Pedido de demissão',
  just_cause: 'Dispensa por justa causa',
  experience_end: 'Término do contrato de experiência',
  agreement: 'Acordo entre as partes (art. 484-A)',
};

export const noticeTypes = ['indemnified', 'worked', 'waived', 'deducted', 'none'] as const;
export type NoticeType = (typeof noticeTypes)[number];
export const noticeTypeLabel: Record<NoticeType, string> = {
  indemnified: 'Indenizado',
  worked: 'Trabalhado',
  waived: 'Dispensado pela empresa',
  deducted: 'Não cumprido (descontado)',
  none: 'Sem aviso prévio',
};
/** Formas de aviso possíveis em cada tipo de rescisão. */
export const noticeOptions: Record<TerminationType, NoticeType[]> = {
  without_cause: ['indemnified', 'worked'],
  resignation: ['worked', 'waived', 'deducted'],
  just_cause: ['none'],
  experience_end: ['none'],
  agreement: ['indemnified', 'worked'],
};

export interface TerminationCalcInput {
  type: TerminationType;
  notice: NoticeType;
  admissionDate: string;
  /** Último dia trabalhado (data de afastamento). */
  terminationDate: string;
  salary: number;
  /** Média mensal das variáveis (horas extras, comissões, DSR). */
  variableAverage: number;
  dependents: number;
  apprentice: boolean;
  /** Fim do contrato de experiência, se houver. */
  experienceEnd: string | null;
  /** Férias já gozadas/marcadas por período aquisitivo (dias gozados + vendidos). */
  vacationsUsed: { periodStart: string; days: number }[];
  leaves: LeaveSpan[];
  /** 1ª parcela do 13º paga no ano da saída. */
  thirteenthAdvance: number;
  /** 13º do ano da saída já pago inteiro (folha da 2ª parcela fechada). */
  thirteenthPaid: boolean;
  /** Saldo de salário já pago na folha mensal fechada do mês da saída. */
  salaryAlreadyPaid: boolean;
  fgtsBalance: number;
  fgtsBalanceSource: 'informed' | 'estimated';
  otherEarnings: number;
  otherDeductions: number;
}

export interface TerminationLine {
  code: string;
  label: string;
  reference: string;
  kind: 'earning' | 'deduction';
  amount: number;
  /** Incidências: INSS (mensal ou 13º), IRRF (mensal, 13º ou isento), FGTS. */
  inss: 'salary' | 'thirteenth' | null;
  irrf: 'salary' | 'thirteenth' | null;
  fgts: boolean;
}

export interface TerminationStatement {
  type: TerminationType;
  notice: NoticeType;
  admissionDate: string;
  terminationDate: string;
  /** Data de saída projetada pelo aviso prévio indenizado (CLT, art. 487 §1º; OJ 82 SDI-1). */
  projectedEnd: string;
  yearsOfService: number;
  /** Dias de aviso a que o empregado tem direito (Lei 12.506/2011). */
  noticeDays: number;
  /** Dias de aviso pagos como indenização. */
  noticeDaysIndemnified: number;
  /** Dias do saldo de salário (0 se já pago na folha mensal). */
  salaryDays: number;
  salary: number;
  variableAverage: number;
  /** Remuneração usada no aviso, 13º e férias (salário + média das variáveis). */
  remuneration: number;
  thirteenthAvos: number;
  vacationAvos: number;
  lines: TerminationLine[];
  earnings: number;
  deductions: number;
  net: number;
  bases: { inssSalary: number; inssThirteenth: number; irrfSalary: number; irrfThirteenth: number; fgts: number };
  taxes: { inssSalary: number; inssThirteenth: number; irrfSalary: number; irrfThirteenth: number };
  fgts: {
    rate: number;
    /** FGTS do mês da rescisão, aviso indenizado e 13º (depósito rescisório). */
    deposit: number;
    balance: number;
    balanceSource: 'informed' | 'estimated';
    fineRate: number;
    /** Multa rescisória sobre saldo + depósito rescisório. */
    fine: number;
    /** Guia do FGTS rescisório (depósito + multa). */
    total: number;
  };
  /** Prazo de pagamento: 10 dias do término do contrato (CLT, art. 477 §6º). */
  payBy: string;
  warnings: string[];
}

export function noticeDaysFor(years: number, t: TaxTables) {
  return Math.min(t.noticeDays.max, t.noticeDays.base + t.noticeDays.perYear * years);
}

/**
 * Termo de rescisão (cálculo). Regras principais:
 * - Saldo de salário: dias do mês até a saída (mês cheio = 30).
 * - Aviso prévio: 30 dias + 3 por ano completo, até 90 (Lei 12.506/2011), só a favor do
 *   empregado; no pedido de demissão são 30 dias. Indenizado: pago sobre a remuneração (com
 *   médias) e projeta a saída para 13º e férias. Trabalhado: os 30 dias já estão no saldo de
 *   salário; os dias além de 30 são indenizados (Nota Técnica MTE 184/2012). No acordo, o aviso
 *   indenizado é pago pela metade (art. 484-A, I, a). No pedido de demissão sem cumprir o aviso,
 *   a empresa desconta 30 dias (art. 487 §2º).
 * - Experiência rompida antes do termo pela empresa: indenização do art. 479 (metade dos dias
 *   restantes), sem aviso prévio (sem cláusula assecuratória, art. 481), mais a multa do FGTS.
 * - 13º proporcional: avos até a saída projetada; não é devido na justa causa (Lei 4.090, art. 3º),
 *   caso em que a 1ª parcela paga é descontada. A 1ª parcela paga no ano é abatida.
 * - Férias: vencidas (em dobro se passou o prazo de concessão, art. 137) e proporcionais (art.
 *   146; devidas também no pedido de demissão com menos de 1 ano, Súmula 261 TST), sempre com
 *   1/3. Na justa causa, só as vencidas (Súmula 171 TST).
 * - INSS: saldo de salário (e outros proventos) e 13º, em separado; não incide sobre aviso
 *   indenizado, férias indenizadas + 1/3 e indenização do art. 479 (Lei 8.212, art. 28 §9º).
 * - IRRF: mensal sobre o saldo; 13º em separado; aviso indenizado, férias indenizadas e
 *   indenizações são isentos (Lei 7.713, art. 6º V; Súmula 386 STJ).
 * - FGTS rescisório: sobre saldo, aviso (Súmula 305 TST) e 13º; não sobre férias indenizadas
 *   (OJ 195 SDI-1). Multa de 40% (sem justa causa) ou 20% (acordo) sobre saldo + depósito.
 * Simplificações: INSS do saldo calculado sozinho (sem somar ao que já saiu na folha do mês);
 * contribuições patronais fora; compensação limitada a 1 salário (art. 477 §5º) vira só aviso.
 */
export function computeTermination(i: TerminationCalcInput, t: TaxTables): TerminationStatement {
  const warnings: string[] = [];
  const daily = i.salary / 30;
  const remuneration = round2(i.salary + i.variableAverage);
  const remDaily = remuneration / 30;
  const years = fullYearsBetween(i.admissionDate, i.terminationDate);
  const lines: TerminationLine[] = [];
  const add = (l: Omit<TerminationLine, 'amount'> & { amount: number }) => {
    const amount = round2(l.amount);
    if (amount > 0) lines.push({ ...l, amount });
  };

  // Aviso prévio
  const earlyExperience = i.type === 'without_cause' && !!i.experienceEnd && i.terminationDate < i.experienceEnd;
  let noticeDays = 0;
  if (i.type === 'without_cause' || i.type === 'agreement') noticeDays = noticeDaysFor(years, t);
  else if (i.type === 'resignation') noticeDays = t.noticeDays.base;
  if (earlyExperience) noticeDays = 0;
  let indemnifiedDays = 0;
  let projection = 0;
  if (noticeDays > 0 && (i.type === 'without_cause' || i.type === 'agreement')) {
    if (i.notice === 'indemnified') indemnifiedDays = noticeDays;
    else if (i.notice === 'worked') indemnifiedDays = Math.max(0, noticeDays - t.noticeDays.base);
    // Projeção pelos dias de aviso indenizado (no acordo, pelo período inteiro: só o valor cai pela metade).
    projection = indemnifiedDays;
  }
  const projectedEnd = isoAddDays(i.terminationDate, projection);
  if (i.type === 'experience_end' && i.experienceEnd !== i.terminationDate)
    warnings.push(
      i.experienceEnd
        ? `O contrato de experiência termina em ${i.experienceEnd.split('-').reverse().join('/')}; saída em outra data não é término do contrato (antes do termo pela empresa: dispensa sem justa causa, com a indenização do art. 479).`
        : 'O cadastro não tem a data de fim do contrato de experiência.',
    );

  // Saldo de salário
  const monthStart = `${i.terminationDate.slice(0, 7)}-01`;
  const from = i.admissionDate > monthStart ? i.admissionDate : monthStart;
  const fullMonth = from === monthStart && i.terminationDate === isoMonthEnd(monthStart);
  const salaryDays = fullMonth ? 30 : Math.min(30, isoDaysInclusive(from, i.terminationDate));
  if (i.salaryAlreadyPaid) warnings.push('O saldo de salário do mês já foi pago na folha mensal fechada e não entra no termo.');
  else add({ code: '50', label: 'Saldo de salário', reference: `${salaryDays} dias`, kind: 'earning', amount: daily * salaryDays, inss: 'salary', irrf: 'salary', fgts: true });
  add({ code: '99', label: 'Outros proventos do mês', reference: '', kind: 'earning', amount: i.otherEarnings, inss: 'salary', irrf: 'salary', fgts: true });

  if (indemnifiedDays > 0) {
    const half = i.type === 'agreement';
    add({
      code: '69',
      label: half ? 'Aviso prévio indenizado (metade, art. 484-A)' : 'Aviso prévio indenizado',
      reference: `${indemnifiedDays} dias${half ? ' ÷ 2' : ''}`,
      kind: 'earning',
      amount: remDaily * indemnifiedDays * (half ? 0.5 : 1),
      inss: null,
      irrf: null,
      fgts: true,
    });
  }
  if (earlyExperience) {
    const remaining = isoDaysInclusive(isoAddDays(i.terminationDate, 1), i.experienceEnd!);
    add({ code: '52', label: 'Indenização art. 479 (fim antecipado da experiência)', reference: `${remaining} dias ÷ 2`, kind: 'earning', amount: (daily * remaining) / 2, inss: null, irrf: null, fgts: false });
    warnings.push('Contrato de experiência rompido antes do termo: indenização do art. 479 no lugar do aviso prévio.');
  }

  // 13º proporcional
  const year = Number(i.terminationDate.slice(0, 4));
  const companyDays = t.sickLeaveCompanyDays;
  let avos13 = 0;
  if (i.type !== 'just_cause') {
    const endThisYear = projectedEnd.slice(0, 4) === String(year) ? projectedEnd : `${year}-12-31`;
    avos13 = i.thirteenthPaid ? 0 : thirteenthAvos(year, i.admissionDate, endThisYear, i.leaves, companyDays);
    // Aviso indenizado que atravessa o ano gera avos no ano seguinte.
    if (projectedEnd.slice(0, 4) !== String(year)) avos13 += thirteenthAvos(year + 1, i.admissionDate, projectedEnd, i.leaves, companyDays);
    if (i.thirteenthPaid) warnings.push(`O 13º de ${year} já foi pago inteiro; entram só os avos projetados para o ano seguinte.`);
  }
  const thirteenth = round2((remuneration / 12) * avos13);
  add({ code: '63', label: '13º salário proporcional', reference: `${avos13}/12`, kind: 'earning', amount: thirteenth, inss: 'thirteenth', irrf: 'thirteenth', fgts: true });

  // Férias
  const periods = acquisitionPeriods(i.admissionDate, projectedEnd, i.vacationsUsed);
  let vacationTotal = 0;
  for (const p of periods.filter((p) => p.earned && p.balance > 0)) {
    const value = remDaily * p.balance * (p.overdue ? 2 : 1);
    vacationTotal += round2(value);
    add({
      code: '66',
      label: p.overdue ? 'Férias vencidas em dobro (art. 137)' : 'Férias vencidas',
      reference: `${p.balance} dias · ${p.start.split('-').reverse().join('/')}`,
      kind: 'earning',
      amount: value,
      inss: null,
      irrf: null,
      fgts: false,
    });
  }
  let avosVac = 0;
  const current = periods.find((p) => !p.earned);
  if (current && i.type !== 'just_cause') {
    avosVac = vacationAvos(current.start, projectedEnd);
    const value = round2((remuneration / 12) * avosVac);
    vacationTotal += value;
    add({ code: '65', label: 'Férias proporcionais', reference: `${avosVac}/12`, kind: 'earning', amount: value, inss: null, irrf: null, fgts: false });
  }
  add({ code: '68', label: '1/3 constitucional de férias', reference: '', kind: 'earning', amount: vacationTotal / 3, inss: null, irrf: null, fgts: false });

  // Bases e impostos
  const sumBy = (pred: (l: TerminationLine) => boolean) => round2(lines.filter((l) => l.kind === 'earning' && pred(l)).reduce((s, l) => s + l.amount, 0));
  const inssSalaryBase = sumBy((l) => l.inss === 'salary');
  const inssThirteenthBase = sumBy((l) => l.inss === 'thirteenth');
  const inssSalary = inss(inssSalaryBase, t);
  const inssThirteenth = inss(inssThirteenthBase, t);
  const irSalary = irrf(sumBy((l) => l.irrf === 'salary'), inssSalary, i.dependents, t);
  const irThirteenth = irrf(sumBy((l) => l.irrf === 'thirteenth'), inssThirteenth, i.dependents, t, t.thirteenthIrrf);
  const fgtsBase = sumBy((l) => l.fgts);

  const ded = (code: string, label: string, amount: number, reference = '') => add({ code, label, reference, kind: 'deduction', amount, inss: null, irrf: null, fgts: false });
  ded('112.1', 'INSS', inssSalary);
  ded('112.2', 'INSS sobre 13º', inssThirteenth);
  ded('114.1', 'IRRF', irSalary.tax);
  ded('114.2', 'IRRF sobre 13º', irThirteenth.tax);
  if (i.thirteenthAdvance > 0 && !i.thirteenthPaid) ded('101', i.type === 'just_cause' ? 'Adiantamento de 13º (devolução)' : 'Adiantamento de 13º (1ª parcela)', i.thirteenthAdvance);
  if (i.type === 'resignation' && i.notice === 'deducted') ded('103', 'Aviso prévio não cumprido (art. 487 §2º)', daily * t.noticeDays.base, `${t.noticeDays.base} dias`);
  ded('115', 'Outros descontos', i.otherDeductions);

  const earnings = round2(lines.filter((l) => l.kind === 'earning').reduce((s, l) => s + l.amount, 0));
  const deductions = round2(lines.filter((l) => l.kind === 'deduction').reduce((s, l) => s + l.amount, 0));
  let net = round2(earnings - deductions);
  if (net < 0) {
    warnings.push('Os descontos passam dos proventos: o líquido fica zerado e a diferença não é cobrada no termo (art. 477 §5º limita a compensação).');
    net = 0;
  }

  const rate = fgtsRateOf(t, i.apprentice);
  const deposit = round2(fgtsBase * rate);
  const fineRate = i.type === 'without_cause' ? t.fgtsFineRate : i.type === 'agreement' ? t.fgtsAgreementFineRate : 0;
  const fine = round2((i.fgtsBalance + deposit) * fineRate);
  if (fineRate > 0 && i.fgtsBalanceSource === 'estimated')
    warnings.push('Saldo do FGTS estimado pela soma das folhas registradas (sem juros, correção e depósitos de antes do sistema). Informe o saldo do extrato para a multa exata.');

  return {
    type: i.type,
    notice: noticeOptions[i.type].includes(i.notice) ? i.notice : noticeOptions[i.type][0]!,
    admissionDate: i.admissionDate,
    terminationDate: i.terminationDate,
    projectedEnd,
    yearsOfService: years,
    noticeDays,
    noticeDaysIndemnified: indemnifiedDays,
    salaryDays: i.salaryAlreadyPaid ? 0 : salaryDays,
    salary: i.salary,
    variableAverage: round2(i.variableAverage),
    remuneration,
    thirteenthAvos: avos13,
    vacationAvos: avosVac,
    lines,
    earnings,
    deductions,
    net,
    bases: { inssSalary: inssSalaryBase, inssThirteenth: inssThirteenthBase, irrfSalary: irSalary.base, irrfThirteenth: irThirteenth.base, fgts: fgtsBase },
    taxes: { inssSalary, inssThirteenth, irrfSalary: irSalary.tax, irrfThirteenth: irThirteenth.tax },
    fgts: { rate, deposit, balance: round2(i.fgtsBalance), balanceSource: i.fgtsBalanceSource, fineRate, fine, total: round2(deposit + fine) },
    payBy: isoAddDays(i.terminationDate, 10),
    warnings,
  };
}
