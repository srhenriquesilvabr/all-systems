import { defineWebModule } from '@all/module-sdk/web';
import { GroomingBoardPage } from './GroomingBoardPage';

export const petshopWeb = defineWebModule({
  key: 'petshop',
  routes: [{ path: 'petshop/hoje', permission: 'shared.scheduling.read', Component: GroomingBoardPage }],
});
