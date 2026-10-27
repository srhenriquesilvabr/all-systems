import type { Tx } from '@all/db';
import { ModuleRegistry, requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { ZodTypeAny } from 'zod';
import { AuditService } from '../audit/audit.service';
import { isMasked, maskSecret, SecretBox } from '../common/secrets';
import { tenantModules } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { ModuleHooks } from './module-hooks';

/**
 * Configurações dos módulos por tenant, validadas pelo schema `settings` do manifesto.
 * Campos listados em `secretSettings` são cifrados no banco e mascarados ao voltar para a tela.
 */
@Injectable()
export class ModuleSettingsService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly registry: ModuleRegistry,
    private readonly audit: AuditService,
    private readonly secrets: SecretBox,
    private readonly hooks: ModuleHooks,
  ) {}

  /** Uso interno (servidor): valores reais, segredos decifrados. Inválido (schema mudou) volta ao padrão. */
  async getInTx<T = Record<string, unknown>>(tx: Tx, key: string): Promise<T> {
    const schema = this.schemaOf(key);
    const [row] = await tx.select({ settings: tenantModules.settings }).from(tenantModules).where(eq(tenantModules.moduleKey, key));
    const stored = this.decryptSecrets(key, (row?.settings ?? {}) as Record<string, unknown>);
    const parsed = schema.safeParse(stored);
    return (parsed.success ? parsed.data : schema.parse({})) as T;
  }

  /** Uso interno fora de transação (ex.: gerar o Pix): valores reais, módulo precisa estar ativo. */
  getReal<T = Record<string, unknown>>(key: string): Promise<T> {
    this.assertActive(key);
    return this.tdb.run((tx) => this.getInTx<T>(tx, key));
  }

  /** Para a tela: segredos mascarados. */
  async get(key: string): Promise<Record<string, unknown>> {
    this.assertActive(key);
    const values = await this.tdb.run((tx) => this.getInTx<Record<string, unknown>>(tx, key));
    for (const field of this.secretFields(key)) values[field] = maskSecret(String(values[field] ?? ''));
    return values;
  }

  save(key: string, body: unknown) {
    this.assertActive(key);
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const current = await this.getInTx<Record<string, unknown>>(tx, key);
      // Segredo vazio ou ainda mascarado = "não mexi": mantém o valor atual.
      const candidate = { ...(body as Record<string, unknown>) };
      for (const field of this.secretFields(key)) {
        if (candidate[field] === undefined || candidate[field] === '' || isMasked(candidate[field])) candidate[field] = current[field] ?? '';
      }
      const parsed = this.schemaOf(key).safeParse(candidate);
      if (!parsed.success) {
        throw new BadRequestException({
          code: 'VALIDATION',
          message: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
        });
      }
      const toStore = { ...(parsed.data as Record<string, unknown>) };
      for (const field of this.secretFields(key)) {
        if (toStore[field]) toStore[field] = this.secrets.encrypt(String(toStore[field]));
      }
      await tx
        .update(tenantModules)
        .set({ settings: toStore })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, key)));
      await this.hooks.onSettingsSaved(tx, tenantId, key, parsed.data as Record<string, unknown>);
      await this.audit.log(tx, { action: 'module.settings.updated', entity: 'module', entityId: key });
      return parsed.data as Record<string, unknown>;
    });
  }

  private decryptSecrets(key: string, values: Record<string, unknown>) {
    const out = { ...values };
    for (const field of this.secretFields(key)) {
      if (typeof out[field] === 'string' && out[field]) out[field] = this.secrets.decrypt(out[field] as string);
    }
    return out;
  }

  private secretFields(key: string): string[] {
    return this.registry.get(key)?.secretSettings ?? [];
  }

  private assertActive(key: string) {
    if (!requestContext.require().modules?.has(key)) {
      throw new NotFoundException({ code: 'MODULE_NOT_ENABLED', message: 'Módulo não contratado' });
    }
  }

  private schemaOf(key: string): ZodTypeAny {
    const schema = this.registry.get(key)?.settings;
    if (!schema) throw new NotFoundException({ code: 'NO_SETTINGS', message: 'Este módulo não tem configurações' });
    return schema;
  }
}
