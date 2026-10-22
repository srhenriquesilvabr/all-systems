import type { Tx } from '@all/db';
import { Injectable } from '@nestjs/common';

/**
 * Cada módulo que guarda dados ligados a um cliente registra como exportá-los e anonimizá-los.
 * É assim que o pedido de acesso/eliminação da LGPD alcança todos os módulos sem que o core
 * os conheça.
 */
export interface CustomerDataProvider {
  moduleKey: string;
  /** Dados do cliente neste módulo, em formato legível (vai para o arquivo de exportação). */
  export(tx: Tx, customerId: string): Promise<unknown>;
  /** Apaga ou mascara dados pessoais, mantendo o que a lei exige guardar (ex.: valores financeiros). */
  anonymize?(tx: Tx, customerId: string): Promise<void>;
}

@Injectable()
export class CustomerDataRegistry {
  private readonly providers: CustomerDataProvider[] = [];

  register(provider: CustomerDataProvider) {
    this.providers.push(provider);
  }

  /** Só os módulos ativos no tenant participam. */
  for(activeModules: ReadonlySet<string>) {
    return this.providers.filter((p) => activeModules.has(p.moduleKey));
  }
}
