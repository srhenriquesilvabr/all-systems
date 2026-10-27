import { defineModule } from '@all/module-sdk';

const credit = ['integration.banking.simulate', 'integration.banking.propose'];

/** Revenda de veículos: estoque com fotos e FIPE, negociações com troca e financiamento pelos bancos parceiros. */
export const vehiclesManifest = defineModule({
  key: 'vehicles',
  name: 'Revenda de veículos',
  layer: 'vertical',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'integration.banking'],
  optionalDependsOn: ['integration.whatsapp'],
  permissions: [
    { key: 'vehicles.stock.read', label: 'Ver o estoque de veículos' },
    { key: 'vehicles.stock.write', label: 'Cadastrar veículos, preços e fotos' },
    { key: 'vehicles.deals.read', label: 'Ver negociações' },
    { key: 'vehicles.deals.write', label: 'Negociar, fechar e perder vendas' },
    { key: 'vehicles.costs.read', label: 'Ver custo e margem dos veículos' },
  ],
  defaultRoles: [
    { key: 'vehicles.seller', label: 'Vendedor(a)', permissions: ['vehicles.stock.read', 'vehicles.deals.read', 'vehicles.deals.write', ...credit, 'core.customers.read', 'core.customers.write'] },
    {
      key: 'vehicles.manager',
      label: 'Gerente de loja',
      permissions: ['vehicles.stock.read', 'vehicles.stock.write', 'vehicles.deals.read', 'vehicles.deals.write', 'vehicles.costs.read', ...credit, 'core.customers.read', 'core.customers.write'],
    },
  ],
  menu: [
    { label: 'Estoque', path: '/veiculos/estoque', icon: 'car', permission: 'vehicles.stock.read' },
    { label: 'Negociações', path: '/veiculos/negociacoes', icon: 'handshake', permission: 'vehicles.deals.read' },
  ],
  notificationTemplates: [
    {
      key: 'vehicles.credit_approved',
      label: 'Financiamento aprovado',
      variables: ['veiculo.nome', 'credito.instituicao'],
      email: {
        subject: 'Seu financiamento foi aprovado!',
        body: 'Olá, {{cliente.nome}}!\n\nBoa notícia: o financiamento do {{veiculo.nome}} foi aprovado por {{credito.instituicao}}. Vamos combinar a assinatura do contrato e a entrega?\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! O financiamento do {{veiculo.nome}} foi aprovado por {{credito.instituicao}}. Vamos combinar a assinatura e a entrega? — {{empresa.nome}}',
        meta: { name: 'financiamento_aprovado', params: ['cliente.nome', 'veiculo.nome', 'credito.instituicao'] },
      },
    },
  ],
  events: { subscribes: ['integration.banking.proposal_updated'] },
});
