import { Public, RequirePermission } from '@all/module-sdk';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { addressInput } from '../common/address';
import { ZodPipe } from '../common/zod.pipe';
import type { UploadedFile as StoredFile } from '../files/files.service';
import { CompanyService } from './company.service';
import { MAX_LOGO_BYTES } from './logo';

const MANAGE = 'core.company.manage';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));

const companyBody = z.object({
  name: z.string().trim().min(2, 'Informe o nome fantasia').max(120).optional(),
  legalName: optionalText(200),
  document: optionalText(20),
  stateRegistration: optionalText(30),
  municipalRegistration: optionalText(30),
  email: z
    .string()
    .trim()
    .email('E-mail inválido')
    .max(254)
    .nullish()
    .or(z.literal(''))
    .transform((v) => (v === undefined ? undefined : v || null)),
  phone: optionalText(20),
  website: optionalText(200),
  instagram: optionalText(100),
  address: addressInput,
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #rrggbb')
    .nullish(),
});

const logoQuery = z.object({ v: z.string().max(64).optional() });

/** Dados da empresa logada: cadastro, logo e cor do painel. */
@Controller('company')
@RequirePermission(MANAGE)
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  get() {
    return this.company.get();
  }

  @Patch()
  update(@Body(new ZodPipe(companyBody)) body: z.infer<typeof companyBody>) {
    return this.company.update(body);
  }

  @Post('logo')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: MAX_LOGO_BYTES, files: 1 } }))
  setLogo(@UploadedFile() file: StoredFile | undefined) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Envie o logo no campo "logo"' });
    return this.company.setLogo(file);
  }

  @Delete('logo')
  @HttpCode(204)
  removeLogo() {
    return this.company.removeLogo();
  }
}

/**
 * Logo pelo endereço público da empresa: agendamento online, lojinha e o próprio admin (<img>
 * não leva token). Com `?v=<id do arquivo atual>` a resposta pode ficar no cache por um ano;
 * sem ele, por pouco tempo, para a troca de logo aparecer logo.
 */
@Controller('public/company/:slug')
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class PublicCompanyController {
  constructor(private readonly company: CompanyService) {}

  /** Resposta montada à mão (sem passthrough), senão o Nest trocaria o 304 por 200. */
  @Get('logo')
  async logo(@Param('slug') slug: string, @Query(new ZodPipe(logoQuery)) query: z.infer<typeof logoQuery>, @Req() req: Request, @Res() res: Response) {
    const found = await this.company.publicLogo(slug);
    if (!found) throw new NotFoundException({ code: 'LOGO_NOT_FOUND', message: 'Esta empresa não tem logo' });

    const etag = `"${found.fileId}"`;
    res.setHeader('ETag', etag);
    res.setHeader(
      'Cache-Control',
      query.v === found.fileId ? 'public, max-age=31536000, immutable' : 'public, max-age=300, stale-while-revalidate=86400',
    );
    // Pode ser usado como <img> por páginas da empresa em outro domínio (ex.: lojinha).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Segunda camada para SVG: mesmo aberto direto no navegador, nada executa.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const { file, stream } = await this.company.openLogo(found.tenantId, found.fileId);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    if (file.size) res.setHeader('Content-Length', String(file.size));
    stream.once('error', () => res.destroy());
    stream.pipe(res);
  }
}
