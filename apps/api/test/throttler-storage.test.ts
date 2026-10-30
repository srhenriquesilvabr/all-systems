import { IsolateThrottlerStorage } from '@all/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('limite de requisições em memória', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hit = (s: IsolateThrottlerStorage, key = 'k') => s.increment(key, 60_000, 2, 30_000);

  it('conta dentro da janela e bloqueia acima do limite', async () => {
    const s = new IsolateThrottlerStorage();
    expect(await hit(s)).toMatchObject({ totalHits: 1, isBlocked: false, timeToExpire: 60, timeToBlockExpire: 0 });
    expect(await hit(s)).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(await hit(s)).toMatchObject({ totalHits: 3, isBlocked: true, timeToBlockExpire: 30 });
    // Bloqueado: tentar de novo não aumenta a contagem nem o bloqueio.
    vi.advanceTimersByTime(10_000);
    expect(await hit(s)).toMatchObject({ totalHits: 3, isBlocked: true, timeToBlockExpire: 20 });
  });

  it('libera quando o bloqueio e a janela terminam, e cada chave conta sozinha', async () => {
    const s = new IsolateThrottlerStorage();
    for (let i = 0; i < 3; i++) await hit(s);
    expect((await hit(s, 'outra')).isBlocked).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(await hit(s)).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('usa a janela como bloqueio quando não há duração própria', async () => {
    const s = new IsolateThrottlerStorage();
    await s.increment('k', 5_000, 0, 0);
    expect(await s.increment('k', 5_000, 0, 0)).toMatchObject({ isBlocked: true });
    vi.advanceTimersByTime(5_001);
    expect((await s.increment('k', 5_000, 1, 0)).isBlocked).toBe(false);
  });

  it('limpa os registros vencidos, sem timer', async () => {
    const s = new IsolateThrottlerStorage();
    await hit(s, 'velha');
    vi.advanceTimersByTime(120_000);
    await hit(s, 'nova');
    expect((s as unknown as { records: Map<string, unknown> }).records.has('velha')).toBe(false);
  });
});
