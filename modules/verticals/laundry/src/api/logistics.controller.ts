import { MAX_IMAGE_BYTES, ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { ModuleRoute, RequireAnyPermission, RequirePermission } from '@all/module-sdk';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  cancelJobInput,
  completeJobInput,
  deliveryInput,
  failJobInput,
  jobsQuery,
  jobUpdateInput,
  linkOrderInput,
  pickupInput,
  type CompleteJobInput,
  type DeliveryInput,
  type JobsQuery,
  type JobUpdateInput,
  type PickupInput,
} from '../contracts';
import { LaundryLogisticsService } from './logistics.service';

const MANAGE = 'laundry.logistics.manage';
const DRIVE = 'laundry.logistics.drive';
const routeQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * Coleta e entrega. Escritório (manage): agenda, atribui, reagenda e cancela. Motorista (drive):
 * só as tarefas dele — sair para a rota, concluir (com comprovante) ou registrar que não deu.
 */
@Controller('laundry')
@ModuleRoute('laundry')
export class LaundryLogisticsController {
  constructor(private readonly logistics: LaundryLogisticsService) {}

  @Get('logistics/defaults')
  @RequirePermission(MANAGE)
  defaults() {
    return this.logistics.defaults();
  }

  @Get('logistics/jobs')
  @RequirePermission(MANAGE)
  list(@Query(new ZodPipe(jobsQuery)) q: JobsQuery) {
    return this.logistics.list(q);
  }

  @Get('logistics/my-route')
  @RequireAnyPermission(DRIVE, MANAGE)
  myRoute(@Query(new ZodPipe(routeQuery)) q: z.infer<typeof routeQuery>) {
    return this.logistics.myRoute(q.date);
  }

  @Get('logistics/jobs/:id')
  @RequireAnyPermission(DRIVE, MANAGE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.logistics.get(id);
  }

  @Post('logistics/pickups')
  @RequirePermission(MANAGE)
  schedulePickup(@Body(new ZodPipe(pickupInput)) body: PickupInput) {
    return this.logistics.schedulePickup(body);
  }

  /** "Entregar no endereço" a partir da ordem. */
  @Post('orders/:id/delivery')
  @RequirePermission(MANAGE)
  scheduleDelivery(@Param('id', ParseUUIDPipe) orderId: string, @Body(new ZodPipe(deliveryInput)) body: DeliveryInput) {
    return this.logistics.scheduleDelivery(orderId, body);
  }

  @Patch('logistics/jobs/:id')
  @RequirePermission(MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(jobUpdateInput)) body: JobUpdateInput) {
    return this.logistics.update(id, body);
  }

  @Post('logistics/jobs/:id/start')
  @HttpCode(200)
  @RequireAnyPermission(DRIVE, MANAGE)
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.logistics.start(id);
  }

  @Post('logistics/jobs/:id/complete')
  @HttpCode(200)
  @RequireAnyPermission(DRIVE, MANAGE)
  complete(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeJobInput)) body: CompleteJobInput) {
    return this.logistics.complete(id, body);
  }

  @Post('logistics/jobs/:id/fail')
  @HttpCode(200)
  @RequireAnyPermission(DRIVE, MANAGE)
  fail(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(failJobInput)) body: z.infer<typeof failJobInput>) {
    return this.logistics.fail(id, body.reason);
  }

  @Post('logistics/jobs/:id/cancel')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelJobInput)) body: z.infer<typeof cancelJobInput>) {
    return this.logistics.cancel(id, body.reason);
  }

  /** Coleta concluída → ordem aberta depois no balcão. */
  @Post('logistics/jobs/:id/link-order')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  linkOrder(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(linkOrderInput)) body: z.infer<typeof linkOrderInput>) {
    return this.logistics.linkOrder(id, body.orderId);
  }

  /** Foto do comprovante (entrega) ou das peças coletadas. */
  @Post('logistics/jobs/:id/photos')
  @RequireAnyPermission(DRIVE, MANAGE)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  addPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie a foto no campo "photo"' });
    return this.logistics.addPhoto(id, file);
  }

  @Delete('logistics/jobs/:id/photos/:fileId')
  @HttpCode(204)
  @RequireAnyPermission(DRIVE, MANAGE)
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.logistics.removePhoto(id, fileId);
  }
}
