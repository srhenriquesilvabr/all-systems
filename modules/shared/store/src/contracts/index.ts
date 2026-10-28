import { z } from 'zod';

// Contratos compartilhados entre a API e as telas (src/web). Nada aqui importa código de servidor:
// as telas (admin e vitrine pública) usam este arquivo direto.

export const STORE = 'store';

// ---- Espelhos de shared.sales (o navegador não pode importar o pacote de servidor) -----------------

export const units = ['un', 'kg', 'g', 'l', 'ml', 'pct'] as const;
export type Unit = (typeof units)[number];
/** Unidades vendidas em quantidade fracionada (balança), como no PDV. */
export const fractionalUnits: readonly Unit[] = ['kg', 'l'];
/** Formas de pagamento da venda (mesmas do PDV). */
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

// ---- Pedido ----------------------------------------------------------------------------------------

export const orderStatuses = ['new', 'confirmed', 'preparing', 'ready', 'dispatched', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export const orderStatusLabel: Record<OrderStatus, string> = {
  new: 'Novo',
  confirmed: 'Confirmado',
  preparing: 'Em preparo',
  ready: 'Pronto para retirada',
  dispatched: 'Saiu para entrega',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};
/** Pedidos nestes estados seguram (reservam) o estoque dos itens. */
export const reservingStatuses: readonly OrderStatus[] = ['confirmed', 'preparing', 'ready', 'dispatched'];
/** Ainda em andamento (nem concluído nem cancelado). */
export const openStatuses: readonly OrderStatus[] = ['new', ...reservingStatuses];

export const fulfillments = ['pickup', 'delivery'] as const;
export type Fulfillment = (typeof fulfillments)[number];
export const fulfillmentLabel: Record<Fulfillment, string> = { pickup: 'Retirada no local', delivery: 'Entrega' };

/**
 * Como o pedido é finalizado. "online" fica desligado até um provedor ser registrado em
 * `StorePaymentProviders` (ver src/api/payments.ts).
 */
export const paymentModes = ['whatsapp', 'on_delivery', 'online'] as const;
export type PaymentMode = (typeof paymentModes)[number];
export const paymentModeLabel: Record<PaymentMode, string> = {
  whatsapp: 'Finalizar pelo WhatsApp',
  on_delivery: 'Pagar na retirada ou na entrega',
  online: 'Pagamento online',
};
export const paymentModeHint: Record<PaymentMode, string> = {
  whatsapp: 'O pedido é registrado e abrimos o WhatsApp da loja com o resumo para combinar o pagamento.',
  on_delivery: 'Você paga quando receber ou retirar o pedido.',
  online: 'Pague agora pelo site.',
};

/** Etapas do pedido conforme a forma de entrega (cancelar é possível em qualquer etapa em aberto). */
export function orderFlow(fulfillment: Fulfillment): OrderStatus[] {
  return ['new', 'confirmed', 'preparing', fulfillment === 'pickup' ? 'ready' : 'dispatched', 'completed'];
}

/** Para onde o pedido pode ir a partir do estado atual (sempre para a frente; pular etapas é permitido). */
export function nextStatuses(status: OrderStatus, fulfillment: Fulfillment): OrderStatus[] {
  const flow = orderFlow(fulfillment);
  const at = flow.indexOf(status);
  return at < 0 ? [] : flow.slice(at + 1);
}

// ---- Dinheiro, telefone e textos -------------------------------------------------------------------

const money = z.coerce.number().min(0, 'Valor inválido').max(1_000_000).multipleOf(0.01, 'Use no máximo 2 casas decimais');
const qty = z.coerce.number().positive('Quantidade inválida').max(999).multipleOf(0.001);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

/** Hoje no fuso do negócio (YYYY-MM-DD). */
export const businessToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Celular/telefone em E.164 quando reconhecível (mesma regra do cadastro de clientes). */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return null;
}

/** Nome de bairro para comparar: sem acento, minúsculo e com espaços simples. */
export const normalizeDistrict = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Quantidade com a casa decimal certa para a unidade: "1,250 kg", "3 un". */
export function formatQuantity(q: number, unit: Unit): string {
  const digits = fractionalUnits.includes(unit) ? 3 : Number.isInteger(q) ? 0 : 3;
  return `${q.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 3 })} ${unit}`;
}

/** Valor da linha em centavos, com o mesmo arredondamento do PDV (quantidade × preço). */
export const lineCents = (quantity: number, unitPrice: number) => Math.round(quantity * Math.round(unitPrice * 100));

