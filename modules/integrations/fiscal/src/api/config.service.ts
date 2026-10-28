import { AuditService, FilesService, MessageChannels, ModuleHooks, ModuleSettingsService, ScheduledJobs, SecretBox, TenantDb, type UploadedFile } from '@all/core';
import { tenants } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  docTypes,
  environments,
  isSimples,
  MODULE,
  type Certificate,
  type CompanyFiscal,
  type FiscalOverview,
  type FiscalSettings,
  type ReadinessItem,
  type Series,
  type SeriesInput,
} from '../contracts';
import { fiscalCertificates, fiscalSeries } from '../db/schema';
import { CertificateError, daysUntil, parsePfx } from './certificate';
import { FILE_OWNER, FiscalContext } from './context.service';

/** Avisos de vencimento do certificado (dias antes). */
const ALERT_DAYS = [30, 15, 7, 1, 0];

/** Dados fiscais da empresa, certificado A1, séries, provedor e avisos de vencimento. */
@Injectable()
export class FiscalConfigService implements OnModuleInit {
  private readonly logger = new Logger('Fiscal');

  constructor(
    private readonly tdb: TenantDb,
    private readonly ctx: FiscalContext,
    private readonly settings: ModuleSettingsService,
    private readonly files: FilesService,
    private readonly secrets: SecretBox,
    private readonly audit: AuditService,
    private readonly hooks: ModuleHooks,
    private readonly jobs: ScheduledJobs,
    private readonly channels: MessageChannels,
  ) {}

  onModuleInit() {
    this.hooks.register(MODULE, { onEnable: (tx, tenantId) => this.seed(tx, tenantId) });
    this.jobs.every('fiscal.certificate-alerts', 12 * 60 * 60_000, () => this.certificateAlerts());
  }

  // ---- Visão geral e configuração -------------------------------------------------------------------

  async overview(): Promise<FiscalOverview> {
    const masked = await this.settings.get(MODULE);
    return this.tdb.run(async (tx) => {
      const s = await this.ctx.settingsInTx(tx);
      const company = await this.ctx.company(tx);
      const certificate = await this.certificateDto(tx, company);
      const series = (await tx.select().from(fiscalSeries).orderBy(asc(fiscalSeries.type), asc(fiscalSeries.environment))).map(toSeries);
      const { tenantId } = requestContext.require();
      return {
        settings: masked,
        company,
        effective: this.ctx.effective(company, s),
        certificate,
        series,
        readiness: readiness(s, company, this.ctx.effective(company, s), certificate),
        webhookUrl: `${this.ctx.publicApiBase()}/api/public/fiscal/webhook/${tenantId}`,
      };
    });
  }

  saveSettings(body: Record<string, unknown>) {
    // O segredo do webhook só muda pelo botão próprio (a tela não manda o valor).
    return this.settings.save(MODULE, { ...body, webhookSecret: undefined });
  }

  /** Gera um segredo novo para o webhook; o valor aparece uma vez para colar no provedor. */
  async rotateWebhookSecret(): Promise<{ url: string; secret: string }> {
    const secret = randomBytes(24).toString('base64url');
    const current = await this.settings.get(MODULE);
    await this.settings.save(MODULE, { ...current, webhookSecret: secret });
    const { tenantId } = requestContext.require();
    return { url: `${this.ctx.publicApiBase()}/api/public/fiscal/webhook/${tenantId}`, secret };
  }

