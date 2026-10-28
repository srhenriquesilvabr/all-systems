import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { CoreConfig } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Em produção (Cloudflare Workers, sem SMTP) o envio é pela API HTTP do Resend.
 * Sem RESEND_API_KEY, usa o SMTP_URL: em dev, o Mailpit.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport?: Transporter;
  private warnedDisabled = false;

  constructor(private readonly config: CoreConfig) {}

  async send(message: MailMessage): Promise<void> {
    if (this.config.resendApiKey) return this.sendViaResend(message);
    // Produção sem provedor de e-mail: não há SMTP no Workers, então tentar só gera erro e
    // reenvio em loop no outbox. O e-mail é descartado com um aviso até a chave ser configurada.
    if (this.config.isProduction) {
      if (!this.warnedDisabled) this.logger.warn('E-mail desligado: configure RESEND_API_KEY para enviar.');
      this.warnedDisabled = true;
      return;
    }
    this.transport ??= createTransport(this.config.smtpUrl);
    await this.transport.sendMail({ from: this.config.mailFrom, ...message });
  }

  /** Envio fora do fluxo da requisição: falha de e-mail não derruba a operação, só gera log. */
  sendInBackground(message: MailMessage): void {
    this.send(message).catch((err) => this.logger.error(`Falha ao enviar e-mail "${message.subject}": ${err}`));
  }

  private async sendViaResend(message: MailMessage) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.config.mailFrom, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!res.ok) throw new Error(`Resend respondeu ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
}
