import { laundryWeb } from '@all/laundry/web';
import type { WebModule } from '@all/module-sdk/web';
import { notificationsWeb } from '@all/notifications/web';
import { serviceOrdersWeb } from '@all/service-orders/web';

/** Telas dos módulos instalados. Só as dos módulos ativos no tenant viram rotas. */
export const webModules: WebModule[] = [notificationsWeb, serviceOrdersWeb, laundryWeb];
