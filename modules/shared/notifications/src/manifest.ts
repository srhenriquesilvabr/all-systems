import { defineModule } from '@all/module-sdk';

export const notificationsManifest = defineModule({
  key: 'shared.notifications',
  name: 'Notificações',
  layer: 'shared',
  description: 'Avisos automáticos aos clientes por e-mail e WhatsApp.',
  icon: 'bell',
  version: '1.0.0',
  dependsOn: ['core.customers'],
  permissions: [
    { key: 'shared.notifications.read', label: 'Ver mensagens enviadas aos clientes' },
    { key: 'shared.notifications.manage', label: 'Personalizar os textos das mensagens' },
  ],
  menu: [
    { label: 'Notificações', path: '/configuracoes/notificacoes', icon: 'mail', permission: 'shared.notifications.read', group: 'Configurações' },
  ],
  events: { publishes: ['shared.notifications.deliver'], subscribes: ['shared.notifications.deliver'] },
});
