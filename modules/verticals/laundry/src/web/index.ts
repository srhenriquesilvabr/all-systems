import { defineWebModule } from '@all/module-sdk/web';
import { ServicesPage } from './ServicesPage';

export const laundryWeb = defineWebModule({
  key: 'laundry',
  routes: [{ path: 'lavanderia/servicos', permission: 'laundry.catalog.manage', Component: ServicesPage }],
});
