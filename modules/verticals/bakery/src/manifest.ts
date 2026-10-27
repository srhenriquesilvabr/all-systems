import { defineModule } from '@all/module-sdk';

const vars = ['os.numero', 'os.status', 'os.total', 'os.saldo', 'os.previsao', 'os.itens'];
const sales = ['shared.sales.sell', 'shared.sales.read', 'shared.sales.register'];
const orders = ['shared.service-orders.read', 'shared.service-orders.write', 'shared.service-orders.status', 'shared.service-orders.payments'];

/** Padaria: caixa (PDV) com balança, estoque, encomendas e plano de produção. */
export const bakeryManifest = defineModule({
  key: 'bakery',
  name: 'Padaria',
  layer: 'vertical',
  description: 'Encomendas, produção do dia e caixa.',
  icon: 'croissant',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.sales', 'shared.service-orders'],
  optionalDependsOn: ['integration.whatsapp', 'integration.payments'],
  permissions: [],
  defaultRoles: [
    { key: 'bakery.counter', label: 'Balcão', permissions: [...sales, ...orders, 'core.customers.read', 'core.customers.write'] },
    { key: 'bakery.production', label: 'Produção', permissions: ['shared.service-orders.read', 'shared.service-orders.status', 'shared.sales.stock', 'shared.sales.products'] },
  ],
  menu: [
    { label: 'Encomendas', path: '/padaria/encomendas', icon: 'cake', permission: 'shared.service-orders.read', replaces: '/ordens' },
    { label: 'Produção do dia', path: '/padaria/producao', icon: 'chef', permission: 'shared.service-orders.read' },
  ],
  notificationTemplates: [
    {
      key: 'bakery.order_received',
      label: 'Encomenda registrada',
      variables: vars,
      email: {
        subject: 'Encomenda nº {{os.numero}} registrada',
        body: 'Olá, {{cliente.nome}}!\n\nAnotamos sua encomenda nº {{os.numero}}:\n{{os.itens}}\n\nTotal: {{os.total}} (em aberto: {{os.saldo}})\nRetirada: {{os.previsao}}\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Anotamos sua encomenda nº {{os.numero}} ({{os.total}}) para retirar em {{os.previsao}}. — {{empresa.nome}}',
        meta: { name: 'encomenda_registrada', params: ['cliente.nome', 'os.numero', 'os.total', 'os.previsao'] },
      },
    },
    {
      key: 'bakery.order_ready',
      label: 'Encomenda pronta',
      variables: vars,
      email: {
        subject: 'Sua encomenda nº {{os.numero}} está pronta',
        body: 'Olá, {{cliente.nome}}!\n\nSua encomenda nº {{os.numero}} está pronta para retirada.\nValor em aberto: {{os.saldo}}\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Sua encomenda nº {{os.numero}} está pronta para retirar. Em aberto: {{os.saldo}}. — {{empresa.nome}}',
        meta: { name: 'encomenda_pronta', params: ['cliente.nome', 'os.numero', 'os.saldo'] },
      },
    },
  ],
});
