import { defineModule } from '@all/module-sdk';

const agenda = {
  read: 'shared.scheduling.read',
  write: 'shared.scheduling.write',
  status: 'shared.scheduling.status',
};

/** Escritório de advocacia: processos, prazos com alerta, andamentos, honorários e audiências na agenda. */
export const legalManifest = defineModule({
  key: 'legal',
  name: 'Escritório de advocacia',
  layer: 'vertical',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.scheduling'],
  optionalDependsOn: ['integration.whatsapp', 'integration.payments'],
  permissions: [
    { key: 'legal.cases.read', label: 'Ver processos, andamentos e prazos' },
    { key: 'legal.cases.write', label: 'Cadastrar processos, andamentos e prazos' },
    { key: 'legal.fees.read', label: 'Ver honorários' },
    { key: 'legal.fees.manage', label: 'Lançar e cancelar honorários' },
  ],
  defaultRoles: [
    {
      key: 'legal.lawyer',
      label: 'Advogado(a)',
      permissions: ['legal.cases.read', 'legal.cases.write', 'legal.fees.read', agenda.read, agenda.write, agenda.status, 'core.customers.read', 'core.customers.write'],
    },
    {
      key: 'legal.assistant',
      label: 'Secretaria / estagiário(a)',
      permissions: ['legal.cases.read', 'legal.cases.write', agenda.read, agenda.write, agenda.status, 'core.customers.read', 'core.customers.write'],
    },
  ],
  menu: [
    { label: 'Processos', path: '/juridico/processos', icon: 'scale', permission: 'legal.cases.read' },
    { label: 'Prazos', path: '/juridico/prazos', icon: 'alarm', permission: 'legal.cases.read' },
  ],
});
