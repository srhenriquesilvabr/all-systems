import { z } from 'zod';

/** Endereço em jsonb (clientes, pessoas da equipe): { zip, street, number, complement, district, city, state }. */
export const addressInput = z
  .object({
    zip: z.string().trim().max(9).optional(),
    street: z.string().trim().max(200).optional(),
    number: z.string().trim().max(20).optional(),
    complement: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(2).optional(),
  })
  .nullish();
