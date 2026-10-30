import { defineWebModule } from '@all/module-sdk/web';
import { registerPetTab } from '@all/pets/web';
import { PetRecordsTab } from './PetRecordsTab';
import { VaccinesDuePage } from './VaccinesDuePage';
import { VaccinesTab } from './VaccinesTab';

registerPetTab({ key: 'vet.records', label: 'Prontuário', moduleKey: 'vet', permission: 'shared.medical-records.read', Component: PetRecordsTab });
registerPetTab({ key: 'vet.vaccines', label: 'Vacinas', moduleKey: 'vet', permission: 'vet.vaccines.read', Component: VaccinesTab });

export const vetWeb = defineWebModule({
  key: 'vet',
  manual: () => import('./manual').then((m) => m.manual),
  routes: [{ path: 'vet/vacinas', permission: 'vet.vaccines.read', Component: VaccinesDuePage }],
});
