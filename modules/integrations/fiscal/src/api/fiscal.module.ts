import { ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { ModuleRoute, Public, RequireAnyPermission, RequirePermission } from '@all/module-sdk';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  cancelInput,
  correctionInput,
  docTypes,
  documentInput,
  documentListQuery,
  documentPatch,
  periodQuery,
  productCodeInput,
  seriesInput,
  serviceCodeInput,
  sourceListQuery,
  voidInput,
  type DocumentListQuery,
  type PeriodQuery,
  type ProductCodeInput,
  type SeriesInput,
  type ServiceCodeInput,
  type VoidInput,
} from '../contracts';
import { MAX_PFX_BYTES } from './certificate';
import { FiscalCodesService } from './codes.service';
import { FiscalConfigService } from './config.service';
import { FiscalContext } from './context.service';
import { FiscalDocumentsService } from './documents.service';
import { FiscalHttp } from './providers/http';
import { FocusProvider } from './providers/focus';
import { SimulatedProvider } from './providers/simulated';
import { NfeIoProvider, PlugNotasProvider } from './providers/skeletons';
import { FiscalReportsService } from './reports.service';
import { FiscalSourcesService } from './sources.service';

const P = {
  read: 'integration.fiscal.read',
  issue: 'integration.fiscal.issue',
  cancel: 'integration.fiscal.cancel',
  codes: 'integration.fiscal.codes',
  export: 'integration.fiscal.export',
  configure: 'integration.fiscal.configure',
} as const;

const passwordBody = z.object({ password: z.string().min(1, 'Informe a senha do certificado').max(200) });
const sourceDocBody = z.object({ type: z.enum(docTypes) });
const sendBody = z.object({ channels: z.array(z.enum(['email', 'whatsapp'])).min(1).default(['email']) });
const discardBody = z.object({ reason: z.string().trim().max(255).nullish() });
const fileKind = z.enum(['xml', 'pdf', 'cancel-xml', 'correction-xml', 'correction-pdf']);
const fileQuery = z.object({ sequence: z.coerce.number().int().min(1).max(20).optional() });
const settingsBody = z.record(z.unknown());

@Controller('fiscal')
@ModuleRoute('integration.fiscal')
export class FiscalController {
  constructor(
    private readonly config: FiscalConfigService,
    private readonly codes: FiscalCodesService,
    private readonly docs: FiscalDocumentsService,
    private readonly sources: FiscalSourcesService,
    private readonly reports: FiscalReportsService,
  ) {}

  // ---- Configuração ---------------------------------------------------------------------------------

  @Get('overview')
  @RequireAnyPermission(P.configure, P.issue, P.read)
  overview() {
    return this.config.overview();
  }

  @Put('settings')
  @RequirePermission(P.configure)
  saveSettings(@Body(new ZodPipe(settingsBody)) body: Record<string, unknown>) {
    return this.config.saveSettings(body);
  }

