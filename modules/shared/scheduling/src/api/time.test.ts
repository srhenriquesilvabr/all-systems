import { describe, expect, it } from 'vitest';
import { freeSlots, localToUtc, utcToLocal, weekdayOf } from './time';

describe('horários da agenda', () => {
  it('converte hora local de São Paulo para UTC e volta', () => {
    const d = localToUtc('2026-10-22', '09:30');
    expect(d.toISOString()).toBe('2026-10-22T12:30:00.000Z');
    expect(utcToLocal(d)).toEqual({ date: '2026-10-22', time: '09:30' });
  });

  it('dia da semana da data local', () => {
    expect(weekdayOf('2026-10-25')).toBe(0); // domingo
    expect(weekdayOf('2026-10-22')).toBe(4); // quinta
  });

  it('respeita expediente, pausa, atendimentos e antecedência', () => {
    const slots = freeSlots({
      date: '2026-10-22',
      hours: [
        { start: '13:00', end: '15:00' },
        { start: '09:00', end: '12:00' },
      ],
      busy: [{ start: localToUtc('2026-10-22', '10:00'), end: localToUtc('2026-10-22', '10:45') }],
      durationMin: 60,
      stepMin: 30,
      notBefore: localToUtc('2026-10-22', '09:15'),
    });
    // 09:00 é antes da antecedência; 09:30 e 10:00/10:30 batem no atendimento das 10h; 11:30 não cabe até 12h.
    expect(slots).toEqual(['11:00', '13:00', '13:30', '14:00']);
  });
});
