import { z } from 'zod';

// Contratos compartilhados entre a API e as telas (src/web).

export const units = ['un', 'kg', 'g', 'l', 'ml', 'pct'] as const;
export type Unit = (typeof units)[number];
export const unitLabel: Record<Unit, string> = { un: 'Unidade', kg: 'Quilo', g: 'Grama', l: 'Litro', ml: 'Mililitro', pct: 'Pacote' };
/** Unidades vendidas em quantidade fracionada (balança). */
export const fractionalUnits: Unit[] = ['kg', 'l'];

const money = z.coerce.number().min(0, 'Valor inválido').max(1_000_000).multipleOf(0.01, 'Use no máximo 2 casas decimais');
const qty = z.coerce.number().positive('Quantidade inválida').max(100_000).multipleOf(0.001);

/** Hoje no fuso do negócio (YYYY-MM-DD). */
export const businessToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/**
 * Momento informado pelo usuário (venda ou movimento lançado depois): só a data (hoje vira agora,
 * outro dia vira meio-dia no fuso de SP) ou data e hora completas. Não aceita data futura.
 */
const pastMoment = (futureMessage: string) =>
  z
    .union([z.string().trim(), z.date()])
    .transform((v) => (v instanceof Date ? v : /^\d{4}-\d{2}-\d{2}$/.test(v) ? (v === businessToday() ? new Date() : new Date(`${v}T12:00:00-03:00`)) : new Date(v)))
    .refine((d) => !Number.isNaN(d.getTime()), 'Data inválida')
    .refine((d) => Number.isNaN(d.getTime()) || d.getTime() <= Date.now() + 5 * 60_000, futureMessage);

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
  /** Quando aconteceu; sem data, é agora. */
  occurredAt: pastMoment('A data do movimento não pode ser no futuro').optional(),
});
export type StockMoveInput = z.infer<typeof stockMoveInput>;

export interface StockMove {
  id: string;
  kind: keyof typeof stockMoveLabel;
  quantity: number;
  balance: number;
  reason: string | null;
  userName: string | null;
  /** Quando aconteceu (pode ser anterior ao registro). */
  occurredAt: string;
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
  /** Data da venda (lançar venda anterior); sem data, é agora. */
  soldAt: pastMoment('A data da venda não pode ser no futuro').optional(),
  /** Caixa (terminal) em que a venda é feita: a venda entra na sessão aberta dele. */
  registerId: z.string().uuid().nullish(),
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
  /** Sessão de caixa em que a venda entrou (vendas antigas, sem caixa ou lançadas depois: null). */
  registerSessionId: string | null;
  /** Quando a venda aconteceu (anterior ao registro nas vendas lançadas depois). */
  soldAt: string;
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
  /**
   * Só vende com caixa aberto (abertura com troco, sangria/suprimento e fechamento conferido).
   * Desligado por padrão: quem já vende sem controle de caixa (e as empresas de demonstração)
   * continua vendendo; ligar é uma decisão do dono, na tela "Caixas".
   */
  requireRegisterSession: z.boolean().default(false),
});
export type SalesSettings = z.infer<typeof salesSettings>;

// ---- Caixa: abertura, sangria/suprimento e fechamento ------------------------------------------

export const registerInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome do caixa').max(40),
});
export const registerUpdate = registerInput.extend({ active: z.boolean() }).partial();
export type RegisterInput = z.infer<typeof registerInput>;
export type RegisterUpdate = z.infer<typeof registerUpdate>;

export const openSessionInput = z.object({
  registerId: z.string().uuid(),
  /** Troco inicial: dinheiro que já está na gaveta na abertura. */
  openingFloat: money,
});
export type OpenSessionInput = z.infer<typeof openSessionInput>;

export const registerMoveKinds = ['withdrawal', 'deposit'] as const;
export type RegisterMoveKind = (typeof registerMoveKinds)[number];
export const registerMoveLabel: Record<RegisterMoveKind, string> = { withdrawal: 'Sangria', deposit: 'Suprimento' };

