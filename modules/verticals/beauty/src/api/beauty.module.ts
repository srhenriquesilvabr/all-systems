import { ZodPipe } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import { SchedulingModule } from '@all/scheduling';
import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { cancelPayoutInput, commissionPayoutInput, commissionRulesInput, type CommissionPayoutInput, type CommissionRulesInput } from '../contracts';
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

  /** A comissão de quem está logado: só as linhas dele. */
  @Get('commissions/mine')
  @RequirePermission('beauty.commissions.own')
  mine(@Query(new ZodPipe(periodQuery)) q: z.infer<typeof periodQuery>) {
    return this.beauty.mine(q.from, q.to);
  }

  @Get('commissions/payouts')
  @RequirePermission('beauty.commissions.read')
  payouts(@Query(new ZodPipe(periodQuery)) q: z.infer<typeof periodQuery>) {
    return this.beauty.listPayouts(q.from, q.to);
  }

  /** Lança como despesa a pagar o que ainda não foi lançado do período. */
  @Post('commissions/payouts')
  @RequirePermission('beauty.commissions.manage')
  createPayouts(@Body(new ZodPipe(commissionPayoutInput)) body: CommissionPayoutInput) {
    return this.beauty.createPayouts(body);
  }

  @Post('commissions/payouts/:id/cancel')
  @HttpCode(200)
  @RequirePermission('beauty.commissions.manage')
  cancelPayout(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelPayoutInput)) body: z.infer<typeof cancelPayoutInput>) {
    return this.beauty.cancelPayout(id, body.reason);
  }
}

@Module({ imports: [SchedulingModule], controllers: [BeautyController], providers: [BeautyService] })
export class BeautyModule {}
