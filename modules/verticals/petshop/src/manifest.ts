import { defineModule } from '@all/module-sdk';
import { z } from 'zod';

const agenda = {
  read: 'shared.scheduling.read',
  write: 'shared.scheduling.write',
  status: 'shared.scheduling.status',
  payments: 'shared.scheduling.payments',
};

export const petshopSettings = z.object({
  /** Avisa o tutor (WhatsApp/e-mail) quando o banho ou a tosa termina. */
  notifyReady: z.boolean().default(true),
});
export type PetshopSettings = z.infer<typeof petshopSettings>;

/** Pet shop: banho e tosa pela agenda, ficha dos pets, aviso de "pet pronto" e loja (PDV e estoque). */
export const petshopManifest = defineModule({
  key: 'petshop',
  name: 'Pet shop',
  layer: 'vertical',
  description: 'Banho e tosa com quadro do dia e venda de produtos.',
  icon: 'paw',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.scheduling', 'shared.pets', 'shared.sales'],
  optionalDependsOn: ['integration.whatsapp', 'integration.payments'],
  permissions: [],
  settings: petshopSettings,
  defaultRoles: [
    {
      key: 'petshop.reception',
      label: 'Recepção',
      permissions: [agenda.read, agenda.write, agenda.status, agenda.payments, 'core.customers.read', 'core.customers.write', 'shared.pets.read', 'shared.pets.write', 'shared.sales.sell', 'shared.sales.register'],
    },
    {
      key: 'petshop.manager',
      label: 'Gerente',
      permissions: [agenda.read, agenda.write, agenda.status, agenda.payments, 'shared.scheduling.manage', 'core.customers.read', 'core.customers.write', 'shared.pets.read', 'shared.pets.write', 'shared.sales.sell', 'shared.sales.register', 'shared.sales.read', 'shared.sales.products', 'shared.sales.stock', 'shared.sales.register.history'],
    },
    {
      key: 'petshop.groomer',
      label: 'Banho e tosa',
      permissions: [agenda.read, agenda.status, 'core.customers.read', 'shared.pets.read'],
    },
  ],
  menu: [{ label: 'Banho e tosa', path: '/petshop/hoje', icon: 'kanban', permission: agenda.read }],
  notificationTemplates: [
    {
      key: 'petshop.ready',
      label: 'Pet pronto para buscar',
      variables: ['pet.nome', 'agendamento.servicos'],
      email: {
        subject: '{{pet.nome}} está pronto(a)!',
        body: 'Olá, {{cliente.nome}}!\n\n{{pet.nome}} já terminou ({{agendamento.servicos}}) e está esperando por você.\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! {{pet.nome}} já está pronto(a) ({{agendamento.servicos}}) e esperando por você. 🐾 — {{empresa.nome}}',
        meta: { name: 'pet_pronto', params: ['cliente.nome', 'pet.nome', 'agendamento.servicos'] },
      },
    },
  ],
  events: { subscribes: ['shared.scheduling.status_changed'] },
});
