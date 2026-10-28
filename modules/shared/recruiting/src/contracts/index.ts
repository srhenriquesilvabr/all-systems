import { z } from 'zod';

// Contratos do Head hunter (recrutamento): schemas Zod e tipos usados pela API e pelas telas.

export const workModels = ['onsite', 'hybrid', 'remote'] as const;
export type WorkModel = (typeof workModels)[number];
export const workModelLabel: Record<WorkModel, string> = { onsite: 'Presencial', hybrid: 'Híbrido', remote: 'Remoto' };

export const contractTypes = ['clt', 'pj', 'internship', 'temporary'] as const;
export type ContractType = (typeof contractTypes)[number];
export const contractTypeLabel: Record<ContractType, string> = { clt: 'CLT', pj: 'PJ', internship: 'Estágio', temporary: 'Temporário' };

export const jobStatuses = ['draft', 'open', 'paused', 'closed'] as const;
export type JobStatus = (typeof jobStatuses)[number];
export const jobStatusLabel: Record<JobStatus, string> = { draft: 'Rascunho', open: 'Aberta', paused: 'Pausada', closed: 'Encerrada' };

export const applicationStatuses = ['active', 'rejected', 'hired', 'withdrawn'] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];
export const applicationStatusLabel: Record<ApplicationStatus, string> = { active: 'Em andamento', rejected: 'Reprovado', hired: 'Contratado', withdrawn: 'Desistiu' };

/** Etapa do processo. `hired` é a etapa final (só uma por vaga, a última). "Reprovado" não é etapa: é a situação da candidatura. */
export interface JobStage {
  id: string;
  name: string;
  kind: 'open' | 'hired';
}

export const DEFAULT_STAGES: JobStage[] = [
  { id: 'triagem', name: 'Triagem', kind: 'open' },
  { id: 'entrevista-rh', name: 'Entrevista RH', kind: 'open' },
  { id: 'entrevista-gestor', name: 'Entrevista gestor', kind: 'open' },
  { id: 'proposta', name: 'Proposta', kind: 'open' },
  { id: 'contratado', name: 'Contratado', kind: 'hired' },
];

export interface JobQuestion {
  id: string;
  label: string;
  kind: 'text' | 'yes_no';
  required: boolean;
}

export interface ApplicationAnswer {
  questionId: string;
  question: string;
  answer: string;
}

/** Prova do consentimento (LGPD): o texto exato aceito, a versão e quando. */
export interface ConsentRecord {
  version: string;
  text: string;
  acceptedAt: string;
  ip: string | null;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const list = (maxItems: number, maxLen: number) =>
  z
    .array(z.string().trim().max(maxLen))
    .max(maxItems)
    .default([])
    .transform((items) => items.filter(Boolean));
const money = z.coerce.number().min(0).max(10_000_000).nullish();
const uf = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'UF inválida (ex.: SP)')
  .nullish()
  .or(z.literal(''))
  .transform((v) => v || null);

const stageInput = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,40}$/, 'Identificador de etapa inválido'),
  name: z.string().trim().min(1, 'Dê um nome à etapa').max(40),
  kind: z.enum(['open', 'hired']).default('open'),
});

const questionInput = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,40}$/, 'Identificador de pergunta inválido'),
  label: z.string().trim().min(3, 'Escreva a pergunta').max(300),
  kind: z.enum(['text', 'yes_no']).default('text'),
  required: z.boolean().default(false),
});

/** Etapas: nomes e ids únicos, ao menos uma em aberto e a de contratação por último. */
export const stagesInput = z
  .array(stageInput)
  .min(2)
  .max(12)
  .superRefine((stages, ctx) => {
    const ids = new Set(stages.map((s) => s.id));
    if (ids.size !== stages.length) ctx.addIssue({ code: 'custom', message: 'Há etapas repetidas' });
    const names = new Set(stages.map((s) => s.name.toLowerCase()));
    if (names.size !== stages.length) ctx.addIssue({ code: 'custom', message: 'Há etapas com o mesmo nome' });
    const hired = stages.filter((s) => s.kind === 'hired');
    if (hired.length !== 1 || stages[stages.length - 1]!.kind !== 'hired') {
      ctx.addIssue({ code: 'custom', message: 'A última etapa precisa ser a de contratação (e só ela)' });
    }
  });