/** Preço que vale hoje: o promocional, se houver e ainda estiver no prazo (validade inclusiva). */
export function effectivePrice(price: number, promo: { promoPrice: number | null; promoUntil: string | null }, today = businessToday()): number {
  if (promo.promoPrice == null || promo.promoPrice >= price) return price;
  if (promo.promoUntil && promo.promoUntil < today) return price;
  return promo.promoPrice;
}

// ---- Configurações (schema do manifesto) -----------------------------------------------------------

export const districtFeeInput = z.object({ name: z.string().trim().min(2, 'Informe o bairro').max(80), fee: money });

export const storeSettings = z
  .object({
    /** Loja recebendo pedidos. Pausada, a vitrine continua no ar, mas sem finalizar compra. */
    open: z.boolean().default(false),
    pausedMessage: z.string().trim().max(300).default('A loja está fechada no momento. Volte mais tarde!'),
    /** Texto de boas-vindas no topo da vitrine (também usado como descrição para buscadores). */
    welcome: z.string().trim().max(1000).default(''),
    /** Produto sem estoque: aparece como "esgotado" ou some da vitrine. */
    outOfStock: z.enum(['sold_out', 'hide']).default('sold_out'),
    /** WhatsApp que recebe os pedidos. Vazio = telefone dos dados da empresa. */
    whatsapp: z
      .string()
      .trim()
      .max(30)
      .default('')
      .refine((v) => !v || !!normalizePhone(v), 'WhatsApp inválido: informe com DDD'),
    /** Formas de finalizar oferecidas na vitrine (o pagamento online só vale com provedor ligado). */
    paymentModes: z
      .array(z.enum(paymentModes))
      .min(1, 'Escolha ao menos uma forma de finalizar o pedido')
      .max(paymentModes.length)
      .default(['whatsapp', 'on_delivery'])
      .transform((list) => [...new Set(list)]),
    pickup: z
      .object({
        enabled: z.boolean().default(true),
        address: z.string().trim().max(300).default(''),
        hours: z.string().trim().max(300).default(''),
      })
      .default({}),
    delivery: z
      .object({
        enabled: z.boolean().default(false),
        /** Taxa fixa ou por bairro (bairro fora da lista não é atendido). */
        feeMode: z.enum(['fixed', 'district']).default('fixed'),
        fixedFee: money.default(0),
        districts: z.array(districtFeeInput).max(200).default([]),
        /** Pedido mínimo para entrega (soma dos produtos). */
        minOrder: money.default(0),
        /** Prazo mostrado na vitrine ("até 60 minutos", "no dia seguinte"). */
        eta: z.string().trim().max(120).default(''),
      })
      .default({}),
    exchangePolicy: z.string().trim().max(3000).default(''),
    /** Canal para pedidos do titular (LGPD), mostrado no consentimento. */
    privacyEmail: z.string().trim().email('E-mail inválido').max(254).or(z.literal('')).default(''),
  })
  .refine((s) => s.pickup.enabled || s.delivery.enabled, { message: 'Ative a retirada no local ou a entrega', path: ['pickup', 'enabled'] })
  .refine((s) => !s.delivery.enabled || s.delivery.feeMode !== 'district' || s.delivery.districts.length > 0, {
    message: 'Cadastre ao menos um bairro com a taxa de entrega',
    path: ['delivery', 'districts'],
  });
export type StoreSettings = z.infer<typeof storeSettings>;

/** Taxa de entrega para o bairro, ou null se o bairro não é atendido. */
export function deliveryFeeFor(delivery: StoreSettings['delivery'], district: string | null | undefined): number | null {
  if (delivery.feeMode === 'fixed') return delivery.fixedFee;
  const wanted = normalizeDistrict(district ?? '');
  if (!wanted) return null;
  return delivery.districts.find((d) => normalizeDistrict(d.name) === wanted)?.fee ?? null;
}

// ---- Anúncios --------------------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const listingInput = z.object({
  visible: z.boolean().default(false),
  /** Título na loja; vazio = nome do produto no PDV. */
  title: optionalText(120),
  description: z.string().trim().max(3000).default(''),
  /** Categoria da loja; vazio = categoria do produto no PDV. */
  category: optionalText(60),
  featured: z.boolean().default(false),
  promoPrice: money.nullish().transform((v) => (v == null || v === 0 ? null : v)),
  /** Último dia do preço promocional (inclusive); vazio = sem prazo. */
  promoUntil: isoDate.nullish().or(z.literal('')).transform((v) => v || null),
});
export type ListingInput = z.infer<typeof listingInput>;

/** Linha da planilha de anúncios: o produto é achado pelo código de barras, código interno ou nome. */
export const listingImportInput = listingInput.extend({ product: z.string().trim().min(1, 'Informe o produto').max(120) });
export type ListingImportInput = z.infer<typeof listingImportInput>;

export const photoOrderInput = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(20) });

