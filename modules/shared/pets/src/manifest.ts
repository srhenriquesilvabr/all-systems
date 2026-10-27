import { defineModule } from '@all/module-sdk';

export const petsManifest = defineModule({
  key: 'shared.pets',
  name: 'Pets',
  layer: 'shared',
  version: '1.0.0',
  dependsOn: ['core.customers'],
  permissions: [
    { key: 'shared.pets.read', label: 'Ver pets' },
    { key: 'shared.pets.write', label: 'Cadastrar e editar pets' },
  ],
  menu: [{ label: 'Pets', path: '/pets', icon: 'paw', permission: 'shared.pets.read' }],
});
