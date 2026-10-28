import { defineWebModule } from '@all/module-sdk/web';
import { CatalogPage, ConnectionFormPage, ConnectionsPage } from './ConnectionsPage';

export const bankingWeb = defineWebModule({
  key: 'integration.banking',
  routes: [
    { path: 'configuracoes/bancos', permission: 'core.access.settings', Component: ConnectionsPage },
    { path: 'configuracoes/bancos/catalogo', permission: 'core.access.settings', Component: CatalogPage },
    { path: 'configuracoes/bancos/nova', permission: 'core.access.settings', Component: ConnectionFormPage },
    { path: 'configuracoes/bancos/:id', permission: 'core.access.settings', Component: ConnectionFormPage },
  ],
});

export { bankingKey } from './ConnectionsPage';
export { FinancingPanel, ManualResponseForm, ProposalList, proposalTone, useProposals } from './FinancingPanel';
