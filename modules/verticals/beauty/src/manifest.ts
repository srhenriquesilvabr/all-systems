import { defineModule } from '@all/module-sdk';

const agenda = {
  read: 'shared.scheduling.read',
  write: 'shared.scheduling.write',
  status: 'shared.scheduling.status',
  payments: 'shared.scheduling.payments',
};

/** Salão de beleza e cabeleireiro: agenda por profissional, WhatsApp, agendamento online e comissões. */
export const beautyManifest = defineModule({
  key: 'beauty',
  name: 'Salão de beleza',
  layer: 'vertical',
  description: 'Agenda do salão, serviços e comissões dos profissionais.',
  icon: 'scissors',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.scheduling', 'shared.sales'],
  optionalDependsOn: ['integration.whatsapp', 'integration.payments'],
  permissions: [
    { key: 'beauty.commissions.read', label: 'Ver comissões de todos os profissionais' },
    { key: 'beauty.commissions.manage', label: 'Definir percentuais de comissão' },
  ],
  defaultRoles: [
    {
      key: 'beauty.reception',
      label: 'Recepção',
      permissions: [agenda.read, agenda.write, agenda.status, agenda.payments, 'core.customers.read', 'core.customers.write'],
    },
    {
      key: 'beauty.professional',
      label: 'Profissional',
      permissions: [agenda.read, agenda.status, 'core.customers.read'],
    },
  ],
  menu: [{ label: 'Comissões', path: '/salao/comissoes', icon: 'percent', permission: 'beauty.commissions.read' }],
});
