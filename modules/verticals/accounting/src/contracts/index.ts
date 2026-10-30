import { z } from 'zod';

export const taxRegimes = ['mei', 'simples', 'presumido', 'real'] as const;
export type TaxRegime = (typeof taxRegimes)[number];
export const taxRegimeLabel: Record<TaxRegime, string> = { mei: 'MEI', simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' };

export const clientInput = z.object({
  customerId: z.string().uuid('Escolha a empresa'),
  taxRegime: z.enum(taxRegimes),
  cnae: z.string().trim().max(20).nullish(),
  hasEmployees: z.boolean().default(false),
  /** Honorário mensal (R$), lançado como "a receber" todo mês. 0 = sem cobrança recorrente. */
  monthlyFee: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01).default(0),
  feeDueDay: z.coerce.number().int().min(1).max(28).default(10),
  responsibleUserId: z.string().uuid().nullish(),
  active: z.boolean().default(true),
  notes: z.string().trim().max(2000).nullish(),
  /**
   * Na mudança de regime ou de funcionários: as obrigações em aberto que deixam de valer e devem ser
   * dispensadas. Sem a lista, vale a regra padrão: as que ainda não venceram são dispensadas e as
   * vencidas ficam, com uma observação, porque eram devidas no regime antigo.
   */
  waiveObligationIds: z.array(z.string().uuid()).max(500).optional(),
});
export type ClientInput = z.infer<typeof clientInput>;

/** Obrigação em aberto que deixa de valer com o novo regime ou sem funcionários. */
export interface RegimeImpactItem {
  id: string;
  name: string;
  competence: string;
  dueOn: string;
  /** Já venceu: era devida no regime antigo, então a sugestão é manter. */
  overdue: boolean;
}

export interface SaveClientResult {
  id: string;
  /** Só quando o regime ou os funcionários mudaram e havia obrigação em aberto que deixou de valer. */
  regimeChange?: { waived: number; kept: number };
}

export interface AccountingClient extends Omit<ClientInput, 'customerId' | 'responsibleUserId'> {
  id: string;
  customer: { id: string; name: string; document: string | null };
  responsible: { id: string; name: string } | null;
  pendingObligations: number;
  overdueObligations: number;
}

