import { ZodPipe } from '@all/core';
import { ModuleRoute, RequireAnyPermission, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  closeSessionInput,
  openSessionInput,
  registerInput,
  registerMoveInput,
  registerUpdate,
  type CloseSessionInput,
  type OpenSessionInput,
  type RegisterInput,
  type RegisterMoveInput,
  type RegisterUpdate,
} from '../contracts';
import { RegistersService } from './registers.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sessionsQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    registerId: z.string().uuid().optional(),
    status: z.enum(['open', 'closed']).optional(),
    withDifference: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'Período inválido');

/**
 * Caixas do PDV. Fica em `sales/registers` e é registrado antes do SalesController: senão
 * `GET /sales/registers` cairia em `GET /sales/:id`.
 */
@Controller('sales/registers')
@ModuleRoute('shared.sales')
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  /** Caixas, sessão aberta de cada um e se a empresa exige caixa aberto (o PDV usa). */
  @Get()
  @RequireAnyPermission('shared.sales.sell', 'shared.sales.register', 'shared.sales.register.history')
  overview() {
    return this.registers.overview();
  }

  @Post()
  @RequirePermission('shared.sales.register')
  create(@Body(new ZodPipe(registerInput)) body: RegisterInput) {
    return this.registers.createRegister(body);
  }

  @Patch(':id')
  @RequirePermission('shared.sales.register.history')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(registerUpdate)) body: RegisterUpdate) {
    return this.registers.updateRegister(id, body);
  }

  @Get('sessions')
  @RequirePermission('shared.sales.register.history')
  sessions(@Query(new ZodPipe(sessionsQuery)) q: z.infer<typeof sessionsQuery>) {
    return this.registers.list(q);
  }

  @Post('sessions')
  @RequirePermission('shared.sales.register')
  open(@Body(new ZodPipe(openSessionInput)) body: OpenSessionInput) {
    return this.registers.open(body);
  }

  @Get('sessions/:id')
  @RequireAnyPermission('shared.sales.register', 'shared.sales.register.history')
  session(@Param('id', ParseUUIDPipe) id: string) {
    return this.registers.get(id);
  }

  /** Sangria ou suprimento. */
  @Post('sessions/:id/moves')
  @RequirePermission('shared.sales.register')
  move(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(registerMoveInput)) body: RegisterMoveInput) {
    return this.registers.addMove(id, body);
  }

  @Post('sessions/:id/close')
  @RequirePermission('shared.sales.register')
  close(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(closeSessionInput)) body: CloseSessionInput) {
    return this.registers.close(id, body);
  }
}