  /** Cadastra a empresa no provedor (certificado, CSC) e guarda os tokens que ele devolver. */
  async syncProvider(): Promise<{ message: string }> {
    const outcome = await this.tdb.run(async (tx) => {
      const s = await this.ctx.settingsInTx(tx);
      const provider = this.ctx.provider(s.provider);
      if (!provider.syncCompany) throw new BadRequestException({ code: 'NOT_SUPPORTED', message: 'Este provedor não cadastra a empresa pela API: use o painel dele' });
      const pctx = await this.ctx.providerContext(tx, s.environment, { withCertificate: true, settings: s });
      const result = (await this.ctx.guard(() => provider.syncCompany!(pctx))) as { message: string; companyId?: string; tokens?: { production?: string; homologation?: string } };
      await this.audit.log(tx, { action: 'fiscal.provider.synced', entity: 'module', entityId: MODULE, data: { provider: s.provider } });
      return result;
    });
    if (outcome.companyId || outcome.tokens?.production || outcome.tokens?.homologation) {
      const current = await this.settings.get(MODULE);
      await this.settings.save(MODULE, {
        ...current,
        providerCompanyId: outcome.companyId ?? current.providerCompanyId,
        tokenProduction: outcome.tokens?.production || current.tokenProduction,
        tokenHomologation: outcome.tokens?.homologation || current.tokenHomologation,
      });
    }
    return { message: outcome.message };
  }

