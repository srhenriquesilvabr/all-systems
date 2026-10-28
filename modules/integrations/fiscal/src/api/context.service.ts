import { CoreConfig, FilesService, ModuleSettingsService, SecretBox } from '@all/core';
import { tenantModules, tenants } from '@all/core/schema';
import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadGatewayException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { MODULE, type CompanyFiscal, type FiscalEnvironment, type FiscalSettings, type ProviderKey } from '../contracts';
import { fiscalCertificates } from '../db/schema';
import { FocusProvider } from './providers/focus';
import { SimulatedProvider } from './providers/simulated';
import { NfeIoProvider, PlugNotasProvider } from './providers/skeletons';
import { FiscalProviderError, type FiscalProvider, type ProviderContext } from './providers/types';

/** Donos lógicos dos arquivos do módulo em `files` (todos fora do download genérico). */
export const FILE_OWNER = { document: 'fiscal_document', certificate: 'fiscal_certificate', void: 'fiscal_void' } as const;

/**
 * O que os serviços do módulo compartilham: configuração, dados da empresa, provedores e o
 * contexto que vai para o adaptador (tokens e CSC decifrados).
 */
@Injectable()
export class FiscalContext {
  private readonly providers: Record<ProviderKey, FiscalProvider>;

  constructor(
    private readonly settings: ModuleSettingsService,
    private readonly files: FilesService,
    private readonly secrets: SecretBox,
    private readonly config: CoreConfig,
    simulated: SimulatedProvider,
    focus: FocusProvider,
    plugnotas: PlugNotasProvider,
    nfeio: NfeIoProvider,
  ) {
    this.providers = { simulated, focus, plugnotas, nfeio };
    for (const owner of Object.values(FILE_OWNER)) files.protectOwner(owner);
  }

  provider(key: ProviderKey): FiscalProvider {
    return this.providers[key];
  }

  settingsInTx(tx: Tx): Promise<FiscalSettings> {
    return this.settings.getInTx<FiscalSettings>(tx, MODULE);
  }

  /** O módulo está ativo na empresa do contexto (handlers de eventos rodam para todas). */
  async isActive(tx: Tx): Promise<boolean> {
    const [row] = await tx
      .select({ status: tenantModules.status })
      .from(tenantModules)
      .where(and(eq(tenantModules.moduleKey, MODULE), eq(tenantModules.status, 'active')));
    return !!row;
  }

  async company(tx: Tx): Promise<CompanyFiscal> {
    const { tenantId } = requestContext.requireTenant();
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    return {
      name: t?.name ?? '',
      legalName: t?.legalName ?? null,
      document: t?.document ?? null,
      stateRegistration: t?.stateRegistration ?? null,
      municipalRegistration: t?.municipalRegistration ?? null,
      email: t?.email ?? null,
      phone: t?.phone ?? null,
      address: t?.address ?? null,
    };
  }

  /** Inscrições efetivas: as informadas na configuração fiscal ou, vazias, as do cadastro da empresa. */
  effective(company: CompanyFiscal, s: FiscalSettings) {
    return {
      stateRegistration: s.stateRegistration || company.stateRegistration || null,
      municipalRegistration: s.municipalRegistration || company.municipalRegistration || null,
    };
  }

  /** Contexto do adaptador. `withCertificate` lê o .pfx do storage (só para cadastrar a empresa no provedor). */
  async providerContext(tx: Tx, environment: FiscalEnvironment, opts: { withCertificate?: boolean; settings?: FiscalSettings } = {}): Promise<ProviderContext> {
    const s = opts.settings ?? (await this.settingsInTx(tx));
    const company = await this.company(tx);
    return {
      environment,
      settings: s,
      token: environment === 'production' ? s.tokenProduction : s.tokenHomologation,
      company: { ...company, ...this.effective(company, s) },
      certificate: opts.withCertificate ? await this.certificate(tx) : null,
    };
  }

  async certificate(tx: Tx): Promise<{ pfx: Buffer; password: string } | null> {
    const [row] = await tx.select().from(fiscalCertificates).where(eq(fiscalCertificates.active, true));
    if (!row) return null;
    const { stream } = await this.files.open(row.fileId, FILE_OWNER.certificate);
    return { pfx: await toBuffer(stream), password: this.secrets.decrypt(row.passwordEnc) };
  }

  /** Base pública da API (links de webhook e de download para o cliente). */
  publicApiBase(): string {
    return (process.env.PUBLIC_API_URL ?? this.config.adminUrl.replace(/:5173$/, ':3000')).replace(/\/$/, '');
  }

  /** Erro de comunicação/configuração do provedor → 502 com mensagem legível. */
  async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw asGatewayError(err);
    }
  }
}

export function asGatewayError(err: unknown): unknown {
  if (err instanceof FiscalProviderError) return new BadGatewayException({ code: 'FISCAL_PROVIDER_ERROR', message: err.message });
  if ((err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'TypeError') return new BadGatewayException({ code: 'FISCAL_PROVIDER_UNREACHABLE', message: 'O provedor de notas não respondeu. Tente de novo em instantes.' });
  return err;
}

export async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
