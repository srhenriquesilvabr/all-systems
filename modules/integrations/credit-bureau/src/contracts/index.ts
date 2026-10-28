import { z } from 'zod';

// Contratos da consulta de crédito (birôs): schemas Zod e tipos usados pela API e pelas telas.

export const CREDIT_BUREAU = 'integration.credit_bureau';

/** Provedores. `simulated` não consulta ninguém: gera um resultado de demonstração a partir do documento. */
export const bureauProviders = ['simulated', 'serasa_experian', 'boa_vista', 'quod'] as const;
export type BureauProvider = (typeof bureauProviders)[number];
export const bureauProviderLabel: Record<BureauProvider, string> = {
  simulated: 'Simulação (sem consulta real)',
  serasa_experian: 'Serasa Experian',
  boa_vista: 'Boa Vista (Equifax)',
  quod: 'Quod',
};

/**
 * O que cada birô exige para ligar. Referência para a conversa comercial: nada aqui foi confirmado
 * com os birôs, e os nomes de produtos, endpoints e campos só chegam com o contrato.
 */
export const bureauRequirements: Record<Exclude<BureauProvider, 'simulated'>, string[]> = {
  serasa_experian: [
    'Contrato comercial com a Serasa Experian em nome da empresa (CNPJ) e escolha do produto de consulta (score + resumo de pendências PF/PJ) — a confirmar',
    'Credenciais de acesso à API (modelo de autenticação, ambiente de homologação) — a confirmar',
    'Documentação dos campos de retorno para o mapeamento do adaptador — a confirmar',
    'Preço por consulta e franquia mensal (para configurar o custo aqui)',
  ],
  boa_vista: [
    'Contrato com a Boa Vista/Equifax e escolha do produto (score + pendências) — a confirmar',
    'Credenciais da API e ambiente de homologação — a confirmar',
    'Documentação dos campos de retorno — a confirmar',
    'Preço por consulta e franquia mensal',
  ],
  quod: [
    'Contrato com a Quod e escolha do produto (score + pendências; cadastro positivo) — a confirmar',
    'Credenciais da API e ambiente de homologação — a confirmar',
    'Documentação dos campos de retorno — a confirmar',
    'Preço por consulta e franquia mensal',
  ],
};

export const queryPurposes = ['consortium_sale', 'credit_analysis', 'other_credit'] as const;
export type QueryPurpose = (typeof queryPurposes)[number];
export const queryPurposeLabel: Record<QueryPurpose, string> = {
  consortium_sale: 'análise da proposta de consórcio',
  credit_analysis: 'análise de crédito para financiamento',
  other_credit: 'outra análise de crédito solicitada pelo cliente',
};

export const consentMethods = ['signed_term', 'digital_acceptance', 'recorded_call', 'written_message'] as const;
export type ConsentMethod = (typeof consentMethods)[number];
export const consentMethodLabel: Record<ConsentMethod, string> = {
  signed_term: 'Termo assinado (papel ou assinatura eletrônica)',
  digital_acceptance: 'Aceite em formulário ou site',
  recorded_call: 'Ligação gravada',
  written_message: 'Mensagem escrita (WhatsApp ou e-mail)',
};

export const CONSENT_VERSION = 'v1';

/**
 * Texto da autorização que o cliente dá antes da consulta (o mesmo é guardado com ela). A equipe
 * mostra/lê este texto ao cliente e registra como ele concordou.
 */
export function consentText(o: { company: string; provider: BureauProvider; purpose: QueryPurpose; documentType: DocumentType }): string {
  const bureau = o.provider === 'simulated' ? 'birô de crédito' : `birô de crédito (${bureauProviderLabel[o.provider]})`;
  const doc = o.documentType === 'cnpj' ? 'o CNPJ da minha empresa' : 'o meu CPF';
  return [
    `Autorizo ${o.company} a consultar ${doc} em ${bureau}, com a finalidade de ${queryPurposeLabel[o.purpose]}.`,
    'A consulta traz score e um resumo de pendências financeiras (negativações, protestos, cheques sem fundo); o resultado é usado só nesta análise e fica registrado com a data e quem consultou.',
    'Posso pedir acesso ao resultado e a correção ou exclusão dos meus dados, respeitados os prazos de guarda exigidos por lei.',
  ].join(' ');
}

export type DocumentType = 'cpf' | 'cnpj';

