import { defineWebModule } from '@all/module-sdk/web';
import { CustomerRecordsTab, CustomerTreatmentsTab, TreatmentsPage } from './treatments';

export const orthodonticsWeb = defineWebModule({
  key: 'orthodontics',
  routes: [{ path: 'orto/tratamentos', permission: 'orthodontics.treatments.read', Component: TreatmentsPage }],
  customerTabs: [
    { key: 'orthodontics.records', label: 'Prontuário', permission: 'shared.medical-records.read', Component: CustomerRecordsTab },
    { key: 'orthodontics.treatments', label: 'Tratamento', permission: 'orthodontics.treatments.read', Component: CustomerTreatmentsTab },
  ],
  manual: () => import('./manual').then((m) => m.manual),
});
