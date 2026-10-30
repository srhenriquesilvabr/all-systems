import { defineWebModule } from '@all/module-sdk/web';
import { CustomerDealsTab, DealPage, DealsPage } from './deals';
import { StockPage, VehiclePage } from './stock';

export const vehiclesWeb = defineWebModule({
  key: 'vehicles',
  routes: [
    { path: 'veiculos/estoque', permission: 'vehicles.stock.read', Component: StockPage },
    { path: 'veiculos/estoque/:id', permission: 'vehicles.stock.read', Component: VehiclePage },
    { path: 'veiculos/negociacoes', permission: 'vehicles.deals.read', Component: DealsPage },
    { path: 'veiculos/negociacoes/:id', permission: 'vehicles.deals.read', Component: DealPage },
  ],
  customerTabs: [{ key: 'vehicles.deals', label: 'Veículos', permission: 'vehicles.deals.read', Component: CustomerDealsTab }],
  manual: () => import('./manual').then((m) => m.manual),
});
