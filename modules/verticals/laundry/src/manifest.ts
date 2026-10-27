import { defineModule } from '@all/module-sdk';
import { laundrySettings } from './contracts';

const orders = {
  read: 'shared.service-orders.read',
  write: 'shared.service-orders.write',
  status: 'shared.service-orders.status',
  payments: 'shared.service-orders.payments',
};
const customers = { read: 'core.customers.read', write: 'core.customers.write' };

const vars = ['os.numero', 'os.status', 'os.total', 'os.saldo', 'os.previsao', 'os.itens'];
const logisticsVars = ['os.numero', 'logistica.data', 'logistica.janela', 'logistica.endereco', 'logistica.taxa'];

/** Vertical Lavanderia (ver docs/arquitetura/07-vertical-lavanderia.md): balcão, peças etiquetadas e produção. */
export const laundryManifest = defineModule({
  key: 'laundry',
  name: 'Lavanderia',
  layer: 'vertical',
  description: 'Peça a peça, do recebimento à entrega, com etiquetas e prazos.',
  icon: 'shirt',
  version: '0.4.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.service-orders', 'shared.notifications', 'shared.sales'],
  optionalDependsOn: ['integration.payments'],

  permissions: [
    { key: 'laundry.orders.read', label: 'Ver ordens de serviço' },
    { key: 'laundry.orders.write', label: 'Criar e editar ordens' },
    { key: 'laundry.orders.status', label: 'Alterar status de peças e ordens' },
    { key: 'laundry.logistics.manage', label: 'Gerenciar coletas e entregas (agendar, atribuir motorista, reagendar)' },
    { key: 'laundry.logistics.drive', label: 'Fazer coletas e entregas (só as atribuídas a si)' },
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
        'laundry.logistics.drive',
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
      // Só as próprias rotas: os dados do cliente e da ordem de que precisa vêm junto com cada tarefa.
      permissions: ['laundry.logistics.drive'],
    },
  ],

  menu: [
    { label: 'Balcão', path: '/lavanderia/ordens/nova', icon: 'plus', permission: 'laundry.orders.write' },
    { label: 'Produção', path: '/lavanderia/producao', icon: 'kanban', permission: 'laundry.orders.status' },
    { label: 'Coletas e entregas', path: '/lavanderia/logistica', icon: 'car', permission: 'laundry.logistics.manage' },
    { label: 'Minhas rotas', path: '/lavanderia/minhas-rotas', icon: 'list', permission: 'laundry.logistics.drive' },
    { label: 'Relatórios da lavanderia', path: '/lavanderia/relatorios', icon: 'chart', permission: 'laundry.reports.read' },
    { label: 'Serviços e preços', path: '/lavanderia/servicos', icon: 'tag', permission: 'laundry.catalog.manage' },
  ],

  settings: laundrySettings,

  notificationTemplates: [
    {
      key: 'laundry.order.received',
      label: 'Peças recebidas',
      email: {
        subject: 'Recebemos suas peças — ordem nº {{os.numero}}',
        body: 'Olá, {{cliente.nome}}!\n\nRecebemos as peças da ordem nº {{os.numero}}:\n{{os.itens}}\n\nTotal: {{os.total}}\nPrevisão: {{os.previsao}}\n\nGuarde o comprovante para a retirada.\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Olá, {{cliente.nome}}! Recebemos suas peças (ordem nº {{os.numero}}). Total {{os.total}}, previsão {{os.previsao}}. — {{empresa.nome}}' },
      variables: vars,
    },
    {
      key: 'laundry.order.ready',
      label: 'Peças prontas',
      email: {
        subject: 'Suas peças estão prontas — ordem nº {{os.numero}}',
        body: 'Olá, {{cliente.nome}}!\n\nAs peças da ordem nº {{os.numero}} estão prontas para retirada.\nValor em aberto: {{os.saldo}}\n\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Olá, {{cliente.nome}}! As peças da ordem nº {{os.numero}} estão prontas para retirada. Em aberto: {{os.saldo}}. — {{empresa.nome}}' },
      variables: vars,
    },
    {
      key: 'laundry.order.out_for_delivery',
      label: 'Saiu para entrega',
      email: {
        subject: 'Ordem nº {{os.numero}} saiu para entrega',
        body: 'Olá, {{cliente.nome}}!\n\nSuas peças (ordem nº {{os.numero}}) saíram para entrega.\nValor em aberto: {{os.saldo}}\n\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Olá, {{cliente.nome}}! Suas peças (ordem nº {{os.numero}}) saíram para entrega. — {{empresa.nome}}' },
      variables: vars,
    },
    {
      key: 'laundry.order.delivered',
      label: 'Peças entregues',
      email: {
        subject: 'Ordem nº {{os.numero}} entregue',
        body: 'Olá, {{cliente.nome}}!\n\nA ordem nº {{os.numero}} foi entregue. Obrigado pela preferência!\n\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Ordem nº {{os.numero}} entregue. Obrigado, {{cliente.nome}}! — {{empresa.nome}}' },
      variables: vars,
    },
    // Coleta e entrega. "A caminho" e "entregue" da entrega são os avisos da ordem acima
    // (Saiu para entrega / Peças entregues), disparados quando o motorista sai e conclui.
    {
      key: 'laundry.delivery.scheduled',
      label: 'Entrega agendada',
      email: {
        subject: 'Entrega agendada — ordem nº {{os.numero}}',
        body: 'Olá, {{cliente.nome}}!\n\nAgendamos a entrega das peças da ordem nº {{os.numero}}:\n\nDia: {{logistica.data}}\nHorário: {{logistica.janela}}\nEndereço: {{logistica.endereco}}\nTaxa de entrega: {{logistica.taxa}}\n\nSe precisar mudar, é só responder esta mensagem.\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Entrega da ordem nº {{os.numero}} agendada para {{logistica.data}}, {{logistica.janela}}, em {{logistica.endereco}}. Taxa: {{logistica.taxa}}. — {{empresa.nome}}',
      },
      variables: logisticsVars,
    },
    {
      key: 'laundry.pickup.scheduled',
      label: 'Coleta agendada',
      email: {
        subject: 'Coleta agendada para {{logistica.data}}',
        body: 'Olá, {{cliente.nome}}!\n\nAgendamos a coleta das suas peças:\n\nDia: {{logistica.data}}\nHorário: {{logistica.janela}}\nEndereço: {{logistica.endereco}}\nTaxa de coleta: {{logistica.taxa}}\n\nDeixe as peças separadas. Se precisar mudar, é só responder esta mensagem.\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Coleta agendada para {{logistica.data}}, {{logistica.janela}}, em {{logistica.endereco}}. Taxa: {{logistica.taxa}}. — {{empresa.nome}}',
      },
      variables: logisticsVars,
    },
    {
      key: 'laundry.pickup.on_the_way',
      label: 'Motorista a caminho da coleta',
      email: {
        subject: 'Estamos a caminho para buscar suas peças',
        body: 'Olá, {{cliente.nome}}!\n\nO motorista saiu para a coleta das suas peças em {{logistica.endereco}} ({{logistica.janela}}).\n\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Olá, {{cliente.nome}}! O motorista está a caminho para buscar suas peças ({{logistica.janela}}). — {{empresa.nome}}' },
      variables: logisticsVars,
    },
    {
      key: 'laundry.item.incident',
      label: 'Ocorrência com uma peça',
      email: {
        subject: 'Precisamos falar sobre uma peça da ordem nº {{os.numero}}',
        body: 'Olá, {{cliente.nome}}.\n\nDurante o processo da ordem nº {{os.numero}}, identificamos o seguinte na peça {{peca.descricao}} (etiqueta {{peca.etiqueta}}):\n\n{{ocorrencia}}\n\nEntre em contato conosco para combinarmos como seguir.\n{{empresa.nome}}',
      },
      whatsapp: { body: 'Olá, {{cliente.nome}}. Sobre a peça {{peca.descricao}} (etiqueta {{peca.etiqueta}}) da ordem nº {{os.numero}}: {{ocorrencia}}. Pode falar com a gente? — {{empresa.nome}}' },
      variables: ['os.numero', 'peca.descricao', 'peca.etiqueta', 'ocorrencia'],
    },
  ],
});
