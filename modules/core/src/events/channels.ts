import { Injectable } from '@nestjs/common';
import { MailService } from '../mail/mail.service';

/** Mensagem pronta para um canal (e-mail, WhatsApp…). */
export interface OutgoingMessage {
  tenantId: string;
  /** E-mail ou telefone E.164, conforme o canal. */
  to: string;
  subject?: string;
  body: string;
  /** Template aprovado (WhatsApp oficial exige para mensagens iniciadas pela empresa). */
  template?: { name: string; params: string[]; buttons?: { payload: string }[] };
  /** Identificador da notificação, para casar respostas (ex.: botão "Confirmar"). */
  reference: string;
}

export interface ChannelResult {
  /** `manual`: o canal não envia sozinho; a equipe envia pelo link (ex.: WhatsApp Web). */
  status: 'sent' | 'manual';
  externalId?: string;
  actionUrl?: string;
}

export interface MessageChannel {
  send(message: OutgoingMessage): Promise<ChannelResult>;
}

/**
 * Canais de envio. O core registra o e-mail; integrações registram os seus (ex.: WhatsApp),
 * sem que quem envia (notificações) precise conhecê-las.
 */
@Injectable()
export class MessageChannels {
  private readonly channels = new Map<string, MessageChannel>();

  constructor(mail: MailService) {
    this.register('email', {
      async send(m) {
        await mail.send({ to: m.to, subject: m.subject ?? '', text: m.body });
        return { status: 'sent' };
      },
    });
  }

  register(name: string, channel: MessageChannel) {
    this.channels.set(name, channel);
  }

  get(name: string): MessageChannel {
    const channel = this.channels.get(name);
    if (!channel) throw new Error(`Canal de mensagem não instalado: ${name}`);
    return channel;
  }

  has(name: string) {
    return this.channels.has(name);
  }
}
