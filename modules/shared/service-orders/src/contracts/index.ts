import { z } from 'zod';

// Contratos compartilhados entre a API e as telas (src/web).

export const paymentMethods = ['cash', 'pix', 'credit_card', 'debit_card', 'transfer', 'other'] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  transfer: 'Transferência',
  other: 'Outro',
};

export const paymentStatusLabel = { pending: 'A pagar', partial: 'Pago em parte', paid: 'Pago' } as const;

export const orderItemInput = z.object({
  description: z.string().trim().min(1, 'Descreva o item').max(200),
  quantity: z.coerce.number().positive('Quantidade inválida').max(100_000).multipleOf(0.001),
  unitPrice: z.coerce.number().min(0, 'Preço inválido').max(1_000_000).multipleOf(0.01, 'Use no máximo 2 casas decimais'),
  refType: z.string().max(50).nullish(),
  refId: z.string().max(100).nullish(),
});
export type OrderItemInput = z.infer<typeof orderItemInput>;

export const createOrderInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  workflow: z.string().max(50).default('default'),
  channel: z.enum(['counter', 'online', 'pos', 'whatsapp', 'phone']).default('counter'),
  items: z.array(orderItemInput).min(1, 'Inclua ao menos um item').max(200),
  discount: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01).default(0),
  dueAt: z.coerce.date().nullish(),
  notesCustomer: z.string().trim().max(2000).nullish(),
  notesInternal: z.string().trim().max(2000).nullish(),
});
export type CreateOrderInput = z.infer<typeof createOrderInput>;

export const updateOrderInput = createOrderInput.pick({ items: true, discount: true, dueAt: true, notesCustomer: true, notesInternal: true }).partial();
export type UpdateOrderInput = z.infer<typeof updateOrderInput>;

export const transitionInput = z.object({ to: z.string().min(1), reason: z.string().trim().max(500).nullish() });

export const paymentInput = z.object({
  amount: z.coerce.number().positive('Informe o valor').max(1_000_000).multipleOf(0.01),
  method: z.enum(paymentMethods),
  accountId: z.string().uuid('Escolha a conta'),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
});
export type PaymentInput = z.infer<typeof paymentInput>;

export type Tone = 'neutral' | 'brand' | 'warning' | 'success' | 'danger';

export interface WorkflowStatus {
  key: string;
  label: string;
  tone: Tone;
  /** Ordem encerrada: não aceita mais edição de itens. */
  terminal?: boolean;
  /** Status de cancelamento: zera o "a receber" no financeiro. */
  cancelled?: boolean;
}

/** Fluxo de status de uma ordem. Cada vertical registra o seu (ex.: lavanderia com etapas de produção). */
export interface ServiceOrderWorkflow {
  key: string;
  label: string;
  /** Módulo dono do fluxo: só aparece para tenants com ele ativo. */
  moduleKey: string;
  /** Ordens deste fluxo são abertas pela tela/endpoint da vertical (que grava dados extras), não pelo genérico. */
  customCreate?: boolean;
  /** Telas da vertical para a ordem (`:id` é substituído). Sem isso, usa as telas genéricas. */
  detailPath?: string;
  newPath?: string;
  statuses: WorkflowStatus[];
  initial: string;
  transitions: Record<string, string[]>;
  /** Status → template de notificação enviado ao cliente ao entrar nele. */
  notify?: Record<string, string>;
  /**
   * Só no servidor (some ao virar JSON): a vertical pode vetar uma mudança de status lançando um erro.
   * `tx` é a transação do Drizzle em andamento.
   */
  beforeTransition?: (ctx: { tx: unknown; orderId: string; from: string; to: string }) => Promise<void>;
}

export interface OrderSummary {
  id: string;
  number: number;
  workflow: string;
  status: string;
  channel: string;
  customer: { id: string; name: string };
  total: number;
  paidAmount: number;
  paymentStatus: keyof typeof paymentStatusLabel;
  dueAt: string | null;
  createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  subtotal: number;
  discount: number;
  notesCustomer: string | null;
  notesInternal: string | null;
  closedAt: string | null;
  cancelReason: string | null;
  customer: { id: string; name: string; email: string | null; phone: string | null };
  items: { id: string; description: string; quantity: number; unitPrice: number; total: number }[];
  payments: { id: string; amount: number; method: PaymentMethod; paidAt: string; createdAt: string }[];
  history: { id: string; from: string | null; to: string; reason: string | null; userName: string | null; createdAt: string }[];
}
