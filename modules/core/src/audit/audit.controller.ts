import { RequirePermission } from '@all/module-sdk';
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from './audit.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.date().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    action: z.string().trim().max(120).optional(),
    userId: z.union([z.literal('system'), z.string().uuid()]).optional(),
    q: z.string().trim().max(100).optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: 'O início do período deve ser antes do fim', path: ['from'] });

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('core.audit.read')
  list(@Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.audit.list(query);
  }

  /** Ações e pessoas que já aparecem na trilha, para os filtros da tela. */
  @Get('filters')
  @RequirePermission('core.audit.read')
  filters() {
    return this.audit.filterOptions();
  }
}
