import type { Tx } from '@all/db';
import { Injectable } from '@nestjs/common';

/** Papel de uma pessoa da equipe em outro módulo (ex.: "Profissional da agenda", "Colaborador (RH)"). */
export interface TeamLink {
  moduleKey: string;
  teamMemberId: string;
  label: string;
  /** Tela do admin onde o vínculo é gerenciado. */
  path?: string;
  active: boolean;
}

/**
 * Cada módulo que usa pessoas da equipe registra como encontrar os vínculos dele. É assim que o
 * cadastro da pessoa mostra onde ela aparece (agenda, RH…) sem que o core conheça esses módulos.
 */
export interface TeamLinkProvider {
  moduleKey: string;
  find(tx: Tx, teamMemberIds: string[]): Promise<Omit<TeamLink, 'moduleKey'>[]>;
}

@Injectable()
export class TeamLinksRegistry {
  private readonly providers: TeamLinkProvider[] = [];

  register(provider: TeamLinkProvider) {
    this.providers.push(provider);
  }

  /** Vínculos nos módulos ativos no tenant. */
  async findInTx(tx: Tx, activeModules: ReadonlySet<string>, teamMemberIds: string[]): Promise<TeamLink[]> {
    if (!teamMemberIds.length) return [];
    const out: TeamLink[] = [];
    for (const p of this.providers.filter((p) => activeModules.has(p.moduleKey))) {
      for (const link of await p.find(tx, teamMemberIds)) out.push({ ...link, moduleKey: p.moduleKey });
    }
    return out;
  }
}
