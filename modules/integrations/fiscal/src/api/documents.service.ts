import { AuditService, CoreConfig, CustomerDataRegistry, CustomersService, FilesService, MessageChannels, OutboxHandlers, OutboxService, ScheduledJobs, TenantDb, type OutboxEvent } from '@all/core';
import { customers, tenantModules, users } from '@all/core/schema';
import { uuidv7, type Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, max, or, sql, type SQL } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import {
  DELIVER,
  DOCUMENT_UPDATED,
  docTypeShort,
  editableStatuses,
  isSimples,
  isValidPersonOrCompany,
  MODULE,
  normalizeIcmsSituation,
  TRANSMIT,
  type CompanyFiscal,
  type DocStatus,
  type DocType,
  type DocumentItem,
  type DocumentListQuery,
  type DocumentPayment,
  type DocumentSummary,
  type DocumentUpdated,
  type FiscalDocument,
  type FiscalSettings,
  type Recipient,
  type SourceType,
  type Taxes,
  type ValidationIssue,
  type VoidInput,
  type VoidRecord,
  documentInput,
  documentPatch,
} from '../contracts';
import { fiscalCorrections, fiscalDocumentEvents, fiscalDocuments, fiscalProductCodes, fiscalSeries, fiscalServiceCodes, fiscalSources, fiscalVoids } from '../db/schema';
import { asGatewayError, FILE_OWNER, FiscalContext } from './context.service';
import { FiscalProviderError, ProviderNotReadyError, type ProviderContext, type ProviderDocument, type ProviderFile, type ProviderResult } from './providers/types';

type DocRow = typeof fiscalDocuments.$inferSelect;
type ParsedInput = z.infer<typeof documentInput>;
type ParsedPatch = z.infer<typeof documentPatch>;
type ParsedItem = ParsedInput['items'][number];
type EventSource = (typeof fiscalDocumentEvents.$inferInsert)['source'];

const badRequest = (code: string, message: string | string[]) => new BadRequestException({ code, message });
const round2 = (n: number) => Math.round(n * 100) / 100;
const UNIT: Record<string, string> = { un: 'UN', kg: 'KG', g: 'G', l: 'L', ml: 'ML', pct: 'PCT' };

/** Prazos de cancelamento fixos (a NFS-e é configurável, varia por município). */
const CANCEL_MINUTES: Record<Exclude<DocType, 'nfse'>, number> = { nfce: 30, nfe: 24 * 60 };

export interface DocumentOrigin {
  sourceType: SourceType;
  sourceId: string | null;
  sourceLabel: string | null;
}

@Injectable()
export class FiscalDocumentsService implements OnModuleInit {
  private readonly logger = new Logger('Fiscal');

  constructor(
    private readonly tdb: TenantDb,
    private readonly ctx: FiscalContext,
    private readonly files: FilesService,
    private readonly customers: CustomersService,
    private readonly outbox: OutboxService,
    private readonly handlers: OutboxHandlers,
    private readonly jobs: ScheduledJobs,
    private readonly audit: AuditService,
    private readonly channels: MessageChannels,
    private readonly config: CoreConfig,
    private readonly customerData: CustomerDataRegistry,
  ) {}

