import { RequirePermission } from '@all/module-sdk';
import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { SegmentationService, type CustomerRfm } from './segmentation.service';

const segments = ['champions', 'loyal', 'promising', 'new', 'at_risk', 'hibernating', 'lost'] as const;
const listQuery = z.object({ segment: z.enum(segments).optional(), limit: z.coerce.number().int().min(1).max(5000).default(200) });

const segmentLabel: Record<(typeof segments)[number], string> = {
  champions: 'Campeões',
  loyal: 'Leais',
  promising: 'Promissores',
  new: 'Novos',
  at_risk: 'Em risco',
  hibernating: 'Hibernando',
  lost: 'Perdidos',
};

/** CSV para planilha (separador ";" e vírgula decimal, como o Excel em português espera). */
function toCsv(rows: CustomerRfm[]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Cliente', 'Telefone', 'E-mail', 'Segmento', 'Última compra', 'Dias desde a última', 'Compras (12 meses)', 'Valor (12 meses)', 'R', 'F', 'M'];
  const lines = rows.map((r) =>
    [r.customer.name, r.customer.phone, r.customer.email, segmentLabel[r.segment], r.lastPurchaseOn, r.recencyDays, r.frequency, r.monetary, r.r, r.f, r.m].map(cell).join(';'),
  );
  return `﻿${[header.join(';'), ...lines].join('\r\n')}\r\n`;
}

@Controller('segmentation')
export class SegmentationController {
  constructor(private readonly segmentation: SegmentationService) {}

  @Get('summary')
  @RequirePermission('core.segmentation.read')
  summary() {
    return this.segmentation.summary();
  }

  @Get('customers')
  @RequirePermission('core.segmentation.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.segmentation.list(q);
  }

  @Get('customers.csv')
  @RequirePermission('core.segmentation.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return toCsv(await this.segmentation.list({ ...q, limit: 5000 }));
  }

  @Get('customers/:id')
  @RequirePermission('core.customers.read')
  ofCustomer(@Param('id', ParseUUIDPipe) id: string) {
    return this.segmentation.ofCustomer(id);
  }

  @Post('recompute')
  @RequirePermission('core.segmentation.manage')
  recompute() {
    return this.segmentation.recompute();
  }
}
