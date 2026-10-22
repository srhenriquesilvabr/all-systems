import { defineWebModule } from '@all/module-sdk/web';
import { NotificationsPage } from './NotificationsPage';

export const notificationsWeb = defineWebModule({
  key: 'shared.notifications',
  routes: [{ path: 'configuracoes/notificacoes', permission: 'shared.notifications.read', Component: NotificationsPage }],
});
