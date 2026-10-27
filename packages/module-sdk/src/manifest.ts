import type { ZodTypeAny } from 'zod';

export type ModuleLayer = 'core' | 'shared' | 'integration' | 'vertical';

export interface PermissionDef {
  /** Sempre prefixada pela key do módulo. Ex.: `laundry.orders.read`. */
  key: string;
  label: string;
}

export interface RoleTemplate {
  key: string;
  label: string;
  permissions: string[];
}

export interface MenuItem {
  label: string;
  path: string;
  icon?: string;
  /** O item só aparece se o usuário tiver esta permissão. */
  permission?: string;
  /** Agrupa itens no menu (ex.: "Configurações"). Sem grupo = menu principal. */
  group?: string;
  /**
   * Caminho de um item de outro módulo que este substitui quando os dois estão ativos
   * (ex.: "Encomendas" da padaria no lugar de "Ordens de serviço").
   */
  replaces?: string;
}

export interface ModuleManifest {
  key: string;
  name: string;
  layer: ModuleLayer;
  /** Uma frase sobre o que o módulo faz, mostrada no catálogo e no início do admin. */
  description?: string;
  /** Ícone do módulo no admin (mesmos nomes usados no `icon` do menu). */
  icon?: string;
  version: string;
  dependsOn?: string[];
  optionalDependsOn?: string[];
  permissions?: PermissionDef[];
  /** Papéis criados no tenant quando o módulo é ativado. */
  defaultRoles?: RoleTemplate[];
  menu?: MenuItem[];
  /** Schema das configurações do módulo por tenant. */
  settings?: ZodTypeAny;
  events?: { publishes?: string[]; subscribes?: string[] };
  /** Mensagens que o módulo envia. O tenant pode personalizar o texto em shared.notifications. */
  notificationTemplates?: NotificationTemplateDef[];
  /** Campos de `settings` que são segredos (tokens): cifrados no banco e mascarados na tela. */
  secretSettings?: string[];
}

export type NotificationChannel = 'email' | 'whatsapp';

/**
 * Mensagem que um módulo envia ao cliente, com uma versão por canal. Textos usam variáveis
 * no formato {{cliente.nome}}. Só os canais definidos (e disponíveis no tenant) são usados.
 */
export interface NotificationTemplateDef {
  /** Prefixada pela key do módulo. Ex.: `shared.service-orders.ready`. */
  key: string;
  label: string;
  /** Variáveis disponíveis, exibidas ao editar o template. */
  variables: string[];
  email?: { subject: string; body: string };
  whatsapp?: {
    /** Texto livre: usado no modo manual (link do WhatsApp) e dentro da janela de 24 h da API. */
    body: string;
    /** Template aprovado na Meta, exigido pela API oficial para mensagens iniciadas pela empresa. */
    meta?: { name: string; params: string[] };
    /** Botões de resposta rápida. O payload volta no webhook quando o cliente toca. */
    buttons?: { label: string; payload: string }[];
  };
}

export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest;
}
