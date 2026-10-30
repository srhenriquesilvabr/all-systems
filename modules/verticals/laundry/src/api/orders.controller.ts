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
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  addPiecesInput,
  bulkStatusInput,
  incidentInput,
  laundryOrderInput,
  laundryOrderUpdate,
  pieceStatusInput,
  pieceUpdate,
  type AddPiecesInput,
  type LaundryOrderInput,
  type LaundryOrderUpdate,
  type PieceUpdate,
} from '../contracts';
import { LaundryOrdersService } from './orders.service';
import { LaundryReportsService } from './reports.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reportQuery = z.object({ from: isoDate, to: isoDate }).refine((q) => q.from <= q.to, 'Período inválido');
const productionQuery = z.object({ includeReady: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });

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

  /** Previsão, desconto e observações, conforme a situação da ordem. */
  @Patch('orders/:id')
  @RequirePermission('laundry.orders.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(laundryOrderUpdate)) body: LaundryOrderUpdate) {
    return this.orders.update(id, body);
  }

  /** Mais peças na ordem, enquanto ela está na produção: cada uma ganha etiqueta nova. */
  @Post('orders/:id/pieces')
  @RequirePermission('laundry.orders.write')
  addPieces(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(addPiecesInput)) body: AddPiecesInput) {
    return this.orders.addPieces(id, body.lines);
  }

  /** Tira a peça que ainda não começou a ser trabalhada. */
  @Delete('orders/:id/pieces/:itemId')
  @RequirePermission('laundry.orders.write')
  removePiece(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.orders.removePiece(id, itemId);
  }

  @Patch('pieces/:itemId')
  @RequirePermission('laundry.orders.write')
  updatePiece(@Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(pieceUpdate)) body: PieceUpdate) {
    return this.orders.updatePiece(itemId, body);
  }

  @Get('production')
  @RequirePermission('laundry.orders.read')
  production(@Query(new ZodPipe(productionQuery)) q: z.infer<typeof productionQuery>) {
    return this.orders.production(q.includeReady);
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
