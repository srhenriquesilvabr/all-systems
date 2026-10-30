import { defineWebModule } from '@all/module-sdk/web';
import { registerSubjectPicker } from '@all/scheduling/web';
import { CasePage } from './CasePage';
import { CasePicker } from './CasePicker';
import { CasesPage, CustomerCasesTab } from './CasesPage';
import { DeadlinesPage } from './DeadlinesPage';

// Na agenda do escritório, audiências e reuniões podem ser ligadas a um processo do cliente.
registerSubjectPicker({ label: 'Processo', moduleKey: 'legal', Component: CasePicker });

export const legalWeb = defineWebModule({
  key: 'legal',
  routes: [
    { path: 'juridico/processos', permission: 'legal.cases.read', Component: CasesPage },
    { path: 'juridico/processos/:id', permission: 'legal.cases.read', Component: CasePage },
    { path: 'juridico/prazos', permission: 'legal.cases.read', Component: DeadlinesPage },
  ],
  customerTabs: [{ key: 'legal.cases', label: 'Processos', permission: 'legal.cases.read', Component: CustomerCasesTab }],
  manual: () => import('./manual').then((m) => m.manual),
});
