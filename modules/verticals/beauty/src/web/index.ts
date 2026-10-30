import { defineWebModule } from '@all/module-sdk/web';
import { MyCommissionPage } from './CommissionsExtra';
import { CommissionsPage } from './CommissionsPage';

export const beautyWeb = defineWebModule({
  key: 'beauty',
  routes: [
    { path: 'salao/comissoes', permission: 'beauty.commissions.read', Component: CommissionsPage },
    { path: 'salao/minha-comissao', permission: 'beauty.commissions.own', Component: MyCommissionPage },
  ],
  manual: () => import('./manual').then((m) => m.manual),
});