  /** Cadastra o webhook no provedor (gera o segredo se ainda não houver). */
  async registerWebhook(): Promise<{ message: string }> {
    let secret = (await this.tdb.run((tx) => this.ctx.settingsInTx(tx))).webhookSecret;
    if (!secret) secret = (await this.rotateWebhookSecret()).secret;
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const s = await this.ctx.settingsInTx(tx);
      const provider = this.ctx.provider(s.provider);
      if (!provider.registerWebhook) throw new BadRequestException({ code: 'NOT_SUPPORTED', message: 'Este provedor não precisa de webhook (ou não cadastra pela API)' });
      const pctx = await this.ctx.providerContext(tx, s.environment, { settings: s });
      const result = await this.ctx.guard(() => provider.registerWebhook!(pctx, `${this.ctx.publicApiBase()}/api/public/fiscal/webhook/${tenantId}`, secret));
      await this.audit.log(tx, { action: 'fiscal.provider.webhook_registered', entity: 'module', entityId: MODULE, data: { provider: s.provider } });
      return result;
    });
  }

  // ---- Certificado ----------------------------------------------------------------------------------

  async uploadCertificate(file: UploadedFile, password: string): Promise<Certificate> {
    const { tenantId, userId } = requestContext.require();
    let parsed: ReturnType<typeof parsePfx>;
    try {
      parsed = parsePfx(file.buffer, password);
    } catch (err) {
      if (err instanceof CertificateError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }
    if (parsed.validTo.getTime() < Date.now()) throw new BadRequestException({ code: 'CERTIFICATE_EXPIRED', message: `Certificado vencido em ${parsed.validTo.toLocaleDateString('pt-BR')}` });
    return this.tdb.run(async (tx) => {
      const company = await this.ctx.company(tx);
      // Matriz e filiais compartilham a raiz do CNPJ (8 primeiros caracteres).
      if (parsed.document && company.document && parsed.document.length === 14 && parsed.document.slice(0, 8) !== company.document.slice(0, 8)) {
        throw new BadRequestException({ code: 'CERTIFICATE_MISMATCH', message: `O certificado é do CNPJ ${parsed.document}, diferente do CNPJ da empresa (${company.document})` });
      }
      const [previous] = await tx.select().from(fiscalCertificates).where(eq(fiscalCertificates.active, true)).for('update');
      if (previous) await tx.update(fiscalCertificates).set({ active: false }).where(eq(fiscalCertificates.id, previous.id));
      const saved = await this.files.saveCheckedInTx(
        tx,
        { buffer: file.buffer, originalname: 'certificado-a1.pfx', mimetype: 'application/x-pkcs12', size: file.buffer.length },
        { entity: FILE_OWNER.certificate, id: tenantId },
      );
      const [row] = await tx
        .insert(fiscalCertificates)
        .values({
          tenantId,
          fileId: saved.id,
          passwordEnc: this.secrets.encrypt(password),
          subjectName: parsed.subjectName,
          subjectDocument: parsed.document,
          issuerName: parsed.issuerName,
          serialNumber: parsed.serialNumber,
          validFrom: parsed.validFrom,
          validTo: parsed.validTo,
          createdBy: userId,
        })
        .returning();
      // O anterior sai do storage: um .pfx guardado é risco, mesmo cifrado pela senha.
      if (previous) await this.files.removeInTx(tx, previous.fileId, { entity: FILE_OWNER.certificate, id: tenantId }).catch(() => undefined);
      await this.audit.log(tx, {
        action: 'fiscal.certificate.uploaded',
        entity: 'fiscal_certificate',
        entityId: row!.id,
        data: { subject: parsed.subjectName, validTo: parsed.validTo.toISOString(), replaced: previous?.id ?? null },
      });
      return toCertificate(row!, company);
    });
  }

  removeCertificate(id: string) {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [row] = await tx.select().from(fiscalCertificates).where(eq(fiscalCertificates.id, id)).for('update');
      if (!row || !row.active) throw new NotFoundException({ code: 'CERTIFICATE_NOT_FOUND', message: 'Certificado não encontrado' });
      await tx.update(fiscalCertificates).set({ active: false }).where(eq(fiscalCertificates.id, id));
      await this.files.removeInTx(tx, row.fileId, { entity: FILE_OWNER.certificate, id: tenantId }).catch(() => undefined);
      await this.audit.log(tx, { action: 'fiscal.certificate.removed', entity: 'fiscal_certificate', entityId: id });
    });
  }

  // ---- Séries ---------------------------------------------------------------------------------------

  saveSeries(input: SeriesInput): Promise<Series> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const [row] = await tx
        .insert(fiscalSeries)
        .values({ tenantId, ...input })
        .onConflictDoUpdate({ target: [fiscalSeries.tenantId, fiscalSeries.type, fiscalSeries.environment], set: { series: input.series, nextNumber: input.nextNumber } })
        .returning();
      await this.audit.log(tx, { action: 'fiscal.series.updated', entity: 'fiscal_series', entityId: row!.id, data: input });
      return toSeries(row!);
    });
  }

  // ---- Aviso de vencimento --------------------------------------------------------------------------

  /** Job: avisa por e-mail (e-mail da empresa) 30, 15, 7, 1 e 0 dias antes do vencimento. */
  async certificateAlerts() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      await requestContext.run({ tenantId }, () =>
        this.tdb.run(async (tx) => {
          const [cert] = await tx.select().from(fiscalCertificates).where(eq(fiscalCertificates.active, true));
          if (!cert) return;
          const days = daysUntil(cert.validTo);
          // Faixa atual (a mais urgente que já chegou); cada faixa avisa uma vez.
          const threshold = [...ALERT_DAYS].reverse().find((d) => days <= d);
          if (threshold === undefined || (cert.lastAlertDays !== null && cert.lastAlertDays <= threshold)) return;
          const [company] = await tx.select({ email: tenants.email, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
          if (company?.email) {
            const when = days < 0 ? `venceu em ${cert.validTo.toLocaleDateString('pt-BR')}` : days === 0 ? 'vence hoje' : `vence em ${days} dia${days === 1 ? '' : 's'} (${cert.validTo.toLocaleDateString('pt-BR')})`;
            await this.channels
              .get('email')
              .send({
                tenantId,
                to: company.email,
                subject: `Certificado digital ${days <= 0 ? 'vencido' : 'perto de vencer'} — ${company.name}`,
                body: `O certificado digital A1 da empresa (${cert.subjectName}) ${when}.\n\nSem certificado válido não é possível emitir notas fiscais. Renove com a sua certificadora e envie o arquivo novo em Configurações → Nota fiscal.`,
                reference: `fiscal-cert:${cert.id}:${threshold}`,
              })
              .catch((err) => this.logger.warn(`Aviso de certificado (${tenantId}) falhou: ${err}`));
          }
          await tx.update(fiscalCertificates).set({ lastAlertDays: threshold }).where(eq(fiscalCertificates.id, cert.id));
        }),
      );
    }
  }

  // ---- internos -------------------------------------------------------------------------------------

  private async certificateDto(tx: Tx, company: CompanyFiscal): Promise<Certificate | null> {
    const [row] = await tx.select().from(fiscalCertificates).where(eq(fiscalCertificates.active, true));
    return row ? toCertificate(row, company) : null;
  }

  /** Séries "1" a partir do nº 1 em cada tipo e ambiente (idempotente). */
  private async seed(tx: Tx, tenantId: string) {
    for (const type of docTypes) {
      for (const environment of environments) {
        await tx.insert(fiscalSeries).values({ tenantId, type, environment, series: '1', nextNumber: 1 }).onConflictDoNothing();
      }
    }
  }
}

