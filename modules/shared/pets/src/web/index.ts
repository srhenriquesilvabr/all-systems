import { defineWebModule } from '@all/module-sdk/web';
import { registerSubjectPicker } from '@all/scheduling/web';
import { CustomerPetsTab } from './CustomerPetsTab';
import { PetPage } from './PetPage';
import { PetPicker } from './PetPicker';
import { PetsPage } from './PetsPage';

// Na agenda, com o módulo de pets ativo, o horário é marcado para um pet do cliente.
registerSubjectPicker({ label: 'Pet', moduleKey: 'shared.pets', Component: PetPicker });

export const petsWeb = defineWebModule({
  key: 'shared.pets',
  routes: [
    { path: 'pets', permission: 'shared.pets.read', Component: PetsPage },
    { path: 'pets/:id', permission: 'shared.pets.read', Component: PetPage },
  ],
  customerTabs: [{ key: 'pets', label: 'Pets', permission: 'shared.pets.read', Component: CustomerPetsTab }],
});

export { registerPetTab, usePet, usePets, petsKey, type PetTab } from './hooks';
export { PetModal } from './PetModal';
