import { ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { ModuleRoute, Public, RequireAnyPermission, RequirePermission, requestContext } from '@all/module-sdk';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import {
  adminOrderInput,
  cancelInput,
  completeInput,
  listingImportInput,
  listingInput,
  ordersQuery,
  photoOrderInput,
  productsQuery,
  publicOrderInput,
  statusInput,
  STORE,
  type AdminOrderInput,
  type ListingImportInput,
  type ListingInput,
  type PublicOrderInput,
} from '../contracts';
import { StoreCatalogService } from './catalog.service';
import { StoreOrdersService } from './orders.service';
import { StorePublicService } from './public.service';
import { MAX_BANNER_BYTES, MAX_PHOTO_BYTES } from './shared';

const bannerQuery = z.object({ v: z.string().max(64).optional() });

@Controller('store')
@ModuleRoute(STORE)
export class StoreController {
  constructor(
    private readonly catalog: StoreCatalogService,
    private readonly orders: StoreOrdersService,
  ) {}

  /** Endereço público, aberta/pausada, notificações e formas de pagamento disponíveis. */
  @Get('status')
  @RequireAnyPermission('store.orders.read', 'store.catalog.manage', 'store.settings.manage')
  status() {
    return this.catalog.status();
  }

  // ---- Configurações ----

  @Get('settings')
  @RequirePermission('store.settings.manage')
  settings() {
    return this.catalog.getSettings();
  }

  @Put('settings')
  @RequirePermission('store.settings.manage')
  saveSettings(@Body() body: unknown) {
    return this.catalog.saveSettings(body);
  }

  @Post('banner')
  @HttpCode(200)
  @RequirePermission('store.settings.manage')
  @UseInterceptors(FileInterceptor('banner', { limits: { fileSize: MAX_BANNER_BYTES, files: 1 } }))
  setBanner(@UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie a imagem no campo "banner"' });
    return this.catalog.setBanner(file);
  }

  @Delete('banner')
  @HttpCode(204)
  @RequirePermission('store.settings.manage')
  removeBanner() {
    return this.catalog.removeBanner();
  }

  // ---- Anúncios ----

  // Quem lança pedido também escolhe produtos.
  @Get('products')
  @RequireAnyPermission('store.catalog.manage', 'store.orders.manage')
  products(@Query(new ZodPipe(productsQuery)) q: z.infer<typeof productsQuery>) {
    return this.catalog.products(q);
  }

  @Get('categories')
  @RequirePermission('store.catalog.manage')
  categories() {
    return this.catalog.categories();
  }

  /** Importação por planilha: uma linha por chamada, com o produto pelo código ou nome. */
  @Post('listings/import')
  @HttpCode(200)
  @RequirePermission('store.catalog.manage')
  importListing(@Body(new ZodPipe(listingImportInput)) body: ListingImportInput) {
    return this.catalog.importListing(body);
  }

  @Put('listings/:productId')
  @RequirePermission('store.catalog.manage')
  saveListing(@Param('productId', ParseUUIDPipe) productId: string, @Body(new ZodPipe(listingInput)) body: ListingInput) {
    return this.catalog.saveListing(productId, body);
  }

  @Post('listings/:productId/photos')
  @HttpCode(200)
  @RequirePermission('store.catalog.manage')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  addPhoto(@Param('productId', ParseUUIDPipe) productId: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie a foto no campo "photo"' });
    return this.catalog.addPhoto(productId, file);
  }

  @Put('listings/:productId/photos/order')
  @RequirePermission('store.catalog.manage')
  reorderPhotos(@Param('productId', ParseUUIDPipe) productId: string, @Body(new ZodPipe(photoOrderInput)) body: z.infer<typeof photoOrderInput>) {
    return this.catalog.reorderPhotos(productId, body.fileIds);
  }

  @Delete('listings/:productId/photos/:fileId')
  @RequirePermission('store.catalog.manage')
  removePhoto(@Param('productId', ParseUUIDPipe) productId: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.catalog.removePhoto(productId, fileId);
  }

  // ---- Pedidos ----

  @Get('orders')
  @RequirePermission('store.orders.read')
  listOrders(@Query(new ZodPipe(ordersQuery)) q: z.infer<typeof ordersQuery>) {
    return this.orders.list(q);
  }

  /** Pedido lançado pela equipe (telefone, balcão). */
  @Post('orders')
  @RequirePermission('store.orders.manage')
  createOrder(@Body(new ZodPipe(adminOrderInput)) body: AdminOrderInput) {
    return this.orders.create(body);
  }

  @Get('orders/:id')
  @RequirePermission('store.orders.read')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Post('orders/:id/status')
  @HttpCode(200)
  @RequirePermission('store.orders.manage')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(statusInput)) body: z.infer<typeof statusInput>) {
    return this.orders.setStatus(id, body.status);
  }

  @Post('orders/:id/complete')
  @HttpCode(200)
  @RequirePermission('store.orders.manage')
  complete(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeInput)) body: z.infer<typeof completeInput>) {
    return this.orders.complete(id, body);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermission('store.orders.cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelInput)) body: z.infer<typeof cancelInput>) {
    return this.orders.cancel(id, body.reason);
  }
}

/** Imagem servida sem login: cache longo (o endereço muda quando a imagem muda) e nada executável. */
function sendImage(req: Request, res: Response, opened: { file: { id: string; mime: string; filename: string; size: number }; stream: Readable }, maxAge: string) {
  const etag = `"${opened.file.id}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', maxAge);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (req.headers['if-none-match'] === etag) {
    opened.stream.destroy();
    res.status(304).end();
    return;
  }
  res.setHeader('Content-Type', opened.file.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(opened.file.filename)}"`);
  if (opened.file.size) res.setHeader('Content-Length', String(opened.file.size));
  opened.stream.once('error', () => res.destroy());
  opened.stream.pipe(res);
}

/** Vitrine pública (/loja/<slug>): sem login, com limite de requisições por IP. */
@Controller('public/store/:slug')
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class PublicStoreController {
  constructor(private readonly store: StorePublicService) {}

  @Get()
  storefront(@Param('slug') slug: string) {
    return this.store.storefront(slug);
  }

  /** Resposta montada à mão (sem passthrough), senão o Nest trocaria o 304 por 200. */
  @Get('photos/:fileId')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async photo(@Param('slug') slug: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: Request, @Res() res: Response) {
    sendImage(req, res, await this.store.photo(slug, fileId), 'public, max-age=31536000, immutable');
  }

  @Get('banner')
  async banner(@Param('slug') slug: string, @Query(new ZodPipe(bannerQuery)) q: z.infer<typeof bannerQuery>, @Req() req: Request, @Res() res: Response) {
    const found = await this.store.banner(slug);
    if (!found) throw new NotFoundException({ code: 'BANNER_NOT_FOUND', message: 'Esta loja não tem banner' });
    sendImage(req, res, found, q.v === found.fileId ? 'public, max-age=31536000, immutable' : 'public, max-age=300, stale-while-revalidate=86400');
  }

  @Get('cep/:cep')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  cep(@Param('slug') slug: string, @Param('cep') cep: string) {
    return this.store.lookupCep(slug, cep);
  }

  @Post('orders')
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  place(@Param('slug') slug: string, @Body(new ZodPipe(publicOrderInput)) body: PublicOrderInput) {
    return this.store.place(slug, body, requestContext.get().ip);
  }
}
