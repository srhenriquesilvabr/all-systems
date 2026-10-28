import type { Tx } from '@all/db';
import { Injectable } from '@nestjs/common';
import { normalizePhone, whatsappLink, whatsappOrderText, type CheckoutNext, type DeliveryAddress, type Fulfillment, type PaymentMode, type Unit } from '../contracts';

/** O que o provedor recebe ao finalizar: o pedido já gravado (na mesma transação) e a empresa. */
export interface CheckoutContext {
  tenantId: string;
  company: { name: string; slug: string; whatsapp: string | null };
  order: {
    id: string;
    number: number;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    items: { productId: string; name: string; quantity: number; unit: Unit; unitPrice: number; total: number }[];
    subtotal: number;
    deliveryFee: number;
    total: number;
    fulfillment: Fulfillment;
    address: DeliveryAddress | null;
    paymentMode: PaymentMode;
    notes: string | null;
  };
}

/**
 * Forma de finalizar o pedido na vitrine. O checkout definitivo ainda vai ser escolhido, por
 * isso a loja só conhece esta interface.
 *
 * PONTO DE EXTENSÃO — pagamento online (`mode: 'online'`):
 * - quem implementa registra o provedor no boot: `providers.register(meuProvedor)` (onModuleInit);
 * - `available(tx)` diz se a empresa pode usar agora (ex.: gateway configurado no integration.payments);
 *   enquanto nenhum provedor "online" estiver registrado e disponível, a vitrine não oferece a opção,
 *   mesmo que ela esteja marcada nas configurações;
 * - `checkoutInTx` cria a cobrança no gateway (ou prepara o Pix) e devolve `{ kind: 'redirect', url }`
 *   para a página de pagamento; o pedido fica `payment_status = 'pending'`;
 * - a confirmação do gateway (webhook, idealmente via outbox) chama
 *   `StoreOrdersService.markPaidInTx(tx, orderId, referência)`, que marca o pedido como pago.
 *
 * Como `integration.payments` (camada integration) não pode importar módulos shared, o registro fica
 * numa ponte que conhece os dois lados: um pacote/vertical que dependa de `@all/store` e
 * `@all/payments`, ou o próprio apps/api.
 */
export interface StorePaymentProvider {
  mode: PaymentMode;
  available(tx: Tx): Promise<boolean>;
  checkoutInTx(tx: Tx, ctx: CheckoutContext): Promise<CheckoutNext>;
}

/** Abre o WhatsApp da empresa com o resumo do pedido (sem WhatsApp cadastrado, só confirma na tela). */
const whatsappCheckout: StorePaymentProvider = {
  mode: 'whatsapp',
  available: async () => true,
  checkoutInTx: async (_tx, { company, order }) => {
    const phone = normalizePhone(company.whatsapp);
    if (!phone) return { kind: 'done' };
    return { kind: 'whatsapp', url: whatsappLink(phone, whatsappOrderText(order)) };
  },
};

/** Paga na retirada ou na entrega: nada a fazer agora. */
const onDeliveryCheckout: StorePaymentProvider = {
  mode: 'on_delivery',
  available: async () => true,
  checkoutInTx: async () => ({ kind: 'done' }),
};

/** Provedores de finalização registrados (os dois modos simples já vêm prontos). */
@Injectable()
export class StorePaymentProviders {
  private readonly byMode = new Map<PaymentMode, StorePaymentProvider>();

  constructor() {
    this.register(whatsappCheckout);
    this.register(onDeliveryCheckout);
  }

  /** Registra (ou troca) o provedor de um modo. */
  register(provider: StorePaymentProvider) {
    this.byMode.set(provider.mode, provider);
  }

  get(mode: PaymentMode): StorePaymentProvider | undefined {
    return this.byMode.get(mode);
  }

  /** Modos ligados nas configurações que têm provedor disponível agora, na ordem configurada. */
  async availableModes(tx: Tx, enabled: readonly PaymentMode[]): Promise<PaymentMode[]> {
    const out: PaymentMode[] = [];
    for (const mode of enabled) {
      const provider = this.byMode.get(mode);
      if (provider && (await provider.available(tx))) out.push(mode);
    }
    return out;
  }
}
