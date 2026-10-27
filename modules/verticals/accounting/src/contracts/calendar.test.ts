import { describe, expect, it } from 'vitest';
import { applies, competencesFor } from './index';

describe('calendário de obrigações', () => {
  it('mensal: competência anterior vence neste mês, a atual no próximo', () => {
    expect(competencesFor({ frequency: 'monthly', dueDay: 20 }, '2026-10-22')).toEqual([
      { competence: '2026-09', dueOn: '2026-10-20' },
      { competence: '2026-10', dueOn: '2026-11-20' },
    ]);
    expect(competencesFor({ frequency: 'monthly', dueDay: 20 }, '2026-01-05')[0]).toEqual({ competence: '2025-12', dueOn: '2026-01-20' });
    expect(competencesFor({ frequency: 'monthly', dueDay: 31 }, '2026-01-05')[1]).toEqual({ competence: '2026-01', dueOn: '2026-02-28' });
  });

  it('trimestral: o trimestre fechado vence no mês seguinte', () => {
    expect(competencesFor({ frequency: 'quarterly', dueDay: 31 }, '2026-10-22')).toEqual([{ competence: '2026-T3', dueOn: '2026-10-31' }]);
    expect(competencesFor({ frequency: 'quarterly', dueDay: 31 }, '2026-02-10')).toEqual([{ competence: '2025-T4', dueOn: '2026-01-31' }]);
  });

  it('anual: o ano anterior vence no mês configurado', () => {
    expect(competencesFor({ frequency: 'annual', dueDay: 31, dueMonth: 3 }, '2026-02-01')).toEqual([{ competence: '2025', dueOn: '2026-03-31' }]);
  });

  it('regime e funcionários decidem se a obrigação se aplica', () => {
    const esocial = { regimes: ['simples', 'presumido'] as const, requiresEmployees: true };
    expect(applies({ ...esocial, regimes: [...esocial.regimes] }, { taxRegime: 'simples', hasEmployees: false })).toBe(false);
    expect(applies({ ...esocial, regimes: [...esocial.regimes] }, { taxRegime: 'simples', hasEmployees: true })).toBe(true);
    expect(applies({ regimes: ['presumido'], requiresEmployees: false }, { taxRegime: 'mei', hasEmployees: true })).toBe(false);
  });
});
