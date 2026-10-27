import { describe, expect, it } from 'vitest';
import { acquisitionPeriods, computePayslip, inss, irrf, taxTables, vacationPay } from './payroll';

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
});
