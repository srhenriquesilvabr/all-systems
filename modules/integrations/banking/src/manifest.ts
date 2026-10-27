import { defineModule } from '@all/module-sdk';

/**
 * Integração com bancos, financeiras e administradoras de consórcio: simulação em várias
 * instituições, envio de proposta e acompanhamento do status (consulta e webhook).
 */
export const bankingManifest = defineModule({
  key: 'integration.banking',
  name: 'Integração bancária (crédito e consórcio)',
  layer: 'integration',
  description: 'Propostas de financiamento e consórcio com bancos parceiros.',
  icon: 'bank',
  version: '1.0.0',
  dependsOn: ['core.customers'],
  permissions: [
    { key: 'integration.banking.simulate', label: 'Simular financiamento' },
    { key: 'integration.banking.propose', label: 'Enviar e acompanhar propostas de crédito' },
  ],
  menu: [{ label: 'Bancos e financeiras', path: '/configuracoes/bancos', icon: 'bank', permission: 'core.access.settings', group: 'Configurações' }],
  events: { publishes: ['integration.banking.proposal_updated'] },
});
