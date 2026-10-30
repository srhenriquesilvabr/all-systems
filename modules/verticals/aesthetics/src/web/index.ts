import { defineWebModule } from '@all/module-sdk/web';
import { CustomerPackagesTab, PackagesPage } from './packages';
import { SetupPage, SpecialtiesPage, SurgeryBudgetsPage } from './specialties/pages';
import { CustomerRecordsTab } from './specialties/PatientSpecialties';

export const aestheticsWeb = defineWebModule({
  key: 'aesthetics',
  routes: [
    { path: 'estetica/pacotes', permission: 'aesthetics.packages.read', Component: PackagesPage },
    { path: 'estetica/especialidades', permission: 'shared.medical-records.read', Component: SpecialtiesPage },
    { path: 'estetica/orcamentos', permission: 'aesthetics.surgery.budget', Component: SurgeryBudgetsPage },
    { path: 'estetica/cadastros', permission: 'aesthetics.setup.manage', Component: SetupPage },
  ],
  customerTabs: [
    // Com especialidades ligadas, o prontuário ganha as fichas, tratamentos e fotos de cada uma.
    { key: 'aesthetics.records', label: 'Prontuário', permission: 'shared.medical-records.read', Component: CustomerRecordsTab },
    { key: 'aesthetics.packages', label: 'Pacotes', permission: 'aesthetics.packages.read', Component: CustomerPackagesTab },
  ],
  manual: () => import('./manual').then((m) => m.manual),
});
