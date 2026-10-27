import { defineModule } from '@all/module-sdk';

export const medicalRecordsManifest = defineModule({
  key: 'shared.medical-records',
  name: 'Prontuário',
  layer: 'shared',
  version: '1.0.0',
  dependsOn: ['core.customers'],
  permissions: [
    { key: 'shared.medical-records.read', label: 'Ver prontuários (dado sensível)' },
    { key: 'shared.medical-records.write', label: 'Incluir registros e anexos no prontuário' },
    { key: 'shared.medical-records.audit', label: 'Ver quem acessou cada prontuário' },
  ],
});
