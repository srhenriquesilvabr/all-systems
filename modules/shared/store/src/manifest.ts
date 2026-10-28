import { defineModule } from '@all/module-sdk';
import { STORE, storeSettings } from './contracts';

const vars = ['pedido.numero', 'pedido.total', 'pedido.itens', 'pedido.entrega', 'pedido.motivo', 'loja.link'];

/**
 * Lojinha: a empresa vende os produtos do PDV num endereço da Palmer Tech (/loja/<slug>), com
 * carrinho e pedido finalizado pelo WhatsApp ou pago na retirada/entrega. Os pedidos seguem um
 * fluxo no admin, reservam o estoque ao confirmar e viram venda do PDV ao concluir.
 */
export const storeManifest = defineModule({
  key: STORE,
  name: 'Lojinha',
  layer: 'shared',
  description: 'Loja online com os produtos do PDV: vitrine com a marca da empresa, carrinho, pedidos pelo WhatsApp ou pagos na entrega.',
  icon: 'store',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.sales'],
  // Avisos ao cliente quando estes estiverem ativos; o pagamento online entra por provedor (src/api/payments.ts).
  optionalDependsOn: ['shared.notifications', 'integration.whatsapp', 'integration.payments'],
  permissions: [
    { key: 'store.catalog.manage', label: 'Publicar produtos na loja: textos, fotos, categorias e preço promocional' },
    { key: 'store.orders.read', label: 'Ver os pedidos da loja (dados de contato dos clientes)' },
    { key: 'store.orders.manage', label: 'Confirmar, preparar, despachar e concluir pedidos; lançar pedidos' },
    { key: 'store.orders.cancel', label: 'Cancelar pedidos da loja' },
    { key: 'store.settings.manage', label: 'Configurar a loja: abrir/pausar, entrega, pagamento e textos' },
  ],
  defaultRoles: [
    {
      key: 'store.manager',
      label: 'Gerente da loja',
      permissions: ['store.catalog.manage', 'store.orders.read', 'store.orders.manage', 'store.orders.cancel', 'store.settings.manage', 'core.customers.read'],
    },
    { key: 'store.attendant', label: 'Atendente da loja', permissions: ['store.orders.read', 'store.orders.manage', 'core.customers.read'] },
  ],
  menu: [
    { label: 'Pedidos da loja', path: '/lojinha/pedidos', icon: 'shopping-bag', permission: 'store.orders.read' },
    { label: 'Anúncios da loja', path: '/lojinha/anuncios', icon: 'store', permission: 'store.catalog.manage' },
    { label: 'Lojinha', path: '/configuracoes/lojinha', icon: 'store', permission: 'store.settings.manage', group: 'Configurações' },
  ],
  settings: storeSettings,
  events: { publishes: ['store.order.placed', 'store.order.status_changed'] },
  notificationTemplates: [
    {
      key: 'store.order.confirmed',
      label: 'Pedido da loja confirmado',
      variables: vars,
      email: {
        subject: 'Pedido nº {{pedido.numero}} confirmado',
        body: 'Olá, {{cliente.nome}}!\n\nConfirmamos o seu pedido nº {{pedido.numero}}:\n{{pedido.itens}}\n\nTotal: {{pedido.total}}\n{{pedido.entrega}}\n\nAvisaremos quando estiver pronto.\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Confirmamos o seu pedido nº {{pedido.numero}} ({{pedido.total}}). {{pedido.entrega}} Avisaremos quando estiver pronto. — {{empresa.nome}}',
        meta: { name: 'pedido_confirmado', params: ['cliente.nome', 'pedido.numero', 'pedido.total'] },
      },
    },
    {
      key: 'store.order.preparing',
      label: 'Pedido da loja em preparo',
      variables: vars,
      email: { subject: 'Pedido nº {{pedido.numero}} em preparo', body: 'Olá, {{cliente.nome}}!\n\nSeu pedido nº {{pedido.numero}} está sendo preparado.\n\n{{empresa.nome}}' },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Seu pedido nº {{pedido.numero}} está sendo preparado. — {{empresa.nome}}',
        meta: { name: 'pedido_em_preparo', params: ['cliente.nome', 'pedido.numero'] },
      },
    },
    {
      key: 'store.order.ready',
      label: 'Pedido da loja pronto para retirada',
      variables: vars,
      email: { subject: 'Pedido nº {{pedido.numero}} pronto para retirada', body: 'Olá, {{cliente.nome}}!\n\nSeu pedido nº {{pedido.numero}} está pronto. {{pedido.entrega}}\n\n{{empresa.nome}}' },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Seu pedido nº {{pedido.numero}} está pronto para retirada. {{pedido.entrega}} — {{empresa.nome}}',
        meta: { name: 'pedido_pronto', params: ['cliente.nome', 'pedido.numero'] },
      },
    },
    {
      key: 'store.order.dispatched',
      label: 'Pedido da loja saiu para entrega',
      variables: vars,
      email: { subject: 'Pedido nº {{pedido.numero}} saiu para entrega', body: 'Olá, {{cliente.nome}}!\n\nSeu pedido nº {{pedido.numero}} saiu para entrega. {{pedido.entrega}}\n\n{{empresa.nome}}' },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Seu pedido nº {{pedido.numero}} saiu para entrega. — {{empresa.nome}}',
        meta: { name: 'pedido_saiu_entrega', params: ['cliente.nome', 'pedido.numero'] },
      },
    },
    {
      key: 'store.order.completed',
      label: 'Pedido da loja concluído',
      variables: vars,
      email: { subject: 'Obrigado pelo pedido nº {{pedido.numero}}', body: 'Olá, {{cliente.nome}}!\n\nSeu pedido nº {{pedido.numero}} foi concluído. Obrigado pela preferência!\n{{loja.link}}\n\n{{empresa.nome}}' },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Pedido nº {{pedido.numero}} concluído. Obrigado pela preferência! {{loja.link}} — {{empresa.nome}}',
        meta: { name: 'pedido_concluido', params: ['cliente.nome', 'pedido.numero'] },
      },
    },
    {
      key: 'store.order.cancelled',
      label: 'Pedido da loja cancelado',
      variables: vars,
      email: { subject: 'Pedido nº {{pedido.numero}} cancelado', body: 'Olá, {{cliente.nome}}.\n\nO pedido nº {{pedido.numero}} foi cancelado. Motivo: {{pedido.motivo}}\n\nQualquer dúvida, fale com a gente.\n{{empresa.nome}}' },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}. O pedido nº {{pedido.numero}} foi cancelado. Motivo: {{pedido.motivo}}. Qualquer dúvida, fale com a gente. — {{empresa.nome}}',
        meta: { name: 'pedido_cancelado', params: ['cliente.nome', 'pedido.numero', 'pedido.motivo'] },
      },
    },
  ],
});
