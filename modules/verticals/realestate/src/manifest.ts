import { defineModule } from '@all/module-sdk';

const credit = ['integration.banking.simulate', 'integration.banking.propose'];
const agenda = ['shared.scheduling.read', 'shared.scheduling.write', 'shared.scheduling.status'];

/** Imobiliária (venda): imóveis com fotos, visitas na agenda, propostas com financiamento habitacional e comissão. */
export const realEstateManifest = defineModule({
  key: 'real_estate',
  name: 'Imobiliária',
  layer: 'vertical',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.scheduling', 'integration.banking'],
  optionalDependsOn: ['integration.whatsapp'],
  permissions: [
    { key: 'real_estate.properties.read', label: 'Ver imóveis' },
    { key: 'real_estate.properties.write', label: 'Cadastrar imóveis, preços e fotos' },
    { key: 'real_estate.deals.read', label: 'Ver propostas de compra' },
    { key: 'real_estate.deals.write', label: 'Negociar, fechar e perder propostas' },
  ],
  defaultRoles: [
    {
      key: 'real_estate.broker',
      label: 'Corretor(a)',
      permissions: ['real_estate.properties.read', 'real_estate.deals.read', 'real_estate.deals.write', ...credit, ...agenda, 'core.customers.read', 'core.customers.write'],
    },
    {
      key: 'real_estate.manager',
      label: 'Gerente / captação',
      permissions: ['real_estate.properties.read', 'real_estate.properties.write', 'real_estate.deals.read', 'real_estate.deals.write', ...credit, ...agenda, 'core.customers.read', 'core.customers.write'],
    },
  ],
  menu: [
    { label: 'Imóveis', path: '/imoveis', icon: 'building', permission: 'real_estate.properties.read' },
    { label: 'Propostas', path: '/imoveis/propostas', icon: 'handshake', permission: 'real_estate.deals.read' },
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
  ],
  events: { subscribes: ['integration.banking.proposal_updated'] },
});
