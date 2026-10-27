import { z } from 'zod';

// Contratos compartilhados entre a API e as telas (src/web).

export const units = ['un', 'kg', 'g', 'l', 'ml', 'pct'] as const;
export type Unit = (typeof units)[number];
export const unitLabel: Record<Unit, string> = { un: 'Unidade', kg: 'Quilo', g: 'Grama', l: 'Litro', ml: 'Mililitro', pct: 'Pacote' };
/** Unidades vendidas em quantidade fracionada (balança). */
export const fractionalUnits: Unit[] = ['kg', 'l'];

const money = z.coerce.number().min(0, 'Valor inválido').max(1_000_000).multipleOf(0.01, 'Use no máximo 2 casas decimais');
const qty = z.coerce.number().positive('Quantidade inválida').max(100_000).multipleOf(0.001);

export const productInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  sku: z.string().trim().max(40).nullish(),
  barcode: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, 'Código de barras: de 8 a 14 dígitos')
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  category: z.string().trim().max(60).nullish(),
  unit: z.enum(units).default('un'),
  price: money,
  cost: money.nullish(),
  trackStock: z.boolean().default(true),
  minStock: z.coerce.number().min(0).max(100_000).nullish(),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productInput>;

export interface Product extends Omit<ProductInput, 'cost' | 'minStock'> {
  id: string;
  cost: number | null;
  minStock: number | null;
  stock: number;
  createdAt: string;
}

export const stockMoveKinds = ['purchase', 'production', 'loss', 'count'] as const;
export const stockMoveLabel: Record<(typeof stockMoveKinds)[number] | 'sale' | 'return', string> = {
  purchase: 'Entrada (compra)',
  production: 'Produção',
  loss: 'Perda / quebra',
  count: 'Inventário (contagem)',
  sale: 'Venda',
  return: 'Venda cancelada',
};

export const stockMoveInput = z.object({
  productId: z.string().uuid(),
  kind: z.enum(stockMoveKinds),
  /** Quantidade movimentada; no inventário, a quantidade contada. */
  quantity: z.coerce.number().min(0).max(1_000_000).multipleOf(0.001),
  unitCost: money.nullish(),
  reason: z.string().trim().max(200).nullish(),
});
export type StockMoveInput = z.infer<typeof stockMoveInput>;

export interface StockMove {
  id: string;
  kind: keyof typeof stockMoveLabel;
  quantity: number;
  balance: number;
  reason: string | null;
  userName: string | null;
  createdAt: string;
}

export const salePaymentMethods = ['cash', 'pix', 'debit_card', 'credit_card', 'on_account', 'other'] as const;
export type SalePaymentMethod = (typeof salePaymentMethods)[number];
export const salePaymentLabel: Record<SalePaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  debit_card: 'Débito',
  credit_card: 'Crédito',
  on_account: 'Fiado (a receber)',
  other: 'Outro',
};

export const saleInput = z.object({
  customerId: z.string().uuid().nullish(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: qty }))
    .min(1, 'Inclua ao menos um produto')
    .max(300),
  discount: money.default(0),
  payments: z
    .array(z.object({ method: z.enum(salePaymentMethods), amount: z.coerce.number().positive().max(1_000_000).multipleOf(0.01) }))
    .min(1, 'Informe o pagamento')
    .max(5),
  notes: z.string().trim().max(500).nullish(),
});
export type SaleInput = z.infer<typeof saleInput>;

export const cancelSaleInput = z.object({ reason: z.string().trim().min(3, 'Explique o motivo').max(300) });

export interface Sale {
  id: string;
  number: number;
  status: 'completed' | 'cancelled';
  customer: { id: string; name: string } | null;
  items: { productId: string; name: string; unit: Unit; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  total: number;
  payments: { method: SalePaymentMethod; amount: number }[];
  /** Troco devolvido (pagamento em dinheiro acima do total). */
  change: number;
  notes: string | null;
  sellerName: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface SalesSummary {
  count: number;
  total: number;
  averageTicket: number;
  byMethod: { method: SalePaymentMethod; amount: number }[];
  byDay: { date: string; count: number; total: number }[];
  topProducts: { productId: string; name: string; quantity: number; total: number }[];
}

export const salesSettings = z.object({
  /** Conta do financeiro onde entram Pix e cartões (dinheiro vai para o caixa). */
  bankAccountId: z.string().uuid().nullish(),
  /** Recusa vender o que não tem em estoque. */
  blockNegativeStock: z.boolean().default(false),
  receiptFooter: z.string().trim().max(200).default('Obrigado pela preferência!'),
});
export type SalesSettings = z.infer<typeof salesSettings>;

/** Quantidade com a casa decimal certa para a unidade: "1,250 kg", "3 un". */
export function formatQuantity(q: number, unit: Unit): string {
  const digits = fractionalUnits.includes(unit) ? 3 : Number.isInteger(q) ? 0 : 3;
  return `${q.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 3 })} ${unit}`;
}
