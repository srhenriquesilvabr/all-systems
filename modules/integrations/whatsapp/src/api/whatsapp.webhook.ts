import { OutboxService, TenantDb } from '@all/core';
import { Public, requestContext } from '@all/module-sdk';
import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { whatsappInbound, whatsappNumbers } from '../db/schema';
import { whatsappConfig } from './whatsapp.channel';

export const WHATSAPP_REPLY = 'integration.whatsapp.reply';

/** Resposta do cliente, publicada no outbox para os módulos (ex.: agenda confirma o horário). */
export interface WhatsAppReply {
  from: string;
  /** Payload do botão tocado (definido por quem enviou a mensagem). */
  payload?: string;
  text?: string;
  messageId: string;
}

/**
 * Webhook da WhatsApp Business Platform (Meta). Um único endereço para todas as empresas:
 * o número de destino (phone_number_id) diz de qual empresa é a mensagem.
 */
@Controller('webhooks/whatsapp')
@SkipThrottle()
export class WhatsAppWebhookController {
  private readonly logger = new Logger('WhatsAppWebhook');

  constructor(
    private readonly tdb: TenantDb,
    private readonly outbox: OutboxService,
  ) {}

  /** Verificação feita pela Meta ao cadastrar o webhook. */
  @Public()
  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    const { verifyToken } = whatsappConfig();
    if (mode !== 'subscribe' || !verifyToken || token !== verifyToken) throw new ForbiddenException();
    return challenge;
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    const { appSecret } = whatsappConfig();
    if (!appSecret) throw new ServiceUnavailableException('Webhook do WhatsApp não configurado');
    if (!req.rawBody || !validSignature(req.rawBody, signature, appSecret)) throw new UnauthorizedException();

    let processed = 0;
    for (const entry of req.body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId || !value.messages?.length) continue;
        const [number] = await this.tdb.db.select().from(whatsappNumbers).where(eq(whatsappNumbers.phoneNumberId, String(phoneNumberId)));
        if (!number) {
          this.logger.warn(`Mensagem para número não cadastrado: ${phoneNumberId}`);
          continue;
        }
        for (const msg of value.messages) {
          const reply: WhatsAppReply = {
            from: String(msg.from),
            payload: msg.button?.payload ?? msg.interactive?.button_reply?.id,
            text: msg.text?.body ?? msg.button?.text,
            messageId: String(msg.id),
          };
          // A Meta reenvia webhooks: cada mensagem é publicada uma única vez.
          const inserted = await this.tdb.db
            .insert(whatsappInbound)
            .values({ messageId: reply.messageId, tenantId: number.tenantId, fromPhone: reply.from, payload: reply })
            .onConflictDoNothing()
            .returning({ id: whatsappInbound.messageId });
          if (!inserted.length) continue;
          await requestContext.run({ tenantId: number.tenantId }, () =>
            this.tdb.run((tx) => this.outbox.publish(tx, WHATSAPP_REPLY, { ...reply })),
          );
          processed++;
        }
      }
    }
    return { processed };
  }
}

function validSignature(raw: Buffer, header: string | undefined, secret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const received = Buffer.from(header.slice('sha256='.length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
