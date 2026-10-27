import { MessageChannels, ModuleHooks } from '@all/core';
import { Module, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { WhatsAppSettings } from '../manifest';
import { whatsappNumbers } from '../db/schema';
import { WhatsAppChannel, WhatsAppHttp } from './whatsapp.channel';
import { WhatsAppWebhookController } from './whatsapp.webhook';

@Module({
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppChannel, WhatsAppHttp],
  exports: [WhatsAppChannel, WhatsAppHttp],
})
export class WhatsAppModule implements OnModuleInit {
  constructor(
    private readonly channels: MessageChannels,
    private readonly channel: WhatsAppChannel,
    private readonly hooks: ModuleHooks,
  ) {}

  onModuleInit() {
    this.channels.register('whatsapp', this.channel);
    // O webhook descobre a empresa pelo número: mantém o índice número → empresa em dia.
    this.hooks.register('integration.whatsapp', {
      onSettingsSaved: async (tx, tenantId, raw) => {
        const settings = raw as WhatsAppSettings;
        await tx.delete(whatsappNumbers).where(sql`${whatsappNumbers.tenantId} = ${tenantId}`);
        if (settings.mode === 'cloud_api' && settings.phoneNumberId) {
          await tx.insert(whatsappNumbers).values({ phoneNumberId: settings.phoneNumberId, tenantId });
        }
      },
    });
  }
}
