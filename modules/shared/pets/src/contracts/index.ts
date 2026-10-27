import { z } from 'zod';

export const species = ['dog', 'cat', 'bird', 'rodent', 'reptile', 'other'] as const;
export type Species = (typeof species)[number];
export const speciesLabel: Record<Species, string> = {
  dog: 'Cachorro',
  cat: 'Gato',
  bird: 'Ave',
  rodent: 'Roedor',
  reptile: 'Réptil',
  other: 'Outro',
};

export const petInput = z.object({
  customerId: z.string().uuid('Escolha o tutor'),
  name: z.string().trim().min(1, 'Informe o nome').max(60),
  species: z.enum(species).default('dog'),
  breed: z.string().trim().max(60).nullish(),
  sex: z.enum(['male', 'female', 'unknown']).default('unknown'),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')).transform((v) => v || null),
  weightKg: z.coerce.number().positive().max(500).multipleOf(0.01).nullish(),
  coat: z.string().trim().max(60).nullish(),
  /** Porte (usado no banho e tosa). */
  size: z.enum(['small', 'medium', 'large', 'giant']).nullish(),
  neutered: z.boolean().default(false),
  microchip: z.string().trim().max(30).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  deceased: z.boolean().default(false),
});
export type PetInput = z.infer<typeof petInput>;

export const sizeLabel = { small: 'Pequeno', medium: 'Médio', large: 'Grande', giant: 'Gigante' } as const;

export interface Pet extends Omit<PetInput, 'deceased'> {
  id: string;
  tutor: { id: string; name: string; phone: string | null };
  deceased: boolean;
  createdAt: string;
}

/** Idade legível a partir da data de nascimento: "3 anos", "5 meses". */
export function petAge(birthDate: string | null | undefined, now = new Date()): string {
  if (!birthDate) return '';
  const [y, m, d] = birthDate.split('-').map(Number);
  let months = (now.getFullYear() - y!) * 12 + (now.getMonth() + 1 - m!);
  if (now.getDate() < d!) months--;
  if (months < 1) return 'menos de 1 mês';
  if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'ano' : 'anos'}`;
}
