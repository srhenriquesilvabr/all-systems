import { defineModule } from '@all/module-sdk';
import { laundrySettings } from './contracts';

const orders = {
  read: 'shared.service-orders.read',
  write: 'shared.service-orders.write',
  status: 'shared.service-orders.status',
  payments: 'shared.service-orders.payments',
};
const customers = { read: 'core.customers.read', write: 'core.customers.write' };

/**
 * Vertical Lavanderia (ver docs/arquitetura/07-vertical-lavanderia.md).
 * Por enquanto: catálogo de serviços + ordens de serviço genéricas. O fluxo por peça vem na Fase 3.
 */
export const laundryManifest = defineModule({
  key: 'laundry',
  name: 'Lavanderia',
  layer: 'vertical',
  version: '0.2.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.service-orders', 'shared.notifications'],

  permissions: [
    { key: 'laundry.orders.read', label: 'Ver ordens de serviço' },
    { key: 'laundry.orders.write', label: 'Criar e editar ordens' },
    { key: 'laundry.orders.status', label: 'Alterar status de peças e ordens' },
    { key: 'laundry.logistics.manage', label: 'Gerenciar coletas e entregas' },
    { key: 'laundry.catalog.manage', label: 'Gerenciar serviços e preços' },
    { key: 'laundry.reports.read', label: 'Ver relatórios da lavanderia' },
  ],

  defaultRoles: [
    {
      key: 'laundry.attendant',
      label: 'Atendente',
      permissions: [
        'laundry.orders.read',
        'laundry.orders.write',
        'laundry.orders.status',
        'laundry.logistics.manage',
        orders.read,
        orders.write,
        orders.status,
        orders.payments,
        customers.read,
        customers.write,
      ],
    },
    {
      key: 'laundry.operator',
      label: 'Operador',
      permissions: ['laundry.orders.read', 'laundry.orders.status', orders.read, orders.status],
    },
    {
      key: 'laundry.driver',
      label: 'Motorista',
      permissions: ['laundry.orders.read', 'laundry.logistics.manage', orders.read, orders.status, customers.read],
    },
  ],

  menu: [{ label: 'Serviços e preços', path: '/lavanderia/servicos', icon: 'tag', permission: 'laundry.catalog.manage' }],

  settings: laundrySettings,
});
