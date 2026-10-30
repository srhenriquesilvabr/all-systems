import { defineWebModule } from '@all/module-sdk/web';
import { registerSubjectPicker } from '@all/scheduling/web';
import { CustomerDealsTab, DealPage, DealsPage } from './deals';
import { CustomerLeasesTab, LeasePage, LeasesPage, OwnerStatementPage } from './leases';
import { PropertiesPage, PropertyPage, PropertyPicker } from './properties';

// Visitas na agenda são marcadas para um imóvel.
registerSubjectPicker({ label: 'Imóvel', moduleKey: 'real_estate', Component: PropertyPicker });

export const realEstateWeb = defineWebModule({
  key: 'real_estate',
  routes: [
    { path: 'imoveis', permission: 'real_estate.properties.read', Component: PropertiesPage },
    { path: 'imoveis/propostas', permission: 'real_estate.deals.read', Component: DealsPage },
    { path: 'imoveis/propostas/:id', permission: 'real_estate.deals.read', Component: DealPage },
    { path: 'imoveis/locacoes', permission: 'real_estate.leases.read', Component: LeasesPage },
    { path: 'imoveis/locacoes/extrato', permission: 'real_estate.leases.read', Component: OwnerStatementPage },
    { path: 'imoveis/locacoes/:id', permission: 'real_estate.leases.read', Component: LeasePage },
    { path: 'imoveis/:id', permission: 'real_estate.properties.read', Component: PropertyPage },
  ],
  customerTabs: [
    { key: 'real_estate.deals', label: 'Imóveis', permission: 'real_estate.deals.read', Component: CustomerDealsTab },
    { key: 'real_estate.leases', label: 'Locações', permission: 'real_estate.leases.read', Component: CustomerLeasesTab },
  ],
  manual: () => import('./manual').then((m) => m.manual),
});
