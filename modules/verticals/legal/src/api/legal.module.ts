import { ZodPipe } from '@all/core';
import { ModuleRoute, RequireAnyPermission, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { caseInput, deadlineDoneInput, deadlineInput, deadlineUpdateInput, feeInput, removeInput, successInput, updateInput, type CaseInput, type DeadlineInput, type DeadlineUpdateInput, type FeeInput } from '../contracts';
import { LegalService } from './legal.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const casesQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.string().max(20).optional(),
  customerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
const deadlinesQuery = z.object({
  caseId: z.string().uuid().optional(),
  until: isoDate.optional(),
  assignedUserId: z.string().uuid().optional(),
  /** Só os meus: designados a quem está logado ou dos processos em que essa pessoa é responsável. */
  mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  status: z.enum(['open', 'done']).optional(),
});

@Controller('legal')
@ModuleRoute('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('team')
  @RequireAnyPermission('legal.cases.read', 'shared.scheduling.read')
  team() {
    return this.legal.team();
  }

  @Get('cases')
  @RequireAnyPermission('legal.cases.read', 'shared.scheduling.write')
  cases(@Query(new ZodPipe(casesQuery)) q: z.infer<typeof casesQuery>) {
    return this.legal.listCases(q);
  }

  @Get('cases/:id')
  @RequirePermission('legal.cases.read')
  getCase(@Param('id', ParseUUIDPipe) id: string) {
    return this.legal.getCase(id);
  }

  @Post('cases')
  @RequirePermission('legal.cases.write')
  createCase(@Body(new ZodPipe(caseInput)) body: CaseInput) {
    return this.legal.createCase(body);
  }

  @Patch('cases/:id')
  @RequirePermission('legal.cases.write')
  updateCase(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(caseInput.partial())) body: Partial<CaseInput>) {
    return this.legal.updateCase(id, body);
  }

  @Get('cases/:id/updates')
  @RequirePermission('legal.cases.read')
  updates(@Param('id', ParseUUIDPipe) id: string) {
    return this.legal.updates(id);
  }

  @Post('cases/:id/updates')
  @RequirePermission('legal.cases.write')
  addUpdate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateInput)) body: z.infer<typeof updateInput>) {
    return this.legal.addUpdate(id, body);
  }

  @Patch('updates/:id')
  @RequirePermission('legal.cases.write')
  editUpdate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateInput)) body: z.infer<typeof updateInput>) {
    return this.legal.editUpdate(id, body);
  }

  @Post('updates/:id/delete')
  @HttpCode(204)
  @RequirePermission('legal.cases.write')
  deleteUpdate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(removeInput)) body: z.infer<typeof removeInput>) {
    return this.legal.deleteUpdate(id, body.reason);
  }

  @Get('deadlines')
  @RequirePermission('legal.cases.read')
  deadlines(@Query(new ZodPipe(deadlinesQuery)) q: z.infer<typeof deadlinesQuery>) {
    return this.legal.deadlines(q);
  }

  @Post('deadlines')
  @RequirePermission('legal.cases.write')
  addDeadline(@Body(new ZodPipe(deadlineInput)) body: DeadlineInput) {
    return this.legal.addDeadline(body);
  }

  @Patch('deadlines/:id')
  @RequirePermission('legal.cases.write')
  updateDeadline(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(deadlineUpdateInput)) body: DeadlineUpdateInput) {
    return this.legal.updateDeadline(id, body);
  }

  @Post('deadlines/:id/delete')
  @HttpCode(204)
  @RequirePermission('legal.cases.write')
  deleteDeadline(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(removeInput)) body: z.infer<typeof removeInput>) {
    return this.legal.deleteDeadline(id, body.reason);
  }

  @Post('deadlines/:id/done')
  @HttpCode(204)
  @RequirePermission('legal.cases.write')
  done(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(deadlineDoneInput)) body: { doneOn?: string }) {
    return this.legal.completeDeadline(id, true, body.doneOn);
  }

  @Post('deadlines/:id/reopen')
  @HttpCode(204)
  @RequirePermission('legal.cases.write')
  reopen(@Param('id', ParseUUIDPipe) id: string) {
    return this.legal.completeDeadline(id, false);
  }

  @Get('cases/:id/fees')
  @RequirePermission('legal.fees.read')
  fees(@Param('id', ParseUUIDPipe) id: string) {
    return this.legal.fees(id);
  }

  @Post('fees')
  @RequirePermission('legal.fees.manage')
  addFee(@Body(new ZodPipe(feeInput)) body: FeeInput) {
    return this.legal.addFee(body);
  }

  @Post('fees/:id/success')
  @HttpCode(204)
  @RequirePermission('legal.fees.manage')
  success(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(successInput)) body: z.infer<typeof successInput>) {
    return this.legal.registerSuccess(id, body.obtainedAmount, body.dueOn);
  }

  @Post('fees/:id/cancel')
  @HttpCode(204)
  @RequirePermission('legal.fees.manage')
  cancelFee(@Param('id', ParseUUIDPipe) id: string) {
    return this.legal.cancelFee(id);
  }
}

@Module({ controllers: [LegalController], providers: [LegalService] })
export class LegalModule {}