const jobFields = {
  /** Empresa contratante (cliente do tipo empresa). Vazio = a própria empresa. */
  customerId: z.string().uuid().nullish(),
  /** Esconde o nome da contratante na página pública e nos anúncios. */
  confidential: z.boolean().default(false),
  title: z.string().trim().min(3, 'Informe o título da vaga').max(120),
  area: text(80),
  description: z.string().trim().max(10_000).default(''),
  requirements: list(30, 200),
  niceToHave: list(30, 200),
  salaryMin: money,
  salaryMax: money,
  showSalary: z.boolean().default(false),
  benefits: list(30, 120),
  workModel: z.enum(workModels).default('onsite'),
  city: text(80),
  state: uf,
  contractType: z.enum(contractTypes).default('clt'),
  positions: z.coerce.number().int().min(1).max(500).default(1),
  stages: stagesInput.default(DEFAULT_STAGES),
  questions: z.array(questionInput).max(15).default([]),
  /** Publicar também na Gupy (precisa da integração configurada). */
  publishGupy: z.boolean().default(false),
};

const salaryRange = (j: { salaryMin?: number | null; salaryMax?: number | null }) => j.salaryMin == null || j.salaryMax == null || j.salaryMax >= j.salaryMin;

export const jobInput = z.object(jobFields).refine(salaryRange, { message: 'O salário máximo precisa ser maior que o mínimo', path: ['salaryMax'] });
export type JobInput = z.infer<typeof jobInput>;
export const jobPatch = z.object(jobFields).partial().refine(salaryRange, { message: 'O salário máximo precisa ser maior que o mínimo', path: ['salaryMax'] });
export type JobPatch = z.infer<typeof jobPatch>;

export const jobStatusInput = z.object({ status: z.enum(jobStatuses) });

export const jobsQuery = z.object({
  status: z.enum([...jobStatuses, 'active']).optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
});

const email = z.string().trim().toLowerCase().email('E-mail inválido').max(254);
const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => !v || v.replace(/\D/g, '').length >= 10, 'Informe o telefone com DDD')
  .nullish()
  .transform((v) => v || null);
const linkedin = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
  .refine((v) => !v || /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(v), 'LinkedIn: informe o endereço do perfil (ex.: linkedin.com/in/fulano)');

export const candidateInput = z.object({
  name: z.string().trim().min(3, 'Informe o nome completo').max(120),
  email,
  phone,
  linkedinUrl: linkedin,
  city: text(80),
  state: uf,
  notes: text(4000),
});
export type CandidateInput = z.infer<typeof candidateInput>;
export const candidatePatch = candidateInput.partial();

export const candidatesQuery = z.object({
  q: z.string().trim().max(120).optional(),
  jobId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const answerInput = z.object({ questionId: z.string().max(40), answer: z.string().trim().max(2000) });

/** Candidatura lançada pela equipe (ex.: indicação, currículo recebido por e-mail). */
export const applicationInput = z.object({
  candidateId: z.string().uuid(),
  jobId: z.string().uuid(),
  salaryExpectation: money,
  answers: z.array(answerInput).max(15).default([]),
  /** heuristic: não gasta IA (ex.: lançamentos em lote); auto: IA quando disponível. */
  analysis: z.enum(['auto', 'heuristic']).default('auto'),
});
export type ApplicationInput = z.infer<typeof applicationInput>;

export const moveInput = z.object({ stageId: z.string().max(40) });
export const rejectInput = z.object({ reason: z.string().trim().min(3, 'Informe o motivo da reprovação').max(1000) });
export const noteInput = z.object({ text: z.string().trim().min(1, 'Escreva a anotação').max(4000) });
export const analyzeInput = z.object({ analysis: z.enum(['auto', 'heuristic']).default('auto') });
export const hireInput = z.object({
  /** Início na empresa (data da admissão prevista). */
  startedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
    .nullish(),
});

/** Campos da candidatura pela página pública (multipart: o currículo vai no campo "resume"). */
export const publicApplicationInput = z.object({
  name: z.string().trim().min(3, 'Informe o nome completo').max(120),
  email,
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v.replace(/\D/g, '').length >= 10, 'Informe o telefone com DDD'),
  linkedinUrl: linkedin,
  city: z.string().trim().min(2, 'Informe a cidade').max(80),
  state: uf,
  salaryExpectation: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => (v ? Number(v.replace(/\./g, '').replace(',', '.')) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 10_000_000), 'Pretensão salarial inválida'),
  /** JSON com [{ questionId, answer }]. */
  answers: z
    .string()
    .max(40_000)
    .nullish()
    .transform((v, ctx) => {
      if (!v) return [];
      try {
        return z.array(answerInput).max(15).parse(JSON.parse(v));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Respostas inválidas' });
        return z.NEVER;
      }
    }),
  /** Precisa ser "true": o candidato marcou o aceite. */
  consent: z.literal('true', { errorMap: () => ({ message: 'É preciso aceitar o uso dos dados para se candidatar' }) }),
  consentVersion: z.string().max(20),
  /** Armadilha para robôs: campo escondido que pessoas não preenchem. */
  website: z.string().max(500).optional(),
  /** Quando o formulário foi aberto (ms): envio rápido demais é de robô. */
  startedAt: z.coerce.number().optional(),
});

