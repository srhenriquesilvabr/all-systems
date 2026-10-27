import { defineModule } from '@all/module-sdk';
import { z } from 'zod';

const agenda = {
  read: 'shared.scheduling.read',
  write: 'shared.scheduling.write',
  status: 'shared.scheduling.status',
  payments: 'shared.scheduling.payments',
};
const records = { read: 'shared.medical-records.read', write: 'shared.medical-records.write' };

export const aestheticsSettings = z.object({
  /** Falta sem aviso consome a sessão do pacote. */
  noShowConsumesSession: z.boolean().default(false),
});
export type AestheticsSettings = z.infer<typeof aestheticsSettings>;

/** Clínica de estética: agenda, anamnese e evolução no prontuário, pacotes de sessões. */
export const aestheticsManifest = defineModule({
  key: 'aesthetics',
  name: 'Clínica de estética',
  layer: 'vertical',
  description: 'Procedimentos, pacotes de sessões e prontuário.',
  icon: 'sparkles',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.scheduling', 'shared.medical-records'],
  optionalDependsOn: ['integration.whatsapp', 'integration.payments'],
  permissions: [
    { key: 'aesthetics.packages.read', label: 'Ver pacotes de sessões' },
    { key: 'aesthetics.packages.sell', label: 'Vender e cancelar pacotes' },
  ],
  settings: aestheticsSettings,
  defaultRoles: [
    {
      key: 'aesthetics.professional',
      label: 'Esteticista',
      permissions: [agenda.read, agenda.status, records.read, records.write, 'aesthetics.packages.read', 'core.customers.read'],
    },
    {
      key: 'aesthetics.reception',
      label: 'Recepção',
      permissions: [agenda.read, agenda.write, agenda.status, agenda.payments, 'aesthetics.packages.read', 'aesthetics.packages.sell', 'core.customers.read', 'core.customers.write'],
    },
  ],
  menu: [{ label: 'Pacotes', path: '/estetica/pacotes', icon: 'package', permission: 'aesthetics.packages.read' }],
  events: { subscribes: ['shared.scheduling.status_changed'] },
});
