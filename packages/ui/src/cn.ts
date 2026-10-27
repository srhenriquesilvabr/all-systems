import { twMerge } from 'tailwind-merge';

/** Junta classes; em conflito do Tailwind (ex.: duas cores de texto), vale a última. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return twMerge(classes.filter(Boolean).join(' '));
}
