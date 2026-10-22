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

/** Parte web de um módulo. O admin só registra as rotas dos módulos ativos no tenant. */
export interface WebModule {
  key: string;
  routes: WebRoute[];
  customerTabs?: CustomerTab[];
}

export function defineWebModule(m: WebModule): WebModule {
  return m;
}
