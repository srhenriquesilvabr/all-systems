import { z } from 'zod';
import {
  normalizeCest,
  normalizeCfop,
  normalizeClassTrib,
  normalizeCnae,
  normalizeIbge,
  normalizeIbsCbsCst,
  normalizeLc116,
  normalizeNationalServiceCode,
  normalizeNbs,
  normalizeNcm,
  normalizePisCofinsCst,
} from './codes';

export * from './codes';

export const MODULE = 'integration.fiscal';

// ---- Vocabulário ----------------------------------------------------------------------------------

export const docTypes = ['nfse', 'nfce', 'nfe'] as const;
export type DocType = (typeof docTypes)[number];
export const docTypeLabel: Record<DocType, string> = { nfse: 'NFS-e (serviço)', nfce: 'NFC-e (consumidor)', nfe: 'NF-e (mercadoria)' };
export const docTypeShort: Record<DocType, string> = { nfse: 'NFS-e', nfce: 'NFC-e', nfe: 'NF-e' };

/**
 * rascunho → enviada (aguardando o provedor) → autorizada | rejeitada | denegada → cancelada.
 * Rejeitada volta a ser editável e é reenviada com a mesma referência e o mesmo número.
 * Descartada: rascunho abandonado, ou rejeitada que não vai ser corrigida (o número vira lacuna a inutilizar).
 */
export const docStatuses = ['draft', 'sending', 'authorized', 'rejected', 'denied', 'cancelled', 'discarded'] as const;
export type DocStatus = (typeof docStatuses)[number];
export const docStatusLabel: Record<DocStatus, string> = {
  draft: 'Rascunho',
  sending: 'Enviada (aguardando)',
  authorized: 'Autorizada',
  rejected: 'Rejeitada',
  denied: 'Denegada',
  cancelled: 'Cancelada',
  discarded: 'Descartada',
};
export const docStatusTone: Record<DocStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'brand'> = {
  draft: 'neutral',
  sending: 'brand',
  authorized: 'success',
  rejected: 'danger',
  denied: 'danger',
  cancelled: 'warning',
  discarded: 'neutral',
};
/** Pode ser editada (dados, itens, alíquotas) e enviada de novo. */
export const editableStatuses: DocStatus[] = ['draft', 'rejected'];

export const environments = ['homologation', 'production'] as const;
export type FiscalEnvironment = (typeof environments)[number];
export const environmentLabel: Record<FiscalEnvironment, string> = { homologation: 'Homologação (testes, sem valor fiscal)', production: 'Produção' };

export const providers = ['simulated', 'focus', 'plugnotas', 'nfeio'] as const;
export type ProviderKey = (typeof providers)[number];
export const providerLabel: Record<ProviderKey, string> = {
  simulated: 'Simulado (demonstração e testes)',
  focus: 'Focus NFe',
  plugnotas: 'PlugNotas (TecnoSpeed) — em preparação',
  nfeio: 'NFE.io — em preparação',
};

export const taxRegimes = ['mei', 'simples', 'simples_excess', 'presumido', 'real'] as const;
export type TaxRegime = (typeof taxRegimes)[number];
export const taxRegimeLabel: Record<TaxRegime, string> = {
  mei: 'MEI',
  simples: 'Simples Nacional',
  simples_excess: 'Simples Nacional — excesso de sublimite',
  presumido: 'Lucro Presumido',
  real: 'Lucro Real',
};
export const isSimples = (r: TaxRegime) => r === 'mei' || r === 'simples' || r === 'simples_excess';

export const sourceTypes = ['sale', 'appointment', 'service_order', 'manual'] as const;
export type SourceType = (typeof sourceTypes)[number];
export const sourceTypeLabel: Record<SourceType, string> = { sale: 'Venda', appointment: 'Atendimento', service_order: 'Ordem de serviço', manual: 'Avulsa' };

export const paymentMethods = ['cash', 'pix', 'debit_card', 'credit_card', 'on_account', 'other'] as const;
export type FiscalPaymentMethod = (typeof paymentMethods)[number];
export const paymentMethodLabel: Record<FiscalPaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  debit_card: 'Cartão de débito',
  credit_card: 'Cartão de crédito',
  on_account: 'Crédito na loja (fiado)',
  other: 'Outros',
};

