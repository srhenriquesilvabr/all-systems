// Horários da agenda no fuso da empresa. Por enquanto, todas em São Paulo: UTC−3 fixo
// (sem horário de verão desde 2019). Fuso por empresa entra quando houver clientes fora dele.
export const TIME_ZONE = 'America/Sao_Paulo';
const OFFSET = '-03:00';

/** "2026-10-22" + "14:30" (hora local) → instante UTC. */
export const localToUtc = (date: string, time: string) => new Date(`${date}T${time}:00${OFFSET}`);

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });

/** Instante → data e hora locais ("2026-10-22", "14:30"). */
export const utcToLocal = (d: Date) => ({ date: dateFmt.format(d), time: timeFmt.format(d) });

/** Dia da semana (0 = domingo) de uma data local. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export const addMinutes = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface Interval {
  start: Date;
  end: Date;
}

/**
 * Horários livres (HH:MM locais) para um atendimento de `durationMin` num dia: dentro do
 * expediente, sem encostar em atendimentos/bloqueios e não antes de `notBefore`.
 */
export function freeSlots(opts: {
  date: string;
  hours: { start: string; end: string }[];
  busy: Interval[];
  durationMin: number;
  stepMin: number;
  notBefore: Date;
}): string[] {
  const slots: string[] = [];
  for (const window of [...opts.hours].sort((a, b) => a.start.localeCompare(b.start))) {
    const endMin = toMinutes(window.end);
    for (let t = toMinutes(window.start); t + opts.durationMin <= endMin; t += opts.stepMin) {
      const start = localToUtc(opts.date, toHhmm(t));
      const end = addMinutes(start, opts.durationMin);
      if (start < opts.notBefore) continue;
      if (opts.busy.some((b) => b.start < end && b.end > start)) continue;
      slots.push(toHhmm(t));
    }
  }
  return slots;
}
