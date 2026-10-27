import { defineWebModule } from '@all/module-sdk/web';
import { BakeryOrdersPage, NewBakeryOrderPage, ProductionPage } from './pages';

export const bakeryWeb = defineWebModule({
  key: 'bakery',
  routes: [
    { path: 'padaria/encomendas', permission: 'shared.service-orders.read', Component: BakeryOrdersPage },
    { path: 'padaria/encomendas/nova', permission: 'shared.service-orders.write', Component: NewBakeryOrderPage },
    { path: 'padaria/producao', permission: 'shared.service-orders.read', Component: ProductionPage },
  ],
});