/** Aviso que acompanha toda tela de códigos e alíquotas. */
export const ACCOUNTANT_NOTICE =
  'Códigos (NCM, CFOP, CST/CSOSN, item da LC 116, NBS) e alíquotas variam por produto, serviço, município e regime. Confira cada um com o contador da empresa antes de emitir em produção: o sistema confere só o formato.';

// ---- Configuração (settings do módulo) ------------------------------------------------------------

const code = (fn: (v: string) => string | null, message: string) =>
  z
    .string()
    .trim()
    .max(30)
    .refine((v) => !v || fn(v) !== null, message)
    .transform((v) => (v ? fn(v)! : ''));
const rate = (max: number) => z.coerce.number().min(0).max(max);

export const fiscalSettings = z.object({
  provider: z.enum(providers).default('simulated'),
  environment: z.enum(environments).default('homologation'),
  /** Token da API do provedor por ambiente (Focus: um por empresa e ambiente). */
  tokenHomologation: z.string().trim().max(500).default(''),
  tokenProduction: z.string().trim().max(500).default(''),
  /** Id da empresa no provedor (NFE.io/PlugNotas usam; Focus identifica pelo token). */
  providerCompanyId: z.string().trim().max(100).default(''),

  taxRegime: z.enum(taxRegimes).default('simples'),
  cnae: code(normalizeCnae, 'CNAE: 7 dígitos (ex.: 9602-5/01)').default(''),
  /** Vazias = usa as do cadastro da empresa. */
  stateRegistration: z.string().trim().max(20).default(''),
  municipalRegistration: z.string().trim().max(20).default(''),
  municipalityCode: code(normalizeIbge, 'Código IBGE do município: 7 dígitos').default(''),
  /** NFS-e: padrão nacional (obrigatório para municípios desde 2026) ou o padrão próprio do município. */
  nfseStandard: z.enum(['national', 'municipal']).default('national'),
  /** Regime especial de tributação municipal (código do provedor; vazio = nenhum). */
  specialRegime: z.string().trim().max(5).default(''),
  /** Natureza da operação padrão da NFC-e/NF-e e descrição da NFS-e. */
  defaultNature: z.string().trim().min(1).max(60).default('Venda de mercadoria'),
  serviceNature: z.string().trim().min(1).max(60).default('Prestação de serviço'),
  /** Alíquota de ISS para serviço sem alíquota própria no cadastro fiscal (0 = não definida). */
  defaultIssRate: rate(5).default(0),
  issWithheldDefault: z.boolean().default(false),
  /** Código padrão para itens de ordem de serviço sem cadastro fiscal próprio. */
  defaultLc116: code(normalizeLc116, 'Item da LC 116: nn.nn (ex.: 14.01)').default(''),
  defaultNationalCode: code(normalizeNationalServiceCode, 'Código de tributação nacional: 6 dígitos').default(''),
  defaultNbs: code(normalizeNbs, 'NBS: 9 dígitos').default(''),
  /** Retenções federais (%) quando o tomador do serviço é empresa. 0 = não retém. */
  retentionIr: rate(27.5).default(0),
  retentionPis: rate(10).default(0),
  retentionCofins: rate(10).default(0),
  retentionCsll: rate(10).default(0),
  retentionInss: rate(20).default(0),
  /** CSC (código de segurança do contribuinte) da NFC-e, por ambiente. */
  cscIdHomologation: z.string().trim().max(10).default(''),
  cscTokenHomologation: z.string().trim().max(100).default(''),
  cscIdProduction: z.string().trim().max(10).default(''),
  cscTokenProduction: z.string().trim().max(100).default(''),
  /** Quem numera: o sistema (série e próximo número abaixo) ou o provedor. */
  numbering: z.enum(['system', 'provider']).default('system'),
  /** Reforma Tributária (LC 214/2025): em 2026, IBS e CBS destacados como teste (0,1% e 0,9%). */
  reformEnabled: z.boolean().default(true),
  cbsRate: rate(30).default(0.9),
  ibsRate: rate(30).default(0.1),
  ibsCbsCst: code(normalizeIbsCbsCst, 'CST do IBS/CBS: 3 dígitos').default('000'),
  classTrib: code(normalizeClassTrib, 'Classificação tributária (cClassTrib): 6 dígitos').default('000001'),
  /** Lei 12.741/2012 ("valor aproximado dos tributos"), % sobre o total. 0 = não informa. */
  approximateTaxPercent: rate(100).default(0),
  additionalInfo: z.string().trim().max(500).default(''),
  /** Emissão automática. */
  autoSale: z.enum(['off', 'nfce', 'nfe']).default('off'),
  autoAppointment: z.boolean().default(false),
  autoServiceOrder: z.boolean().default(false),
  /** Envio ao cliente quando autorizada. */
  sendEmail: z.boolean().default(true),
  sendWhatsapp: z.boolean().default(false),
  /** Prazo de cancelamento da NFS-e (varia por município). NFC-e: 30 min; NF-e: 24 h. */
  nfseCancelDays: z.coerce.number().int().min(0).max(365).default(30),
  /** Segredo que o provedor manda no cabeçalho do webhook. */
  webhookSecret: z.string().trim().max(200).default(''),
});
export type FiscalSettings = z.infer<typeof fiscalSettings>;
export const fiscalSecretSettings = ['tokenHomologation', 'tokenProduction', 'cscTokenHomologation', 'cscTokenProduction', 'webhookSecret'];