export const registerMoveInput = z.object({
  kind: z.enum(registerMoveKinds),
  amount: z.coerce.number().positive('Informe o valor').max(1_000_000).multipleOf(0.01, 'Use no máximo 2 casas decimais'),
  reason: z.string().trim().min(3, 'Explique o motivo').max(200),
  /**
   * Conta do financeiro do outro lado: para onde foi a sangria (banco, cofre) ou de onde veio o
   * suprimento. Sem conta, a sangria é uma despesa e o suprimento uma receita.
   */
  accountId: z.string().uuid().nullish(),
});
export type RegisterMoveInput = z.infer<typeof registerMoveInput>;

/** Formas conferidas no fechamento (fiado não passa pela gaveta nem pela maquininha). */
export const countedMethods = ['cash', 'pix', 'debit_card', 'credit_card', 'other'] as const;
export type CountedMethod = (typeof countedMethods)[number];

export const closeSessionInput = z.object({
  /** Valores contados pelo operador. Dinheiro é obrigatório; o resto, só se ele conferir. */
  counted: z.object({
    cash: money,
    pix: money.nullish(),
    debit_card: money.nullish(),
    credit_card: money.nullish(),
    other: money.nullish(),
  }),
  notes: z.string().trim().max(500).nullish(),
});
export type CloseSessionInput = z.infer<typeof closeSessionInput>;

export interface RegisterSessionTotal {
  method: SalePaymentMethod;
  /** Dinheiro: troco inicial + vendas + suprimentos − sangrias. Demais: soma das vendas. */
  expected: number;
  /** Informado no fechamento (null: não conferido). */
  counted: number | null;
  /** Contado − esperado: positivo é sobra, negativo é quebra. */
  difference: number | null;
}

export interface RegisterSessionSummary {
  id: string;
  number: number;
  register: { id: string; name: string };
  status: 'open' | 'closed';
  openingFloat: number;
  openedAt: string;
  openedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  /** Vendas concluídas (canceladas não contam). */
  salesCount: number;
  salesTotal: number;
  withdrawals: number;
  deposits: number;
  expectedCash: number;
  /** Só nas sessões fechadas. */
  countedCash: number | null;
  cashDifference: number | null;
  notes: string | null;
}

export interface RegisterMove {
  id: string;
  kind: RegisterMoveKind;
  amount: number;
  reason: string;
  accountName: string | null;
  userName: string | null;
  createdAt: string;
}

export interface RegisterSession extends RegisterSessionSummary {
  /** Por forma de pagamento; na sessão aberta, `counted` e `difference` são null. */
  totals: RegisterSessionTotal[];
  moves: RegisterMove[];
  sales: { id: string; number: number; soldAt: string; status: 'completed' | 'cancelled'; total: number; payments: { method: SalePaymentMethod; amount: number }[] }[];
}

export interface CashRegister {
  id: string;
  name: string;
  active: boolean;
  openSession: { id: string; number: number; openedAt: string; openedByName: string | null; openingFloat: number } | null;
}

/** O que o PDV precisa para escolher o caixa (quem vende não tem acesso às configurações). */
export interface RegistersOverview {
  requireSession: boolean;
  registers: CashRegister[];
  /** Contas ativas do financeiro: destino da sangria / origem do suprimento. */
  accounts: { id: string; name: string; type: 'cash' | 'bank' | 'gateway' }[];
  /** Conta onde entra o dinheiro das vendas (a gaveta). */
  cashAccountId: string | null;
}

/** Quantidade com a casa decimal certa para a unidade: "1,250 kg", "3 un". */
export function formatQuantity(q: number, unit: Unit): string {
  const digits = fractionalUnits.includes(unit) ? 3 : Number.isInteger(q) ? 0 : 3;
  return `${q.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 3 })} ${unit}`;
}