export const productsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  listed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

/** Produto do PDV com o anúncio dele (se houver), para a tela de anúncios. */
export interface StoreProduct {
  productId: string;
  name: string;
  /** Categoria do PDV. */
  category: string | null;
  sku: string | null;
  barcode: string | null;
  unit: Unit;
  price: number;
  active: boolean;
  trackStock: boolean;
  stock: number;
  /** Em pedidos confirmados e ainda não concluídos. */
  reserved: number;
  /** Saldo menos o reservado (null: não controla estoque). */
  available: number | null;
  listing: Listing | null;
}

export interface Listing {
  id: string;
  visible: boolean;
  title: string | null;
  description: string;
  category: string | null;
  featured: boolean;
  promoPrice: number | null;
  promoUntil: string | null;
  photos: { fileId: string }[];
  updatedAt: string;
}

// ---- Vitrine pública -------------------------------------------------------------------------------

export interface PublicCompany {
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
}

export interface PublicProduct {
  /** Id do produto do PDV. */
  id: string;
  title: string;
  description: string;
  category: string | null;
  unit: Unit;
  /** Preço cheio. */
  price: number;
  /** Preço que vale hoje (promocional ou cheio). */
  finalPrice: number;
  promoUntil: string | null;
  featured: boolean;
  photos: string[];
  soldOut: boolean;
  /** Quanto dá para pedir (null = sem limite de estoque). */
  maxQuantity: number | null;
}

export interface PublicStore {
  company: PublicCompany;
  slug: string;
  open: boolean;
  pausedMessage: string;
  welcome: string;
  bannerUrl: string | null;
  exchangePolicy: string;
  pickup: { enabled: boolean; address: string; hours: string };
  delivery: { enabled: boolean; feeMode: 'fixed' | 'district'; fixedFee: number; districts: { name: string; fee: number }[]; minOrder: number; eta: string };
  paymentModes: PaymentMode[];
  consent: { version: string; text: string };
  categories: string[];
  products: PublicProduct[];
}

export const CONSENT_VERSION = '2026-10-28';

export function consentText(opts: { company: string; privacyEmail: string | null }): string {
  return [
    `Ao enviar o pedido, você autoriza ${opts.company} a usar seu nome, telefone, e-mail e endereço para preparar, entregar e cobrar este pedido e para avisar você sobre o andamento dele (por WhatsApp ou e-mail).`,
    'Seus dados ficam no cadastro de clientes da loja, que pode usá-los para atender você em compras futuras. Eles não são vendidos nem repassados a terceiros, exceto quando necessário para a entrega ou o pagamento.',
    opts.privacyEmail
      ? `Para consultar, corrigir ou pedir a exclusão dos seus dados, escreva para ${opts.privacyEmail}.`
      : 'Para consultar, corrigir ou pedir a exclusão dos seus dados, fale com a loja pelos canais de atendimento.',
  ].join(' ');
}

export interface ConsentRecord {
  version: string;
  text: string;
  acceptedAt: string;
  ip: string | null;
}

/** Endereço de entrega (mesmos campos do cadastro de clientes). */
export const deliveryAddressInput = z.object({
  zip: z.string().trim().max(10).nullish(),
  street: z.string().trim().min(2, 'Informe a rua').max(150),
  number: z.string().trim().min(1, 'Informe o número').max(20),
  complement: z.string().trim().max(80).nullish(),
  district: z.string().trim().min(2, 'Informe o bairro').max(80),
  city: z.string().trim().min(2, 'Informe a cidade').max(80),
  state: z.string().trim().max(2).nullish(),
});
export type DeliveryAddress = z.infer<typeof deliveryAddressInput>;

export const formatAddress = (a: DeliveryAddress) =>
  [[a.street, a.number].filter(Boolean).join(', '), a.complement, a.district, [a.city, a.state].filter(Boolean).join('/'), a.zip].filter(Boolean).join(' · ');

const orderItems = z
  .array(z.object({ productId: z.string().uuid(), quantity: qty }))
  .min(1, 'O carrinho está vazio')
  .max(50, 'No máximo 50 produtos diferentes por pedido');

const orderBase = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => !!normalizePhone(v), 'Informe o celular com DDD'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail inválido')
    .max(254)
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  fulfillment: z.enum(fulfillments),
  address: deliveryAddressInput.nullish(),
  notes: z.string().trim().max(500).nullish(),
  items: orderItems,
  paymentMode: z.enum(paymentModes),
});

const needsAddress = (o: { fulfillment: Fulfillment; address?: DeliveryAddress | null }) => o.fulfillment !== 'delivery' || !!o.address;

