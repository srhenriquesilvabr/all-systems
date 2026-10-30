import { defineWebModule } from '@all/module-sdk/web';
import { BakeryOrderPage } from './BakeryOrderPage';
import { BakeryOrdersPage, NewBakeryOrderPage, ProductionPage } from './pages';

export const bakeryWeb = defineWebModule({
  key: 'bakery',
  manual: () => import('./manual').then((m) => m.manual),
  routes: [
    { path: 'padaria/encomendas', permission: 'shared.service-orders.read', Component: BakeryOrdersPage },
    { path: 'padaria/encomendas/nova', permission: 'shared.service-orders.write', Component: NewBakeryOrderPage },
    { path: 'padaria/encomendas/:id', permission: 'shared.service-orders.read', Component: BakeryOrderPage },
    { path: 'padaria/producao', permission: 'shared.service-orders.read', Component: ProductionPage },
  ],
});