// ---- Cadastro fiscal ------------------------------------------------------------------------------

const optionalCode = (fn: (v: string) => string | null, message: string) =>
  z
    .string()
    .trim()
    .max(30)
    .nullish()
    .refine((v) => !v || fn(v) !== null, message)
    .transform((v) => (v ? fn(v)! : null));
const requiredCode = (fn: (v: string) => string | null, message: string) =>
  z
    .string({ required_error: message })
    .trim()
    .refine((v) => fn(v) !== null, message)
    .transform((v) => fn(v)!);

export const productCodeInput = z.object({
  productId: z.string().uuid(),
  productName: z.string().trim().min(1).max(200),
  ncm: requiredCode(normalizeNcm, 'NCM: 8 dígitos (ex.: 1905.90.90)'),
  cfop: requiredCode(normalizeCfop, 'CFOP de saída: 4 dígitos começando com 5, 6 ou 7 (ex.: 5102)'),
  cest: optionalCode(normalizeCest, 'CEST: 7 dígitos (ex.: 17.049.00)'),
  origin: z.coerce.number().int().min(0).max(8).default(0),
  /** CST (regime normal) ou CSOSN (Simples); conferido contra o regime na API. */
  icmsSituation: z.string().trim().min(2).max(3),
  icmsRate: rate(40).nullish(),
  pisCofinsCst: optionalCode(normalizePisCofinsCst, 'CST de PIS/COFINS: 2 dígitos'),
  pisRate: rate(10).nullish(),
  cofinsRate: rate(10).nullish(),
  /** Unidade tributável (ex.: UN, KG). */
  taxUnit: z.string().trim().min(1).max(6).transform((v) => v.toUpperCase()),
  ibsCbsCst: optionalCode(normalizeIbsCbsCst, 'CST do IBS/CBS: 3 dígitos'),
  classTrib: optionalCode(normalizeClassTrib, 'cClassTrib: 6 dígitos'),
});
export type ProductCodeInput = z.infer<typeof productCodeInput>;

