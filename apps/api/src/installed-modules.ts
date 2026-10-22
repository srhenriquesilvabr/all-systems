import { coreManifests } from '@all/core';
import { LaundryModule, laundryManifest } from '@all/laundry';
import { NotificationsModule, notificationsManifest } from '@all/notifications';
import { ServiceOrdersModule, serviceOrdersManifest } from '@all/service-orders';

/**
 * Módulos instalados nesta build. Para adicionar uma vertical: criar o pacote em
 * modules/verticals/, registrar o manifesto e o Nest module aqui e as telas em apps/admin/src/modules.ts.
 * O que cada tenant usa é decidido em runtime (tabela tenant_modules).
 */
export const manifests = [...coreManifests, notificationsManifest, serviceOrdersManifest, laundryManifest];

export const featureModules = [NotificationsModule, ServiceOrdersModule, LaundryModule];
