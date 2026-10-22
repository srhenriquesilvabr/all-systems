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
}

export interface ModuleManifest {
  key: string;
  name: string;
  layer: ModuleLayer;
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
}

export interface NotificationTemplateDef {
  /** Prefixada pela key do módulo. Ex.: `shared.service-orders.ready`. */
  key: string;
  label: string;
  channel: 'email';
  subject: string;
  /** Texto com variáveis no formato {{cliente.nome}}. */
  body: string;
  /** Variáveis disponíveis, exibidas ao editar o template. */
  variables: string[];
}

export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest;
}
