import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { CoreConfig } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Em dev o SMTP aponta para o Mailpit; em produção, para o SMTP do Amazon SES. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;

  constructor(private readonly config: CoreConfig) {
    this.transport = createTransport(config.smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.mailFrom, ...message });
  }

  /** Envio fora do fluxo da requisição: falha de e-mail não derruba a operação, só gera log. */
  sendInBackground(message: MailMessage): void {
    this.send(message).catch((err) => this.logger.error(`Falha ao enviar e-mail "${message.subject}": ${err}`));
  }
}
