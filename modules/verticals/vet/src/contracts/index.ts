import { z } from 'zod';
import type { MedicalForm } from '@all/medical-records';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const vaccinationInput = z
  .object({
    petId: z.string().uuid(),
    vaccine: z.string().trim().min(2, 'Informe a vacina').max(80),
    dose: z.string().trim().max(40).nullish(),
    batch: z.string().trim().max(40).nullish(),
    manufacturer: z.string().trim().max(60).nullish(),
    appliedOn: isoDate,
    /** Próxima dose ou reforço: o tutor é lembrado antes. */
    nextDueOn: isoDate.nullish().or(z.literal('')).transform((v) => v || null),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((v) => !v.nextDueOn || v.nextDueOn > v.appliedOn, { message: 'O reforço tem de ser depois da aplicação', path: ['nextDueOn'] });
export type VaccinationInput = z.infer<typeof vaccinationInput>;

export const voidInput = z.object({ reason: z.string().trim().min(3, 'Explique o motivo').max(300) });

export interface Vaccination {
  id: string;
  petId: string;
  vaccine: string;
  dose: string | null;
  batch: string | null;
  manufacturer: string | null;
  appliedOn: string;
  nextDueOn: string | null;
  appliedBy: string;
  notes: string | null;
  voided: { at: string; reason: string } | null;
  createdAt: string;
}

export interface VaccineDue {
  id: string;
  vaccine: string;
  nextDueOn: string;
  pet: { id: string; name: string };
  tutor: { id: string; name: string; phone: string | null };
  reminderSentAt: string | null;
}

/** Vacinas mais comuns, para sugestão no formulário. */
export const commonVaccines = ['V10 (polivalente canina)', 'V8 (polivalente canina)', 'Antirrábica', 'Gripe canina (tosse dos canis)', 'Giárdia', 'Leishmaniose', 'V4 (felina)', 'V5 (felina)', 'FeLV'];

export const vetForms: MedicalForm[] = [
  {
    key: 'vet.consultation',
    moduleKey: 'vet',
    label: 'Consulta',
    subjectTypes: ['pet'],
    fields: [
      { key: 'complaint', label: 'Queixa principal', type: 'textarea', required: true },
      { key: 'history', label: 'Anamnese', type: 'textarea' },
      { key: 'weight', label: 'Peso', type: 'number', unit: 'kg' },
      { key: 'temperature', label: 'Temperatura', type: 'number', unit: '°C' },
      { key: 'heartRate', label: 'Frequência cardíaca', type: 'number', unit: 'bpm' },
      { key: 'respiratoryRate', label: 'Frequência respiratória', type: 'number', unit: 'mpm' },
      { key: 'hydration', label: 'Hidratação', type: 'select', options: ['Normal', 'Desidratação leve', 'Desidratação moderada', 'Desidratação grave'] },
      { key: 'mucosa', label: 'Mucosas', type: 'select', options: ['Normocoradas', 'Hipocoradas', 'Hipercoradas', 'Ictéricas', 'Cianóticas'] },
      { key: 'exam', label: 'Exame físico', type: 'textarea' },
      { key: 'diagnosis', label: 'Diagnóstico / suspeita', type: 'textarea' },
      { key: 'treatment', label: 'Conduta e prescrição', type: 'textarea' },
      { key: 'returnOn', label: 'Retorno', type: 'date' },
    ],
  },
  {
    key: 'vet.exam',
    moduleKey: 'vet',
    label: 'Exame',
    subjectTypes: ['pet'],
    fields: [
      { key: 'type', label: 'Exame', type: 'select', required: true, options: ['Hemograma', 'Bioquímico', 'Urinálise', 'Parasitológico', 'Raio-X', 'Ultrassom', 'Citologia', 'Teste rápido', 'Outro'] },
      { key: 'lab', label: 'Laboratório', type: 'text' },
      { key: 'result', label: 'Resultado / laudo', type: 'textarea', hint: 'Anexe o PDF do laudo depois de incluir.' },
    ],
  },
  {
    key: 'vet.procedure',
    moduleKey: 'vet',
    label: 'Procedimento',
    subjectTypes: ['pet'],
    fields: [
      { key: 'procedure', label: 'Procedimento', type: 'text', required: true },
      { key: 'anesthesia', label: 'Anestesia / sedação', type: 'text' },
      { key: 'description', label: 'Descrição', type: 'textarea' },
      { key: 'complications', label: 'Intercorrências', type: 'textarea' },
      { key: 'postOp', label: 'Orientações pós-procedimento', type: 'textarea' },
      { key: 'consent', label: 'Termo de consentimento assinado', type: 'boolean' },
    ],
  },
];
