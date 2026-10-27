import { defineWebModule } from '@all/module-sdk/web';
import { CustomerPackagesTab, CustomerRecordsTab, PackagesPage } from './packages';

export const aestheticsWeb = defineWebModule({
  key: 'aesthetics',
  routes: [{ path: 'estetica/pacotes', permission: 'aesthetics.packages.read', Component: PackagesPage }],
  customerTabs: [
    { key: 'aesthetics.records', label: 'Prontuário', permission: 'shared.medical-records.read', Component: CustomerRecordsTab },
    { key: 'aesthetics.packages', label: 'Pacotes', permission: 'aesthetics.packages.read', Component: CustomerPackagesTab },
  ],
});