  @Post('certificate')
  @HttpCode(200)
  @RequirePermission(P.configure)
  @UseInterceptors(FileInterceptor('certificate', { limits: { fileSize: MAX_PFX_BYTES, files: 1 } }))
  uploadCertificate(@UploadedFile() file: StoredFile | undefined, @Body(new ZodPipe(passwordBody)) body: z.infer<typeof passwordBody>) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie o arquivo .pfx no campo "certificate"' });
    return this.config.uploadCertificate(file, body.password);
  }

  @Delete('certificate/:id')
  @HttpCode(204)
  @RequirePermission(P.configure)
  removeCertificate(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.removeCertificate(id);
  }

  @Put('series')
  @RequirePermission(P.configure)
  saveSeries(@Body(new ZodPipe(seriesInput)) body: SeriesInput) {
    return this.config.saveSeries(body);
  }

  @Post('webhook-secret')
  @HttpCode(200)
  @RequirePermission(P.configure)
  rotateWebhookSecret() {
    return this.config.rotateWebhookSecret();
  }

  @Post('provider/sync')
  @HttpCode(200)
  @RequirePermission(P.configure)
  syncProvider() {
    return this.config.syncProvider();
  }

  @Post('provider/webhook')
  @HttpCode(200)
  @RequirePermission(P.configure)
  registerWebhook() {
    return this.config.registerWebhook();
  }

  // ---- Cadastro fiscal ------------------------------------------------------------------------------

  @Get('codes/products')
  @RequireAnyPermission(P.codes, P.issue)
  products() {
    return this.codes.listProducts();
  }

  @Get('codes/pending')
  @RequireAnyPermission(P.codes, P.issue)
  pendingCodes() {
    return this.codes.pendingItems();
  }

  @Put('codes/products')
  @RequirePermission(P.codes)
  saveProduct(@Body(new ZodPipe(productCodeInput)) body: ProductCodeInput) {
    return this.codes.saveProduct(body);
  }

  @Delete('codes/products/:productId')
  @HttpCode(204)
  @RequirePermission(P.codes)
  removeProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.codes.removeProduct(productId);
  }

  @Get('codes/services')
  @RequireAnyPermission(P.codes, P.issue)
  services() {
    return this.codes.listServices();
  }

  @Put('codes/services')
  @RequirePermission(P.codes)
  saveService(@Body(new ZodPipe(serviceCodeInput)) body: ServiceCodeInput) {
    return this.codes.saveService(body);
  }

  @Delete('codes/services/:refType/:refId')
  @HttpCode(204)
  @RequirePermission(P.codes)
  removeService(@Param('refType') refType: string, @Param('refId') refId: string) {
    return this.codes.removeService(refType, refId);
  }

  // ---- Origens --------------------------------------------------------------------------------------

  @Get('sources')
  @RequirePermission(P.read)
  listSources(@Query(new ZodPipe(sourceListQuery)) q: z.infer<typeof sourceListQuery>) {
    return this.sources.list(q);
  }

  @Post('sources/:id/document')
  @RequirePermission(P.issue)
  sourceDocument(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sourceDocBody)) body: z.infer<typeof sourceDocBody>) {
    return this.sources.createDocument(id, body.type);
  }

  // ---- Notas ----------------------------------------------------------------------------------------

  @Get('documents')
  @RequirePermission(P.read)
  list(@Query(new ZodPipe(documentListQuery)) q: DocumentListQuery) {
    return this.docs.list(q);
  }

  @Post('documents')
  @RequirePermission(P.issue)
  create(@Body(new ZodPipe(documentInput)) body: z.infer<typeof documentInput>) {
    return this.docs.create(body);
  }

  @Get('documents/:id')
  @RequirePermission(P.read)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.get(id);
  }

  @Patch('documents/:id')
  @RequirePermission(P.issue)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(documentPatch)) body: z.infer<typeof documentPatch>) {
    return this.docs.update(id, body);
  }

  @Post('documents/:id/issue')
  @HttpCode(200)
  @RequirePermission(P.issue)
  issue(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.issue(id);
  }

  @Post('documents/:id/refresh')
  @HttpCode(200)
  @RequireAnyPermission(P.issue, P.cancel)
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.refresh(id);
  }

  @Post('documents/:id/discard')
  @HttpCode(200)
  @RequirePermission(P.issue)
  discard(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(discardBody)) body: z.infer<typeof discardBody>) {
    return this.docs.discard(id, body.reason);
  }

  @Post('documents/:id/cancel')
  @HttpCode(200)
  @RequirePermission(P.cancel)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelInput)) body: z.infer<typeof cancelInput>) {
    return this.docs.cancel(id, body.reason);
  }

  @Post('documents/:id/correction')
  @HttpCode(200)
  @RequirePermission(P.cancel)
  correct(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(correctionInput)) body: z.infer<typeof correctionInput>) {
    return this.docs.correct(id, body.text);
  }

  @Post('documents/:id/send')
  @HttpCode(200)
  @RequirePermission(P.issue)
  send(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sendBody)) body: z.infer<typeof sendBody>) {
    return this.docs.send(id, body.channels);
  }

  @Get('documents/:id/files/:kind')
  @RequirePermission(P.export)
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ZodPipe(fileKind)) kind: z.infer<typeof fileKind>,
    @Query(new ZodPipe(fileQuery)) q: z.infer<typeof fileQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.docs.download(id, kind, q.sequence);
    sendHeaders(res, file);
    return new StreamableFile(stream);
  }

  // ---- Numeração ------------------------------------------------------------------------------------

  @Get('voids')
  @RequirePermission(P.read)
  voids() {
    return this.docs.listVoids();
  }

  @Post('voids')
  @RequirePermission(P.cancel)
  voidRange(@Body(new ZodPipe(voidInput)) body: VoidInput) {
    return this.docs.voidRange(body);
  }

  @Get('gaps')
  @RequirePermission(P.read)
  gaps() {
    return this.docs.gapsNow();
  }

  // ---- Relatórios -----------------------------------------------------------------------------------

  @Get('reports/summary')
  @RequirePermission(P.export)
  summary(@Query(new ZodPipe(periodQuery)) q: PeriodQuery) {
    return this.reports.summary(q);
  }

  @Get('reports/spreadsheet')
  @RequirePermission(P.export)
  async spreadsheet(@Query(new ZodPipe(periodQuery)) q: PeriodQuery, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="notas-fiscais-${q.from}-a-${q.to}.csv"`);
    return this.reports.spreadsheet(q);
  }

  @Get('reports/xml-zip')
  @RequirePermission(P.export)
  async xmlZip(@Query(new ZodPipe(periodQuery)) q: PeriodQuery, @Res({ passthrough: true }) res: Response) {
    const { filename, content } = await this.reports.xmlZip(q);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(content);
  }
}

/**
 * Sem login: aviso do provedor (segredo no cabeçalho X-Fiscal-Token) e o link da nota que vai para
 * o cliente (token HMAC por nota).
 */
@Controller('public/fiscal')
@Public()
export class FiscalPublicController {
  constructor(private readonly docs: FiscalDocumentsService) {}

  @Post('webhook/:tenantId')
  @HttpCode(200)
  @SkipThrottle()
  async webhook(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Headers('x-fiscal-token') token: string | undefined, @Body() body: Record<string, unknown>) {
    const result = await this.docs.webhook(tenantId, token, body ?? {});
    if (!result.ok && result.reason === 'unknown') throw new NotFoundException();
    if (!result.ok) throw new UnauthorizedException();
    return { applied: !!result.applied };
  }

  @Get(':tenantId/documents/:id/:kind')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async download(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ZodPipe(z.enum(['pdf', 'xml']))) kind: 'pdf' | 'xml',
    @Query('t') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const opened = token ? await this.docs.publicDownload(tenantId, id, kind, token) : null;
    if (!opened) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Nota não encontrada' });
    sendHeaders(res, opened.file);
    return new StreamableFile(opened.stream);
  }
}

/** XML e PDF como anexo; o DANFE em HTML (NFC-e da Focus) nunca roda no nosso domínio. */
function sendHeaders(res: Response, file: { mime: string; filename: string; size: number }) {
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `${file.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  if (file.size) res.setHeader('Content-Length', String(file.size));
}

@Module({
  controllers: [FiscalController, FiscalPublicController],
  providers: [
    FiscalContext,
    FiscalConfigService,
    FiscalCodesService,
    FiscalDocumentsService,
    FiscalSourcesService,
    FiscalReportsService,
    FiscalHttp,
    SimulatedProvider,
    FocusProvider,
    PlugNotasProvider,
    NfeIoProvider,
  ],
  exports: [FiscalDocumentsService],
})
export class FiscalModule {}
