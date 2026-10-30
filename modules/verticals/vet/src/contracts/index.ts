import { z } from 'zod';
import type { MedicalForm } from '@all/medical-records';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
/** Hoje no fuso do negócio (YYYY-MM-DD). */
const businessToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export const vaccinationInput = z
  .object({
    petId: z.string().uuid(),
    vaccine: z.string().trim().min(2, 'Informe a vacina').max(80),
    dose: z.string().trim().max(40).nullish(),
    batch: z.string().trim().max(40).nullish(),
    manufacturer: z.string().trim().max(60).nullish(),
    /** Pode ser passada (carteira trazida de outra clínica), nunca futura. */
    appliedOn: isoDate.refine((d) => d <= businessToday(), 'A data da aplicação não pode ser no futuro'),
    /** Próxima dose ou reforço: o tutor é lembrado antes. */
    nextDueOn: isoDate.nullish().or(z.literal('')).transform((v) => v || null),
    notes: z.string().trim().max(500).nullish(),
    /** Importação: a mesma vacina na mesma data já registrada é ignorada, em vez de recusada. */
    skipDuplicate: z.boolean().optional(),
  })
  .refine((v) => !v.nextDueOn || v.nextDueOn > v.appliedOn, { message: 'O reforço tem de ser depois da aplicação', path: ['nextDueOn'] });
export type VaccinationInput = z.infer<typeof vaccinationInput>;

export const voidInput = z.object({ reason: z.string().trim().min(3, 'Explique o motivo').max(300) });

export interface Vaccination {
  id: string;
  petId: string;
  /** Como foi digitada (o histórico não muda). */
  vaccine: string;
  /** Vacina do catálogo: é por ela que o reforço é contado e a carteira é lida. */
  vaccineId: string | null;
  vaccineName: string;
  /** Já existia: a importação não criou outra. */
  duplicate?: boolean;
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

/** O que aconteceu de fato com o lembrete, pelos avisos gerados: "skipped" é quando nenhum canal tinha como enviar. */
export type ReminderStatus = 'sent' | 'manual' | 'queued' | 'failed' | 'skipped';
export const reminderStatusLabel: Record<ReminderStatus, string> = {
  sent: 'Enviado',
  manual: 'Aguardando envio pela equipe',
  queued: 'Na fila',
  failed: 'Falhou',
  skipped: 'Não enviado',
};

export interface VaccineDue {
  id: string;
  vaccine: string;
  vaccineName: string;
  nextDueOn: string;
  pet: { id: string; name: string };
  tutor: { id: string; name: string; phone: string | null };
  /** Quando o lembrete foi gerado (não quer dizer que chegou: veja `reminder`). */
  reminderSentAt: string | null;
  reminder: { status: ReminderStatus; detail: string | null } | null;
}

/** Catálogo inicial de cada clínica: o nome é o que aparece na carteira; os apelidos contam como a mesma vacina. */
export const defaultVaccines: { name: string; aliases: string[] }[] = [
  { name: 'V10 (polivalente canina)', aliases: ['Déctupla', 'Polivalente V10'] },
  { name: 'V8 (polivalente canina)', aliases: ['Óctupla', 'Polivalente V8'] },
  { name: 'Antirrábica', aliases: ['Anti-rábica', 'Raiva', 'Contra raiva'] },
  { name: 'Gripe canina (tosse dos canis)', aliases: ['Gripe canina', 'Tosse dos canis', 'Bordetella'] },
  { name: 'Giárdia', aliases: [] },
  { name: 'Leishmaniose', aliases: [] },
  { name: 'V4 (felina)', aliases: ['Quádrupla felina'] },
  { name: 'V5 (felina)', aliases: ['Quíntupla felina'] },
  { name: 'FeLV', aliases: ['Leucemia felina'] },
];

const FILLER_WORDS = new Set(['polivalente', 'canina', 'canino', 'felina', 'felino', 'dose', 'contra']);

/**
 * Chave para comparar nomes de vacina: sem acento, maiúscula, pontuação e a palavra "vacina". Nomes
 * com o código (V10, V-10, "V10 polivalente", "V10 (polivalente canina)") valem pelo código.
 */
export function vaccineKey(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bv (\d+)\b/g, 'v$1')
    .trim();
  const words = base.split(' ').filter((w) => w && w !== 'vacina');
  const code = words.find((w) => /^v\d+$/.test(w));
  if (code && words.every((w) => w === code || FILLER_WORDS.has(w))) return code;
  return words.join(' ');
}

/** Vacina do catálogo com este nome ou apelido, se houver. */
export function matchVaccine<T extends { name: string; aliases: string[] }>(name: string, catalog: T[]): T | undefined {
  const key = vaccineKey(name);
  return key ? catalog.find((v) => vaccineKey(v.name) === key || v.aliases.some((a) => vaccineKey(a) === key)) : undefined;
}

export const vaccineCatalogInput = z.object({
  name: z.string().trim().min(2, 'Informe o nome da vacina').max(80),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  active: z.boolean().default(true),
});
export type VaccineCatalogInput = z.infer<typeof vaccineCatalogInput>;

export const mergeVaccineInput = z.object({ intoId: z.string().uuid('Escolha a vacina que fica') });

export interface VaccineCatalogEntry {
  id: string;
  name: string;
  aliases: string[];
  active: boolean;
  /** Aplicações registradas com esta vacina (anuladas também contam: o histórico é dela). */
  uses: number;
}

/** Marcar o retorno de uma consulta: o horário nasce já com o pet. */
export const returnAppointmentInput = z.object({
  resourceId: z.string().uuid('Escolha o profissional'),
  serviceIds: z.array(z.string().uuid()).min(1, 'Escolha o serviço').max(10),
  startsAt: z.coerce.date(),
  notes: z.string().trim().max(1000).nullish(),
});
export type ReturnAppointmentInput = z.infer<typeof returnAppointmentInput>;

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
      { key: 'returnOn', label: 'Retorno', type: 'date', hint: 'Depois de incluir, use Marcar retorno no registro para reservar o horário na agenda.' },
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
