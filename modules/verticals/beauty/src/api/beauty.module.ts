import { ZodPipe } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { commissionRulesInput, type CommissionRulesInput } from '../contracts';
import { BeautyService } from './beauty.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodQuery = z.object({ from: isoDate, to: isoDate }).refine((q) => q.from <= q.to, 'Período inválido');

@Controller('beauty')
@ModuleRoute('beauty')
export class BeautyController {
  constructor(private readonly beauty: BeautyService) {}

  @Get('commission-rules')
  @RequirePermission('beauty.commissions.read')
  rules() {
    return this.beauty.rules();
  }

  @Put('commission-rules/:resourceId')
  @HttpCode(204)
  @RequirePermission('beauty.commissions.manage')
  setRules(@Param('resourceId', ParseUUIDPipe) resourceId: string, @Body(new ZodPipe(commissionRulesInput)) body: CommissionRulesInput) {
    return this.beauty.setRules(resourceId, body);
  }

  @Get('commissions')
  @RequirePermission('beauty.commissions.read')
  report(@Query(new ZodPipe(periodQuery)) q: z.infer<typeof periodQuery>) {
    return this.beauty.report(q.from, q.to);
  }
}

@Module({ controllers: [BeautyController], providers: [BeautyService] })
export class BeautyModule {}
