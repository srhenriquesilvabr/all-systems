import type { MedicalForm } from '@all/medical-records';
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

/** Hoje no fuso da clínica (YYYY-MM-DD). */
export const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const pastDate = (message: string) => isoDate.refine((d) => d <= localToday(), message);

export const packageInput = z.object({
  customerId: z.string().uuid('Escolha o cliente'),
  serviceId: z.string().uuid('Escolha o procedimento'),
  totalSessions: z.coerce.number().int().min(2, 'Pacote tem pelo menos 2 sessões').max(100),
  /** Valor total do pacote, em reais. */
  price: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01),
  /** Parcelas mensais lançadas como "a receber" no financeiro (vencimento da 1ª em `firstDueOn`). */
  installments: z.coerce.number().int().min(1).max(24).default(1),
  /** Dia da venda (padrão hoje); pode ser no passado para registrar histórico. */
  soldOn: pastDate('A data da venda não pode ser no futuro').optional(),
  /** Padrão: o dia da venda. */
  firstDueOn: isoDate.optional(),
  expiresOn: isoDate.nullish().or(z.literal('')).transform((v) => v || null),
  notes: z.string().trim().max(500).nullish(),
  /** Tratamento de origem, quando vendido a partir dele (ex.: drenagem do pós-operatório). */
  caseId: z.string().uuid().nullish(),
});
export type PackageInput = z.infer<typeof packageInput>;

export const cancelPackageInput = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo').max(300),
  cancelledOn: pastDate('A data do cancelamento não pode ser no futuro').optional(),
});

export type PackageStatus = 'active' | 'finished' | 'cancelled';
export const packageStatusLabel: Record<PackageStatus, string> = { active: 'Ativo', finished: 'Concluído', cancelled: 'Cancelado' };

export interface SessionPackage {
  id: string;
  customer: { id: string; name: string };
  service: { id: string; name: string };
  totalSessions: number;
  usedSessions: number;
  /** Sessões já marcadas na agenda, ainda não realizadas. */
  reservedSessions: number;
  price: number;
  soldOn: string;
  expiresOn: string | null;
  status: PackageStatus;
  notes: string | null;
  cancelReason: string | null;
  cancelledOn: string | null;
  /** Tratamento de origem, se foi vendido a partir de um. */
  case: { id: string; title: string } | null;
  createdAt: string;
}

export const aestheticsForms: MedicalForm[] = [
  {
    key: 'aesthetics.anamnesis',
    moduleKey: 'aesthetics',
    label: 'Anamnese',
    subjectTypes: ['customer'],
    fields: [
      { key: 'complaint', label: 'Queixa principal', type: 'textarea', required: true },
      { key: 'previous', label: 'Tratamentos estéticos anteriores', type: 'textarea' },
      { key: 'allergies', label: 'Alergias', type: 'text' },
      { key: 'medications', label: 'Medicamentos em uso', type: 'text' },
      { key: 'skinConditions', label: 'Doenças ou alterações de pele', type: 'text' },
      { key: 'phototype', label: 'Fototipo (Fitzpatrick)', type: 'select', options: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
      { key: 'pregnant', label: 'Gestante ou amamentando', type: 'boolean' },
      { key: 'acids', label: 'Usa ácidos ou retinoides', type: 'boolean' },
      { key: 'sun', label: 'Exposição solar frequente', type: 'boolean' },
      { key: 'smoker', label: 'Fumante', type: 'boolean' },
      { key: 'expectations', label: 'Expectativas', type: 'textarea' },
    ],
  },
  {
    key: 'aesthetics.session',
    moduleKey: 'aesthetics',
    label: 'Evolução',
    subjectTypes: ['customer'],
    fields: [
      { key: 'procedure', label: 'Procedimento', type: 'text', required: true },
      { key: 'area', label: 'Área tratada', type: 'text' },
      { key: 'parameters', label: 'Parâmetros e produtos', type: 'textarea', hint: 'Equipamento, energia, concentração, lote…' },
      { key: 'reaction', label: 'Reação imediata', type: 'text' },
      { key: 'guidance', label: 'Orientações passadas', type: 'textarea' },
    ],
  },
];

export * from './specialties';
