import type { Tx } from '@all/db';
import { Injectable } from '@nestjs/common';

export interface ModuleLifecycle {
  /**
   * Roda na transação que ativa o módulo para o tenant (e de novo se for reativado):
   * precisa ser idempotente. Uso típico: dados iniciais (categorias, contas, templates).
   */
  onEnable?(tx: Tx, tenantId: string): Promise<void>;
  /** Depois de salvar as configurações do módulo (ex.: indexar o número do WhatsApp). */
  onSettingsSaved?(tx: Tx, tenantId: string, settings: Record<string, unknown>): Promise<void>;
}

/** Ganchos de ciclo de vida que os módulos registram no onModuleInit. */
@Injectable()
export class ModuleHooks {
  private readonly hooks = new Map<string, ModuleLifecycle>();

  register(moduleKey: string, lifecycle: ModuleLifecycle) {
    this.hooks.set(moduleKey, { ...this.hooks.get(moduleKey), ...lifecycle });
  }

  async onEnable(tx: Tx, tenantId: string, moduleKey: string) {
    await this.hooks.get(moduleKey)?.onEnable?.(tx, tenantId);
  }

  async onSettingsSaved(tx: Tx, tenantId: string, moduleKey: string, settings: Record<string, unknown>) {
    await this.hooks.get(moduleKey)?.onSettingsSaved?.(tx, tenantId, settings);
  }
}
