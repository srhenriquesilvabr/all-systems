import { RequirePermission } from '@all/module-sdk';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, type UploadedFile as StoredFile } from '../files/files.service';
import { teamMemberInput, TeamService, type TeamMemberInput, type TeamMemberPatch } from './team.service';

const listQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['active', 'ended', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const fileRequired = (field: string) => new BadRequestException({ code: 'FILE_REQUIRED', message: `Envie o arquivo no campo "${field}"` });

/** Pessoas da equipe: dados pessoais (dado sensível). Leituras do cadastro e do currículo ficam na auditoria. */
@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermission('core.team.read')
  list(@Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.team.list(query);
  }

  @Get(':id')
  @RequirePermission('core.team.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.team.get(id);
  }

  @Post()
  @RequirePermission('core.team.manage')
  create(@Body(new ZodPipe(teamMemberInput)) body: TeamMemberInput) {
    return this.team.create(body);
  }

  @Patch(':id')
  @RequirePermission('core.team.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(teamMemberInput.partial())) body: TeamMemberPatch) {
    return this.team.update(id, body);
  }

  @Post(':id/photo')
  @RequirePermission('core.team.manage')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  setPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw fileRequired('photo');
    return this.team.setPhoto(id, file);
  }

  @Delete(':id/photo')
  @HttpCode(204)
  @RequirePermission('core.team.manage')
  removePhoto(@Param('id', ParseUUIDPipe) id: string) {
    return this.team.removePhoto(id);
  }

  @Post(':id/resume')
  @RequirePermission('core.team.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  setResume(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: StoredFile | undefined) {
    if (!file) throw fileRequired('file');
    return this.team.setResume(id, file);
  }

  @Delete(':id/resume')
  @HttpCode(204)
  @RequirePermission('core.team.manage')
  removeResume(@Param('id', ParseUUIDPipe) id: string) {
    return this.team.removeResume(id);
  }

  @Get(':id/resume')
  @RequirePermission('core.team.read')
  @Header('Cache-Control', 'private, no-store')
  async downloadResume(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.team.openResume(id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }
}
