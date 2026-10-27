import { defineWebModule } from '@all/module-sdk/web';
import { ConnectionsPage } from './ConnectionsPage';

export const bankingWeb = defineWebModule({
  key: 'integration.banking',
  routes: [{ path: 'configuracoes/bancos', permission: 'core.access.settings', Component: ConnectionsPage }],
});

export { bankingKey } from './ConnectionsPage';
export { FinancingPanel, ProposalList, proposalTone, useProposals } from './FinancingPanel';
