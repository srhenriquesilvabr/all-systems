import { defineWebModule } from '@all/module-sdk/web';
import { CommissionsPage } from './CommissionsPage';

export const beautyWeb = defineWebModule({
  key: 'beauty',
  routes: [{ path: 'salao/comissoes', permission: 'beauty.commissions.read', Component: CommissionsPage }],
  manual: () => import('./manual').then((m) => m.manual),
});
