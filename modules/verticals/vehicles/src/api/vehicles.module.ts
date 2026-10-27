import { BankingModule } from '@all/banking';
import { MAX_IMAGE_BYTES, ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import { NotificationsModule } from '@all/notifications';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { dealInput, vehicleInput, type DealInput, type VehicleInput } from '../contracts';
import { FipeHttp, VehiclesService } from './vehicles.service';

const stockQuery = z.object({ q: z.string().max(100).optional(), status: z.string().max(20).optional() });
const dealsQuery = z.object({ status: z.string().max(30).optional(), customerId: z.string().uuid().optional(), vehicleId: z.string().uuid().optional() });
const dealUpdate = dealInput.pick({ price: true, discount: true, paymentType: true, downPayment: true, tradeIn: true, notes: true });

@Controller('vehicles')
@ModuleRoute('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get('stock')
  @RequirePermission('vehicles.stock.read')
  list(@Query(new ZodPipe(stockQuery)) q: z.infer<typeof stockQuery>) {
    return this.vehicles.list(q);
  }

  @Get('stock/:id')
  @RequirePermission('vehicles.stock.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(id);
  }

  @Post('stock')
  @RequirePermission('vehicles.stock.write')
  create(@Body(new ZodPipe(vehicleInput)) body: VehicleInput) {
    return this.vehicles.save(null, body);
  }

  @Patch('stock/:id')
  @RequirePermission('vehicles.stock.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(vehicleInput)) body: VehicleInput) {
    return this.vehicles.save(id, body);
  }

  @Post('stock/:id/photos')
  @RequirePermission('vehicles.stock.write')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  addPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie a foto no campo "photo"' });
    return this.vehicles.addPhoto(id, file);
  }

  @Delete('stock/:id/photos/:fileId')
  @HttpCode(204)
  @RequirePermission('vehicles.stock.write')
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.vehicles.removePhoto(id, fileId);
  }

  @Get('fipe/:code')
  @RequirePermission('vehicles.stock.read')
  fipe(@Param('code') code: string) {
    if (!/^\d{6}-\d$/.test(code)) throw new BadRequestException({ code: 'INVALID_FIPE', message: 'Código FIPE no formato 000000-0' });
    return this.vehicles.fipePrice(code);
  }

  @Get('deals')
  @RequirePermission('vehicles.deals.read')
  deals(@Query(new ZodPipe(dealsQuery)) q: z.infer<typeof dealsQuery>) {
    return this.vehicles.listDeals(q);
  }

  @Get('deals/:id')
  @RequirePermission('vehicles.deals.read')
  deal(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.getDeal(id);
  }

  @Post('deals')
  @RequirePermission('vehicles.deals.write')
  createDeal(@Body(new ZodPipe(dealInput)) body: DealInput) {
    return this.vehicles.createDeal(body);
  }

  @Patch('deals/:id')
  @RequirePermission('vehicles.deals.write')
  updateDeal(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(dealUpdate)) body: z.infer<typeof dealUpdate>) {
    return this.vehicles.updateDeal(id, body);
  }

  @Post('deals/:id/close')
  @HttpCode(200)
  @RequirePermission('vehicles.deals.write')
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.closeDeal(id);
  }

  @Post('deals/:id/lose')
  @HttpCode(200)
  @RequirePermission('vehicles.deals.write')
  lose(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3).max(300) }))) body: { reason: string }) {
    return this.vehicles.loseDeal(id, body.reason);
  }
}

@Module({ imports: [BankingModule, NotificationsModule], controllers: [VehiclesController], providers: [VehiclesService, FipeHttp] })
export class VehiclesModule {}