/** `refType`: de onde vem o serviço. `sch_service` = serviço da agenda; outros = itens de ordem de serviço. */
export const serviceCodeInput = z.object({
  refType: z.string().trim().min(1).max(40).default('sch_service'),
  refId: z.string().trim().min(1).max(100),
  serviceName: z.string().trim().min(1).max(200),
  lc116: requiredCode(normalizeLc116, 'Item da LC 116: nn.nn (ex.: 06.01)'),
  nationalCode: optionalCode(normalizeNationalServiceCode, 'Código de tributação nacional: 6 dígitos (ex.: 060101)'),
  nbs: optionalCode(normalizeNbs, 'NBS: 9 dígitos (ex.: 1.2601.10.00)'),
  municipalCode: z.string().trim().max(20).nullish().transform((v) => v || null),
  issRate: rate(5),
  issWithheld: z.boolean().default(false),
  cnae: optionalCode(normalizeCnae, 'CNAE: 7 dígitos'),
  ibsCbsCst: optionalCode(normalizeIbsCbsCst, 'CST do IBS/CBS: 3 dígitos'),
  classTrib: optionalCode(normalizeClassTrib, 'cClassTrib: 6 dígitos'),
});
export type ServiceCodeInput = z.infer<typeof serviceCodeInput>;

export interface ProductCode extends Omit<ProductCodeInput, 'icmsRate' | 'pisRate' | 'cofinsRate'> {
  id: string;
  icmsRate: number | null;
  pisRate: number | null;
  cofinsRate: number | null;
  updatedAt: string;
}
export interface ServiceCode extends ServiceCodeInput {
  id: string;
  updatedAt: string;
}

// ---- Empresa, certificado e séries ----------------------------------------------------------------

export interface Certificate {
  id: string;
  subjectName: string;
  /** CNPJ/CPF do titular, quando o certificado traz (ICP-Brasil). */
  document: string | null;
  issuerName: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  daysLeft: number;
  active: boolean;
  /** Titular diferente do CNPJ da empresa. */
  documentMismatch: boolean;
  createdAt: string;
}

export interface Series {
  id: string;
  type: DocType;
  environment: FiscalEnvironment;
  series: string;
  nextNumber: number;
}
export const seriesInput = z.object({
  type: z.enum(docTypes),
  environment: z.enum(environments),
  series: z.string().trim().regex(/^\d{1,3}$/, 'Série: até 3 dígitos'),
  nextNumber: z.coerce.number().int().min(1).max(999_999_999),
});
export type SeriesInput = z.infer<typeof seriesInput>;

export interface CompanyFiscal {
  name: string;
  legalName: string | null;
  document: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  email: string | null;
  phone: string | null;
  address: { zip?: string; street?: string; number?: string; complement?: string; district?: string; city?: string; state?: string } | null;
}

export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  /** Bloqueia a emissão (no ambiente/provedor atual) ou só avisa. */
  blocking: boolean;
  types: DocType[];
}

export interface FiscalOverview {
  settings: Record<string, unknown>;
  company: CompanyFiscal;
  /** Inscrições efetivas (as da configuração ou, vazias, as do cadastro da empresa). */
  effective: { stateRegistration: string | null; municipalRegistration: string | null };
  certificate: Certificate | null;
  series: Series[];
  readiness: ReadinessItem[];
  webhookUrl: string;
}

// ---- Documento ------------------------------------------------------------------------------------

const money = z.coerce.number().min(0).max(99_999_999);

export const recipientInput = z.object({
  name: z.string().trim().min(1).max(150),
  /** CPF ou CNPJ, só dígitos/letras. Vazio = consumidor não identificado (NFC-e, NFS-e de pessoa física). */
  document: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => (v ? v.replace(/[^\dA-Za-z]/g, '').toUpperCase() : null)),
  email: z.string().trim().email().max(254).nullish().or(z.literal('')).transform((v) => v || null),
  phone: z.string().trim().max(20).nullish().transform((v) => v || null),
  stateRegistration: z.string().trim().max(20).nullish().transform((v) => v || null),
  /** Indicador da IE do destinatário (NF-e): 1 contribuinte, 2 isento, 9 não contribuinte. */
  ieIndicator: z.union([z.literal(1), z.literal(2), z.literal(9)]).default(9),
  address: z
    .object({
      zip: z.string().trim().max(10).optional(),
      street: z.string().trim().max(150).optional(),
      number: z.string().trim().max(20).optional(),
      complement: z.string().trim().max(80).optional(),
      district: z.string().trim().max(80).optional(),
      city: z.string().trim().max(80).optional(),
      state: z.string().trim().max(2).optional(),
      ibge: z.string().trim().max(7).optional(),
    })
    .nullish()
    .transform((v) => v ?? null),
});
export type Recipient = z.infer<typeof recipientInput>;

