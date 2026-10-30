import type { OrderDetail, ServiceOrderWorkflow } from '@all/service-orders';
import { z } from 'zod';

export const BAKERY_WORKFLOW = 'bakery';

/** Encomendas (bolos, salgados para festa…): da encomenda à retirada, com aviso de "pronta". */
export const bakeryWorkflow: ServiceOrderWorkflow = {
  key: BAKERY_WORKFLOW,
  label: 'Encomendas da padaria',
  moduleKey: 'bakery',
  customCreate: true,
  detailPath: '/padaria/encomendas/:id',
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

const spToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Mesma regra da ordem de serviço: 'YYYY-MM-DD' (hoje = agora; outro dia = meio-dia em SP) ou data e hora; nunca no futuro. */
const receivedAtInput = z
  .string()
  .trim()
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? (v === spToday() ? new Date() : new Date(`${v}T12:00:00-03:00`)) : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), 'Data do pedido inválida')
  .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'A data do pedido não pode ser no futuro');

export const bakeryOrderInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  /** Retirada (data e hora). */
  dueAt: z.coerce.date({ errorMap: () => ({ message: 'Informe a data de retirada' }) }),
  /** Quando a encomenda foi feita. Sem data, é agora; data passada registra uma encomenda antiga. */
  receivedAt: receivedAtInput.optional(),
  items: z
    .array(
      z.object({
        /** Produto do catálogo, ou nulo para item sob medida ("Bolo de aniversário 2 kg, recheio de brigadeiro"). */
        productId: z.string().uuid().nullish(),
        description: z.string().trim().min(1, 'Descreva o item').max(200),
        quantity: z.coerce.number().positive().max(100_000).multipleOf(0.001),
        unitPrice: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01),
        /** O que escrever no bolo. */
        inscription: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1, 'Inclua ao menos um item')
    .max(100),
  discount: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01).default(0),
  notesCustomer: z.string().trim().max(2000).nullish(),
  notesInternal: z.string().trim().max(2000).nullish(),
});
export type BakeryOrderInput = z.infer<typeof bakeryOrderInput>;

/** Depois de registrada: retirada, observações e escrita de cada item. Itens e valores não mudam por aqui. */
export const bakeryOrderUpdate = z.object({
  dueAt: z.coerce.date({ errorMap: () => ({ message: 'Informe a data de retirada' }) }).optional(),
  notesCustomer: z.string().trim().max(2000).nullish(),
  notesInternal: z.string().trim().max(2000).nullish(),
  inscriptions: z.array(z.object({ itemId: z.string().uuid(), inscription: z.string().trim().max(200).nullable() })).max(100).optional(),
});
export type BakeryOrderUpdate = z.infer<typeof bakeryOrderUpdate>;

/** Pagamento da encomenda. Com `registerId`, entra na conferência do caixa, sem novo lançamento no financeiro. */
export const bakeryPaymentInput = z.object({
  amount: z.coerce.number().positive('Informe o valor').max(1_000_000).multipleOf(0.01),
  method: z.enum(['cash', 'pix', 'credit_card', 'debit_card', 'transfer', 'other']),
  /** Sem conta, a conta Caixa. Dinheiro que entra num caixa aberto vai sempre para a conta Caixa. */
  accountId: z.string().uuid().nullish(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  registerId: z.string().uuid().nullish(),
});
export type BakeryPaymentInput = z.infer<typeof bakeryPaymentInput>;

/** Encomenda com o que é próprio da padaria em cada item. */
export interface BakeryOrder {
  order: OrderDetail;
  items: { id: string; inscription: string | null; productId: string | null; stockMovedAt: string | null }[];
}

/** O que produzir num dia: encomendas a retirar e os itens somados. */
export interface ProductionPlan {
  date: string;
  orders: { id: string; number: number; status: string; customer: string; dueAt: string; items: { description: string; quantity: number; inscription: string | null }[]; notes: string | null }[];
  /** Só o que ainda falta fazer: encomendas prontas ficam na lista, mas fora da soma. */
  totals: { description: string; quantity: number }[];
}

/** Texto comparável: sem acento, sem diferença de maiúsculas e espaços extras. */
export const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