  onModuleInit() {
    this.handlers.on<{ documentId: string }>(TRANSMIT, 'fiscal.transmit', (e) => this.transmit(e.payload.documentId));
    this.handlers.on<{ documentId: string; channels?: ('email' | 'whatsapp')[] }>(DELIVER, 'fiscal.deliver', (e) => this.deliver(e));
    this.jobs.every('fiscal.poll', 5 * 60_000, () => this.pollAll());
    this.customerData.register({
      moduleKey: MODULE,
      export: async (tx, customerId) =>
        (await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.customerId, customerId))).map((d) => ({
          type: d.type,
          number: d.number,
          series: d.series,
          status: d.status,
          total: Number(d.total),
          issuedAt: d.issuedAt,
          recipient: d.recipient,
        })),
      // Nota emitida fica (guarda obrigatória por 5 anos, LGPD art. 16, I); rascunho e descartada perdem os dados pessoais.
      anonymize: async (tx, customerId) => {
        await tx
          .update(fiscalDocuments)
          .set({ recipient: null, customerId: null })
          .where(and(eq(fiscalDocuments.customerId, customerId), inArray(fiscalDocuments.status, ['draft', 'discarded'])));
      },
    });
  }

  // ---- Rascunho -------------------------------------------------------------------------------------

  /** Nota avulsa (ou montada a partir de uma origem pelo serviço de origens). */
  create(input: ParsedInput): Promise<FiscalDocument> {
    return this.tdb.run(async (tx) => {
      const row = await this.createInTx(tx, input, { sourceType: 'manual', sourceId: null, sourceLabel: null });
      return this.detailInTx(tx, row.id);
    });
  }

  async createInTx(tx: Tx, input: ParsedInput, origin: DocumentOrigin, source: EventSource = 'user'): Promise<DocRow> {
    const { tenantId, userId } = requestContext.requireTenant();
    const s = await this.ctx.settingsInTx(tx);
    const recipient = await this.recipientFor(tx, input.customerId ?? null, input.recipient ?? null);
    const items = await this.fillItems(tx, input.type, input.items, s);
    const payments = input.type === 'nfse' ? [] : this.paymentsFor(input.payments, items);
    const total = round2(items.reduce((sum, i) => sum + i.total, 0));
    const [row] = await tx
      .insert(fiscalDocuments)
      .values({
        tenantId,
        type: input.type,
        environment: s.environment,
        provider: s.provider,
        status: 'draft',
        reference: newReference(),
        sourceType: origin.sourceType,
        sourceId: origin.sourceId,
        sourceLabel: origin.sourceLabel,
        customerId: input.customerId ?? null,
        recipient,
        items,
        payments,
        total: total.toFixed(2),
        discount: round2(items.reduce((sum, i) => sum + i.discount, 0)).toFixed(2),
        taxes: computeTaxes(input.type, items, recipient, total, s),
        nature: input.nature || (input.type === 'nfse' ? s.serviceNature : s.defaultNature),
        additionalInfo: [input.additionalInfo, s.additionalInfo].filter(Boolean).join('\n') || null,
        serviceDate: input.serviceDate ?? localDate(new Date()),
        createdBy: userId ?? null,
      })
      .returning();
    await this.event(tx, row!, { kind: 'created', status: 'draft', source, message: origin.sourceLabel ? `Gerada de: ${origin.sourceLabel}` : 'Nota avulsa' });
    await this.audit.log(tx, { action: 'fiscal.document.created', entity: 'fiscal_document', entityId: row!.id, data: { type: input.type, sourceType: origin.sourceType, sourceId: origin.sourceId } });
    return row!;
  }

  /** Corrige rascunho ou nota rejeitada (o que vier substitui) e recalcula itens e impostos. */
  update(id: string, patch: ParsedPatch): Promise<FiscalDocument> {
    return this.tdb.run(async (tx) => {
      const doc = await this.lockOrFail(tx, id);
      if (!editableStatuses.includes(doc.status)) throw badRequest('NOT_EDITABLE', 'Só rascunho ou nota rejeitada pode ser corrigida');
      const s = await this.ctx.settingsInTx(tx);
      const customerId = patch.customerId !== undefined ? (patch.customerId ?? null) : doc.customerId;
      const recipient = patch.recipient !== undefined || patch.customerId !== undefined ? await this.recipientFor(tx, customerId, patch.recipient ?? null) : doc.recipient;
      const items = patch.items ? await this.fillItems(tx, doc.type, patch.items, s) : doc.items;
      const total = round2(items.reduce((sum, i) => sum + i.total, 0));
      const payments = doc.type === 'nfse' ? [] : this.paymentsFor(patch.payments ?? (patch.items ? [] : doc.payments), items);
      await tx
        .update(fiscalDocuments)
        .set({
          customerId,
          recipient,
          items,
          payments,
          total: total.toFixed(2),
          discount: round2(items.reduce((sum, i) => sum + i.discount, 0)).toFixed(2),
          taxes: computeTaxes(doc.type, items, recipient, total, s),
          ...(patch.nature !== undefined ? { nature: patch.nature || (doc.type === 'nfse' ? s.serviceNature : s.defaultNature) } : {}),
          ...(patch.additionalInfo !== undefined ? { additionalInfo: patch.additionalInfo || null } : {}),
          ...(patch.serviceDate ? { serviceDate: patch.serviceDate } : {}),
        })
        .where(eq(fiscalDocuments.id, id));
      await this.event(tx, doc, { kind: 'edited', status: doc.status, source: 'user', message: 'Dados da nota corrigidos' });
      await this.audit.log(tx, { action: 'fiscal.document.updated', entity: 'fiscal_document', entityId: id, data: { fields: Object.keys(patch) } });
      return this.detailInTx(tx, id);
    });
  }

  /** Abandona rascunho ou rejeitada. Com número, ele vira lacuna (inutilize na tela de numeração). */
  discard(id: string, reason?: string | null): Promise<FiscalDocument> {
    return this.tdb.run(async (tx) => {
      const doc = await this.lockOrFail(tx, id);
      await this.discardInTx(tx, doc, reason ?? 'Descartada', 'user');
      return this.detailInTx(tx, id);
    });
  }

  async discardInTx(tx: Tx, doc: DocRow, reason: string, source: EventSource) {
    if (!editableStatuses.includes(doc.status)) throw badRequest('NOT_DISCARDABLE', 'Só rascunho ou nota rejeitada pode ser descartada');
    await tx.update(fiscalDocuments).set({ status: 'discarded', statusMessage: reason }).where(eq(fiscalDocuments.id, doc.id));
    await this.event(tx, doc, { kind: 'discarded', status: 'discarded', source, message: doc.number ? `${reason}. O nº ${doc.number} (série ${doc.series}) precisa ser inutilizado.` : reason });
    await this.audit.log(tx, { action: 'fiscal.document.discarded', entity: 'fiscal_document', entityId: doc.id, data: { reason } });
    await this.publishUpdated(tx, { ...doc, status: 'discarded' });
  }

  // ---- Emissão --------------------------------------------------------------------------------------

  /** Valida, numera e põe na fila de envio (o envio ao provedor sai pelo outbox). */
  issue(id: string): Promise<FiscalDocument> {
    return this.tdb.run(async (tx) => {
      const doc = await this.lockOrFail(tx, id);
      await this.issueInTx(tx, doc, 'user');
      return this.detailInTx(tx, id);
    });
  }

  async issueInTx(tx: Tx, doc: DocRow, source: EventSource) {
    if (!editableStatuses.includes(doc.status)) throw badRequest('NOT_ISSUABLE', 'Esta nota já foi enviada');
    const s = await this.ctx.settingsInTx(tx);
    const company = await this.ctx.company(tx);
    const issues = this.validate(doc, s, company);
    if (issues.length) throw new BadRequestException({ code: 'FISCAL_VALIDATION', message: issues.map((i) => i.message), issues });

    // Trocou de ambiente/provedor depois da rejeição: a referência e o número antigos não valem mais.
    const changed = doc.environment !== s.environment || doc.provider !== s.provider;
    let { number, series, reference } = doc;
    if (changed) {
      reference = newReference();
      number = null;
      series = null;
    }
    if (number === null && s.numbering === 'system') ({ number, series } = await this.nextNumber(tx, doc.type, s.environment));
    try {
      await tx.transaction((sp) =>
        sp
          .update(fiscalDocuments)
          .set({
            status: 'sending',
            environment: s.environment,
            provider: s.provider,
            reference,
            number,
            series,
            issuedAt: new Date(),
            statusCode: null,
            statusMessage: null,
            errors: [],
            // Reenvio depois de rejeição vai de novo ao provedor (a Focus aceita a mesma referência).
            transmittedAt: null,
          })
          .where(eq(fiscalDocuments.id, doc.id)),
      );
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') throw new ConflictException({ code: 'NUMBER_IN_USE', message: `O número ${number} da série ${series} já foi usado. Ajuste o próximo número na configuração fiscal.` });
      throw err;
    }
    const retry = doc.status === 'rejected';
    await this.event(tx, doc, { kind: retry ? 'resent' : 'sent', status: 'sending', source, message: `${retry ? 'Reenviada' : 'Enviada'} ao provedor${number ? ` (nº ${number}, série ${series})` : ''}` });
    await this.audit.log(tx, { action: retry ? 'fiscal.document.resent' : 'fiscal.document.issued', entity: 'fiscal_document', entityId: doc.id, data: { type: doc.type, number, series, environment: s.environment } });
    await this.outbox.publish(tx, TRANSMIT, { documentId: doc.id });
  }

  /** Handler do outbox (e "Atualizar" quando ainda não foi): manda ao provedor e aplica a resposta. */
  async transmit(documentId: string, source: EventSource = 'provider') {
    await this.tdb.run(async (tx) => {
      const doc = await this.lockOrFail(tx, documentId).catch(() => null);
      if (!doc || doc.status !== 'sending' || doc.transmittedAt) return;
      if (!(await this.ctx.isActive(tx))) return;
      const pctx = await this.ctx.providerContext(tx, doc.environment);
      let result: ProviderResult;
      try {
        result = await this.ctx.provider(doc.provider).emit(pctx, providerDocument(doc));
      } catch (err) {
        await this.transmitFailed(tx, doc, err);
        return;
      }
      await tx.update(fiscalDocuments).set({ transmittedAt: new Date(), attempts: doc.attempts + 1 }).where(eq(fiscalDocuments.id, doc.id));
      await this.applyResult(tx, { ...doc, transmittedAt: new Date(), attempts: doc.attempts + 1 }, result, source, pctx);
    });
  }

  /**
   * Falha de comunicação: a nota continua "enviada" e o job tenta de novo (o provedor reconhece a
   * mesma referência, então não duplica). Falha que reenviar não resolve (configuração, adaptador
   * indisponível) devolve a nota para correção, com o motivo.
   */
  private async transmitFailed(tx: Tx, doc: DocRow, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const fatal = err instanceof ProviderNotReadyError || (err instanceof FiscalProviderError && (err.httpStatus === 401 || err.httpStatus === 403 || err.httpStatus === null));
    this.logger.warn(`Envio da nota ${doc.id} falhou: ${message}`);
    if (fatal) {
      await tx.update(fiscalDocuments).set({ status: 'rejected', statusCode: 'CONFIG', statusMessage: `Não enviada: ${message}`, attempts: doc.attempts + 1 }).where(eq(fiscalDocuments.id, doc.id));
      await this.event(tx, doc, { kind: 'rejected', status: 'rejected', source: 'provider', message: `Não enviada: ${message}` });
      await this.publishUpdated(tx, { ...doc, status: 'rejected' });
      return;
    }
    await tx
      .update(fiscalDocuments)
      .set({ statusMessage: `Falha de comunicação com o provedor (${message}). Nova tentativa automática em alguns minutos.`, attempts: doc.attempts + 1 })
      .where(eq(fiscalDocuments.id, doc.id));
    await this.event(tx, doc, { kind: 'transmit_failed', status: 'sending', source: 'provider', message });
  }

  /** "Atualizar": envia se ainda não foi, consulta se está aguardando e baixa arquivos que faltam. */
  refresh(id: string): Promise<FiscalDocument> {
    return this.checkOne(id, 'poll', true).then(() => this.tdb.run((tx) => this.detailInTx(tx, id)));
  }

  private async checkOne(id: string, source: EventSource, throwErrors = false) {
    const [peek] = await this.tdb.run((tx) => tx.select({ status: fiscalDocuments.status, transmittedAt: fiscalDocuments.transmittedAt }).from(fiscalDocuments).where(eq(fiscalDocuments.id, id)));
    if (!peek) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Nota não encontrada' });
    if (peek.status === 'sending' && !peek.transmittedAt) return this.transmit(id, source);
    await this.tdb.run(async (tx) => {
      const doc = await this.lockOrFail(tx, id);
      const pctx = await this.ctx.providerContext(tx, doc.environment);
      if (doc.status === 'sending') {
        let result: ProviderResult;
        try {
          result = await this.ctx.provider(doc.provider).status(pctx, providerDocument(doc));
        } catch (err) {
          if (throwErrors) throw asGatewayError(err);
          this.logger.warn(`Consulta da nota ${id} falhou: ${(err as Error).message}`);
          return;
        }
        await tx.update(fiscalDocuments).set({ lastCheckedAt: new Date() }).where(eq(fiscalDocuments.id, id));
        await this.applyResult(tx, doc, result, source, pctx);
        return;
      }
      await this.fetchMissingFiles(tx, doc, pctx);
    });
  }

  /** Job: notas aguardando o provedor e arquivos que não baixaram, em todas as empresas com o módulo. */
  async pollAll() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      await requestContext.run({ tenantId }, async () => {
        const pending = await this.tdb.run((tx) =>
          tx
            .select({ id: fiscalDocuments.id })
            .from(fiscalDocuments)
            .where(
              or(
                eq(fiscalDocuments.status, 'sending'),
                and(inArray(fiscalDocuments.status, ['authorized', 'cancelled']), or(isNull(fiscalDocuments.xmlFileId), isNull(fiscalDocuments.pdfFileId)), sql`${fiscalDocuments.remoteFiles} <> '{}'::jsonb`),
              ),
            )
            .orderBy(asc(fiscalDocuments.updatedAt))
            .limit(100),
        );
        for (const { id } of pending) await this.checkOne(id, 'poll').catch((err) => this.logger.warn(`Verificação da nota ${id} falhou: ${(err as Error).message}`));
      });
    }
  }

  /** Aplica a resposta do provedor: status, números, motivo, arquivos e avisos. */
  async applyResult(tx: Tx, doc: DocRow, r: ProviderResult, source: EventSource, pctx: ProviderContext) {
    const status: DocStatus = r.status === 'processing' ? 'sending' : r.status;
    const now = new Date();
    const remote: DocRow['remoteFiles'] = { ...doc.remoteFiles };
    const patch: Partial<typeof fiscalDocuments.$inferInsert> = {
      status,
      lastCheckedAt: now,
      statusCode: r.code ?? (status === 'sending' ? doc.statusCode : null),
      statusMessage: r.message ?? (status === 'sending' ? doc.statusMessage : null),
      errors: r.errors ?? [],
      contingency: doc.contingency || !!r.contingency,
      ...(r.number && (doc.number === null || pctx.settings.numbering === 'provider') ? { number: r.number } : {}),
      ...(r.series && !doc.series ? { series: r.series } : {}),
      ...(r.accessKey ? { accessKey: r.accessKey } : {}),
      ...(r.verificationCode ? { verificationCode: r.verificationCode } : {}),
      ...(r.protocol ? { protocol: r.protocol } : {}),
      ...(r.consultUrl ? { consultUrl: r.consultUrl } : {}),
      ...(r.qrCodeUrl ? { qrCodeUrl: r.qrCodeUrl } : {}),
      ...(status === 'authorized' && !doc.authorizedAt ? { authorizedAt: now } : {}),
      ...(status === 'cancelled' && !doc.cancelledAt ? { cancelledAt: now } : {}),
    };
    const merged = { ...doc, ...patch } as DocRow;
    if (status === 'authorized' || status === 'cancelled') {
      if (!doc.xmlFileId && r.xml) patch.xmlFileId = await this.storeFile(tx, merged, r.xml, 'xml', pctx, remote);
      if (!doc.pdfFileId && r.pdf) patch.pdfFileId = await this.storeFile(tx, merged, r.pdf, 'pdf', pctx, remote);
      if (status === 'cancelled' && !doc.cancelXmlFileId && r.cancelXml) patch.cancelXmlFileId = await this.storeFile(tx, merged, r.cancelXml, 'cancelXml', pctx, remote);
      patch.remoteFiles = remote;
    }
    await tx.update(fiscalDocuments).set(patch).where(eq(fiscalDocuments.id, doc.id));
    if (status === doc.status && source !== 'webhook') return;

    const label = status === 'authorized' ? `Autorizada${merged.number ? ` — nº ${merged.number}` : ''}${r.contingency ? ' (em contingência)' : ''}` : (r.message ?? null);
    await this.event(tx, doc, { kind: status, status, source, message: label, payload: r.raw ?? null });
    if (status === doc.status) return;
    await this.publishUpdated(tx, merged);
    if (status === 'authorized') {
      await this.audit.log(tx, { action: 'fiscal.document.authorized', entity: 'fiscal_document', entityId: doc.id, data: { number: merged.number, series: merged.series, accessKey: merged.accessKey } });
      if (doc.customerId && (pctx.settings.sendEmail || pctx.settings.sendWhatsapp)) {
        await this.outbox.publish(tx, DELIVER, { documentId: doc.id, channels: [...(pctx.settings.sendEmail ? ['email'] : []), ...(pctx.settings.sendWhatsapp ? ['whatsapp'] : [])] });
      }
    }
    if (status === 'rejected' || status === 'denied') {
      await this.audit.log(tx, { action: `fiscal.document.${status}`, entity: 'fiscal_document', entityId: doc.id, data: { code: r.code, message: r.message } });
    }
  }

  /** Grava o arquivo (conteúdo ou download do provedor). Falha no download fica para o job. */
  private async storeFile(tx: Tx, doc: DocRow, file: ProviderFile, kind: 'xml' | 'pdf' | 'cancelXml', pctx: ProviderContext, remote: DocRow['remoteFiles']): Promise<string | undefined> {
    let content: Buffer;
    if ('content' in file) content = file.content;
    else {
      remote[kind] = file.url;
      try {
        content = await this.ctx.provider(doc.provider).download(pctx, file.url);
      } catch (err) {
        this.logger.warn(`Download do ${kind} da nota ${doc.id} falhou: ${(err as Error).message}`);
        return undefined;
      }
    }
    delete remote[kind];
    const ext = kind === 'pdf' ? (file.mime.includes('html') ? 'html' : 'pdf') : 'xml';
    const name = `${docTypeShort[doc.type]}-${doc.series ?? 0}-${doc.number ?? 0}${kind === 'cancelXml' ? '-cancelamento' : kind === 'pdf' ? '-danfe' : ''}${doc.accessKey ? `-${doc.accessKey}` : ''}.${ext}`;
    const saved = await this.files.saveCheckedInTx(tx, { buffer: content, originalname: name, mimetype: file.mime.split(';')[0]!.trim(), size: content.length }, { entity: FILE_OWNER.document, id: doc.id });
    return saved.id;
  }

  private async fetchMissingFiles(tx: Tx, doc: DocRow, pctx: ProviderContext) {
    const remote = { ...doc.remoteFiles };
    if (!Object.keys(remote).length) return;
    const patch: Partial<typeof fiscalDocuments.$inferInsert> = {};
    if (!doc.xmlFileId && remote.xml) patch.xmlFileId = await this.storeFile(tx, doc, { url: remote.xml, mime: 'application/xml' }, 'xml', pctx, remote);
    if (!doc.pdfFileId && remote.pdf) patch.pdfFileId = await this.storeFile(tx, doc, { url: remote.pdf, mime: /\.html?($|\?)/i.test(remote.pdf) ? 'text/html' : 'application/pdf' }, 'pdf', pctx, remote);
    if (!doc.cancelXmlFileId && remote.cancelXml) patch.cancelXmlFileId = await this.storeFile(tx, doc, { url: remote.cancelXml, mime: 'application/xml' }, 'cancelXml', pctx, remote);
    await tx
      .update(fiscalDocuments)
      .set({ ...patch, remoteFiles: remote })
      .where(eq(fiscalDocuments.id, doc.id));
  }

  // ---- Webhook do provedor --------------------------------------------------------------------------

  /**
   * Aviso do provedor. Só a referência do corpo é usada: a situação é consultada de novo no provedor,
   * então um aviso forjado não muda nada além de antecipar uma consulta.
   */
  async webhook(tenantId: string, token: string | undefined, body: Record<string, unknown>): Promise<{ ok: boolean; reason?: 'unknown' | 'signature'; applied?: boolean }> {
    return requestContext.run({ tenantId }, async () => {
      const found = await this.tdb.run(async (tx) => {
        if (!(await this.ctx.isActive(tx))) return { ok: false as const, reason: 'unknown' as const };
        const s = await this.ctx.settingsInTx(tx);
        if (!s.webhookSecret || !token || !safeEqual(s.webhookSecret, token)) return { ok: false as const, reason: 'signature' as const };
        const ref = String(body.ref ?? body.referencia ?? '');
        const [doc] = ref ? await tx.select({ id: fiscalDocuments.id }).from(fiscalDocuments).where(eq(fiscalDocuments.reference, ref)) : [];
        return { ok: true as const, id: doc?.id };
      });
      if (!found.ok) return found;
      if (!found.id) return { ok: true, applied: false };
      await this.tdb.run(async (tx) => {
        const doc = await this.lockOrFail(tx, found.id!);
        if (!['sending', 'authorized'].includes(doc.status)) return;
        const pctx = await this.ctx.providerContext(tx, doc.environment);
        const result = await this.ctx.provider(doc.provider).status(pctx, providerDocument(doc));
        await this.applyResult(tx, doc, result, 'webhook', pctx);
      });
      return { ok: true, applied: true };
    });
  }

  // ---- Cancelamento, carta de correção, inutilização ------------------------------------------------

  async cancel(id: string, reason: string): Promise<FiscalDocument> {
    const outcome = await this.tdb.run(async (tx) => {
      const doc = await this.lockOrFail(tx, id);
      if (doc.status !== 'authorized') throw badRequest('NOT_CANCELLABLE', 'Só nota autorizada pode ser cancelada');
      const s = await this.ctx.settingsInTx(tx);
      const until = cancelDeadline(doc, s);
      if (until && until.getTime() < Date.now()) {
        throw badRequest(
          'CANCEL_DEADLINE',
          doc.type === 'nfce'
            ? 'Prazo de cancelamento da NFC-e (30 minutos) encerrado. Fale com o contador: o caminho é a devolução/estorno.'
            : doc.type === 'nfe'
              ? 'Prazo de cancelamento da NF-e (24 horas) encerrado. Fale com o contador: o caminho é a nota de devolução ou a carta de correção.'
              : `Prazo de cancelamento da NFS-e (${s.nfseCancelDays} dias, na configuração) encerrado. Alguns municípios aceitam pedido de cancelamento fora do prazo pelo portal.`,
        );
      }
      const pctx = await this.ctx.providerContext(tx, doc.environment);
      const r = await this.ctx.guard(() => this.ctx.provider(doc.provider).cancel(pctx, { type: doc.type, reference: doc.reference }, reason));
      if (!r.ok) {
        await this.event(tx, doc, { kind: 'cancel_rejected', status: doc.status, source: 'provider', message: r.message ?? 'Cancelamento recusado', payload: r.raw ?? null });
        await this.audit.log(tx, { action: 'fiscal.document.cancel_rejected', entity: 'fiscal_document', entityId: id, data: { reason, message: r.message } });
        return { ok: false as const, message: r.message ?? 'Cancelamento recusado' };
      }
      const remote = { ...doc.remoteFiles };
      const cancelXmlFileId = r.cancelXml ? await this.storeFile(tx, doc, r.cancelXml, 'cancelXml', pctx, remote) : undefined;
      await tx
        .update(fiscalDocuments)
        .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, remoteFiles: remote, ...(cancelXmlFileId ? { cancelXmlFileId } : {}), statusMessage: r.message ?? null })
        .where(eq(fiscalDocuments.id, id));
      await this.event(tx, doc, { kind: 'cancelled', status: 'cancelled', source: 'user', message: `Cancelada: ${reason}`, payload: r.raw ?? null });
      await this.audit.log(tx, { action: 'fiscal.document.cancelled', entity: 'fiscal_document', entityId: id, data: { reason, number: doc.number, series: doc.series } });
      await this.publishUpdated(tx, { ...doc, status: 'cancelled' });
      return { ok: true as const };
    });
    if (!outcome.ok) throw new UnprocessableEntityException({ code: 'CANCEL_REJECTED', message: outcome.message });
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  async correct(id: string, text: string): Promise<FiscalDocument> {
    const { tenantId, userId } = requestContext.require();
    const outcome = await this.tdb.run(async (tx) => {
      const doc = await this.lockOrFail(tx, id);
      if (doc.type !== 'nfe' || doc.status !== 'authorized') throw badRequest('CORRECTION_NOT_ALLOWED', 'Carta de correção só para NF-e autorizada');
      const [last] = await tx.select({ seq: max(fiscalCorrections.sequence) }).from(fiscalCorrections).where(eq(fiscalCorrections.documentId, id));
      const next = (last?.seq ?? 0) + 1;
      if (next > 20) throw badRequest('CORRECTION_LIMIT', 'Limite de 20 cartas de correção por nota');
      const pctx = await this.ctx.providerContext(tx, doc.environment);
      const r = await this.ctx.guard(() => this.ctx.provider(doc.provider).correct(pctx, { type: doc.type, reference: doc.reference }, text));
      if (!r.ok) {
        await this.event(tx, doc, { kind: 'correction_rejected', status: doc.status, source: 'provider', message: r.message ?? 'Carta de correção recusada' });
        return { ok: false as const, message: r.message ?? 'Carta de correção recusada' };
      }
      const remote = {};
      const sequence = r.sequence ?? next;
      const named = { ...doc, accessKey: `${doc.accessKey ?? ''}-cce${sequence}` };
      const xmlFileId = r.xml ? await this.storeFile(tx, named, r.xml, 'xml', pctx, remote) : undefined;
      const pdfFileId = r.pdf ? await this.storeFile(tx, named, r.pdf, 'pdf', pctx, remote) : undefined;
      await tx.insert(fiscalCorrections).values({ tenantId, documentId: id, sequence, text, protocol: r.protocol ?? null, xmlFileId: xmlFileId ?? null, pdfFileId: pdfFileId ?? null, userId });
      await this.event(tx, doc, { kind: 'correction', status: doc.status, source: 'user', message: `Carta de correção nº ${sequence}: ${text}` });
      await this.audit.log(tx, { action: 'fiscal.document.corrected', entity: 'fiscal_document', entityId: id, data: { sequence, text } });
      return { ok: true as const };
    });
    if (!outcome.ok) throw new UnprocessableEntityException({ code: 'CORRECTION_REJECTED', message: outcome.message });
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  async voidRange(input: VoidInput): Promise<VoidRecord> {
    const { tenantId, userId } = requestContext.require();
    const outcome = await this.tdb.run(async (tx) => {
      const s = await this.ctx.settingsInTx(tx);
      const used = await tx
        .select({ number: fiscalDocuments.number, status: fiscalDocuments.status, id: fiscalDocuments.id })
        .from(fiscalDocuments)
        .where(
          and(
            eq(fiscalDocuments.type, input.type),
            eq(fiscalDocuments.environment, s.environment),
            eq(fiscalDocuments.series, input.series),
            gte(fiscalDocuments.number, input.from),
            lte(fiscalDocuments.number, input.to),
          ),
        );
      const blocking = used.filter((u) => !['discarded', 'rejected'].includes(u.status));
      if (blocking.length) throw badRequest('NUMBERS_IN_USE', `Números já usados por notas enviadas/autorizadas: ${blocking.map((b) => b.number).join(', ')}`);
      const pctx = await this.ctx.providerContext(tx, s.environment, { settings: s });
      const r = await this.ctx.guard(() => this.ctx.provider(s.provider).voidRange(pctx, input));
      let xmlFileId: string | null = null;
      if (r.ok && r.xml && 'content' in r.xml) {
        const saved = await this.files.saveCheckedInTx(
          tx,
          { buffer: r.xml.content, originalname: `inutilizacao-${docTypeShort[input.type]}-${input.series}-${input.from}-${input.to}.xml`, mimetype: 'application/xml', size: r.xml.content.length },
          { entity: FILE_OWNER.void, id: `${input.type}:${input.series}` },
        );
        xmlFileId = saved.id;
      }
      const [row] = await tx
        .insert(fiscalVoids)
        .values({
          tenantId,
          type: input.type,
          environment: s.environment,
          series: input.series,
          numberFrom: input.from,
          numberTo: input.to,
          reason: input.reason,
          status: r.ok ? 'authorized' : 'rejected',
          message: r.message ?? null,
          protocol: r.protocol ?? null,
          xmlFileId,
          userId,
        })
        .returning();
      if (r.ok) {
        // Rejeitadas com número na faixa não podem mais ser reenviadas com ele.
        for (const u of used.filter((u) => u.status === 'rejected')) {
          const [doc] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, u.id));
          if (doc) await this.discardInTx(tx, doc, 'Número inutilizado', 'user');
        }
      }
      await this.audit.log(tx, { action: r.ok ? 'fiscal.numbers.voided' : 'fiscal.numbers.void_rejected', entity: 'fiscal_void', entityId: row!.id, data: { ...input, message: r.message } });
      return { ok: r.ok, row: row!, message: r.message };
    });
    if (!outcome.ok) throw new UnprocessableEntityException({ code: 'VOID_REJECTED', message: outcome.message ?? 'Inutilização recusada' });
    return toVoid(outcome.row);
  }

  listVoids(): Promise<VoidRecord[]> {
    return this.tdb.run(async (tx) => (await tx.select().from(fiscalVoids).orderBy(desc(fiscalVoids.createdAt)).limit(200)).map(toVoid));
  }

  /** Números pulados (sem nota válida e sem inutilização) da série atual de NFC-e/NF-e. */
  async gaps(tx: Tx, environment: string): Promise<{ type: DocType; series: string; numbers: number[] }[]> {
    const rows = await tx.execute<{ type: DocType; series: string; n: number }>(sql`
      with ranges as (
        select type, series, min(number) as lo, max(number) as hi
        from fiscal_documents
        where environment = ${environment} and type in ('nfce', 'nfe') and number is not null and status <> 'discarded'
        group by type, series
      )
      select r.type, r.series, n::int as n
      from ranges r, generate_series(greatest(r.lo, r.hi - 5000), r.hi) as n
      where not exists (
          select 1 from fiscal_documents d
          where d.type = r.type and d.series = r.series and d.environment = ${environment} and d.number = n and d.status <> 'discarded')
        and not exists (
          select 1 from fiscal_voids v
          where v.type = r.type and v.series = r.series and v.environment = ${environment} and v.status = 'authorized' and n between v.number_from and v.number_to)
      union
      select d.type, d.series, d.number
      from fiscal_documents d
      where d.environment = ${environment} and d.type in ('nfce', 'nfe') and d.status = 'discarded' and d.number is not null
        and not exists (select 1 from fiscal_documents o where o.type = d.type and o.series = d.series and o.environment = d.environment and o.number = d.number and o.status <> 'discarded')
        and not exists (select 1 from fiscal_voids v where v.type = d.type and v.series = d.series and v.environment = d.environment and v.status = 'authorized' and d.number between v.number_from and v.number_to)
      order by 1, 2, 3
    `);
    const out = new Map<string, { type: DocType; series: string; numbers: number[] }>();
    for (const r of rows.rows) {
      const key = `${r.type}:${r.series}`;
      if (!out.has(key)) out.set(key, { type: r.type, series: r.series, numbers: [] });
      out.get(key)!.numbers.push(Number(r.n));
    }
    return [...out.values()];
  }

  gapsNow() {
    return this.tdb.run(async (tx) => this.gaps(tx, (await this.ctx.settingsInTx(tx)).environment));
  }

  // ---- Arquivos e envio ao cliente ------------------------------------------------------------------

  /** Download autenticado (XML, DANFE, XML do cancelamento, carta de correção). Fica na auditoria. */
  async download(id: string, kind: 'xml' | 'pdf' | 'cancel-xml' | 'correction-xml' | 'correction-pdf', sequence?: number) {
    const fileId = await this.tdb.run(async (tx) => {
      const doc = await this.findOrFail(tx, id);
      let fileId: string | null = null;
      if (kind === 'xml') fileId = doc.xmlFileId;
      else if (kind === 'pdf') fileId = doc.pdfFileId;
      else if (kind === 'cancel-xml') fileId = doc.cancelXmlFileId;
      else {
        const [c] = await tx
          .select()
          .from(fiscalCorrections)
          .where(and(eq(fiscalCorrections.documentId, id), sequence ? eq(fiscalCorrections.sequence, sequence) : undefined))
          .orderBy(desc(fiscalCorrections.sequence))
          .limit(1);
        fileId = kind === 'correction-xml' ? (c?.xmlFileId ?? null) : (c?.pdfFileId ?? null);
      }
      if (!fileId) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Arquivo ainda não disponível para esta nota' });
      await this.event(tx, doc, { kind: 'download', status: doc.status, source: 'user', message: `Download: ${kind}` });
      await this.audit.log(tx, { action: 'fiscal.document.downloaded', entity: 'fiscal_document', entityId: id, data: { kind } });
      return fileId;
    });
    const opened = await this.files.open(fileId, FILE_OWNER.document);
    if (opened.ownerId !== id) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Arquivo não encontrado' });
    return opened;
  }

  /** Link sem login para o cliente baixar a própria nota (vai no e-mail/WhatsApp). */
  publicToken(tenantId: string, documentId: string) {
    return createHmac('sha256', `fiscal-public:${this.config.jwtSecret}`).update(`${tenantId}:${documentId}`).digest('base64url').slice(0, 32);
  }

  publicLink(tenantId: string, documentId: string, kind: 'pdf' | 'xml') {
    return `${this.ctx.publicApiBase()}/api/public/fiscal/${tenantId}/documents/${documentId}/${kind}?t=${this.publicToken(tenantId, documentId)}`;
  }

  async publicDownload(tenantId: string, documentId: string, kind: 'pdf' | 'xml', token: string) {
    if (!safeEqual(this.publicToken(tenantId, documentId), token)) return null;
    return requestContext.run({ tenantId }, async () => {
      const fileId = await this.tdb.run(async (tx) => {
        if (!(await this.ctx.isActive(tx))) return null;
        const [doc] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, documentId));
        if (!doc || !['authorized', 'cancelled'].includes(doc.status)) return null;
        const fileId = kind === 'pdf' ? doc.pdfFileId : doc.xmlFileId;
        if (fileId) await this.event(tx, doc, { kind: 'download', status: doc.status, source: 'public', message: `Download pelo link do cliente: ${kind}` });
        return fileId;
      });
      return fileId ? this.files.open(fileId, FILE_OWNER.document) : null;
    });
  }

  /** Envia (de novo) a nota ao cliente pelo outbox. */
  send(id: string, channels: ('email' | 'whatsapp')[]): Promise<FiscalDocument> {
    return this.tdb.run(async (tx) => {
      const doc = await this.findOrFail(tx, id);
      if (doc.status !== 'authorized') throw badRequest('NOT_AUTHORIZED', 'Só nota autorizada pode ser enviada ao cliente');
      if (!doc.customerId && !doc.recipient?.email && !doc.recipient?.phone) throw badRequest('NO_CONTACT', 'A nota não tem e-mail nem telefone do cliente');
      await this.outbox.publish(tx, DELIVER, { documentId: id, channels });
      await this.audit.log(tx, { action: 'fiscal.document.sent_to_customer', entity: 'fiscal_document', entityId: id, data: { channels } });
      return this.detailInTx(tx, id);
    });
  }

  private async deliver(e: OutboxEvent<{ documentId: string; channels?: ('email' | 'whatsapp')[] }>) {
    const { tenantId } = requestContext.requireTenant();
    await this.tdb.run(async (tx) => {
      const [doc] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, e.payload.documentId)).for('update');
      if (!doc || doc.status !== 'authorized') return;
      const customer = doc.customerId ? await this.customers.findInTx(tx, doc.customerId) : undefined;
      const email = customer?.email ?? doc.recipient?.email ?? null;
      const phone = customer?.phone ?? doc.recipient?.phone ?? null;
      const company = await this.ctx.company(tx);
      const label = `${docTypeShort[doc.type]} nº ${doc.number ?? ''}`;
      const body = [
        `Olá, ${(customer?.name ?? doc.recipient?.name ?? '').split(' ')[0] || 'cliente'}!`,
        '',
        `Sua nota fiscal (${label}) de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(doc.total))} foi emitida por ${company.name}.`,
        doc.pdfFileId ? `PDF: ${this.publicLink(tenantId, doc.id, 'pdf')}` : null,
        doc.xmlFileId ? `XML: ${this.publicLink(tenantId, doc.id, 'xml')}` : null,
        doc.consultUrl ? `Consulta: ${doc.consultUrl}` : null,
        doc.environment === 'homologation' ? '\n(Emitida em ambiente de testes, sem valor fiscal.)' : null,
      ]
        .filter((l) => l !== null)
        .join('\n');
      const delivery = [...doc.delivery];
      const done = (channel: string) => delivery.some((d) => d.channel === channel && d.requestId === e.id);
      const wanted = e.payload.channels ?? ['email'];
      if (wanted.includes('email') && email && !done('email')) {
        const r = await this.channels.get('email').send({ tenantId, to: email, subject: `Nota fiscal ${label} — ${company.name}`, body, reference: doc.id });
        delivery.push({ channel: 'email', status: r.status, to: email, at: new Date().toISOString(), requestId: e.id });
      }
      if (wanted.includes('whatsapp') && phone && !done('whatsapp') && this.channels.has('whatsapp') && (await this.whatsappActive(tx))) {
        const r = await this.channels.get('whatsapp').send({ tenantId, to: phone, body, reference: doc.id });
        delivery.push({ channel: 'whatsapp', status: r.status, to: phone, actionUrl: r.actionUrl ?? null, at: new Date().toISOString(), requestId: e.id });
      }
      if (delivery.length === doc.delivery.length) return;
      await tx.update(fiscalDocuments).set({ delivery }).where(eq(fiscalDocuments.id, doc.id));
      const sent = delivery.slice(doc.delivery.length);
      await this.event(tx, doc, { kind: 'delivered', status: doc.status, source: 'provider', message: sent.map((d) => `${d.channel === 'email' ? 'E-mail' : 'WhatsApp'} para ${d.to}${d.status === 'manual' ? ' (link para enviar)' : ''}`).join('; ') });
    });
  }

  private async whatsappActive(tx: Tx) {
    const [row] = await tx.select({ status: tenantModules.status }).from(tenantModules).where(and(eq(tenantModules.moduleKey, 'integration.whatsapp'), eq(tenantModules.status, 'active')));
    return !!row;
  }

  // ---- Consulta -------------------------------------------------------------------------------------

  get(id: string): Promise<FiscalDocument> {
    return this.tdb.run((tx) => this.detailInTx(tx, id));
  }

  list(q: DocumentListQuery): Promise<DocumentSummary[]> {
    return this.tdb.run(async (tx) => {
      const conditions: (SQL | undefined)[] = [
        q.type ? eq(fiscalDocuments.type, q.type) : undefined,
        q.status ? eq(fiscalDocuments.status, q.status) : undefined,
        q.sourceType ? eq(fiscalDocuments.sourceType, q.sourceType) : undefined,
        q.sourceId ? eq(fiscalDocuments.sourceId, q.sourceId) : undefined,
        q.from ? sql`coalesce(${fiscalDocuments.issuedAt}, ${fiscalDocuments.createdAt}) >= (${q.from}::date::timestamp at time zone 'America/Sao_Paulo')` : undefined,
        q.to ? sql`coalesce(${fiscalDocuments.issuedAt}, ${fiscalDocuments.createdAt}) < ((${q.to}::date + 1)::timestamp at time zone 'America/Sao_Paulo')` : undefined,
      ];
      if (q.q) {
        const term = q.q.replace(/[%_\\]/g, (c) => `\\${c}`);
        const digits = q.q.replace(/\D/g, '');
        conditions.push(
          or(
            ilike(sql`${fiscalDocuments.recipient}->>'name'`, `%${term}%`),
            digits ? eq(sql`${fiscalDocuments.number}::text`, digits) : undefined,
            digits.length >= 6 ? ilike(fiscalDocuments.accessKey, `%${digits}%`) : undefined,
            ilike(fiscalDocuments.sourceLabel, `%${term}%`),
          ),
        );
      }
      const rows = await tx
        .select()
        .from(fiscalDocuments)
        .where(and(...conditions))
        .orderBy(desc(fiscalDocuments.createdAt))
        .limit(q.limit);
      return rows.map(toSummary);
    });
  }

  async detailInTx(tx: Tx, id: string): Promise<FiscalDocument> {
    const doc = await this.findOrFail(tx, id);
    const s = await this.ctx.settingsInTx(tx);
    const [customer] = doc.customerId ? await tx.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, doc.customerId)) : [];
    const [events, corrections, pdf] = await Promise.all([
      tx
        .select({ e: fiscalDocumentEvents, userName: users.name })
        .from(fiscalDocumentEvents)
        .leftJoin(users, eq(users.id, fiscalDocumentEvents.userId))
        .where(eq(fiscalDocumentEvents.documentId, id))
        .orderBy(asc(fiscalDocumentEvents.at), asc(fiscalDocumentEvents.id)),
      tx.select().from(fiscalCorrections).where(eq(fiscalCorrections.documentId, id)).orderBy(asc(fiscalCorrections.sequence)),
      doc.pdfFileId ? tx.execute<{ mime: string }>(sql`select mime from files where id = ${doc.pdfFileId}`) : Promise.resolve(null),
    ]);
    const issues = editableStatuses.includes(doc.status) ? this.validate(doc, s, await this.ctx.company(tx)) : [];
    const until = doc.status === 'authorized' ? cancelDeadline(doc, s) : null;
    return {
      ...toSummary(doc),
      provider: doc.provider,
      reference: doc.reference,
      accessKey: doc.accessKey,
      verificationCode: doc.verificationCode,
      protocol: doc.protocol,
      sourceId: doc.sourceId,
      customer: customer ? { id: customer.id, name: customer.name } : null,
      recipient: doc.recipient,
      items: doc.items,
      payments: doc.payments,
      discount: Number(doc.discount),
      taxes: doc.taxes,
      nature: doc.nature,
      additionalInfo: doc.additionalInfo,
      serviceDate: doc.serviceDate,
      authorizedAt: doc.authorizedAt?.toISOString() ?? null,
      cancelledAt: doc.cancelledAt?.toISOString() ?? null,
      cancelReason: doc.cancelReason,
      statusCode: doc.statusCode,
      errors: doc.errors,
      files: { xml: !!doc.xmlFileId, pdf: !!doc.pdfFileId, pdfMime: pdf?.rows[0]?.mime ?? null, cancelXml: !!doc.cancelXmlFileId },
      consultUrl: doc.consultUrl,
      qrCodeUrl: doc.qrCodeUrl,
      delivery: doc.delivery.map(({ channel, status, to, actionUrl, at }) => ({ channel, status, to, actionUrl: actionUrl ?? null, at })),
      cancelUntil: until && until.getTime() > Date.now() ? until.toISOString() : null,
      issues,
      events: events.map(({ e, userName }) => ({ kind: e.kind, status: e.status, message: e.message, source: e.source, userName, at: e.at.toISOString() })),
      corrections: corrections.map((c) => ({ sequence: c.sequence, text: c.text, at: c.createdAt.toISOString(), hasXml: !!c.xmlFileId, hasPdf: !!c.pdfFileId })),
    };
  }

  // ---- Regras ---------------------------------------------------------------------------------------

  /** O que impede o envio agora (configuração da empresa + dados da nota). */
  validate(doc: Pick<DocRow, 'type' | 'items' | 'recipient' | 'payments' | 'total' | 'serviceDate'>, s: FiscalSettings, company: CompanyFiscal): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const add = (field: string, message: string) => issues.push({ field, message });
    const eff = this.ctx.effective(company, s);
    const type = doc.type;

    if (s.environment === 'production' && s.provider === 'simulated') add('settings.provider', 'O modo simulado não emite em produção: escolha o provedor ou volte para homologação');
    if (s.provider === 'plugnotas' || s.provider === 'nfeio') add('settings.provider', 'O adaptador deste provedor ainda não está disponível: use a Focus NFe ou o modo simulado');
    if (s.provider !== 'simulated' && !(s.environment === 'production' ? s.tokenProduction : s.tokenHomologation)) add('settings.token', 'Informe o token da API do provedor para o ambiente atual');
    if (!company.document || company.document.length !== 14) add('company.document', 'Cadastre o CNPJ da empresa (Configurações → Dados da empresa)');
    if (!company.legalName) add('company.legalName', 'Cadastre a razão social da empresa');
    if (!company.address?.street || !company.address.city || !company.address.state || !company.address.zip) add('company.address', 'Cadastre o endereço completo da empresa (rua, cidade, UF e CEP)');

    if (!doc.items.length) add('items', 'Inclua ao menos um item');
    if (Number(doc.total) <= 0) add('total', 'O valor da nota precisa ser maior que zero');
    if (doc.recipient?.document && !isValidPersonOrCompany(doc.recipient.document)) add('recipient.document', 'CPF/CNPJ do cliente inválido');

    if (type === 'nfse') {
      if (!s.municipalityCode) add('settings.municipalityCode', 'Informe o código IBGE do município da empresa (configuração fiscal)');
      if (s.nfseStandard === 'municipal' && !eff.municipalRegistration) add('company.municipalRegistration', 'Informe a inscrição municipal (necessária no padrão do município)');
      doc.items.forEach((i, n) => {
        const label = `Item ${n + 1} (${i.description})`;
        if (s.nfseStandard === 'national' && !i.nationalCode) add(`items.${n}.nationalCode`, `${label}: falta o código de tributação nacional (cadastro fiscal do serviço)`);
        if (!i.lc116) add(`items.${n}.lc116`, `${label}: falta o item da LC 116 (cadastro fiscal do serviço)`);
        if (!i.issRate) add(`items.${n}.issRate`, `${label}: falta a alíquota do ISS`);
      });
      const keys = new Set(doc.items.map((i) => `${i.lc116}|${i.nationalCode}|${i.issRate}|${!!i.issWithheld}`));
      if (keys.size > 1) add('items', 'Uma NFS-e tem um só código de serviço e uma alíquota: emita uma nota para cada serviço com código diferente');
      if (!doc.serviceDate) add('serviceDate', 'Informe a data da prestação do serviço');
    } else {
      if (!eff.stateRegistration) add('company.stateRegistration', 'Informe a inscrição estadual da empresa');
      if (type === 'nfce' && s.provider !== 'simulated') {
        const [id, token] = s.environment === 'production' ? [s.cscIdProduction, s.cscTokenProduction] : [s.cscIdHomologation, s.cscTokenHomologation];
        if (!id || !token) add('settings.csc', 'Informe o CSC e o ID do CSC da NFC-e (gerados no portal da SEFAZ) para o ambiente atual');
      }
      doc.items.forEach((i, n) => {
        const label = `Item ${n + 1} (${i.description})`;
        if (!i.ncm) add(`items.${n}.ncm`, `${label}: falta o NCM (cadastro fiscal do produto)`);
        if (!i.cfop) add(`items.${n}.cfop`, `${label}: falta o CFOP`);
        if (!i.icmsSituation || !normalizeIcmsSituation(i.icmsSituation, s.taxRegime)) add(`items.${n}.icmsSituation`, `${label}: ${isSimples(s.taxRegime) ? 'CSOSN' : 'CST do ICMS'} ausente ou incompatível com o regime`);
      });
      const paid = round2(doc.payments.reduce((sum, p) => sum + p.amount, 0));
      if (paid + 0.009 < Number(doc.total)) add('payments', 'A soma das formas de pagamento é menor que o total da nota');
      if (type === 'nfe') {
        const r = doc.recipient;
        if (!r?.document) add('recipient.document', 'NF-e exige CPF ou CNPJ do destinatário');
        if (!r?.address?.street || !r.address.number || !r.address.district || !r.address.city || !r.address.state || !r.address.zip) add('recipient.address', 'NF-e exige o endereço completo do destinatário');
        if (r?.ieIndicator === 1 && !r.stateRegistration) add('recipient.stateRegistration', 'Destinatário contribuinte do ICMS: informe a inscrição estadual');
      }
    }
    return issues;
  }

  /** Completa os itens com o cadastro fiscal (o que veio na nota prevalece) e calcula os totais. */
  private async fillItems(tx: Tx, type: DocType, input: ParsedItem[], s: FiscalSettings): Promise<DocumentItem[]> {
    const productIds = input.filter((i) => i.kind === 'product' && i.refId).map((i) => i.refId!);
    const products = productIds.length ? await tx.select().from(fiscalProductCodes).where(inArray(fiscalProductCodes.productId, productIds.filter(isUuid))) : [];
    const services = await tx.select().from(fiscalServiceCodes);
    return input.map((i) => {
      const total = round2(i.quantity * i.unitPrice - i.discount);
      if (total < 0) throw badRequest('INVALID_DISCOUNT', `Desconto maior que o valor do item "${i.description}"`);
      const item: DocumentItem = { ...i, unit: UNIT[i.unit.toLowerCase()] ?? i.unit.toUpperCase(), total };
      if (i.kind === 'product') {
        const p = products.find((p) => p.productId === i.refId);
        if (p) {
          item.ncm ??= p.ncm;
          item.cfop ??= p.cfop;
          item.cest ??= p.cest;
          item.origin ??= p.origin;
          item.icmsSituation ??= p.icmsSituation;
          item.icmsRate ??= p.icmsRate === null ? null : Number(p.icmsRate);
          item.pisCofinsCst ??= p.pisCofinsCst;
          item.pisRate ??= p.pisRate === null ? null : Number(p.pisRate);
          item.cofinsRate ??= p.cofinsRate === null ? null : Number(p.cofinsRate);
          item.taxUnit ??= p.taxUnit;
          item.ibsCbsCst ??= p.ibsCbsCst;
          item.classTrib ??= p.classTrib;
        }
        item.taxUnit ??= item.unit;
        item.origin ??= 0;
      } else {
        const c = services.find((c) => c.refType === (i.refType ?? 'sch_service') && c.refId === i.refId);
        item.lc116 ??= c?.lc116 ?? (s.defaultLc116 || null);
        item.nationalCode ??= c?.nationalCode ?? (s.defaultNationalCode || null);
        item.nbs ??= c?.nbs ?? (s.defaultNbs || null);
        item.municipalCode ??= c?.municipalCode ?? null;
        item.issRate ??= c ? Number(c.issRate) : s.defaultIssRate || null;
        item.issWithheld ??= c?.issWithheld ?? s.issWithheldDefault;
        item.ibsCbsCst ??= c?.ibsCbsCst ?? null;
        item.classTrib ??= c?.classTrib ?? null;
      }
      if (type !== 'nfse' && i.kind === 'service') throw badRequest('ITEM_KIND', `"${i.description}" é serviço: NFC-e/NF-e são para mercadorias (use a NFS-e)`);
      if (type === 'nfse' && i.kind === 'product') throw badRequest('ITEM_KIND', `"${i.description}" é mercadoria: a NFS-e é só para serviços`);
      return item;
    });
  }

  private paymentsFor(input: DocumentPayment[], items: DocumentItem[]): DocumentPayment[] {
    if (input.length) return input;
    return [{ method: 'other', amount: round2(items.reduce((sum, i) => sum + i.total, 0)) }];
  }

  private async recipientFor(tx: Tx, customerId: string | null, override: Recipient | null): Promise<Recipient | null> {
    if (override) return override;
    if (!customerId) return null;
    const c = await this.customers.findInTx(tx, customerId);
    if (!c || c.anonymizedAt) throw badRequest('CUSTOMER_NOT_FOUND', 'Cliente não encontrado');
    return {
      name: c.name,
      document: c.document ? c.document.toUpperCase() : null,
      email: c.email,
      phone: c.phone,
      stateRegistration: null,
      ieIndicator: 9,
      address: c.address ? { ...c.address } : null,
    };
  }

  private async nextNumber(tx: Tx, type: DocType, environment: 'homologation' | 'production') {
    const { tenantId } = requestContext.requireTenant();
    let [row] = await tx.select().from(fiscalSeries).where(and(eq(fiscalSeries.type, type), eq(fiscalSeries.environment, environment))).for('update');
    if (!row) {
      [row] = await tx.insert(fiscalSeries).values({ tenantId, type, environment, series: '1', nextNumber: 1 }).onConflictDoNothing().returning();
      row ??= (await tx.select().from(fiscalSeries).where(and(eq(fiscalSeries.type, type), eq(fiscalSeries.environment, environment))).for('update'))[0];
    }
    await tx.update(fiscalSeries).set({ nextNumber: row!.nextNumber + 1 }).where(eq(fiscalSeries.id, row!.id));
    return { number: row!.nextNumber, series: row!.series };
  }

  private async publishUpdated(tx: Tx, doc: Pick<DocRow, 'id' | 'type' | 'status' | 'sourceType' | 'sourceId' | 'number'>) {
    const payload: DocumentUpdated = { documentId: doc.id, type: doc.type, status: doc.status, sourceType: doc.sourceType, sourceId: doc.sourceId, number: doc.number };
    await this.outbox.publish(tx, DOCUMENT_UPDATED, { ...payload });
  }

  async event(tx: Tx, doc: Pick<DocRow, 'id' | 'tenantId'>, e: { kind: string; status: string | null; source: EventSource; message?: string | null; payload?: unknown }) {
    const { userId } = requestContext.get();
    await tx.insert(fiscalDocumentEvents).values({ tenantId: doc.tenantId, documentId: doc.id, kind: e.kind, status: e.status, source: e.source, message: e.message ?? null, payload: e.payload ?? null, userId: userId ?? null });
  }

  async lockOrFail(tx: Tx, id: string): Promise<DocRow> {
    const [row] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id)).for('update');
    if (!row) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Nota não encontrada' });
    return row;
  }

  private async findOrFail(tx: Tx, id: string): Promise<DocRow> {
    const [row] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id));
    if (!row) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Nota não encontrada' });
    return row;
  }

  /** Origem com nota em andamento/autorizada (evita nota duplicada para a mesma venda). */
  async openDocumentForSource(tx: Tx, sourceType: string, sourceId: string) {
    const [row] = await tx
      .select()
      .from(fiscalDocuments)
      .where(and(eq(fiscalDocuments.sourceType, sourceType as SourceType), eq(fiscalDocuments.sourceId, sourceId), inArray(fiscalDocuments.status, ['draft', 'sending', 'authorized', 'rejected', 'denied'])))
      .orderBy(desc(fiscalDocuments.createdAt))
      .limit(1);
    return row ?? null;
  }

  async linkSource(tx: Tx, sourceType: string, sourceId: string, documentId: string) {
    await tx
      .update(fiscalSources)
      .set({ documentId, autoError: null })
      .where(and(eq(fiscalSources.sourceType, sourceType as (typeof fiscalSources.$inferSelect)['sourceType']), eq(fiscalSources.sourceId, sourceId)));
  }
}

