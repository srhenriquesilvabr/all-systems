import { defineModule } from '@all/module-sdk';

/** Escritório de contabilidade: carteira de empresas, calendário de obrigações com alertas e honorários mensais. */
export const accountingManifest = defineModule({
  key: 'accounting',
  name: 'Escritório de contabilidade',
  layer: 'vertical',
  description: 'Carteira de empresas, obrigações e honorários.',
  icon: 'calculator',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.sales'],
  optionalDependsOn: ['integration.whatsapp'],
  permissions: [
    { key: 'accounting.read', label: 'Ver carteira e obrigações' },
    { key: 'accounting.work', label: 'Dar baixa nas obrigações' },
    { key: 'accounting.manage', label: 'Cadastrar empresas, honorários e o catálogo de obrigações' },
  ],
  defaultRoles: [
    { key: 'accounting.analyst', label: 'Analista contábil / fiscal', permissions: ['accounting.read', 'accounting.work', 'core.customers.read'] },
    { key: 'accounting.partner', label: 'Sócio(a) / gestor(a)', permissions: ['accounting.read', 'accounting.work', 'accounting.manage', 'core.customers.read', 'core.customers.write'] },
  ],
  menu: [
    { label: 'Obrigações', path: '/contabil/obrigacoes', icon: 'calendar-check', permission: 'accounting.read' },
    { label: 'Carteira de empresas', path: '/contabil/empresas', icon: 'briefcase', permission: 'accounting.read' },
  ],
});
