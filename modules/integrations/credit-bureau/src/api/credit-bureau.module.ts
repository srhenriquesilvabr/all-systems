import { ZodPipe } from '@all/core';
import { ModuleRoute, RequireAnyPermission, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CREDIT_BUREAU, decisionInput, queryInput, type DecisionInput, type QueryInput } from '../contracts';
import { CreditBureauService } from './credit-bureau.service';
import { BoaVistaAdapter, BureauHttp, QuodAdapter, SerasaExperianAdapter, SimulatedBureau } from './providers';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuery = z.object({
  document: z.string().max(20).optional(),
  customerId: z.string().uuid().optional(),
  sourceType: z.string().max(50).optional(),
  sourceId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

@Controller('credit-bureau')
@ModuleRoute(CREDIT_BUREAU)
export class CreditBureauController {
  constructor(private readonly bureau: CreditBureauService) {}

  @Get('status')
  @RequireAnyPermission('integration.credit_bureau.query', 'integration.credit_bureau.read', 'core.access.settings')
  status() {
    return this.bureau.status();
  }

  @Get('queries')
  @RequireAnyPermission('integration.credit_bureau.read', 'integration.credit_bureau.query')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.bureau.list(q);
  }

  @Post('queries')
  @RequirePermission('integration.credit_bureau.query')
  query(@Body(new ZodPipe(queryInput)) body: QueryInput) {
    return this.bureau.query(body);
  }

  @Get('queries/:id')
  @RequireAnyPermission('integration.credit_bureau.read', 'integration.credit_bureau.query')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.bureau.get(id);
  }

  @Post('queries/:id/decision')
  @HttpCode(200)
  @RequirePermission('integration.credit_bureau.query')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionInput)) body: DecisionInput) {
    return this.bureau.decide(id, body);
  }
}

@Module({
  controllers: [CreditBureauController],
  providers: [CreditBureauService, SimulatedBureau, SerasaExperianAdapter, BoaVistaAdapter, QuodAdapter, BureauHttp],
  exports: [CreditBureauService],
})
export class CreditBureauModule {}
