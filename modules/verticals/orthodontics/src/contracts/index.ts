import type { MedicalForm } from '@all/medical-records';
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const money = z.coerce.number().min(0).max(1_000_000).multipleOf(0.01);

export const appliances = ['fixed_metal', 'fixed_aesthetic', 'self_ligating', 'aligners', 'removable', 'other'] as const;
export type Appliance = (typeof appliances)[number];
export const applianceLabel: Record<Appliance, string> = {
  fixed_metal: 'Fixo metálico',
  fixed_aesthetic: 'Fixo estético (safira/porcelana)',
  self_ligating: 'Autoligado',
  aligners: 'Alinhadores',
  removable: 'Móvel',
  other: 'Outro',
};

export const treatmentInput = z.object({
  customerId: z.string().uuid('Escolha o paciente'),
  appliance: z.enum(appliances),
  startedOn: isoDate,
  expectedMonths: z.coerce.number().int().min(1).max(60),
  /** Documentação / instalação, cobrada na data de início. */
  entryFee: money.default(0),
  monthlyFee: money,
  /** Dia do vencimento das mensalidades (até 28, para existir em todo mês). */
  dueDay: z.coerce.number().int().min(1).max(28),
  notes: z.string().trim().max(1000).nullish(),
});
export type TreatmentInput = z.infer<typeof treatmentInput>;

export const finishInput = z.object({
  /** Encerrado antes do previsto: cancela as mensalidades futuras ainda em aberto. */
  cancelFutureInstallments: z.boolean().default(true),
});
export const cancelTreatmentInput = z.object({ reason: z.string().trim().min(3, 'Explique o motivo').max(300) });
export const extendInput = z.object({ months: z.coerce.number().int().min(1).max(24) });

export type TreatmentStatus = 'active' | 'finished' | 'cancelled';
export const treatmentStatusLabel: Record<TreatmentStatus, string> = { active: 'Em tratamento', finished: 'Concluído', cancelled: 'Cancelado' };

export interface Installment {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  status: 'pending' | 'paid' | 'cancelled';
}

export interface Treatment {
  id: string;
  customer: { id: string; name: string };
  appliance: Appliance;
  startedOn: string;
  expectedMonths: number;
  entryFee: number;
  monthlyFee: number;
  dueDay: number;
  status: TreatmentStatus;
  finishedOn: string | null;
  cancelReason: string | null;
  notes: string | null;
  /** Mensalidades pagas / total lançado (sem as canceladas). */
  paidInstallments: number;
  totalInstallments: number;
  overdueAmount: number;
  createdAt: string;
}

export interface TreatmentDetail extends Treatment {
  installments: Installment[];
}

/** Serviços desta categoria ficam sem custo na agenda para quem tem tratamento ativo (já pagos na mensalidade). */
export const COVERED_CATEGORY = 'Manutenção';

export const orthoForms: MedicalForm[] = [
  {
    key: 'ortho.anamnesis',
    moduleKey: 'orthodontics',
    label: 'Anamnese',
    subjectTypes: ['customer'],
    fields: [
      { key: 'complaint', label: 'Queixa principal', type: 'textarea', required: true },
      { key: 'medicalHistory', label: 'Histórico médico', type: 'textarea' },
      { key: 'medications', label: 'Medicamentos em uso', type: 'text' },
      { key: 'allergies', label: 'Alergias', type: 'text' },
      { key: 'mouthBreathing', label: 'Respiração bucal', type: 'boolean' },
      { key: 'bruxism', label: 'Bruxismo / apertamento', type: 'boolean' },
      { key: 'habits', label: 'Hábitos (chupeta, dedo, onicofagia…)', type: 'text' },
      { key: 'previousOrtho', label: 'Já usou aparelho', type: 'boolean' },
    ],
  },
  {
    key: 'ortho.evaluation',
    moduleKey: 'orthodontics',
    label: 'Avaliação ortodôntica',
    subjectTypes: ['customer'],
    fields: [
      { key: 'angle', label: 'Classe de Angle', type: 'select', options: ['Classe I', 'Classe II divisão 1', 'Classe II divisão 2', 'Classe III'] },
      { key: 'overjet', label: 'Sobressaliência (overjet)', type: 'number', unit: 'mm' },
      { key: 'overbite', label: 'Sobremordida (overbite)', type: 'number', unit: 'mm' },
      { key: 'crossbite', label: 'Mordida cruzada', type: 'select', options: ['Ausente', 'Anterior', 'Posterior unilateral', 'Posterior bilateral'] },
      { key: 'openBite', label: 'Mordida aberta', type: 'boolean' },
      { key: 'crowding', label: 'Apinhamento', type: 'select', options: ['Ausente', 'Leve', 'Moderado', 'Severo'] },
      { key: 'midline', label: 'Linha média', type: 'text' },
      { key: 'plan', label: 'Plano de tratamento', type: 'textarea', required: true },
    ],
  },
  {
    key: 'ortho.maintenance',
    moduleKey: 'orthodontics',
    label: 'Manutenção',
    subjectTypes: ['customer'],
    fields: [
      { key: 'upperArch', label: 'Arco superior', type: 'text', hint: 'Ex.: 0.016 NiTi' },
      { key: 'lowerArch', label: 'Arco inferior', type: 'text' },
      { key: 'elastics', label: 'Elásticos', type: 'text' },
      { key: 'procedures', label: 'Procedimentos', type: 'textarea' },
      { key: 'hygiene', label: 'Higiene', type: 'select', options: ['Boa', 'Regular', 'Ruim'] },
      { key: 'brokenBrackets', label: 'Bráquetes soltos', type: 'number' },
      { key: 'next', label: 'Próxima etapa', type: 'text' },
    ],
  },
];
