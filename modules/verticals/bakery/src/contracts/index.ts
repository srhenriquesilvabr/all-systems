import type { ServiceOrderWorkflow } from '@all/service-orders';
import { z } from 'zod';

export const BAKERY_WORKFLOW = 'bakery';

/** Encomendas (bolos, salgados para festa…): da encomenda à retirada, com aviso de "pronta". */
export const bakeryWorkflow: ServiceOrderWorkflow = {
  key: BAKERY_WORKFLOW,
  label: 'Encomendas da padaria',
  moduleKey: 'bakery',
  customCreate: true,
  newPath: '/padaria/encomendas/nova',
  initial: 'received',
  statuses: [
    { key: 'received', label: 'Encomendada', tone: 'brand' },
    { key: 'in_production', label: 'Em produção', tone: 'warning' },
    { key: 'ready', label: 'Pronta para retirar', tone: 'success' },
    { key: 'delivered', label: 'Retirada', tone: 'neutral', terminal: true },
    { key: 'cancelled', label: 'Cancelada', tone: 'danger', terminal: true, cancelled: true },
  ],
  transitions: {
    received: ['in_production', 'ready', 'cancelled'],
    in_production: ['ready', 'cancelled'],
    ready: ['delivered', 'in_production'],
    delivered: [],
    cancelled: [],
  },
  notify: { received: 'bakery.order_received', ready: 'bakery.order_ready' },
};

export const bakeryOrderInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  /** Retirada (data e hora). */
  dueAt: z.coerce.date({ errorMap: () => ({ message: 'Informe a data de retirada' }) }),
  items: z
    .array(
      z.object({
        /** Produto do catálogo, ou nulo para item sob medida ("Bolo de aniversário 2 kg, recheio de brigadeiro"). */
        productId: z.string().uuid().nullish(),
        description: z.string().trim().min(1, 'Descreva o item').max(200),
        quantity: z.coerce.number().positive().max(100_000).multipleOf(0.001),
        unitPrice: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01),
      }),
    )
    .min(1, 'Inclua ao menos um item')
    .max(100),
  discount: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01).default(0),
  notesCustomer: z.string().trim().max(2000).nullish(),
  notesInternal: z.string().trim().max(2000).nullish(),
});
export type BakeryOrderInput = z.infer<typeof bakeryOrderInput>;

/** O que produzir num dia: encomendas a retirar e os itens somados. */
export interface ProductionPlan {
  date: string;
  orders: { id: string; number: number; status: string; customer: string; dueAt: string; items: { description: string; quantity: number }[]; notes: string | null }[];
  totals: { description: string; quantity: number }[];
}
