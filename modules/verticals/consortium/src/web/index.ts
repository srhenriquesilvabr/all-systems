import { defineWebModule } from '@all/module-sdk/web';
import { AssembliesPage } from './assemblies';
import { CustomerQuotasTab, QuotasPage, SimulatorPage } from './pages';
import { QuotaPage } from './quota';
import { CommissionsPage, GroupsPage, LatePage } from './tracking';

export const consortiumWeb = defineWebModule({
  key: 'consortium',
  routes: [
    { path: 'consorcio', permission: 'consortium.read', Component: SimulatorPage },
    { path: 'consorcio/cotas', permission: 'consortium.read', Component: QuotasPage },
    { path: 'consorcio/cotas/:id', permission: 'consortium.read', Component: QuotaPage },
    { path: 'consorcio/inadimplencia', permission: 'consortium.read', Component: LatePage },
    { path: 'consorcio/assembleias', permission: 'consortium.read', Component: AssembliesPage },
    { path: 'consorcio/grupos', permission: 'consortium.read', Component: GroupsPage },
    { path: 'consorcio/comissoes', permission: 'consortium.manage', Component: CommissionsPage },
  ],
  customerTabs: [{ key: 'consortium.quotas', label: 'Consórcio', permission: 'consortium.read', Component: CustomerQuotasTab }],
});
