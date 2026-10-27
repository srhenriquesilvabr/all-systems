import { MAX_IMAGE_BYTES, ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { bulkStatusInput, incidentInput, laundryOrderInput, pieceStatusInput, type LaundryOrderInput } from '../contracts';
import { LaundryOrdersService } from './orders.service';
import { LaundryReportsService } from './reports.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reportQuery = z.object({ from: isoDate, to: isoDate }).refine((q) => q.from <= q.to, 'Período inválido');

@Controller('laundry')
@ModuleRoute('laundry')
export class LaundryOrdersController {
  constructor(
    private readonly orders: LaundryOrdersService,
    private readonly reports: LaundryReportsService,
  ) {}

  @Post('orders')
  @RequirePermission('laundry.orders.write')
  create(@Body(new ZodPipe(laundryOrderInput)) body: LaundryOrderInput) {
    return this.orders.create(body);
  }

  @Get('orders/:id')
  @RequirePermission('laundry.orders.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Get('production')
  @RequirePermission('laundry.orders.read')
  production() {
    return this.orders.production();
  }

  @Get('pieces/by-tag/:tag')
  @RequirePermission('laundry.orders.read')
  byTag(@Param('tag') tag: string) {
    return this.orders.byTag(tag);
  }

  @Post('pieces/:itemId/status')
  @HttpCode(200)
  @RequirePermission('laundry.orders.status')
  move(@Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(pieceStatusInput)) body: z.infer<typeof pieceStatusInput>) {
    return this.orders.movePieces([itemId], body.status);
  }

  /** Mover várias peças de uma vez (ex.: um cesto inteiro para a secagem). */
  @Post('pieces/status')
  @HttpCode(200)
  @RequirePermission('laundry.orders.status')
  moveMany(@Body(new ZodPipe(bulkStatusInput)) body: z.infer<typeof bulkStatusInput>) {
    return this.orders.movePieces(body.itemIds, body.status);
  }

  @Post('pieces/:itemId/incident')
  @HttpCode(200)
  @RequirePermission('laundry.orders.status')
  incident(@Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(incidentInput)) body: z.infer<typeof incidentInput>) {
    return this.orders.reportIncident(itemId, body.notes);
  }

  @Post('pieces/:itemId/photos')
  @RequirePermission('laundry.orders.status')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  addPhoto(@Param('itemId', ParseUUIDPipe) itemId: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie a foto no campo "photo"' });
    return this.orders.addPhoto(itemId, file);
  }

  @Delete('pieces/:itemId/photos/:fileId')
  @HttpCode(204)
  @RequirePermission('laundry.orders.status')
  removePhoto(@Param('itemId', ParseUUIDPipe) itemId: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.orders.removePhoto(itemId, fileId);
  }

  @Get('reports')
  @RequirePermission('laundry.reports.read')
  report(@Query(new ZodPipe(reportQuery)) q: z.infer<typeof reportQuery>) {
    return this.reports.report(q.from, q.to);
  }
}
