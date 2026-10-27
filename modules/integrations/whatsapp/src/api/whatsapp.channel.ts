import { ModuleSettingsService, TenantDb, type ChannelResult, type MessageChannel, type OutgoingMessage } from '@all/core';
import { Injectable, Logger } from '@nestjs/common';
import type { WhatsAppSettings } from '../manifest';

export const whatsappConfig = () => ({
  graphUrl: process.env.WHATSAPP_GRAPH_URL ?? 'https://graph.facebook.com/v21.0',
  /** Segredo do app na Meta: valida a assinatura dos webhooks. */
  appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  /** Token combinado na configuração do webhook na Meta. */
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
});

/** Chamada HTTP à API da Meta. Isolada para poder ser trocada nos testes. */
@Injectable()
export class WhatsAppHttp {
  async post(url: string, body: unknown, token: string): Promise<{ ok: boolean; status: number; body: any }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  }
}

/** Canal "whatsapp" usado pelas notificações. O modo de envio é escolhido por empresa. */
@Injectable()
export class WhatsAppChannel implements MessageChannel {
  private readonly logger = new Logger('WhatsApp');

  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly http: WhatsAppHttp,
  ) {}

  async send(m: OutgoingMessage): Promise<ChannelResult> {
    const s = await this.tdb.withScope({ tenantId: m.tenantId }, (tx) => this.settings.getInTx<WhatsAppSettings>(tx, 'integration.whatsapp'));
    const to = m.to.replace(/\D/g, '');

    if (s.mode === 'manual') {
      return { status: 'manual', actionUrl: `https://wa.me/${to}?text=${encodeURIComponent(m.body)}` };
    }
    if (s.mode === 'simulated') {
      this.logger.log(`[simulado] para +${to}: ${m.body.replace(/\n/g, ' ⏎ ')}`);
      return { status: 'sent', externalId: `simulado-${m.reference}` };
    }

    const payload = m.template
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: m.template.name,
            language: { code: s.languageCode },
            components: [
              // A Meta recusa parâmetro vazio.
              { type: 'body', parameters: m.template.params.map((text) => ({ type: 'text', text: text || '-' })) },
              ...(m.template.buttons ?? []).map((b, index) => ({
                type: 'button',
                sub_type: 'quick_reply',
                index: String(index),
                parameters: [{ type: 'payload', payload: b.payload }],
              })),
            ],
          },
        }
      : // Texto livre só é entregue dentro da janela de 24 h após o cliente falar com a empresa.
        { messaging_product: 'whatsapp', to, type: 'text', text: { body: m.body } };

    const res = await this.http.post(`${whatsappConfig().graphUrl}/${s.phoneNumberId}/messages`, payload, s.accessToken);
    if (!res.ok) throw new Error(`API do WhatsApp respondeu ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
    return { status: 'sent', externalId: res.body?.messages?.[0]?.id };
  }
}