export const documentItemInput = z.object({
  kind: z.enum(['product', 'service']),
  refType: z.string().max(40).nullish().transform((v) => v ?? null),
  refId: z.string().max(100).nullish().transform((v) => v ?? null),
  code: z.string().trim().max(60).default(''),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().max(999_999),
  unit: z.string().trim().min(1).max(6).default('UN'),
  unitPrice: money,
  discount: money.default(0),
  // Mercadoria
  ncm: optionalCode(normalizeNcm, 'NCM: 8 dígitos'),
  cfop: optionalCode(normalizeCfop, 'CFOP de saída: 4 dígitos (5, 6 ou 7)'),
  cest: optionalCode(normalizeCest, 'CEST: 7 dígitos'),
  origin: z.coerce.number().int().min(0).max(8).nullish(),
  icmsSituation: z.string().trim().max(3).nullish(),
  icmsRate: rate(40).nullish(),
  pisCofinsCst: optionalCode(normalizePisCofinsCst, 'CST de PIS/COFINS: 2 dígitos'),
  pisRate: rate(10).nullish(),
  cofinsRate: rate(10).nullish(),
  taxUnit: z.string().trim().max(6).nullish(),
  // Serviço
  lc116: optionalCode(normalizeLc116, 'Item da LC 116: nn.nn'),
  nationalCode: optionalCode(normalizeNationalServiceCode, 'Código de tributação nacional: 6 dígitos'),
  nbs: optionalCode(normalizeNbs, 'NBS: 9 dígitos'),
  municipalCode: z.string().trim().max(20).nullish(),
  issRate: rate(5).nullish(),
  issWithheld: z.boolean().nullish(),
  // Reforma Tributária
  ibsCbsCst: optionalCode(normalizeIbsCbsCst, 'CST do IBS/CBS: 3 dígitos'),
  classTrib: optionalCode(normalizeClassTrib, 'cClassTrib: 6 dígitos'),
});
export type DocumentItemInput = z.input<typeof documentItemInput>;
export type DocumentItem = z.infer<typeof documentItemInput> & { total: number };

export const documentPaymentInput = z.object({ method: z.enum(paymentMethods), amount: money });
export type DocumentPayment = z.infer<typeof documentPaymentInput>;

