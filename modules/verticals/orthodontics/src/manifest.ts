import { defineModule } from '@all/module-sdk';

const agenda = {
  read: 'shared.scheduling.read',
  write: 'shared.scheduling.write',
  status: 'shared.scheduling.status',
  payments: 'shared.scheduling.payments',
};
const records = { read: 'shared.medical-records.read', write: 'shared.medical-records.write' };

/** Clínica ortodôntica: agenda, prontuário e tratamentos com mensalidades no financeiro. */
export const orthodonticsManifest = defineModule({
  key: 'orthodontics',
  name: 'Clínica ortodôntica',
  layer: 'vertical',
  description: 'Tratamentos ortodônticos, manutenções e prontuário.',
  icon: 'smile',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.scheduling', 'shared.medical-records'],
  optionalDependsOn: ['integration.whatsapp', 'integration.payments'],
  permissions: [
    { key: 'orthodontics.treatments.read', label: 'Ver tratamentos e mensalidades' },
    { key: 'orthodontics.treatments.manage', label: 'Iniciar, prorrogar e encerrar tratamentos' },
  ],
  defaultRoles: [
    {
      key: 'orthodontics.dentist',
      label: 'Ortodontista',
      permissions: [agenda.read, agenda.status, records.read, records.write, 'orthodontics.treatments.read', 'orthodontics.treatments.manage', 'core.customers.read'],
    },
    {
      key: 'orthodontics.reception',
      label: 'Recepção',
      permissions: [agenda.read, agenda.write, agenda.status, agenda.payments, 'orthodontics.treatments.read', 'core.customers.read', 'core.customers.write'],
    },
  ],
  menu: [{ label: 'Tratamentos', path: '/orto/tratamentos', icon: 'smile', permission: 'orthodontics.treatments.read' }],
});
