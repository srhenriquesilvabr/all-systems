import { MAX_IMAGE_BYTES, ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { ModuleRoute, RequireAnyPermission, RequirePermission } from '@all/module-sdk';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  budgetApproveInput,
  budgetInput,
  caseCloseInput,
  caseInput,
  caseUpdateInput,
  consentAcceptInput,
  consentTemplateInput,
  credentialInput,
  lotInput,
  photoMeta,
  productInput,
  specialtyKeys,
  specialtyRecordInput,
  stageInput,
  surgeryScheduleInput,
  type BudgetApproveInput,
  type BudgetInput,
  type CaseInput,
  type CaseUpdateInput,
  type ConsentAcceptInput,
  type ConsentTemplateInput,
  type CredentialInput,
  type LotInput,
  type PhotoMeta,
  type ProductInput,
  type SpecialtyRecordInput,
  type SurgeryScheduleInput,
} from '../contracts';
import { SpecialtyClinicalService } from './clinical.service';
import { SpecialtySetupService } from './setup.service';

const records = { read: 'shared.medical-records.read', write: 'shared.medical-records.write' };
const SETUP = 'aesthetics.setup.manage';
const BUDGET = 'aesthetics.surgery.budget';

const productsQuery = z.object({
  specialty: z.enum(specialtyKeys).optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
const templatesQuery = z.object({ specialty: z.enum(specialtyKeys).optional() });
const casesQuery = z.object({
  customerId: z.string().uuid().optional(),
  specialty: z.enum(specialtyKeys).optional(),
  status: z.enum(['active', 'finished', 'cancelled']).optional(),
});
const lotUpdateInput = z.object({
  lot: z.string().trim().min(1, 'Informe o lote').max(40),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  quantity: z.coerce.number().min(0).max(1_000_000).nullish(),
  notes: z.string().trim().max(300).nullish(),
});

/** Especialidades da estética: cadastros (produtos, lotes, termos, conselhos) e a parte clínica. */
@Controller('aesthetics')
@ModuleRoute('aesthetics')
export class SpecialtiesController {
  constructor(
    private readonly setup: SpecialtySetupService,
    private readonly clinical: SpecialtyClinicalService,
  ) {}

  @Get('specialties')
  @RequireAnyPermission(records.read, SETUP, BUDGET, 'aesthetics.packages.read')
  overview() {
    return this.setup.overview();
  }

  // ---- Registro no conselho --------------------------------------------------------------------

  // A recepção escolhe o cirurgião ao marcar a cirurgia (BUDGET).
  @Get('credentials')
  @RequireAnyPermission(SETUP, records.write, BUDGET)
  credentials() {
    return this.setup.listCredentials();
  }

  @Put('credentials/:resourceId')
  @HttpCode(204)
  @RequirePermission(SETUP)
  saveCredential(@Param('resourceId', ParseUUIDPipe) resourceId: string, @Body(new ZodPipe(credentialInput)) body: CredentialInput) {
    return this.setup.saveCredential(resourceId, body);
  }

  @Delete('credentials/:resourceId')
  @HttpCode(204)
  @RequirePermission(SETUP)
  removeCredential(@Param('resourceId', ParseUUIDPipe) resourceId: string) {
    return this.setup.removeCredential(resourceId);
  }

  // ---- Produtos e lotes ------------------------------------------------------------------------

  @Get('products')
  @RequireAnyPermission(SETUP, records.write)
  products(@Query(new ZodPipe(productsQuery)) q: z.infer<typeof productsQuery>) {
    return this.setup.listProducts(q);
  }

  @Post('products')
  @RequirePermission(SETUP)
  createProduct(@Body(new ZodPipe(productInput)) body: ProductInput) {
    return this.setup.createProduct(body);
  }

  @Patch('products/:id')
  @RequirePermission(SETUP)
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productInput)) body: ProductInput) {
    return this.setup.updateProduct(id, body);
  }

  @Post('lots')
  @RequirePermission(SETUP)
  addLot(@Body(new ZodPipe(lotInput)) body: LotInput) {
    return this.setup.addLot(body);
  }

  @Patch('lots/:id')
  @RequirePermission(SETUP)
  updateLot(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lotUpdateInput)) body: z.infer<typeof lotUpdateInput>) {
    return this.setup.updateLot(id, body);
  }

  /** Quem recebeu o lote: dado de saúde, com permissão do prontuário e registro no log de acesso. */
  @Get('lots/:id/trace')
  @RequirePermission(records.read)
  trace(@Param('id', ParseUUIDPipe) id: string) {
    return this.setup.traceLot(id);
  }

  // ---- Modelos de termo ------------------------------------------------------------------------

  @Get('consent-templates')
  @RequireAnyPermission(SETUP, records.write)
  templates(@Query(new ZodPipe(templatesQuery)) q: z.infer<typeof templatesQuery>) {
    return this.setup.listTemplates(q.specialty);
  }

  @Post('consent-templates')
  @RequirePermission(SETUP)
  createTemplate(@Body(new ZodPipe(consentTemplateInput)) body: ConsentTemplateInput) {
    return this.setup.createTemplate(body);
  }

  @Patch('consent-templates/:id')
  @RequirePermission(SETUP)
  updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(consentTemplateInput)) body: ConsentTemplateInput) {
    return this.setup.updateTemplate(id, body);
  }

  // ---- Prontuário das especialidades -----------------------------------------------------------

  @Get('patients/:customerId')
  @RequirePermission(records.read)
  patient(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.clinical.patient(customerId);
  }

  @Post('records')
  @RequirePermission(records.write)
  record(@Body(new ZodPipe(specialtyRecordInput)) body: SpecialtyRecordInput) {
    return this.clinical.record(body);
  }

  @Post('photos')
  @RequirePermission(records.write)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  // Os dados da foto vão na URL (o upload do admin manda só o arquivo); nada de texto livre ali.
  photo(@Query(new ZodPipe(photoMeta)) meta: PhotoMeta, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie a foto no campo "file"' });
    return this.clinical.photo(meta, file);
  }

  @Post('consents')
  @RequirePermission(records.write)
  consent(@Body(new ZodPipe(consentAcceptInput)) body: ConsentAcceptInput) {
    return this.clinical.consent(body);
  }

  // ---- Casos (tratamentos) ---------------------------------------------------------------------

  @Get('cases')
  @RequireAnyPermission(records.read, BUDGET)
  cases(@Query(new ZodPipe(casesQuery)) q: z.infer<typeof casesQuery>) {
    return this.clinical.listCases(q);
  }

  @Post('cases')
  @RequirePermission(records.write)
  createCase(@Body(new ZodPipe(caseInput)) body: CaseInput) {
    return this.clinical.createCase(body);
  }

  @Patch('cases/:id')
  @RequirePermission(records.write)
  updateCase(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(caseUpdateInput)) body: CaseUpdateInput) {
    return this.clinical.updateCase(id, body);
  }

  @Post('cases/:id/close')
  @RequirePermission(records.write)
  closeCase(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(caseCloseInput)) body: z.infer<typeof caseCloseInput>) {
    return this.clinical.closeCase(id, body.status, body.reason);
  }

  @Post('cases/:id/stage')
  @RequirePermission(records.write)
  stage(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(stageInput)) body: z.infer<typeof stageInput>) {
    return this.clinical.setStage(id, body.stage);
  }

  @Put('cases/:id/budget')
  @RequirePermission(BUDGET)
  saveBudget(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(budgetInput)) body: BudgetInput) {
    return this.clinical.saveBudget(id, body);
  }

  @Post('cases/:id/budget/approve')
  @RequirePermission(BUDGET)
  approveBudget(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(budgetApproveInput)) body: BudgetApproveInput) {
    return this.clinical.approveBudget(id, body);
  }

  @Post('cases/:id/surgery')
  @RequirePermission('shared.scheduling.write')
  scheduleSurgery(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(surgeryScheduleInput)) body: SurgeryScheduleInput) {
    return this.clinical.scheduleSurgery(id, body);
  }
}