export const frequencies = ['monthly', 'quarterly', 'annual'] as const;
export type Frequency = (typeof frequencies)[number];
export const frequencyLabel: Record<Frequency, string> = { monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' };

export const obligationTypeInput = z.object({
  code: z.string().trim().min(2, 'Informe o código').max(30),
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  regimes: z.array(z.enum(taxRegimes)).min(1, 'Escolha ao menos um regime'),
  requiresEmployees: z.boolean().default(false),
  frequency: z.enum(frequencies),
  dueDay: z.coerce.number().int().min(1).max(31),
  /** Só para anuais: mês do vencimento no ano seguinte ao de referência. */
  dueMonth: z.coerce.number().int().min(1).max(12).nullish(),
  active: z.boolean().default(true),
});
export type ObligationTypeInput = z.infer<typeof obligationTypeInput>;
export interface ObligationType extends ObligationTypeInput {
  id: string;
}

export type ObligationStatus = 'pending' | 'done' | 'waived';
export const obligationStatusLabel: Record<ObligationStatus, string> = { pending: 'A fazer', done: 'Entregue', waived: 'Dispensada' };

export interface Obligation {
  id: string;
  client: { id: string; name: string; regime: TaxRegime };
  type: { id: string; code: string; name: string };
  /** "2026-09", "2026-T3" ou "2026". */
  competence: string;
  dueOn: string;
  status: ObligationStatus;
  doneAt: string | null;
  doneBy: string | null;
  notes: string | null;
  responsible: string | null;
  attachments: { id: string; filename: string; mime: string; size: number }[];
}

export const obligationNotesInput = z.object({ notes: z.string().trim().max(2000).nullable() });

/**
 * Calendário padrão de obrigações. Os prazos mudam com a legislação e alguns são municipais
 * ou estaduais: o escritório confere e ajusta em "Obrigações → Catálogo".
 */
export const DEFAULT_OBLIGATIONS: ObligationTypeInput[] = [
  { code: 'DAS', name: 'DAS — Simples Nacional', regimes: ['simples', 'mei'], requiresEmployees: false, frequency: 'monthly', dueDay: 20, active: true },
  { code: 'DCTFWEB', name: 'DCTFWeb', regimes: ['simples', 'presumido', 'real'], requiresEmployees: true, frequency: 'monthly', dueDay: 15, active: true },
  { code: 'ESOCIAL', name: 'eSocial — folha de pagamento', regimes: ['mei', 'simples', 'presumido', 'real'], requiresEmployees: true, frequency: 'monthly', dueDay: 15, active: true },
  { code: 'FGTS', name: 'FGTS Digital', regimes: ['mei', 'simples', 'presumido', 'real'], requiresEmployees: true, frequency: 'monthly', dueDay: 20, active: true },
  { code: 'REINF', name: 'EFD-Reinf', regimes: ['presumido', 'real'], requiresEmployees: false, frequency: 'monthly', dueDay: 15, active: true },
  { code: 'PISCOFINS', name: 'PIS/COFINS (DARF)', regimes: ['presumido', 'real'], requiresEmployees: false, frequency: 'monthly', dueDay: 25, active: true },
  { code: 'ISS', name: 'ISS (municipal)', regimes: ['presumido', 'real'], requiresEmployees: false, frequency: 'monthly', dueDay: 10, active: true },
  { code: 'IRPJCSLL', name: 'IRPJ/CSLL trimestral', regimes: ['presumido', 'real'], requiresEmployees: false, frequency: 'quarterly', dueDay: 31, active: true },
  { code: 'DEFIS', name: 'DEFIS', regimes: ['simples'], requiresEmployees: false, frequency: 'annual', dueDay: 31, dueMonth: 3, active: true },
  { code: 'DASNSIMEI', name: 'DASN-SIMEI', regimes: ['mei'], requiresEmployees: false, frequency: 'annual', dueDay: 31, dueMonth: 5, active: true },
  { code: 'ECD', name: 'ECD — escrituração contábil digital', regimes: ['presumido', 'real'], requiresEmployees: false, frequency: 'annual', dueDay: 30, dueMonth: 6, active: true },
  { code: 'ECF', name: 'ECF — escrituração contábil fiscal', regimes: ['presumido', 'real'], requiresEmployees: false, frequency: 'annual', dueDay: 31, dueMonth: 7, active: true },
];

/** Último dia do mês (1–12), para "dia 31" em meses mais curtos. */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay(y, m))).padStart(2, '0')}`;

/**
 * Competências que vencem a partir de uma data de referência e o vencimento de cada uma.
 * Mensal: competência M vence no mês M+1. Trimestral: o trimestre vence no mês seguinte ao
 * fim dele. Anual: o ano Y vence em `dueMonth` de Y+1.
 */
export function competencesFor(type: Pick<ObligationTypeInput, 'frequency' | 'dueDay' | 'dueMonth'>, today: string): { competence: string; dueOn: string }[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (type.frequency === 'monthly') {
    // Mês passado (vence neste mês) e o atual (vence no próximo): dá tempo de se programar.
    const prev = m === 1 ? [y - 1, 12] : [y, m - 1];
    return [
      { competence: `${prev[0]}-${String(prev[1]).padStart(2, '0')}`, dueOn: iso(y, m, type.dueDay) },
      { competence: `${y}-${String(m).padStart(2, '0')}`, dueOn: m === 12 ? iso(y + 1, 1, type.dueDay) : iso(y, m + 1, type.dueDay) },
    ];
  }
  if (type.frequency === 'quarterly') {
    const q = Math.ceil(m / 3);
    const prevQ = q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 };
    const dueMonth = prevQ.q * 3 + 1;
    const due = dueMonth > 12 ? iso(prevQ.y + 1, 1, type.dueDay) : iso(prevQ.y, dueMonth, type.dueDay);
    return [{ competence: `${prevQ.y}-T${prevQ.q}`, dueOn: due }];
  }
  return [{ competence: String(y - 1), dueOn: iso(y, type.dueMonth ?? 12, type.dueDay) }];
}

/**
 * Vencimento do honorário do mês. Se o dia já passou (empresa nova ou reativada depois do vencimento),
 * o honorário não nasce vencido: fica para o mesmo dia do mês seguinte, com aviso. `day` vai até 28.
 */
export function feeDueDate(today: string, day: number): { competence: string; dueOn: string; moved: boolean } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const competence = today.slice(0, 7);
  const dueOn = iso(y, m, day);
  if (dueOn >= today) return { competence, dueOn, moved: false };
  return { competence, dueOn: m === 12 ? iso(y + 1, 1, day) : iso(y, m + 1, day), moved: true };
}

/** Regime e funcionários da empresa → a obrigação se aplica? */
export function applies(type: Pick<ObligationTypeInput, 'regimes' | 'requiresEmployees'>, client: { taxRegime: TaxRegime; hasEmployees: boolean }) {
  return type.regimes.includes(client.taxRegime) && (!type.requiresEmployees || client.hasEmployees);
}