export function toCertificate(row: typeof fiscalCertificates.$inferSelect, company: Pick<CompanyFiscal, 'document'>): Certificate {
  return {
    id: row.id,
    subjectName: row.subjectName,
    document: row.subjectDocument,
    issuerName: row.issuerName,
    serialNumber: row.serialNumber,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo.toISOString(),
    daysLeft: daysUntil(row.validTo),
    active: row.active,
    documentMismatch: !!(row.subjectDocument && company.document && row.subjectDocument.slice(0, 8) !== company.document.slice(0, 8)),
    createdAt: row.createdAt.toISOString(),
  };
}

const toSeries = (r: typeof fiscalSeries.$inferSelect): Series => ({ id: r.id, type: r.type, environment: r.environment, series: r.series, nextNumber: r.nextNumber });

/** O que falta para emitir, por tipo de nota. */
export function readiness(s: FiscalSettings, company: CompanyFiscal, eff: { stateRegistration: string | null; municipalRegistration: string | null }, certificate: Certificate | null): ReadinessItem[] {
  const all = ['nfse', 'nfce', 'nfe'] as const;
  const real = s.provider !== 'simulated';
  const token = s.environment === 'production' ? s.tokenProduction : s.tokenHomologation;
  const [cscId, cscToken] = s.environment === 'production' ? [s.cscIdProduction, s.cscTokenProduction] : [s.cscIdHomologation, s.cscTokenHomologation];
  const items: ReadinessItem[] = [
    { key: 'cnpj', label: 'CNPJ da empresa (Dados da empresa)', ok: company.document?.length === 14, blocking: true, types: [...all] },
    { key: 'legal_name', label: 'Razão social', ok: !!company.legalName, blocking: true, types: [...all] },
    { key: 'address', label: 'Endereço completo da empresa', ok: !!(company.address?.street && company.address.city && company.address.state && company.address.zip), blocking: true, types: [...all] },
    { key: 'regime', label: `Regime tributário: ${isSimples(s.taxRegime) ? 'Simples/MEI' : 'Lucro Presumido/Real'} (confira com o contador)`, ok: true, blocking: false, types: [...all] },
    { key: 'cnae', label: 'CNAE principal', ok: !!s.cnae, blocking: false, types: ['nfse'] },
    { key: 'municipality', label: 'Código IBGE do município', ok: !!s.municipalityCode, blocking: true, types: ['nfse'] },
    { key: 'im', label: 'Inscrição municipal', ok: !!eff.municipalRegistration, blocking: s.nfseStandard === 'municipal', types: ['nfse'] },
    { key: 'ie', label: 'Inscrição estadual', ok: !!eff.stateRegistration, blocking: true, types: ['nfce', 'nfe'] },
    {
      key: 'certificate',
      label: certificate ? `Certificado A1 (vence em ${certificate.daysLeft} dias)` : 'Certificado digital A1',
      ok: !!certificate && certificate.daysLeft >= 0,
      // Com a Focus o certificado pode ter sido enviado direto no painel dela; aqui é aviso.
      blocking: false,
      types: [...all],
    },
    { key: 'provider', label: 'Provedor de emissão contratado', ok: real && s.provider === 'focus', blocking: s.environment === 'production', types: [...all] },
    { key: 'token', label: 'Token da API do provedor (ambiente atual)', ok: !real || !!token, blocking: real, types: [...all] },
    { key: 'csc', label: 'CSC e ID do CSC da NFC-e (ambiente atual)', ok: !real || !!(cscId && cscToken), blocking: real, types: ['nfce'] },
    { key: 'environment', label: s.environment === 'production' ? 'Ambiente de produção (notas com valor fiscal)' : 'Ambiente de homologação (testes, sem valor fiscal)', ok: !(s.environment === 'production' && !real), blocking: true, types: [...all] },
  ];
  return items;
}
