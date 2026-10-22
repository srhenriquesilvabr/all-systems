import { ZodPipe } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from './notifications.service';

const templateBody = z.object({
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(5000),
});
const logQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  customerId: z.string().uuid().optional(),
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

  @Put('templates/:key')
  @HttpCode(204)
  @RequirePermission('shared.notifications.manage')
  save(@Param('key') key: string, @Body(new ZodPipe(templateBody)) body: z.infer<typeof templateBody>) {
    return this.notifications.saveTemplate(key, body);
  }

  @Delete('templates/:key')
  @HttpCode(204)
  @RequirePermission('shared.notifications.manage')
  reset(@Param('key') key: string) {
    return this.notifications.resetTemplate(key);
  }

  @Get()
  @RequirePermission('shared.notifications.read')
  log(@Query(new ZodPipe(logQuery)) query: z.infer<typeof logQuery>) {
    return this.notifications.log(query);
  }
}
