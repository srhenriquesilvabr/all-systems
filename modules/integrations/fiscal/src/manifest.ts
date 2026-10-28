import { defineModule } from '@all/module-sdk';
import { APPOINTMENT_PAYMENT, APPOINTMENT_STATUS, DOCUMENT_UPDATED, fiscalSecretSettings, fiscalSettings, ORDER_STATUS, SALE_CANCELLED, SALE_COMPLETED } from './contracts';

/**
 * Nota fiscal (NFS-e, NFC-e e NF-e) por um provedor de emissão com API única (Focus NFe,
 * PlugNotas, NFE.io…), ou em modo simulado. Ver docs/arquitetura/11-integracao-fiscal.md.
 */
export const fiscalManifest = defineModule({
  key: 'integration.fiscal',
  name: 'Nota fiscal',
  layer: 'integration',
  description: 'Emissão de NFS-e, NFC-e e NF-e por provedor, com XML e DANFE guardados e relatórios para o contador.',
  icon: 'receipt',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.company'],
  permissions: [
    { key: 'integration.fiscal.read', label: 'Ver notas fiscais' },
    { key: 'integration.fiscal.issue', label: 'Emitir, corrigir, reenviar e enviar notas ao cliente' },
    { key: 'integration.fiscal.cancel', label: 'Cancelar notas, carta de correção e inutilizar numeração' },
    { key: 'integration.fiscal.codes', label: 'Cadastro fiscal de produtos e serviços' },
    { key: 'integration.fiscal.export', label: 'Baixar XML/DANFE e exportar para o contador' },
    { key: 'integration.fiscal.configure', label: 'Dados fiscais, certificado digital e provedor' },
  ],
  defaultRoles: [
    {
      key: 'integration.fiscal.biller',
      label: 'Faturista',
      permissions: ['integration.fiscal.read', 'integration.fiscal.issue', 'integration.fiscal.codes', 'integration.fiscal.export', 'core.customers.read'],
    },
    { key: 'integration.fiscal.accountant', label: 'Contador (notas fiscais)', permissions: ['integration.fiscal.read', 'integration.fiscal.export'] },
  ],
  menu: [
    { label: 'Notas fiscais', path: '/fiscal', icon: 'receipt', permission: 'integration.fiscal.read' },
    { label: 'Cadastro fiscal', path: '/fiscal/cadastro', icon: 'tag', permission: 'integration.fiscal.codes', group: 'Notas fiscais' },
    { label: 'Relatórios fiscais', path: '/fiscal/relatorios', icon: 'chart', permission: 'integration.fiscal.export', group: 'Notas fiscais' },
    { label: 'Nota fiscal', path: '/configuracoes/fiscal', icon: 'receipt', permission: 'integration.fiscal.configure', group: 'Configurações' },
  ],
  settings: fiscalSettings,
  secretSettings: fiscalSecretSettings,
  events: {
    publishes: [DOCUMENT_UPDATED],
    subscribes: [SALE_COMPLETED, SALE_CANCELLED, APPOINTMENT_PAYMENT, APPOINTMENT_STATUS, ORDER_STATUS],
  },
});
