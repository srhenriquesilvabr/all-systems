import { FinanceService, ZodPipe } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  createOrderInput,
  paymentInput,
  transitionInput,
  updateOrderInput,
  type CreateOrderInput,
  type PaymentInput,
  type UpdateOrderInput,
} from '../contracts';
import { ServiceOrdersService } from './service-orders.service';

const listQuery = z.object({
  status: z.string().max(50).optional(),
  workflow: z.string().max(50).optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

@Controller('service-orders')
@ModuleRoute('shared.service-orders')
export class ServiceOrdersController {
  constructor(
    private readonly orders: ServiceOrdersService,
    private readonly finance: FinanceService,
  ) {}

  @Get('workflows')
  @RequirePermission('shared.service-orders.read')
  workflows() {
    return this.orders.listWorkflows();
  }

  /** Contas para receber pagamentos (sem saldos: quem atende não precisa ver o caixa). */
  @Get('payment-accounts')
  @RequirePermission('shared.service-orders.payments')
  paymentAccounts() {
    return this.finance.listAccountsBasic();
  }

  @Get()
  @RequirePermission('shared.service-orders.read')
  list(@Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.orders.list(query);
  }

  @Get(':id')
  @RequirePermission('shared.service-orders.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Post()
  @RequirePermission('shared.service-orders.write')
  create(@Body(new ZodPipe(createOrderInput)) body: CreateOrderInput) {
    return this.orders.create(body);
  }

  @Patch(':id')
  @RequirePermission('shared.service-orders.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateOrderInput)) body: UpdateOrderInput) {
    return this.orders.update(id, body);
  }

  @Post(':id/transition')
  @RequirePermission('shared.service-orders.status')
  transition(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(transitionInput)) body: z.infer<typeof transitionInput>) {
    return this.orders.transition(id, body.to, body.reason);
  }

  @Post(':id/payments')
  @RequirePermission('shared.service-orders.payments')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(paymentInput)) body: PaymentInput) {
    return this.orders.addPayment(id, body);
  }
}