/** Nota avulsa (ou rascunho montado pela tela). */
export const documentInput = z.object({
  type: z.enum(docTypes),
  customerId: z.string().uuid().nullish(),
  recipient: recipientInput.nullish(),
  items: z.array(documentItemInput).min(1, 'Inclua ao menos um item').max(300),
  payments: z.array(documentPaymentInput).max(20).default([]),
  nature: z.string().trim().max(60).nullish(),
  additionalInfo: z.string().trim().max(2000).nullish(),
  /** Data da prestação (competência) da NFS-e. Padrão: hoje. */
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type DocumentInput = z.input<typeof documentInput>;

/** Correção de rascunho ou de nota rejeitada (o que vier substitui). */
export const documentPatch = z.object({
  customerId: z.string().uuid().nullish(),
  recipient: recipientInput.nullish(),
  items: z.array(documentItemInput).min(1).max(300).optional(),
  payments: z.array(documentPaymentInput).max(20).optional(),
  nature: z.string().trim().max(60).nullish(),
  additionalInfo: z.string().trim().max(2000).nullish(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type DocumentPatch = z.input<typeof documentPatch>;

export const cancelInput = z.object({ reason: z.string().trim().min(15, 'Justificativa: de 15 a 255 caracteres').max(255, 'Justificativa: de 15 a 255 caracteres') });
export const correctionInput = z.object({ text: z.string().trim().min(15, 'Correção: de 15 a 1000 caracteres').max(1000, 'Correção: de 15 a 1000 caracteres') });
export const voidInput = z
  .object({
    type: z.enum(['nfce', 'nfe']),
    series: z.string().trim().regex(/^\d{1,3}$/),
    from: z.coerce.number().int().min(1),
    to: z.coerce.number().int().min(1),
    reason: z.string().trim().min(15, 'Justificativa: de 15 a 255 caracteres').max(255),
  })
  .refine((v) => v.to >= v.from && v.to - v.from < 10_000, { message: 'Faixa inválida (o final precisa ser maior ou igual ao inicial, até 10 mil números)', path: ['to'] });
export type VoidInput = z.infer<typeof voidInput>;

export interface Taxes {
  iss: number;
  issWithheld: boolean;
  icms: number;
  pis: number;
  cofins: number;
  /** Retenções federais (tomador empresa). */
  retentions: { ir: number; pis: number; cofins: number; csll: number; inss: number };
  ibs: number;
  cbs: number;
  /** Lei 12.741 (estimativa informada ao consumidor). */
  approximate: number;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface DocumentEvent {
  kind: string;
  status: string | null;
  message: string | null;
  source: string;
  userName: string | null;
  at: string;
}

export interface Correction {
  sequence: number;
  text: string;
  at: string;
  hasXml: boolean;
  hasPdf: boolean;
}

export interface FiscalDocument {
  id: string;
  type: DocType;
  environment: FiscalEnvironment;
  provider: ProviderKey;
  status: DocStatus;
  reference: string;
  series: string | null;
  number: number | null;
  accessKey: string | null;
  verificationCode: string | null;
  protocol: string | null;
  sourceType: SourceType;
  sourceId: string | null;
  sourceLabel: string | null;
  customer: { id: string; name: string } | null;
  recipient: Recipient | null;
  items: DocumentItem[];
  payments: DocumentPayment[];
  total: number;
  discount: number;
  taxes: Taxes;
  nature: string;
  additionalInfo: string | null;
  serviceDate: string | null;
  issuedAt: string | null;
  authorizedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  statusCode: string | null;
  statusMessage: string | null;
  errors: { code?: string; message: string; field?: string }[];
  contingency: boolean;
  files: { xml: boolean; pdf: boolean; pdfMime: string | null; cancelXml: boolean };
  consultUrl: string | null;
  qrCodeUrl: string | null;
  delivery: { channel: string; status: string; to: string; actionUrl?: string | null; at: string }[];
  /** Até quando dá para cancelar (null = não cancelável agora). */
  cancelUntil: string | null;
  issues: ValidationIssue[];
  events: DocumentEvent[];
  corrections: Correction[];
  createdAt: string;
}

export interface DocumentSummary {
  id: string;
  type: DocType;
  environment: FiscalEnvironment;
  status: DocStatus;
  series: string | null;
  number: number | null;
  sourceType: SourceType;
  sourceLabel: string | null;
  recipientName: string | null;
  total: number;
  statusMessage: string | null;
  contingency: boolean;
  issuedAt: string | null;
  createdAt: string;
}

export const documentListQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(docTypes).optional(),
  status: z.enum(docStatuses).optional(),
  sourceType: z.enum(sourceTypes).optional(),
  sourceId: z.string().max(100).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type DocumentListQuery = z.infer<typeof documentListQuery>;

// ---- Origens (vendas, atendimentos e ordens vindos dos eventos) ------------------------------------

export interface FiscalSource {
  id: string;
  sourceType: Exclude<SourceType, 'manual'>;
  sourceId: string;
  label: string;
  customer: { id: string; name: string } | null;
  occurredAt: string;
  total: number;
  /** pending: ainda não pode emitir (ex.: atendimento não quitado); ready: pode; cancelled: a origem foi cancelada. */
  status: 'pending' | 'ready' | 'cancelled';
  suggestedType: DocType;
  document: { id: string; status: DocStatus; type: DocType; number: number | null } | null;
  autoError: string | null;
}

export const sourceListQuery = z.object({
  status: z.enum(['pending', 'ready', 'cancelled', 'all']).default('ready'),
  sourceType: z.enum(['sale', 'appointment', 'service_order']).optional(),
  /** Só as que ainda não têm nota autorizada/enviada. */
  withoutDocument: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ---- Relatórios -----------------------------------------------------------------------------------

export const periodQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(docTypes).optional(),
  environment: z.enum(environments).optional(),
});
export type PeriodQuery = z.infer<typeof periodQuery>;

export interface ReportRow {
  type: DocType;
  status: DocStatus;
  count: number;
  total: number;
  iss: number;
  issWithheld: number;
  icms: number;
  pis: number;
  cofins: number;
  retentions: number;
  ibs: number;
  cbs: number;
}

export interface FiscalReport {
  from: string;
  to: string;
  rows: ReportRow[];
  /** Só autorizadas (as canceladas não somam). */
  totals: Omit<ReportRow, 'type' | 'status'>;
  gaps: { type: DocType; series: string; numbers: number[] }[];
}

export interface VoidRecord {
  id: string;
  type: 'nfce' | 'nfe';
  environment: FiscalEnvironment;
  series: string;
  from: number;
  to: number;
  reason: string;
  status: 'authorized' | 'rejected';
  message: string | null;
  protocol: string | null;
  createdAt: string;
}

// ---- Eventos ----------------------------------------------------------------------------------------

/** Publicado a cada mudança de status de uma nota (outros módulos podem reagir). */
export const DOCUMENT_UPDATED = 'integration.fiscal.document_updated';
/** Internos: transmissão ao provedor e envio ao cliente, pelo outbox. */
export const TRANSMIT = 'integration.fiscal.transmit';
export const DELIVER = 'integration.fiscal.deliver';

export interface DocumentUpdated {
  documentId: string;
  type: DocType;
  status: DocStatus;
  sourceType: SourceType;
  sourceId: string | null;
  number: number | null;
}

/*
 * Eventos dos módulos de origem que este módulo consome. A integração não importa os módulos
 * shared (regra de camadas): o contrato é o nome do evento e o formato do payload, repetidos aqui.
 * Quem publica: shared.sales (sales.service.ts), shared.scheduling (scheduling.service.ts) e
 * shared.service-orders (service-orders.service.ts).
 */
export const SALE_COMPLETED = 'shared.sales.sale_completed';
export const SALE_CANCELLED = 'shared.sales.sale_cancelled';
export const APPOINTMENT_PAYMENT = 'shared.scheduling.payment_recorded';
export const APPOINTMENT_STATUS = 'shared.scheduling.status_changed';
export const ORDER_STATUS = 'shared.service-orders.status_changed';

export interface SaleCompletedEvent {
  saleId: string;
  number: number;
  customerId: string | null;
  soldAt: string;
  subtotal: number;
  discount: number;
  total: number;
  items: { productId: string; name: string; unit: string; quantity: number; unitPrice: number; total: number }[];
  payments: { method: string; amount: number }[];
}
export interface SaleCancelledEvent {
  saleId: string;
  number: number;
  reason: string;
}
export interface AppointmentPaymentEvent {
  appointmentId: string;
  customerId: string;
  amount: number;
  method: string;
  paidAt: string;
  status: string;
  paymentStatus: 'pending' | 'partial' | 'paid';
  total: number;
  paidAmount: number;
  startsAt: string;
  professional: string;
  services: { serviceId: string | null; name: string; price: number }[];
}
export interface AppointmentStatusEvent {
  appointmentId: string;
  status: string;
  customerId: string;
}
export interface OrderStatusEvent {
  orderId: string;
  number: number;
  from: string;
  to: string;
  terminal: boolean;
  cancelled: boolean;
  customerId: string;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  paymentStatus: 'pending' | 'partial' | 'paid';
  items: { description: string; quantity: number; unitPrice: number; total: number; refType: string | null; refId: string | null }[];
}

/** Para a tela e a API: CPF/CNPJ só com os caracteres que contam. */
export const cleanDocument = (v: string | null | undefined) => (v ? v.replace(/[^\dA-Za-z]/g, '').toUpperCase() : null);
