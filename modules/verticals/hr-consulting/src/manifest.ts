import { defineModule } from '@all/module-sdk';

/**
 * Ramo das consultorias de RH. A consultoria processa a folha das empresas atendidas (clientes do
 * tipo empresa): no RH, cada colaborador e cada folha têm o empregador; aqui ficam a tela das
 * empresas atendidas e os honorários lançados ao fechar as folhas. Head hunter (vagas, candidatos)
 * é outro módulo.
 */
export const hrConsultingManifest = defineModule({
  key: 'hr_consulting',
  name: 'Consultoria de RH',
  layer: 'vertical',
  description: 'Departamento pessoal das empresas atendidas: colaboradores e folha por empresa, resumo para a empresa e honorários.',
  icon: 'user-search',
  version: '1.1.0',
  dependsOn: ['hr', 'core.customers', 'core.finance'],
  permissions: [{ key: 'hr_consulting.fees.manage', label: 'Configurar os honorários das empresas atendidas' }],
  defaultRoles: [
    {
      key: 'hr_consulting.manager',
      label: 'Gestor(a) de carteira (consultoria de RH)',
      permissions: ['hr.read', 'hr.manage', 'hr.payroll', 'hr_consulting.fees.manage', 'core.team.read', 'core.customers.read', 'core.customers.write'],
    },
  ],
  menu: [{ label: 'Empresas atendidas', path: '/consultoria-rh/empresas', icon: 'building', permission: 'hr.read' }],
});