// ---- funções puras (exportadas para os testes) -----------------------------------------------------

export function computeTaxes(type: DocType, items: DocumentItem[], recipient: Recipient | null, total: number, s: FiscalSettings): Taxes {
  const sum = (fn: (i: DocumentItem) => number) => round2(items.reduce((acc, i) => acc + fn(i), 0));
  const company = recipient?.document?.length === 14;
  const pct = (rate: number) => round2((total * rate) / 100);
  const taxes: Taxes = {
    iss: 0,
    issWithheld: false,
    icms: 0,
    pis: 0,
    cofins: 0,
    retentions: { ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0 },
    ibs: s.reformEnabled ? pct(s.ibsRate) : 0,
    cbs: s.reformEnabled ? pct(s.cbsRate) : 0,
    approximate: s.approximateTaxPercent ? pct(s.approximateTaxPercent) : 0,
  };
  if (type === 'nfse') {
    taxes.iss = sum((i) => (i.total * (i.issRate ?? 0)) / 100);
    taxes.issWithheld = !!items[0]?.issWithheld;
    if (company) taxes.retentions = { ir: pct(s.retentionIr), pis: pct(s.retentionPis), cofins: pct(s.retentionCofins), csll: pct(s.retentionCsll), inss: pct(s.retentionInss) };
  } else {
    // No Simples o ICMS vai no DAS (CSOSN sem destaque); só o regime normal destaca.
    if (!isSimples(s.taxRegime)) taxes.icms = sum((i) => (i.total * (i.icmsRate ?? 0)) / 100);
    taxes.pis = sum((i) => (i.total * (i.pisRate ?? 0)) / 100);
    taxes.cofins = sum((i) => (i.total * (i.cofinsRate ?? 0)) / 100);
  }
  return taxes;
}

