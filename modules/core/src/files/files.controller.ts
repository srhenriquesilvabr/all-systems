import { Controller, Get, Header, Param, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { FilesService } from './files.service';

/**
 * Download de arquivos do tenant. O upload é feito pelos módulos donos do arquivo
 * (ex.: foto de peça na lavanderia), que conferem a permissão adequada.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get(':id')
  @Header('Cache-Control', 'private, max-age=86400')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.files.open(id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }
}