const onlyDigits = (v: string) => v.replace(/\D/g, '');
export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}
/** CNPJ numérico ou alfanumérico (IN RFB 2.229/2024), mesma regra do cadastro de clientes. */
export function isValidCnpj(input: string): boolean {
  const cnpj = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest = weights.reduce((acc, w, i) => acc + w * (cnpj.charCodeAt(i) - 48), 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}
/** Documento normalizado (CPF só dígitos; CNPJ em maiúsculas) e o tipo; null se inválido. */
export function parseDocument(input: string): { document: string; type: DocumentType } | null {
  if (isValidCpf(input)) return { document: onlyDigits(input), type: 'cpf' };
  if (isValidCnpj(input)) return { document: input.toUpperCase().replace(/[^0-9A-Z]/g, ''), type: 'cnpj' };
  return null;
}
/** "123.***.***-09" / "12.***.***\/0001-95": para listas e auditoria. */
export function maskDocument(doc: string): string {
  if (doc.length === 11) return `${doc.slice(0, 3)}.***.***-${doc.slice(9)}`;
  if (doc.length === 14) return `${doc.slice(0, 2)}.***.***/${doc.slice(8, 12)}-${doc.slice(12)}`;
  return doc ? '***' : '';
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Data inválida');

export const queryInput = z.object({
  document: z.string().trim().min(11).max(20).refine((v) => !!parseDocument(v), 'CPF ou CNPJ inválido'),
  subjectName: z.string().trim().min(2, 'Informe o nome').max(150),
  customerId: z.string().uuid().nullish(),
  /** Quem pediu a consulta (ex.: lead ou cota do consórcio), para mostrar o resultado lá. */
  sourceType: z.string().trim().max(50).nullish(),
  sourceId: z.string().uuid().nullish(),
  purpose: z.enum(queryPurposes),
  consent: z.object({
    /** Quando o cliente autorizou (não pode ser no futuro). */
    givenAt: isoDate,
    method: z.enum(consentMethods),
    /** Onde está a prova (ex.: "termo arquivado na pasta do cliente", "protocolo da ligação 123"). */
    evidence: z.string().trim().max(300).nullish(),
    /** A pessoa que consulta confirma que o cliente concordou com o texto mostrado. */
    confirmed: z.literal(true, { errorMap: () => ({ message: 'Confirme que o cliente autorizou a consulta' }) }),
    version: z.string().max(10).default(CONSENT_VERSION),
  }),
});
export type QueryInput = z.infer<typeof queryInput>;

export const decisionInput = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(300).nullish(),
});
export type DecisionInput = z.infer<typeof decisionInput>;

export const riskBands = ['low', 'medium', 'high', 'very_high'] as const;
export type RiskBand = (typeof riskBands)[number];
export const riskBandLabel: Record<RiskBand, string> = { low: 'Baixo risco', medium: 'Risco médio', high: 'Risco alto', very_high: 'Risco muito alto' };

/** Resumo do resultado, no nosso vocabulário (o mapeamento do birô fica no adaptador). */
export interface BureauSummary {
  negativeRecords: { count: number; totalAmount: number };
  protests: { count: number; totalAmount: number };
  bouncedChecks: number;
  /** Avisos curtos (ex.: "documento com restrição na Receita"). */
  alerts: string[];
}

export const decisions = ['pending', 'approved', 'rejected'] as const;
export type Decision = (typeof decisions)[number];
export const decisionLabel: Record<Decision, string> = { pending: 'Aguardando decisão', approved: 'Seguir com a venda', rejected: 'Reprovado' };

export interface CreditQuery {
  id: string;
  document: string;
  documentType: DocumentType;
  subjectName: string;
  customerId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  provider: BureauProvider;
  /** Resultado de demonstração (nenhum birô consultado). */
  simulated: boolean;
  status: 'done' | 'error';
  error: string | null;
  externalId: string | null;
  score: number | null;
  riskBand: RiskBand | null;
  summary: BureauSummary | null;
  /** Score mínimo sugerido nas configurações, para orientar (a decisão é de uma pessoa). */
  suggestedMinScore: number;
  cost: number;
  decision: Decision;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  queriedBy: string | null;
  createdAt: string;
  consent: { purpose: QueryPurpose; method: ConsentMethod; givenAt: string; evidence: string | null; text: string; version: string; recordedBy: string | null };
}

export interface BureauStatus {
  provider: BureauProvider;
  providerName: string;
  simulated: boolean;
  /** Empresa (nome) que aparece no texto de autorização. */
  company: string;
  costPerQueryPf: number;
  costPerQueryPj: number;
  monthlyLimit: number;
  suggestedMinScore: number;
  month: { count: number; cost: number };
  /** Para a tela de configuração: o adaptador do birô escolhido ainda é esqueleto? */
  adapterPending: boolean;
}