export function cancelDeadline(doc: Pick<DocRow, 'type' | 'authorizedAt' | 'issuedAt'>, s: Pick<FiscalSettings, 'nfseCancelDays'>): Date | null {
  const base = doc.authorizedAt ?? doc.issuedAt;
  if (!base) return null;
  if (doc.type === 'nfse') return s.nfseCancelDays ? new Date(base.getTime() + s.nfseCancelDays * 86_400_000) : null;
  return new Date(base.getTime() + CANCEL_MINUTES[doc.type] * 60_000);
}

export function providerDocument(doc: DocRow): ProviderDocument {
  return {
    type: doc.type,
    reference: doc.reference,
    series: doc.series,
    number: doc.number,
    issuedAt: doc.issuedAt ?? new Date(),
    serviceDate: doc.serviceDate ?? localDate(doc.issuedAt ?? new Date()),
    nature: doc.nature,
    recipient: doc.recipient,
    items: doc.items,
    payments: doc.payments,
    total: Number(doc.total),
    discount: Number(doc.discount),
    taxes: doc.taxes,
    additionalInfo: doc.additionalInfo,
  };
}

/** Referência enviada ao provedor: só letras e números (exigência da Focus), única. */
export const newReference = () => `PS${uuidv7().replace(/-/g, '')}`;

const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function toSummary(d: DocRow): DocumentSummary & { sourceId: string | null } {
  return {
    id: d.id,
    type: d.type,
    environment: d.environment,
    status: d.status,
    series: d.series,
    number: d.number,
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    sourceLabel: d.sourceLabel,
    recipientName: d.recipient?.name ?? null,
    total: Number(d.total),
    statusMessage: d.statusMessage,
    contingency: d.contingency,
    issuedAt: d.issuedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

function toVoid(v: typeof fiscalVoids.$inferSelect): VoidRecord {
  return {
    id: v.id,
    type: v.type,
    environment: v.environment,
    series: v.series,
    from: v.numberFrom,
    to: v.numberTo,
    reason: v.reason,
    status: v.status,
    message: v.message,
    protocol: v.protocol,
    createdAt: v.createdAt.toISOString(),
  };
}
