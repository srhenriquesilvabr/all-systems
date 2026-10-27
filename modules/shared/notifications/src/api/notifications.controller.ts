import { ZodPipe } from '@all/core';
import { ModuleRoute, RequirePermission, requestContext } from '@all/module-sdk';
import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from './notifications.service';

const channel = z.enum(['email', 'whatsapp']);
const templateBody = z.object({
  subject: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().min(2).max(5000),
});
const logQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  customerId: z.string().uuid().optional(),
  status: z.enum(['manual', 'queued', 'sent', 'failed', 'skipped']).optional(),
  relatedEntity: z.string().max(50).optional(),
  relatedId: z.string().max(100).optional(),
});

@Controller('notifications')
@ModuleRoute('shared.notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('templates')
  @RequirePermission('shared.notifications.read')
  templates() {
    return this.notifications.templates();
  }

  @Put('templates/:key/:channel')
  @HttpCode(204)
  @RequirePermission('shared.notifications.manage')
  save(
    @Param('key') key: string,
    @Param('channel', new ZodPipe(channel)) ch: z.infer<typeof channel>,
    @Body(new ZodPipe(templateBody)) body: z.infer<typeof templateBody>,
  ) {
    return this.notifications.saveTemplate(key, ch, body);
  }

  @Delete('templates/:key/:channel')
  @HttpCode(204)
  @RequirePermission('shared.notifications.manage')
  reset(@Param('key') key: string, @Param('channel', new ZodPipe(channel)) ch: z.infer<typeof channel>) {
    return this.notifications.resetTemplate(key, ch);
  }

  /**
   * Histórico. Sem a permissão de leitura geral, ainda dá para consultar as mensagens de um
   * registro específico (ex.: o atendimento aberto na tela), que é o que a equipe usa no dia a dia.
   */
  @Get()
  log(@Query(new ZodPipe(logQuery)) q: z.infer<typeof logQuery>) {
    const related = q.relatedEntity && q.relatedId ? { entity: q.relatedEntity, id: q.relatedId } : undefined;
    if (!related && !requestContext.require().permissions?.has('shared.notifications.read')) {
      throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Você não tem permissão para ver todas as mensagens' });
    }
    return this.notifications.log({ limit: q.limit, customerId: q.customerId, status: q.status, related });
  }

  /** Marca como enviada uma mensagem do modo manual, depois que alguém a enviou pelo link. */
  @Post(':id/sent')
  @HttpCode(204)
  markSent(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markSent(id);
  }
}
