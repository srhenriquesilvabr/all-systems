import { defineModule } from '@all/module-sdk';
import { z } from 'zod';
import { specialtyKeys } from './contracts/specialties';

const agenda = {
  read: 'shared.scheduling.read',
  write: 'shared.scheduling.write',
  status: 'shared.scheduling.status',
  payments: 'shared.scheduling.payments',
};
const records = { read: 'shared.medical-records.read', write: 'shared.medical-records.write' };

export const aestheticsSettings = z.object({
  /** Falta sem aviso consome a sessão do pacote. */
  noShowConsumesSession: z.boolean().default(false),
  /** Especialidades ligadas (harmonização, clareamento…). Nenhuma = só a estética básica. */
  specialties: z.array(z.enum(specialtyKeys)).max(specialtyKeys.length).default([]),
  /** Dias até o retorno da toxina / retoque dos injetáveis. */
  harmonizationReturnDays: z.number().int().min(1).max(180).default(15),
  /** Dias até o retoque da micropigmentação. */
  micropigmentationRetouchDays: z.number().int().min(1).max(180).default(30),
});
export type AestheticsSettings = z.infer<typeof aestheticsSettings>;

/** Clínica de estética: agenda, anamnese e evolução no prontuário, pacotes de sessões e especialidades. */
export const aestheticsManifest = defineModule({
  key: 'aesthetics',
  name: 'Clínica de estética',
  layer: 'vertical',
  description: 'Procedimentos, pacotes de sessões, especialidades e prontuário.',
  icon: 'sparkles',
  // 1.1.0: especialidades (o onEnable roda de novo e cria os dados das que estiverem ligadas).
  version: '1.1.0',
  dependsOn: ['core.customers', 'core.finance', 'core.team', 'shared.notifications', 'shared.scheduling', 'shared.medical-records', 'shared.sales'],
  optionalDependsOn: ['integration.whatsapp', 'integration.payments'],
  permissions: [
    { key: 'aesthetics.packages.read', label: 'Ver pacotes de sessões' },
    { key: 'aesthetics.packages.sell', label: 'Vender e cancelar pacotes' },
    { key: 'aesthetics.setup.manage', label: 'Cadastrar produtos e lotes, termos de consentimento e registros dos profissionais' },
    { key: 'aesthetics.surgery.budget', label: 'Montar e aprovar orçamentos de cirurgia (lança no financeiro)' },
  ],
  settings: aestheticsSettings,
  defaultRoles: [
    {
      key: 'aesthetics.professional',
      label: 'Esteticista',
      permissions: [agenda.read, agenda.status, records.read, records.write, 'aesthetics.packages.read', 'core.customers.read'],
    },
    {
      // Quem aplica injetáveis, clareia, opera: marca retornos e retoques na agenda.
      key: 'aesthetics.doctor',
      label: 'Médico(a) / dentista',
      permissions: [agenda.read, agenda.write, agenda.status, records.read, records.write, 'aesthetics.packages.read', 'core.customers.read'],
    },
    {
      key: 'aesthetics.reception',
      label: 'Recepção',
      permissions: [
        agenda.read,
        agenda.write,
        agenda.status,
        agenda.payments,
        'aesthetics.packages.read',
        'aesthetics.packages.sell',
        'aesthetics.surgery.budget',
        'core.customers.read',
        'core.customers.write',
      ],
    },
    {
      // Compras e cadastros (lotes, termos, conselhos); sem acesso ao prontuário.
      key: 'aesthetics.manager',
      label: 'Gestão da clínica',
      permissions: [agenda.read, 'aesthetics.setup.manage', 'aesthetics.surgery.budget', 'aesthetics.packages.read', 'aesthetics.packages.sell', 'shared.sales.stock', 'core.customers.read'],
    },
  ],
  menu: [
    { label: 'Pacotes', path: '/estetica/pacotes', icon: 'package', permission: 'aesthetics.packages.read' },
    { label: 'Especialidades', path: '/estetica/especialidades', icon: 'syringe', permission: records.read },
    { label: 'Orçamentos de cirurgia', path: '/estetica/orcamentos', icon: 'banknote', permission: 'aesthetics.surgery.budget' },
    { label: 'Especialidades da clínica', path: '/estetica/cadastros', icon: 'tag', permission: 'aesthetics.setup.manage', group: 'Configurações' },
  ],
  events: { subscribes: ['shared.scheduling.status_changed'] },
});
