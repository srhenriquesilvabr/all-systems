import { describe, expect, it } from 'vitest';
import { acquisitionPeriods, commercialDays, computePayslip, computeThirteenth, inss, irrf, monthCalendar, taxTables, thirteenthAvos, vacationAvos, vacationPay } from './payroll';
import { computeTermination, noticeDaysFor, type TerminationCalcInput } from './termination';

const t = taxTables.parse({});

describe('folha de pagamento', () => {
  it('INSS progressivo por faixa, com teto', () => {
    expect(inss(1518, t)).toBe(113.85);
    // 1.518 × 7,5% + 1.275,88 × 9% + 206,12 × 12%
    expect(inss(3000, t)).toBe(253.41);
    expect(inss(20_000, t)).toBe(inss(8157.41, t));
  });

  it('IRRF: desconto simplificado quando é melhor, e isenção até R$ 5.000 pela redução', () => {
    expect(irrf(3000, inss(3000, t), 0, t)).toMatchObject({ tax: 0, usedSimplified: true });
    // R$ 5.000: base 4.392,80 (simplificado) → 312,89 de imposto, zerado pela redução.
    expect(irrf(5000, inss(5000, t), 0, t)).toMatchObject({ base: 4392.8, tax: 0, reduction: 312.89 });
  });

  it('IRRF: redução parcial entre R$ 5.000 e R$ 7.350, e nenhuma acima', () => {
    // R$ 6.000: INSS 649,60 > simplificado; base 5.350,40 → 562,63; redução 978,62 − 0,133145 × 6.000 = 179,75.
    const r = irrf(6000, inss(6000, t), 0, t);
    expect(inss(6000, t)).toBe(649.6);
    expect(r).toMatchObject({ base: 5350.4, reduction: 179.75, tax: 382.88 });
    const high = irrf(10_000, inss(10_000, t), 1, t);
    expect(high.reduction).toBe(0);
  });

  it('holerite: proporcional aos dias, hora extra pela jornada, FGTS da empresa', () => {
    const p = computePayslip({ salary: 2200, weeklyHours: 44, daysWorked: 30, overtime50Hours: 10, overtime100Hours: 0, otherEarnings: 0, otherDeductions: 50, dependents: 0 }, t);
    // Hora = 2.200 / 220 = 10; 10h a 50% = 150.
    expect(p).toMatchObject({ baseSalary: 2200, overtime: 150, gross: 2350, fgts: 188 });
    expect(p.net).toBe(Math.round((2350 - p.inss - p.irrf - 50) * 100) / 100);
    expect(computePayslip({ salary: 3000, weeklyHours: 44, daysWorked: 15, overtime50Hours: 0, overtime100Hours: 0, otherEarnings: 0, otherDeductions: 0, dependents: 0 }, t).baseSalary).toBe(1500);
  });

  it('férias com 1/3 e períodos aquisitivos', () => {
    expect(vacationPay(3000, 20, 10)).toEqual({ vacation: 2666.67, allowance: 1333.33 });
    const periods = acquisitionPeriods('2023-03-10', '2026-10-22', [{ periodStart: '2023-03-10', days: 30 }, { periodStart: '2024-03-10', days: 20 }]);
    expect(periods.map((p) => [p.start, p.earned, p.balance, p.overdue])).toEqual([
      ['2023-03-10', true, 0, false],
      ['2024-03-10', true, 10, true], // prazo de concessão acabou em 09/03/2026 com 10 dias pendentes
      ['2025-03-10', true, 30, false],
      ['2026-03-10', false, 0, false],
    ]);
    expect(acquisitionPeriods('2023-03-10', '2026-10-22', [])[0]).toMatchObject({ overdue: true, grantDeadline: '2025-03-09' });
  });

  it('DSR sobre horas extras, faltas com DSR perdido e FGTS do aprendiz', () => {
    // Nov/2025: 5 domingos + 1 feriado = 6 de repouso; 24 úteis.
    const cal = monthCalendar('2025-11', 1);
    expect(cal).toMatchObject({ restDays: 6, workingDays: 24 });
    const base = { salary: 2200, weeklyHours: 44, daysWorked: 30, overtime50Hours: 10, overtime100Hours: 0, otherEarnings: 0, otherDeductions: 0, dependents: 0, ...cal };
    expect(computePayslip(base, t)).toMatchObject({ overtime: 150, dsr: 37.5, gross: 2387.5, fgts: 191 });
    expect(computePayslip({ ...base, salary: 3000, overtime50Hours: 0, absences: 2, dsrLostDays: 1 }, t)).toMatchObject({ absenceDeduction: 300, gross: 2700 });
    expect(computePayslip({ ...base, salary: 1500, overtime50Hours: 0, apprentice: true }, t).fgts).toBe(30);
    expect(computePayslip({ ...base, salary: 3000, overtime50Hours: 0, inssLeaveDays: 15 }, t).baseSalary).toBe(1500);
    expect([commercialDays('2025-02-01', '2025-02-28'), commercialDays('2025-01-16', '2025-01-31')]).toEqual([30, 15]);
  });

  it('13º: avos com 15 dias e parcelas', () => {
    expect(thirteenthAvos(2025, '2025-04-10', '2025-12-31')).toBe(9);
    expect(thirteenthAvos(2025, '2025-04-17', '2025-12-31')).toBe(8); // abril com 14 dias não conta
    expect(computeThirteenth(1, { salary: 2400, variableAverage: 0, avos: 9, dependents: 0, advance: 0 }, t)).toMatchObject({ gross: 900, fgts: 72 });
    expect(computeThirteenth(2, { salary: 3000, variableAverage: 0, avos: 12, dependents: 0, advance: 1500 }, t)).toMatchObject({ gross: 3000, inss: 253.41, irrf: 0, net: 1246.59, fgts: 120 });
  });

  it('rescisão: aviso proporcional, avos de férias e verbas', () => {
    expect([0, 1, 3, 20, 25].map((y) => noticeDaysFor(y, t))).toEqual([30, 33, 39, 90, 90]);
    expect([vacationAvos('2025-03-01', '2025-07-18'), vacationAvos('2025-03-01', '2025-07-14')]).toEqual([5, 4]);
    const common: Omit<TerminationCalcInput, 'type' | 'notice'> = {
      admissionDate: '2024-03-01', terminationDate: '2025-06-15', salary: 3000, variableAverage: 0, dependents: 0, apprentice: false, experienceEnd: null,
      vacationsUsed: [], leaves: [], thirteenthAdvance: 0, thirteenthPaid: false, salaryAlreadyPaid: false, fgtsBalance: 4000, fgtsBalanceSource: 'informed', otherEarnings: 0, otherDeductions: 0,
    };
    const sem = computeTermination({ ...common, type: 'without_cause', notice: 'indemnified' }, t);
    expect(sem).toMatchObject({ noticeDays: 33, projectedEnd: '2025-07-18', earnings: 12216.67, net: 11969.44 });
    expect(sem.fgts).toMatchObject({ deposit: 524, fine: 1809.6 });
    // Justa causa: só saldo e férias vencidas + 1/3; sem 13º, proporcionais nem multa.
    const justa = computeTermination({ ...common, type: 'just_cause', notice: 'none' }, t);
    expect(justa.lines.filter((l) => l.kind === 'earning').map((l) => [l.code, l.amount])).toEqual([['50', 1500], ['66', 3000], ['68', 1000]]);
    expect(justa.fgts.fine).toBe(0);
    // Acordo: aviso indenizado pela metade e multa de 20%.
    const acordo = computeTermination({ ...common, type: 'agreement', notice: 'indemnified' }, t);
    expect(acordo.lines.find((l) => l.code === '69')?.amount).toBe(1650);
    expect(acordo.fgts.fineRate).toBe(0.2);
  });
});