/** Pedido feito na vitrine pública. `website` e `startedAt` são a armadilha para robôs. */
export const publicOrderInput = orderBase
  .extend({
    consent: z.literal(true, { errorMap: () => ({ message: 'Para enviar o pedido, aceite o uso dos dados' }) }),
    consentVersion: z.string().max(40),
    website: z.string().max(200).optional(),
    startedAt: z.coerce.number().int().optional(),
  })
  .refine(needsAddress, { message: 'Informe o endereço de entrega', path: ['address'] });
export type PublicOrderInput = z.infer<typeof publicOrderInput>;

/** Pedido lançado pela equipe (telefone, balcão, Instagram). */
export const adminOrderInput = orderBase
  .extend({ customerId: z.string().uuid().nullish(), paymentMode: z.enum(['whatsapp', 'on_delivery']) })
  .refine(needsAddress, { message: 'Informe o endereço de entrega', path: ['address'] });
export type AdminOrderInput = z.infer<typeof adminOrderInput>;

export const ordersQuery = z.object({
  /** "open" = todos em andamento. */
  status: z.enum(['new', 'confirmed', 'preparing', 'ready', 'dispatched', 'completed', 'cancelled', 'open']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const statusInput = z.object({ status: z.enum(['confirmed', 'preparing', 'ready', 'dispatched']) });
export const completeInput = z.object({
  /** Como o cliente pagou (vira o pagamento da venda). */
  paymentMethod: z.enum(salePaymentMethods),
  /** Caixa em que a venda entra (obrigatório se a empresa exige caixa aberto para vender). */
  registerId: z.string().uuid().nullish(),
});
export const cancelInput = z.object({ reason: z.string().trim().min(3, 'Explique o motivo').max(300) });

export interface OrderItem {
  productId: string;
  name: string;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  /** Preço cheio na hora do pedido (diferente do unitário = estava em promoção). */
  regularPrice: number;
  total: number;
}

export interface OrderSummary {
  id: string;
  number: number;
  status: OrderStatus;
  source: 'public' | 'admin';
  customerName: string;
  customerPhone: string | null;
  fulfillment: Fulfillment;
  paymentMode: PaymentMode;
  paymentStatus: 'pending' | 'paid';
  total: number;
  itemsCount: number;
  createdAt: string;
}

export interface OrderEvent {
  id: string;
  status: OrderStatus | null;
  text: string;
  userName: string | null;
  createdAt: string;
}

export interface Order extends OrderSummary {
  customerEmail: string | null;
  customer: { id: string; name: string } | null;
  address: DeliveryAddress | null;
  notes: string | null;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  saleId: string | null;
  saleNumber: number | null;
  paymentMethod: SalePaymentMethod | null;
  paymentReference: string | null;
  cancelReason: string | null;
  consent: ConsentRecord | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  events: OrderEvent[];
  /** Próximos estados possíveis (sem "concluir" e "cancelar", que têm ação própria). */
  next: OrderStatus[];
  /** Avisos (ex.: estoque que ficou negativo ao confirmar). */
  warnings?: string[];
}

/** O que a vitrine faz depois de gravar o pedido. */
export type CheckoutNext = { kind: 'whatsapp'; url: string } | { kind: 'redirect'; url: string } | { kind: 'done' };

export interface PlacedOrder {
  ok: true;
  /** Ausente quando o envio foi tratado como robô (resposta igual, nada gravado). */
  order?: { id: string; number: number; total: number; paymentMode: PaymentMode };
  next?: CheckoutNext;
}

/** Resumo do pedido para o WhatsApp da loja. */
export function whatsappOrderText(o: {
  number: number;
  customerName: string;
  items: { name: string; quantity: number; unit: Unit; total: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  fulfillment: Fulfillment;
  address: DeliveryAddress | null;
  paymentMode: PaymentMode;
  notes: string | null;
}): string {
  const lines = [
    `Olá! Acabei de fazer o pedido nº ${o.number} pela loja online.`,
    '',
    ...o.items.map((i) => `• ${formatQuantity(i.quantity, i.unit)} ${i.name} — ${brl(i.total)}`),
    '',
    o.deliveryFee > 0 ? `Produtos: ${brl(o.subtotal)}\nEntrega: ${brl(o.deliveryFee)}` : null,
    `Total: ${brl(o.total)}`,
    o.fulfillment === 'delivery' && o.address ? `Entrega em: ${formatAddress(o.address)}` : 'Vou retirar no local.',
    `Pagamento: ${paymentModeLabel[o.paymentMode]}`,
    o.notes ? `Observações: ${o.notes}` : null,
    `Nome: ${o.customerName}`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** Link do WhatsApp (wa.me) com a mensagem pronta. */
export const whatsappLink = (phoneE164: string, text: string) => `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
