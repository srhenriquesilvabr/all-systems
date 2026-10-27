import { defineWebModule } from '@all/module-sdk/web';
import { AssembliesPage, CustomerQuotasTab, QuotasPage, SimulatorPage } from './pages';

export const consortiumWeb = defineWebModule({
  key: 'consortium',
  routes: [
    { path: 'consorcio', permission: 'consortium.read', Component: SimulatorPage },
    { path: 'consorcio/cotas', permission: 'consortium.read', Component: QuotasPage },
    { path: 'consorcio/assembleias', permission: 'consortium.read', Component: AssembliesPage },
  ],
  customerTabs: [{ key: 'consortium.quotas', label: 'Consórcio', permission: 'consortium.read', Component: CustomerQuotasTab }],
});
