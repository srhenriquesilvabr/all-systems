import { defineModule } from '@all/module-sdk';
import { z } from 'zod';
import { taxTables } from './contracts/payroll';

export const hrSettings = z.object({
  tables: taxTables.default({}),
  /** Dia do pagamento do salário (até o 5º dia útil pela CLT; aqui, o dia do mês seguinte). */
  payDay: z.coerce.number().int().min(1).max(10).default(5),
});
export type HrSettings = z.infer<typeof hrSettings>;

/**
 * RH e departamento pessoal: colaboradores, folha com INSS/IRRF/FGTS, 13º, rescisão, afastamentos,
 * holerite e férias. Módulo contratável por empresa de qualquer ramo (camada shared); é a base do
 * ramo "Consultoria de RH" (hr_consulting). O colaborador é uma pessoa da equipe (core.team).
 */
export const hrManifest = defineModule({
  key: 'hr',
  name: 'RH e departamento pessoal',
  layer: 'shared',
  description: 'Colaboradores, folha de pagamento, 13º, rescisão, afastamentos e férias.',
  icon: 'id-card',
  version: '1.1.0',
  dependsOn: ['core.finance', 'core.team', 'shared.sales'],
  permissions: [
    { key: 'hr.read', label: 'Ver colaboradores, salários e folha (dado sensível)' },
    { key: 'hr.manage', label: 'Cadastrar colaboradores e férias' },
    { key: 'hr.payroll', label: 'Calcular e fechar a folha' },
  ],
  settings: hrSettings,
  // O analista escolhe, na admissão, uma pessoa já cadastrada na equipe (ex.: profissional da agenda).
  defaultRoles: [{ key: 'hr.analyst', label: 'Analista de DP', permissions: ['hr.read', 'hr.manage', 'hr.payroll', 'core.team.read'] }],
  menu: [
    { label: 'Colaboradores', path: '/rh/colaboradores', icon: 'id-card', permission: 'hr.read' },
    { label: 'Folha de pagamento', path: '/rh/folha', icon: 'banknote', permission: 'hr.read' },
  ],
});
