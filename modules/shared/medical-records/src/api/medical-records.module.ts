import { MAX_DOCUMENT_BYTES, ZodPipe, type UploadedFile as StoredFile } from '@all/core';
import { ModuleRoute, RequirePermission } from '@all/module-sdk';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { amendInput, entryInput, type AmendInput, type EntryInput } from '../contracts';
import { MedicalRecordsService } from './medical-records.service';

const subjectQuery = z.object({ subjectType: z.string().min(1).max(40), subjectId: z.string().uuid() });
type SubjectQuery = z.infer<typeof subjectQuery>;

@Controller('medical-records')
@ModuleRoute('shared.medical-records')
export class MedicalRecordsController {
  constructor(private readonly records: MedicalRecordsService) {}

  @Get('forms')
  @RequirePermission('shared.medical-records.read')
  forms(@Query(new ZodPipe(subjectQuery.pick({ subjectType: true }))) q: { subjectType: string }) {
    return this.records.formsFor(q.subjectType);
  }

  @Get()
  @RequirePermission('shared.medical-records.read')
  list(@Query(new ZodPipe(subjectQuery)) q: SubjectQuery) {
    return this.records.list(q.subjectType, q.subjectId);
  }

  @Post()
  @RequirePermission('shared.medical-records.write')
  create(@Body(new ZodPipe(entryInput)) body: EntryInput) {
    return this.records.create(body);
  }

  @Post(':id/amend')
  @RequirePermission('shared.medical-records.write')
  amend(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(amendInput)) body: AmendInput) {
    return this.records.amend(id, body);
  }

  @Post(':id/attachments')
  @RequirePermission('shared.medical-records.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  attach(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie o arquivo no campo "file"' });
    return this.records.attach(id, file);
  }

  @Get('attachments/:fileId')
  @RequirePermission('shared.medical-records.read')
  @Header('Cache-Control', 'private, no-store')
  async download(@Param('fileId', ParseUUIDPipe) fileId: string, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.records.download(fileId);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }

  @Get('access-log')
  @RequirePermission('shared.medical-records.audit')
  accessLog(@Query(new ZodPipe(subjectQuery)) q: SubjectQuery) {
    return this.records.accessLog(q.subjectType, q.subjectId);
  }
}

@Module({ controllers: [MedicalRecordsController], providers: [MedicalRecordsService], exports: [MedicalRecordsService] })
export class MedicalRecordsModule {}
