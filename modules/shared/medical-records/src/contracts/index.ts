import { z } from 'zod';

// Contratos compartilhados entre a API e as telas (src/web).

/** Campo de um formulário de prontuário. Cada vertical define os seus (consulta veterinária, anamnese…). */
export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'date';
  options?: string[];
  required?: boolean;
  /** Ex.: "kg", "°C", "bpm". */
  unit?: string;
  hint?: string;
}

export interface MedicalForm {
  key: string;
  /** Módulo que traz o formulário: só aparece com ele ativo. */
  moduleKey: string;
  label: string;
  /** De quem é o registro: o próprio cliente (paciente) ou um pet. */
  subjectTypes: string[];
  fields: FormField[];
}

/** Hoje no fuso do negócio (YYYY-MM-DD). */
export const businessToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Data do atendimento: pode ser passada (histórico), nunca futura. */
const careDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((d) => d <= businessToday(), 'A data do atendimento não pode ser no futuro');

export const entryInput = z.object({
  subjectType: z.string().min(1).max(40),
  subjectId: z.string().uuid(),
  formKey: z.string().min(1).max(80),
  data: z.record(z.unknown()).default({}),
  notes: z.string().trim().max(20_000).nullish(),
  appointmentId: z.string().uuid().nullish(),
  /** Padrão: hoje. */
  occurredOn: careDate.optional(),
});
export type EntryInput = z.infer<typeof entryInput>;

export const amendInput = z.object({
  data: z.record(z.unknown()).default({}),
  notes: z.string().trim().max(20_000).nullish(),
  reason: z.string().trim().min(3, 'Explique o motivo da retificação').max(500),
  /** Padrão: a mesma data do registro retificado. */
  occurredOn: careDate.optional(),
});
export type AmendInput = z.infer<typeof amendInput>;

export interface EntryAttachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface MedicalEntry {
  id: string;
  subjectType: string;
  subjectId: string;
  formKey: string;
  title: string;
  data: Record<string, unknown>;
  notes: string | null;
  appointmentId: string | null;
  /** Registro que este corrige (retificação). O original nunca é alterado. */
  amendsId: string | null;
  amendReason: string | null;
  /** Retificação mais recente deste registro, se houver. */
  amendedById: string | null;
  author: { id: string; name: string };
  attachments: EntryAttachment[];
  /** Data do atendimento (YYYY-MM-DD): a timeline segue esta data. */
  occurredOn: string;
  /** Quando foi registrado no sistema (auditoria). */
  createdAt: string;
}

export interface AccessLogEntry {
  id: string;
  user: { id: string; name: string } | null;
  action: 'view' | 'create' | 'amend' | 'attach' | 'download';
  entryId: string | null;
  at: string;
}

/** Valor exibível de um campo (sim/não, número com unidade, data). */
export function fieldText(field: FormField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'boolean') return value ? 'Sim' : 'Não';
  if (field.type === 'date' && typeof value === 'string') {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  if (field.type === 'number') return `${String(value).replace('.', ',')}${field.unit ? ` ${field.unit}` : ''}`;
  return String(value);
}
