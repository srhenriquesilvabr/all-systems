import { describe, expect, it } from 'vitest';
import { consortiumInstallment, monthlyFromYearly, pricePayment, quote, sacSchedule, yearlyFromMonthly } from './finance-math';

describe('matemática de financiamento', () => {
  it('Price: parcela fixa conhecida', () => {
    // R$ 50.000 a 1,5% a.m. em 48x = R$ 1.468,75 (tabela Price).
    expect(pricePayment(50_000, 0.015, 48)).toBeCloseTo(1468.75, 2);
    expect(pricePayment(1200, 0, 12)).toBe(100);
  });

  it('SAC: amortização constante e juros sobre o saldo', () => {
    const s = sacSchedule(300_000, 0.01, 360);
    expect(s.first).toBeCloseTo(833.33 + 3000, 2);
    expect(s.last).toBeCloseTo(833.33 * 1.01, 1);
    expect(s.total).toBeCloseTo(300_000 + 300_000 * 0.01 * 180.5, 0);
  });

  it('taxas equivalentes', () => {
    expect(yearlyFromMonthly(0.01)).toBeCloseTo(0.126825, 5);
    expect(monthlyFromYearly(yearlyFromMonthly(0.0189))).toBeCloseTo(0.0189, 10);
  });

  it('CET fica acima da taxa quando há tarifa e IOF', () => {
    const q = quote({ amount: 50_000, termMonths: 48, monthlyRate: 0.015, system: 'price', tac: 800, iof: true });
    expect(q.fees.iof).toBeCloseTo(50_000 * (0.0038 + 0.000082 * 365), 2);
    expect(q.cetYearly).toBeGreaterThan(q.yearlyRate);
    const plain = quote({ amount: 50_000, termMonths: 48, monthlyRate: 0.015, system: 'price' });
    expect(plain.cetYearly).toBeCloseTo(plain.yearlyRate, 6);
  });

  it('consórcio: sem juros', () => {
    // Carta de R$ 100.000, 80 meses, 16% de taxa de administração e 2% de fundo de reserva.
    expect(consortiumInstallment(100_000, 80, 16, 2)).toBe(1475);
  });
});
