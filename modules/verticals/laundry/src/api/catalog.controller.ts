import { ZodPipe } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { LaundryCatalogService } from './catalog.service';

const garmentBody = z.object({ name: z.string().trim().min(2).max(40) });
const garmentUpdate = z.object({ name: z.string().trim().min(2).max(40).optional(), active: z.boolean().optional() });
const pricesBody = z.object({
  prices: z
    .array(z.object({ garmentTypeId: z.string().uuid(), price: z.coerce.number().min(0).max(100_000).multipleOf(0.01) }))
    .max(500),
});

@Controller('laundry')
@ModuleRoute('laundry')
export class LaundryCatalogController {
  constructor(private readonly catalog: LaundryCatalogService) {}

  /** Leitura liberada a quem tem a lavanderia ativa: o balcão precisa da lista. */
  @Get('garment-types')
  garmentTypes() {
    return this.catalog.listGarmentTypes();
  }

  @Post('garment-types')
  @RequirePermission('laundry.catalog.manage')
  createGarment(@Body(new ZodPipe(garmentBody)) body: z.infer<typeof garmentBody>) {
    return this.catalog.createGarmentType(body.name);
  }

  @Patch('garment-types/:id')
  @RequirePermission('laundry.catalog.manage')
  updateGarment(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(garmentUpdate)) body: z.infer<typeof garmentUpdate>) {
    return this.catalog.updateGarmentType(id, body);
  }

  @Get('services/:id/prices')
  prices(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.prices(id);
  }

  @Put('services/:id/prices')
  @HttpCode(204)
  @RequirePermission('laundry.catalog.manage')
  setPrices(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(pricesBody)) body: z.infer<typeof pricesBody>) {
    return this.catalog.setPrices(id, body.prices);
  }
}
