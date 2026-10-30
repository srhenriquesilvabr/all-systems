import type { ComponentType } from 'react';

export interface WebRoute {
  /** Caminho relativo à raiz do admin, sem barra inicial. Ex.: `lavanderia/servicos`. */
  path: string;
  /** Sem a permissão, a rota mostra "acesso negado". */
  permission?: string;
  Component: ComponentType;
}

/** Aba extra na ficha do cliente (ex.: "Ordens de serviço", "Pets"). */
export interface CustomerTab {
  key: string;
  label: string;
  permission?: string;
  Component: ComponentType<{ customerId: string }>;
}

/** Um bloco do manual: parágrafo, passo a passo, lista, dica ou cuidado. */
export type ManualBlock = { text: string } | { steps: string[] } | { list: string[] } | { tip: string } | { warn: string };

/** Um assunto do manual, explicado nas duas linguagens, lado a lado. */
export interface ManualTopic {
  /** Trecho do endereço: `/manual/<guia>/<id>`. */
  id: string;
  title: string;
  /** Tela onde isso é feito; o botão só aparece para quem tem acesso a ela. */
  path?: string;
  /** Para quem usa no dia a dia: frases curtas, sem termo técnico. */
  simple: ManualBlock[];
  /** Para quem administra ou dá suporte: regras, situações, cálculos e permissões. */
  technical: ManualBlock[];
}

/** O manual de um ramo. */
export interface ManualGuide {
  title: string;
  summary: string;
  topics: ManualTopic[];
}

/** Parte web de um módulo. O admin só registra as rotas dos módulos ativos no tenant. */
export interface WebModule {
  key: string;
  routes: WebRoute[];
  customerTabs?: CustomerTab[];
  /** Manual do ramo, num arquivo separado: só é baixado quando alguém abre o manual. */
  manual?: () => Promise<ManualGuide>;
}

export function defineWebModule(m: WebModule): WebModule {
  return m;
}
