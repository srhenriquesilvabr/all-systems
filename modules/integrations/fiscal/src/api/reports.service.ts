import { AuditService, FilesService, TenantDb } from '@all/core';
import type { Tx } from '@all/db';
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { docStatusLabel, docTypeShort, environmentLabel, sourceTypeLabel, type FiscalReport, type PeriodQuery, type ReportRow } from '../contracts';
import { fiscalDocuments } from '../db/schema';
import { FILE_OWNER, FiscalContext, toBuffer } from './context.service';
import { FiscalDocumentsService } from './documents.service';
import { csv, zip } from './files';

/** Teto do ZIP numa requisição (memória do Workers); acima disso, períodos menores. */
const MAX_ZIP_DOCUMENTS = 1500;
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

/** Relatórios para o contador: totais por período, planilha e XMLs em lote. */
@Injectable()
export class FiscalReportsService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly ctx: FiscalContext,
    private readonly docs: FiscalDocumentsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  summary(q: PeriodQuery): Promise<FiscalReport> {
    return this.tdb.run(async (tx) => {
      const env = q.environment ?? (await this.ctx.settingsInTx(tx)).environment;
      const num = (path: string) => sql<number>`coalesce(sum((${fiscalDocuments.taxes}->>${path})::numeric), 0)::float8`;
      const rows = await tx
        .select({
          type: fiscalDocuments.type,
          status: fiscalDocuments.status,
          count: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${fiscalDocuments.total}), 0)::float8`,
          iss: num('iss'),
          issWithheld: sql<number>`coalesce(sum(case when (${fiscalDocuments.taxes}->>'issWithheld')::boolean then (${fiscalDocuments.taxes}->>'iss')::numeric else 0 end), 0)::float8`,
          icms: num('icms'),
          pis: num('pis'),
          cofins: num('cofins'),
          retentions: sql<number>`coalesce(sum(
            coalesce((${fiscalDocuments.taxes}->'retentions'->>'ir')::numeric, 0) + coalesce((${fiscalDocuments.taxes}->'retentions'->>'pis')::numeric, 0) +
            coalesce((${fiscalDocuments.taxes}->'retentions'->>'cofins')::numeric, 0) + coalesce((${fiscalDocuments.taxes}->'retentions'->>'csll')::numeric, 0) +
            coalesce((${fiscalDocuments.taxes}->'retentions'->>'inss')::numeric, 0)), 0)::float8`,
          ibs: num('ibs'),
          cbs: num('cbs'),
        })
        .from(fiscalDocuments)
        .where(and(this.period(q, env), inArray(fiscalDocuments.status, ['authorized', 'cancelled', 'denied'])))
        .groupBy(fiscalDocuments.type, fiscalDocuments.status)
        .orderBy(asc(fiscalDocuments.type), asc(fiscalDocuments.status));
      const authorized = rows.filter((r) => r.status === 'authorized');
      const sum = (k: keyof Omit<ReportRow, 'type' | 'status'>) => Math.round(authorized.reduce((acc, r) => acc + Number(r[k]), 0) * 100) / 100;
      return {
        from: q.from,
        to: q.to,
        rows: rows as ReportRow[],
        totals: { count: sum('count'), total: sum('total'), iss: sum('iss'), issWithheld: sum('issWithheld'), icms: sum('icms'), pis: sum('pis'), cofins: sum('cofins'), retentions: sum('retentions'), ibs: sum('ibs'), cbs: sum('cbs') },
        gaps: await this.docs.gaps(tx, env),
      };
    });
  }

  /** Planilha (CSV para Excel): uma linha por nota do período, inclusive canceladas. */
  async spreadsheet(q: PeriodQuery): Promise<string> {
    return this.tdb.run(async (tx) => {
      const env = q.environment ?? (await this.ctx.settingsInTx(tx)).environment;
      const docs = await this.documents(tx, q, env);
      await this.audit.log(tx, { action: 'fiscal.export.spreadsheet', entity: 'module', entityId: 'integration.fiscal', data: { ...q, environment: env, count: docs.length } });
      return csvOf(docs);
    });
  }

  /** XMLs autorizados (e de cancelamento) do período num ZIP, com a planilha junto. */
  async xmlZip(q: PeriodQuery): Promise<{ filename: string; content: Buffer }> {
    const { docs, env } = await this.tdb.run(async (tx) => {
      const env = q.environment ?? (await this.ctx.settingsInTx(tx)).environment;
      const docs = await this.documents(tx, q, env);
      if (docs.length > MAX_ZIP_DOCUMENTS) throw new BadRequestException({ code: 'PERIOD_TOO_LARGE', message: `São ${docs.length} notas no período; exporte no máximo ${MAX_ZIP_DOCUMENTS} por vez (escolha um período menor)` });
      await this.audit.log(tx, { action: 'fiscal.export.xml_zip', entity: 'module', entityId: 'integration.fiscal', data: { ...q, environment: env, count: docs.length } });
      return { docs, env };
    });
    const entries: { name: string; content: Buffer; date?: Date }[] = [];
    for (const d of docs) {
      const folder = `${docTypeShort[d.type]}/${d.status === 'cancelled' ? 'canceladas' : 'autorizadas'}`;
      for (const [fileId, suffix] of [
        [d.xmlFileId, ''],
        [d.cancelXmlFileId, '-cancelamento'],
      ] as const) {
        if (!fileId) continue;
        const { stream } = await this.files.open(fileId, FILE_OWNER.document);
        entries.push({ name: `${folder}/${d.accessKey ?? `${d.series ?? 0}-${d.number ?? d.id}`}${suffix}.xml`, content: await toBuffer(stream), date: d.issuedAt ?? undefined });
      }
    }
    entries.push({ name: 'notas.csv', content: Buffer.from(csvOf(docs), 'utf8') });
    return { filename: `notas-fiscais-${q.from}-a-${q.to}${env === 'homologation' ? '-homologacao' : ''}.zip`, content: zip(entries) };
  }

  private documents(tx: Tx, q: PeriodQuery, env: string) {
    return tx
      .select()
      .from(fiscalDocuments)
      .where(and(this.period(q, env), inArray(fiscalDocuments.status, ['authorized', 'cancelled', 'denied'])))
      .orderBy(asc(fiscalDocuments.type), asc(fiscalDocuments.series), asc(fiscalDocuments.number));
  }

  private period(q: PeriodQuery, env: string) {
    return and(
      eq(fiscalDocuments.environment, env as 'homologation'),
      q.type ? eq(fiscalDocuments.type, q.type) : undefined,
      sql`${fiscalDocuments.issuedAt} >= (${q.from}::date::timestamp at time zone 'America/Sao_Paulo')`,
      sql`${fiscalDocuments.issuedAt} < ((${q.to}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`,
    );
  }
}

function csvOf(docs: (typeof fiscalDocuments.$inferSelect)[]) {
  const header = [
    'Tipo',
    'Ambiente',
    'Série',
    'Número',
    'Chave de acesso',
    'Emissão',
    'Situação',
    'Destinatário/tomador',
    'CPF/CNPJ',
    'Origem',
    'Valor total',
    'Desconto',
    'ISS',
    'ISS retido',
    'ICMS',
    'PIS',
    'COFINS',
    'Retenções federais',
    'IBS',
    'CBS',
    'Tributos aproximados',
    'Protocolo',
    'Cancelamento (motivo)',
  ];
  const rows = docs.map((d) => {
    const t = d.taxes;
    const retentions = Object.values(t.retentions ?? {}).reduce((a, b) => a + Number(b), 0);
    return [
      docTypeShort[d.type],
      environmentLabel[d.environment].split(' ')[0]!,
      d.series ?? '',
      d.number === null ? '' : String(d.number),
      d.accessKey ?? '',
      d.issuedAt ? dateTime.format(d.issuedAt) : '',
      docStatusLabel[d.status],
      d.recipient?.name ?? 'Consumidor não identificado',
      d.recipient?.document ?? '',
      d.sourceLabel ?? sourceTypeLabel[d.sourceType],
      Number(d.total),
      Number(d.discount),
      t.iss,
      t.issWithheld ? 'Sim' : 'Não',
      t.icms,
      t.pis,
      t.cofins,
      retentions,
      t.ibs,
      t.cbs,
      t.approximate,
      d.protocol ?? '',
      d.cancelReason ?? '',
    ];
  });
  return csv(header, rows);
}
