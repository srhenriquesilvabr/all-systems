import { defineModule } from '@all/module-sdk';
import { realEstateSettings } from './contracts/leases';

const credit = ['integration.banking.simulate', 'integration.banking.propose'];
const agenda = ['shared.scheduling.read', 'shared.scheduling.write', 'shared.scheduling.status'];

/**
 * Imobiliária: imóveis com fotos, visitas na agenda, propostas de compra com financiamento
 * habitacional e comissão, e administração de locação (contratos, aluguéis, repasses e reajustes).
 */
export const realEstateManifest = defineModule({
  key: 'real_estate',
  name: 'Imobiliária',
  layer: 'vertical',
  description: 'Cadastro de imóveis, negociações e administração de aluguéis.',
  icon: 'building',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.scheduling', 'integration.banking', 'shared.sales'],
  optionalDependsOn: ['integration.whatsapp'],
  permissions: [
    { key: 'real_estate.properties.read', label: 'Ver imóveis' },
    { key: 'real_estate.properties.write', label: 'Cadastrar imóveis, preços e fotos' },
    { key: 'real_estate.deals.read', label: 'Ver propostas de compra' },
    { key: 'real_estate.deals.write', label: 'Negociar, fechar e perder propostas' },
    { key: 'real_estate.leases.read', label: 'Ver contratos de locação, reajustes e extratos' },
    { key: 'real_estate.leases.write', label: 'Criar, reajustar, prorrogar e encerrar contratos de locação' },
  ],
  settings: realEstateSettings,
  defaultRoles: [
    {
      key: 'real_estate.broker',
      label: 'Corretor(a)',
      permissions: ['real_estate.properties.read', 'real_estate.deals.read', 'real_estate.deals.write', 'real_estate.leases.read', ...credit, ...agenda, 'core.customers.read', 'core.customers.write'],
    },
    {
      key: 'real_estate.manager',
      label: 'Gerente / captação',
      permissions: [
        'real_estate.properties.read',
        'real_estate.properties.write',
        'real_estate.deals.read',
        'real_estate.deals.write',
        'real_estate.leases.read',
        'real_estate.leases.write',
        ...credit,
        ...agenda,
        'core.customers.read',
        'core.customers.write',
      ],
    },
  ],
  menu: [
    { label: 'Imóveis', path: '/imoveis', icon: 'building', permission: 'real_estate.properties.read' },
    { label: 'Propostas', path: '/imoveis/propostas', icon: 'handshake', permission: 'real_estate.deals.read' },
    { label: 'Locações', path: '/imoveis/locacoes', icon: 'receipt', permission: 'real_estate.leases.read' },
  ],
  notificationTemplates: [
    {
      key: 'real_estate.credit_approved',
      label: 'Financiamento imobiliário aprovado',
      variables: ['imovel.titulo', 'credito.instituicao'],
      email: {
        subject: 'Seu financiamento imobiliário foi aprovado!',
        body: 'Olá, {{cliente.nome}}!\n\nO financiamento do imóvel "{{imovel.titulo}}" foi aprovado por {{credito.instituicao}}. Vamos seguir com a documentação para a assinatura?\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! O financiamento do imóvel "{{imovel.titulo}}" foi aprovado por {{credito.instituicao}}. Vamos seguir com a documentação? — {{empresa.nome}}',
        meta: { name: 'financiamento_imovel_aprovado', params: ['cliente.nome', 'imovel.titulo', 'credito.instituicao'] },
      },
    },
    {
      key: 'real_estate.rent_due',
      label: 'Lembrete de vencimento do aluguel',
      variables: ['imovel.titulo', 'aluguel.valor', 'aluguel.vencimento', 'aluguel.competencia'],
      email: {
        subject: 'Seu aluguel vence em {{aluguel.vencimento}}',
        body: 'Olá, {{cliente.nome}}!\n\nLembrete: o aluguel de {{aluguel.competencia}} do imóvel "{{imovel.titulo}}", no valor de {{aluguel.valor}}, vence em {{aluguel.vencimento}}.\n\nSe já pagou, desconsidere esta mensagem.\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! O aluguel de {{aluguel.competencia}} do imóvel "{{imovel.titulo}}" ({{aluguel.valor}}) vence em {{aluguel.vencimento}}. Se já pagou, desconsidere. — {{empresa.nome}}',
        meta: { name: 'lembrete_aluguel', params: ['cliente.nome', 'aluguel.competencia', 'imovel.titulo', 'aluguel.valor', 'aluguel.vencimento'] },
      },
    },
    {
      key: 'real_estate.rent_adjusted',
      label: 'Aviso de reajuste do aluguel',
      variables: ['imovel.titulo', 'reajuste.indice', 'reajuste.percentual', 'reajuste.vigencia', 'aluguel.valor'],
      email: {
        subject: 'Reajuste do aluguel a partir de {{reajuste.vigencia}}',
        body: 'Olá, {{cliente.nome}}!\n\nConforme o contrato do imóvel "{{imovel.titulo}}", o aluguel foi reajustado pelo {{reajuste.indice}} ({{reajuste.percentual}}). A partir de {{reajuste.vigencia}}, o valor passa a ser {{aluguel.valor}}.\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! O aluguel do imóvel "{{imovel.titulo}}" foi reajustado pelo {{reajuste.indice}} ({{reajuste.percentual}}). A partir de {{reajuste.vigencia}}, o valor é {{aluguel.valor}}. — {{empresa.nome}}',
        meta: { name: 'reajuste_aluguel', params: ['cliente.nome', 'imovel.titulo', 'reajuste.indice', 'reajuste.percentual', 'reajuste.vigencia', 'aluguel.valor'] },
      },
    },
  ],
  events: { subscribes: ['integration.banking.proposal_updated'] },
});
