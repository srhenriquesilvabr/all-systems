import { defineModule } from '@all/module-sdk';

const vars = ['os.numero', 'os.status', 'os.total', 'os.saldo', 'os.previsao', 'os.itens'];

export const serviceOrdersManifest = defineModule({
  key: 'shared.service-orders',
  name: 'Ordens de serviço',
  layer: 'shared',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications'],
  permissions: [
    { key: 'shared.service-orders.read', label: 'Ver ordens de serviço' },
    { key: 'shared.service-orders.write', label: 'Abrir e editar ordens de serviço' },
    { key: 'shared.service-orders.status', label: 'Mudar o status das ordens' },
    { key: 'shared.service-orders.payments', label: 'Registrar pagamentos de ordens' },
  ],
  menu: [{ label: 'Ordens de serviço', path: '/ordens', icon: 'clipboard', permission: 'shared.service-orders.read' }],
  notificationTemplates: [
    {
      key: 'shared.service-orders.received',
      label: 'Ordem recebida',
      email: {
        subject: 'Recebemos sua ordem nº {{os.numero}}',
        body: 'Olá, {{cliente.nome}}!\n\nRecebemos sua ordem de serviço nº {{os.numero}}:\n{{os.itens}}\n\nTotal: {{os.total}}\nPrevisão de entrega: {{os.previsao}}\n\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Olá, {{cliente.nome}}! Recebemos sua ordem nº {{os.numero}} ({{os.total}}). Previsão: {{os.previsao}}. — {{empresa.nome}}' },
      variables: vars,
    },
    {
      key: 'shared.service-orders.ready',
      label: 'Ordem pronta',
      email: {
        subject: 'Sua ordem nº {{os.numero}} está pronta',
        body: 'Olá, {{cliente.nome}}!\n\nSua ordem de serviço nº {{os.numero}} está pronta.\nValor em aberto: {{os.saldo}}\n\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Olá, {{cliente.nome}}! Sua ordem nº {{os.numero}} está pronta. Valor em aberto: {{os.saldo}}. — {{empresa.nome}}' },
      variables: vars,
    },
    {
      key: 'shared.service-orders.delivered',
      label: 'Ordem entregue',
      email: {
        subject: 'Ordem nº {{os.numero}} entregue',
        body: 'Olá, {{cliente.nome}}!\n\nSua ordem de serviço nº {{os.numero}} foi entregue. Obrigado pela preferência!\n\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Ordem nº {{os.numero}} entregue. Obrigado pela preferência, {{cliente.nome}}! — {{empresa.nome}}' },
      variables: vars,
    },
  ],
});
