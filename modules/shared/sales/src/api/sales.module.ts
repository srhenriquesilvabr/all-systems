import { ZodPipe } from '@all/core';
import { ModuleRoute, RequireAnyPermission, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { cancelSaleInput, productInput, saleInput, stockMoveInput, type ProductInput, type SaleInput, type StockMoveInput } from '../contracts';
import { RegistersController } from './registers.controller';
import { RegistersService } from './registers.service';
import { SalesService } from './sales.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.object({ from: isoDate, to: isoDate }).refine((q) => q.from <= q.to, 'Período inválido');
const productsQuery = z.object({
  q: z.string().max(100).optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  lowStock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const salesQuery = z.object({ from: isoDate, to: isoDate, customerId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

@Controller('sales')
@ModuleRoute('shared.sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // O caixa também precisa buscar produtos para vender.
  @Get('products')
  @RequireAnyPermission('shared.sales.sell', 'shared.sales.products')
  products(@Query(new ZodPipe(productsQuery)) q: z.infer<typeof productsQuery>) {
    return this.sales.listProducts(q);
  }

  @Post('products')
  @RequirePermission('shared.sales.products')
  createProduct(@Body(new ZodPipe(productInput)) body: ProductInput) {
    return this.sales.createProduct(body);
  }

  @Patch('products/:id')
  @RequirePermission('shared.sales.products')
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productInput.partial())) body: Partial<ProductInput>) {
    return this.sales.updateProduct(id, body);
  }

  @Get('products/:id/moves')
  @RequireAnyPermission('shared.sales.stock', 'shared.sales.products')
  moves(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.moves(id);
  }

  @Post('stock-moves')
  @RequirePermission('shared.sales.stock')
  addMove(@Body(new ZodPipe(stockMoveInput)) body: StockMoveInput) {
    return this.sales.addMove(body);
  }

  @Post()
  @RequirePermission('shared.sales.sell')
  sell(@Body(new ZodPipe(saleInput)) body: SaleInput) {
    return this.sales.sell(body);
  }

  @Get()
  @RequirePermission('shared.sales.read')
  list(@Query(new ZodPipe(salesQuery)) q: z.infer<typeof salesQuery>) {
    return this.sales.list(q);
  }

  @Get('summary')
  @RequirePermission('shared.sales.read')
  summary(@Query(new ZodPipe(period)) q: z.infer<typeof period>) {
    return this.sales.summary(q.from, q.to);
  }

  @Get(':id')
  @RequireAnyPermission('shared.sales.sell', 'shared.sales.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(id);
  }

  @Post(':id/cancel')
  @RequirePermission('shared.sales.cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSaleInput)) body: { reason: string }) {
    return this.sales.cancel(id, body.reason);
  }
}

// RegistersController primeiro: as rotas são registradas nesta ordem e `GET /sales/:id` pegaria `/sales/registers`.
@Module({ controllers: [RegistersController, SalesController], providers: [SalesService, RegistersService], exports: [SalesService, RegistersService] })
export class SalesModule {}
