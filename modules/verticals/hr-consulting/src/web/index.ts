import { defineWebModule } from '@all/module-sdk/web';
import { ClientPage, ClientsPage, ClientTab } from './pages';

/** Consultoria de RH: empresas atendidas. Colaboradores e folhas usam as telas do RH, com o seletor de empresa. */
export const hrConsultingWeb = defineWebModule({
  key: 'hr_consulting',
  routes: [
    { path: 'consultoria-rh/empresas', permission: 'hr.read', Component: ClientsPage },
    { path: 'consultoria-rh/empresas/:id', permission: 'hr.read', Component: ClientPage },
  ],
  customerTabs: [{ key: 'hr_consulting.client', label: 'RH (colaboradores e folhas)', permission: 'hr.read', Component: ClientTab }],
  manual: () => import('./manual').then((m) => m.manual),
});
