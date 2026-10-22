import type { Tx } from '@all/db';
import { Injectable } from '@nestjs/common';

export interface ModuleLifecycle {
  /**
   * Roda na transação que ativa o módulo para o tenant (e de novo se for reativado):
   * precisa ser idempotente. Uso típico: dados iniciais (categorias, contas, templates).
   */
  onEnable?(tx: Tx, tenantId: string): Promise<void>;
}

/** Ganchos de ciclo de vida que os módulos registram no onModuleInit. */
@Injectable()
export class ModuleHooks {
  private readonly hooks = new Map<string, ModuleLifecycle>();

  register(moduleKey: string, lifecycle: ModuleLifecycle) {
    this.hooks.set(moduleKey, lifecycle);
  }

  async onEnable(tx: Tx, tenantId: string, moduleKey: string) {
    await this.hooks.get(moduleKey)?.onEnable?.(tx, tenantId);
  }
}
