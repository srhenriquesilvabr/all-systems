import { defineWebModule } from '@all/module-sdk/web';
import { GroomingBoardPage } from './GroomingBoardPage';

export const petshopWeb = defineWebModule({
  key: 'petshop',
  manual: () => import('./manual').then((m) => m.manual),
  routes: [{ path: 'petshop/hoje', permission: 'shared.scheduling.read', Component: GroomingBoardPage }],
});
