import { defineWebModule } from '@all/module-sdk/web';
import { ClientsPage, CustomerObligationsTab, ObligationsPage } from './pages';

export const accountingWeb = defineWebModule({
  key: 'accounting',
  routes: [
    { path: 'contabil/obrigacoes', permission: 'accounting.read', Component: ObligationsPage },
    { path: 'contabil/empresas', permission: 'accounting.read', Component: ClientsPage },
  ],
  customerTabs: [{ key: 'accounting.obligations', label: 'Contabilidade', permission: 'accounting.read', Component: CustomerObligationsTab }],
  manual: () => import('./manual').then((m) => m.manual),
});
