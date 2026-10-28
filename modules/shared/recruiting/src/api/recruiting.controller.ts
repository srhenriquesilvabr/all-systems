import { MAX_DOCUMENT_BYTES, ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { ModuleRoute, Public, RequirePermission, requestContext } from '@all/module-sdk';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import {
  analyzeInput,
  applicationInput,
  candidateInput,
  candidatePatch,
  candidatesQuery,
  hireInput,
  jobInput,
  jobPatch,
  jobsQuery,
  jobStatusInput,
  moveInput,
  noteInput,
  publicApplicationInput,
  rejectInput,
  type ApplicationInput,
  type CandidateInput,
  type JobInput,
  type JobPatch,
} from '../contracts';
import { RECRUITING } from '../manifest';
import { PublicJobsService } from './public.service';
import { RecruitingService } from './recruiting.service';
import { MAX_RESUME_BYTES } from './shared';

function sendFile(res: Response, opened: { file: { mime: string; filename: string }; stream: Readable }) {
  res.setHeader('Content-Type', opened.file.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(opened.file.filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(opened.stream);
}

@Controller('recruiting')
@ModuleRoute(RECRUITING)
export class RecruitingController {
  constructor(private readonly recruiting: RecruitingService) {}

  /** IA disponível, Gupy, endereços públicos (cabeçalho das telas). */
  @Get('status')
  @RequirePermission('recruiting.jobs.read')
  status() {
    return this.recruiting.status();
  }

  @Get('companies')
  @RequirePermission('recruiting.jobs.read')
  companies() {
    return this.recruiting.companies();
  }

  // ---- Vagas ----

  @Get('jobs')
  @RequirePermission('recruiting.jobs.read')
  listJobs(@Query(new ZodPipe(jobsQuery)) q: z.infer<typeof jobsQuery>) {
    return this.recruiting.listJobs(q);
  }

  @Post('jobs')
  @RequirePermission('recruiting.jobs.manage')
  createJob(@Body(new ZodPipe(jobInput)) body: JobInput) {
    return this.recruiting.createJob(body);
  }

  @Get('jobs/:id')
  @RequirePermission('recruiting.jobs.read')
  getJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.getJob(id);
  }

  @Patch('jobs/:id')
  @RequirePermission('recruiting.jobs.manage')
  updateJob(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(jobPatch)) body: JobPatch) {
    return this.recruiting.updateJob(id, body);
  }

  @Post('jobs/:id/status')
  @HttpCode(200)
  @RequirePermission('recruiting.jobs.manage')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(jobStatusInput)) body: z.infer<typeof jobStatusInput>) {
    return this.recruiting.setJobStatus(id, body.status);
  }

  @Post('jobs/:id/gupy/sync')
  @HttpCode(202)
  @RequirePermission('recruiting.jobs.manage')
  resync(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.resyncJob(id);
  }

  /** Funil: candidaturas da vaga por etapa, das maiores notas para as menores. */
  @Get('jobs/:id/applications')
  @RequirePermission('recruiting.jobs.read', 'recruiting.candidates.read')
  board(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.board(id);
  }

  // ---- Candidaturas ----

  @Post('applications')
  @RequirePermission('recruiting.candidates.manage')
  createApplication(@Body(new ZodPipe(applicationInput)) body: ApplicationInput) {
    return this.recruiting.createApplication(body);
  }

  @Get('applications/:id')
  @RequirePermission('recruiting.candidates.read')
  getApplication(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.getApplication(id);
  }

  @Post('applications/:id/move')
  @HttpCode(200)
  @RequirePermission('recruiting.candidates.manage')
  move(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(moveInput)) body: z.infer<typeof moveInput>) {
    return this.recruiting.move(id, body.stageId);
  }

  @Post('applications/:id/reject')
  @HttpCode(200)
  @RequirePermission('recruiting.candidates.manage')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectInput)) body: z.infer<typeof rejectInput>) {
    return this.recruiting.reject(id, body.reason);
  }

  @Post('applications/:id/notes')
  @RequirePermission('recruiting.candidates.manage')
  addNote(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(noteInput)) body: z.infer<typeof noteInput>) {
    return this.recruiting.addNote(id, body.text);
  }

  @Post('applications/:id/analyze')
  @HttpCode(202)
  @RequirePermission('recruiting.candidates.manage')
  analyze(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(analyzeInput)) body: z.infer<typeof analyzeInput>) {
    return this.recruiting.reanalyze(id, body.analysis);
  }

  /** Cria a pessoa da equipe (core.team) do candidato contratado. */
  @Post('applications/:id/hire')
  @HttpCode(200)
  @RequirePermission('recruiting.candidates.manage')
  hire(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(hireInput)) body: z.infer<typeof hireInput>) {
    return this.recruiting.hire(id, body);
  }

  @Get('applications/:id/resume')
  @RequirePermission('recruiting.candidates.read')
  @Header('Cache-Control', 'private, no-store')
  async applicationResume(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.recruiting.openApplicationResume(id));
  }

  // ---- Banco de talentos ----

  @Get('candidates')
  @RequirePermission('recruiting.candidates.read')
  listCandidates(@Query(new ZodPipe(candidatesQuery)) q: z.infer<typeof candidatesQuery>) {
    return this.recruiting.listCandidates(q);
  }

  @Post('candidates')
  @RequirePermission('recruiting.candidates.manage')
  createCandidate(@Body(new ZodPipe(candidateInput)) body: CandidateInput) {
    return this.recruiting.createCandidate(body);
  }

  @Get('candidates/:id')
  @RequirePermission('recruiting.candidates.read')
  getCandidate(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.getCandidate(id);
  }

  @Patch('candidates/:id')
  @RequirePermission('recruiting.candidates.manage')
  updateCandidate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(candidatePatch)) body: Partial<CandidateInput>) {
    return this.recruiting.updateCandidate(id, body);
  }

  @Post('candidates/:id/resume')
  @RequirePermission('recruiting.candidates.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  setResume(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie o arquivo no campo "file"' });
    return this.recruiting.setCandidateResume(id, file);
  }

  @Get('candidates/:id/resume')
  @RequirePermission('recruiting.candidates.read')
  @Header('Cache-Control', 'private, no-store')
  async candidateResume(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.recruiting.openCandidateResume(id));
  }

  @Get('candidates/:id/export')
  @RequirePermission('recruiting.candidates.privacy')
  @Header('Cache-Control', 'private, no-store')
  exportCandidate(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.exportCandidate(id);
  }

  @Post('candidates/:id/anonymize')
  @HttpCode(200)
  @RequirePermission('recruiting.candidates.privacy')
  anonymize(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.anonymize(id);
  }
}

/** Página pública de vagas e feed do Indeed: sem login, com limite de requisições por IP. */
@Controller('public/jobs/:slug')
@Public()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicJobsController {
  constructor(private readonly jobs: PublicJobsService) {}

  @Get()
  list(@Param('slug') slug: string) {
    return this.jobs.list(slug);
  }

  @Get('feeds/indeed.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=900')
  indeed(@Param('slug') slug: string) {
    return this.jobs.indeed(slug);
  }

  @Get(':jobId')
  detail(@Param('slug') slug: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.jobs.detail(slug, jobId);
  }

  @Post(':jobId/apply')
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @UseInterceptors(FileInterceptor('resume', { limits: { fileSize: MAX_RESUME_BYTES, files: 1, fields: 30, fieldSize: 64 * 1024 } }))
  apply(
    @Param('slug') slug: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodPipe(publicApplicationInput)) body: z.infer<typeof publicApplicationInput>,
    @UploadedFile() file: StoredFile | undefined,
  ) {
    return this.jobs.apply(slug, jobId, body, file, requestContext.get().ip);
  }
}
