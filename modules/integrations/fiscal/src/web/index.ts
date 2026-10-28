import { defineWebModule } from '@all/module-sdk/web';
import { CodesPage } from './CodesPage';
import { DocumentPage } from './DocumentPage';
import { DocumentsPage } from './DocumentsPage';
import { NewDocumentPage } from './NewDocumentPage';
import { ReportsPage } from './ReportsPage';
import { SettingsPage } from './SettingsPage';

export const fiscalWeb = defineWebModule({
  key: 'integration.fiscal',
  routes: [
    { path: 'fiscal', permission: 'integration.fiscal.read', Component: DocumentsPage },
    { path: 'fiscal/nova', permission: 'integration.fiscal.issue', Component: NewDocumentPage },
    { path: 'fiscal/notas/:id', permission: 'integration.fiscal.read', Component: DocumentPage },
    { path: 'fiscal/cadastro', permission: 'integration.fiscal.codes', Component: CodesPage },
    { path: 'fiscal/relatorios', permission: 'integration.fiscal.export', Component: ReportsPage },
    { path: 'configuracoes/fiscal', permission: 'integration.fiscal.configure', Component: SettingsPage },
  ],
});

export { fiscalKey, StatusBadge as FiscalStatusBadge } from './shared';
