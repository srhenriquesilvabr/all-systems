import { defineModule } from '@all/module-sdk';
import { z } from 'zod';

const agenda = {
  read: 'shared.scheduling.read',
  write: 'shared.scheduling.write',
  status: 'shared.scheduling.status',
  payments: 'shared.scheduling.payments',
};
const records = { read: 'shared.medical-records.read', write: 'shared.medical-records.write' };

export const vetSettings = z.object({
  /** Quantos dias antes do reforço o tutor é lembrado (0 = não lembrar). */
  vaccineReminderDays: z.coerce.number().int().min(0).max(60).default(7),
});
export type VetSettings = z.infer<typeof vetSettings>;

/** Clínica veterinária: agenda, ficha dos pets, prontuário e carteira de vacinação com lembrete. */
export const vetManifest = defineModule({
  key: 'vet',
  name: 'Veterinária',
  layer: 'vertical',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'shared.scheduling', 'shared.pets', 'shared.medical-records'],
  optionalDependsOn: ['integration.whatsapp', 'integration.payments'],
  permissions: [
    { key: 'vet.vaccines.read', label: 'Ver carteira de vacinação' },
    { key: 'vet.vaccines.write', label: 'Registrar e anular vacinas' },
  ],
  settings: vetSettings,
  defaultRoles: [
    {
      key: 'vet.veterinarian',
      label: 'Veterinário(a)',
      permissions: [agenda.read, agenda.status, records.read, records.write, 'shared.pets.read', 'shared.pets.write', 'vet.vaccines.read', 'vet.vaccines.write', 'core.customers.read'],
    },
    {
      key: 'vet.reception',
      label: 'Recepção',
      permissions: [agenda.read, agenda.write, agenda.status, agenda.payments, 'shared.pets.read', 'shared.pets.write', 'vet.vaccines.read', 'core.customers.read', 'core.customers.write'],
    },
  ],
  menu: [{ label: 'Vacinas a vencer', path: '/vet/vacinas', icon: 'syringe', permission: 'vet.vaccines.read' }],
  notificationTemplates: [
    {
      key: 'vet.vaccine_due',
      label: 'Lembrete de vacina (reforço)',
      variables: ['pet.nome', 'vacina.nome', 'vacina.data'],
      email: {
        subject: 'Vacina de {{pet.nome}}: reforço em {{vacina.data}}',
        body: 'Olá, {{cliente.nome}}!\n\nO reforço da vacina {{vacina.nome}} de {{pet.nome}} vence em {{vacina.data}}. Responda este e-mail ou ligue para marcar.\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! O reforço da vacina {{vacina.nome}} de {{pet.nome}} vence em {{vacina.data}}. Quer marcar um horário? — {{empresa.nome}}',
        meta: { name: 'lembrete_vacina', params: ['cliente.nome', 'vacina.nome', 'pet.nome', 'vacina.data'] },
      },
    },
  ],
});