/** Resultado de uma análise de aderência (IA ou estimativa). */
export const analysisResult = z.object({
  score: z.number().int().min(0).max(100),
  strengths: z.array(z.string().max(400)).max(8),
  gaps: z.array(z.string().max(400)).max(8),
  summary: z.string().max(1200),
});
export type AnalysisResult = z.infer<typeof analysisResult>;

export const CONSENT_VERSION = 'v1';

/**
 * Texto do consentimento mostrado na candidatura (e guardado com ela). Cobre finalidade, tempo de
 * guarda, compartilhamento com a contratante e a análise automatizada (LGPD arts. 7º, 8º e 20).
 */
export function consentText(o: { company: string; hiringCompany: string | null; retentionMonths: number; privacyEmail: string | null; ai: boolean }): string {
  const sharing = o.hiringCompany
    ? `Meus dados e meu currículo podem ser compartilhados com ${o.hiringCompany}, empresa contratante desta vaga, só para este processo seletivo.`
    : 'Meus dados e meu currículo podem ser compartilhados com a empresa contratante desta vaga, só para este processo seletivo.';
  const automated = o.ai
    ? 'O currículo e as respostas passam por uma análise automatizada, feita com inteligência artificial por um fornecedor (Anthropic, com servidores fora do Brasil), que gera uma nota de aderência aos requisitos da vaga. A nota ajuda a equipe a organizar as candidaturas, mas a decisão é sempre de uma pessoa, e posso pedir a revisão de qualquer decisão.'
    : 'O currículo e as respostas passam por uma análise automatizada que gera uma nota de aderência aos requisitos da vaga. A nota ajuda a equipe a organizar as candidaturas, mas a decisão é sempre de uma pessoa, e posso pedir a revisão de qualquer decisão.';
  const contact = o.privacyEmail ? ` pelo e-mail ${o.privacyEmail}` : ' pelos canais da empresa';
  return [
    `Autorizo ${o.company} a tratar os dados pessoais e o currículo que envio nesta candidatura, com a finalidade de participar deste processo seletivo e de outros compatíveis com o meu perfil (banco de talentos).`,
    sharing,
    automated,
    `Os dados ficam guardados por até ${o.retentionMonths} ${o.retentionMonths === 1 ? 'mês' : 'meses'} depois da minha última candidatura e então são anonimizados.`,
    `Posso pedir acesso, correção ou exclusão dos meus dados, ou revogar este consentimento, a qualquer momento${contact}.`,
  ].join(' ');
}

/** Rótulo da faixa salarial (página pública, anúncios). */
export function salaryLabel(min: number | null, max: number | null): string | null {
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  if (min != null && max != null) return min === max ? brl(min) : `${brl(min)} a ${brl(max)}`;
  if (min != null) return `a partir de ${brl(min)}`;
  if (max != null) return `até ${brl(max)}`;
  return null;
}

/** Id de etapa/pergunta a partir do nome ("Teste técnico" → "teste-tecnico"). */
export function slugId(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'item';
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  return id;
}
