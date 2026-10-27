import { sql } from 'drizzle-orm';

/** Dia (YYYY-MM-DD) de um momento no fuso do negócio. */
export const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
/** Início do dia (fuso do negócio) como timestamp, para filtrar colunas timestamptz. */
export const dayStart = (date: string) => sql`(${date}::date)::timestamp at time zone 'America/Sao_Paulo'`;
/** Início do dia seguinte (limite exclusivo). */
export const dayEnd = (date: string) => sql`((${date}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;
