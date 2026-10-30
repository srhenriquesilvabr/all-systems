import { defineWebModule } from '@all/module-sdk/web';
import { AssembliesPage } from './assemblies';
import { ChannelsPage } from './leads/ChannelsPage';
import { LeadFormPage } from './leads/LeadFormPage';
import { LeadPage } from './leads/LeadPage';
import { LeadsPage } from './leads/LeadsPage';
import { ReferralsPage } from './leads/ReferralsPage';
import { LeadsReportPage } from './leads/ReportPage';
import { SellPage } from './leads/SellPage';
import { LeadSettingsPage } from './leads/SettingsPage';
import { CustomerQuotasTab, QuotasPage, SimulatorPage } from './pages';
import { QuotaPage } from './quota';
import { CommissionsPage, GroupsPage, LatePage } from './tracking';

export const consortiumWeb = defineWebModule({
  key: 'consortium',
  routes: [
    { path: 'consorcio', permission: 'consortium.read', Component: SimulatorPage },
    { path: 'consorcio/vender', permission: 'consortium.sell', Component: SellPage },
    { path: 'consorcio/cotas', permission: 'consortium.read', Component: QuotasPage },
    { path: 'consorcio/cotas/:id', permission: 'consortium.read', Component: QuotaPage },
    { path: 'consorcio/inadimplencia', permission: 'consortium.read', Component: LatePage },
    { path: 'consorcio/assembleias', permission: 'consortium.read', Component: AssembliesPage },
    { path: 'consorcio/grupos', permission: 'consortium.read', Component: GroupsPage },
    { path: 'consorcio/comissoes', permission: 'consortium.manage', Component: CommissionsPage },
    { path: 'consorcio/leads', permission: 'consortium.leads.read', Component: LeadsPage },
    { path: 'consorcio/leads/novo', permission: 'consortium.leads.manage', Component: LeadFormPage },
    { path: 'consorcio/leads/:id', permission: 'consortium.leads.read', Component: LeadPage },
    { path: 'consorcio/leads/:id/editar', permission: 'consortium.leads.work', Component: LeadFormPage },
    { path: 'consorcio/indicacoes', permission: 'consortium.leads.manage', Component: ReferralsPage },
    { path: 'consorcio/conversao', permission: 'consortium.leads.manage', Component: LeadsReportPage },
    { path: 'consorcio/canais', permission: 'consortium.leads.manage', Component: ChannelsPage },
    { path: 'configuracoes/captacao', permission: 'core.access.settings', Component: LeadSettingsPage },
  ],
  customerTabs: [{ key: 'consortium.quotas', label: 'Consórcio', permission: 'consortium.read', Component: CustomerQuotasTab }],
  manual: () => import('./manual').then((m) => m.manual),
});

// Simulador público (fora do login), montado pelo admin em /consorcio/:slug.
export { PublicSimulatorPage } from './leads/PublicSimulatorPage';
