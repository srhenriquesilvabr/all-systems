import { z } from 'zod';

// Captação de clientes do consórcio: leads (simulador público, Meta, Google, planilha, manual,
// indicação), funil, tarefas de retorno, indicação premiada e relatório de conversão.

export const leadAssetTypes = ['vehicle', 'real_estate', 'heavy', 'services'] as const;
export type LeadAssetType = (typeof leadAssetTypes)[number];
/** Rótulo no singular, para frases ("consórcio de imóvel"). */
export const leadAssetLabel: Record<LeadAssetType, string> = { vehicle: 'auto', real_estate: 'imóvel', heavy: 'pesados', services: 'serviços' };

export const leadStatuses = ['new', 'contacting', 'simulation_sent', 'proposal', 'won', 'lost'] as const;
export type LeadStatus = (typeof leadStatuses)[number];
export const leadStatusLabel: Record<LeadStatus, string> = {
  new: 'Novo',
  contacting: 'Em contato',
  simulation_sent: 'Simulação enviada',
  proposal: 'Proposta',
  won: 'Venda',
  lost: 'Perdido',
};
/** Etapas em aberto (colunas do funil antes do desfecho). */
export const openLeadStatuses: LeadStatus[] = ['new', 'contacting', 'simulation_sent', 'proposal'];

export const leadSources = ['simulator', 'meta', 'google', 'import', 'manual', 'referral'] as const;
export type LeadSource = (typeof leadSources)[number];
export const leadSourceLabel: Record<LeadSource, string> = {
  simulator: 'Simulador do site',
  meta: 'Meta (Facebook/Instagram)',
  google: 'Google Ads',
  import: 'Planilha',
  manual: 'Cadastro manual',
  referral: 'Indicação',
};

export const contactBases = ['form_consent', 'requested_contact', 'existing_customer'] as const;
export type ContactBasis = (typeof contactBases)[number];
export const contactBasisLabel: Record<ContactBasis, string> = {
  form_consent: 'Aceite no formulário (site ou anúncio)',
  requested_contact: 'Pediu contato (balcão, telefone, evento)',
  existing_customer: 'Já é cliente da empresa',
};

export const lostReasons = ['Sem interesse no momento', 'Parcela não cabe no orçamento', 'Fechou com outra empresa', 'Não atende / contato inválido', 'Crédito reprovado', 'Prefere financiamento'];

export const rewardStatuses = ['none', 'waiting', 'due', 'paid', 'cancelled', 'reversed'] as const;
export type RewardStatus = (typeof rewardStatuses)[number];
export const rewardStatusLabel: Record<RewardStatus, string> = { none: '—', waiting: 'Aguardando a venda', due: 'A pagar', paid: 'Paga', cancelled: 'Cancelada', reversed: 'Estornada' };

/** Aviso exibido nas telas de captação sobre o uso legal (LGPD) dos dados e das plataformas. */
export const LEGAL_NOTICE =
  'O sistema não compra, não raspa e não cruza listas de pessoas. Leads entram só por quem pediu contato: simulador, formulários de anúncio, indicação ou cadastro feito pela equipe com base no pedido do cliente. Públicos de interesse e semelhantes (lookalike) são configurados nas próprias plataformas de anúncio (Meta, Google), que seguem as regras delas. Não é permitido buscar quem tem ou já teve carta de consórcio: é informação protegida por sigilo bancário (LC 105/2001) e pela LGPD.';

const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Data/hora inválida');
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const uf = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'UF inválida (ex.: SP)')
  .nullish()
  .or(z.literal(''))
  .transform((v) => v || null);
const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v.replace(/\D/g, '').length >= 10, 'Informe o telefone com DDD');
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('E-mail inválido')
  .max(254);

/** Cadastro manual e importação por planilha. */
export const leadInput = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome').max(120),
    phone: phone.nullish().or(z.literal('')).transform((v) => v || null),
    email: email.nullish().or(z.literal('')).transform((v) => v || null),
    city: text(80),
    state: uf,
    assetType: z.enum(leadAssetTypes).nullish(),
    creditValue: z.coerce.number().positive().max(100_000_000).nullish(),
    termMonths: z.coerce.number().int().min(1).max(420).nullish(),
    source: z.enum(['manual', 'import']).default('manual'),
    contactBasis: z.enum(contactBases).default('requested_contact'),
    campaign: text(120),
    notes: text(2000),
    /** Sem informar: distribuição automática (se ligada) ou fica sem vendedor. */
    sellerId: z.string().uuid().nullish(),
    /** Indicação registrada à mão (quem indicou). */
    referrerId: z.string().uuid().nullish(),
  })
  .refine((l) => l.phone || l.email, { message: 'Informe o telefone ou o e-mail', path: ['phone'] });
export type LeadInput = z.infer<typeof leadInput>;

export const leadPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phone.nullish().or(z.literal('')).transform((v) => v || null),
  email: email.nullish().or(z.literal('')).transform((v) => v || null),
  city: text(80),
  state: uf,
  assetType: z.enum(leadAssetTypes).nullish(),
  creditValue: z.coerce.number().positive().max(100_000_000).nullish(),
  termMonths: z.coerce.number().int().min(1).max(420).nullish(),
  campaign: text(120),
  notes: text(2000),
});
export type LeadPatch = z.infer<typeof leadPatch>;

/** "Venda" não entra aqui: o lead vira venda quando a adesão da cota ligada a ele é aceita. */
export const leadStatusInput = z
  .object({
    status: z.enum(['new', 'contacting', 'simulation_sent', 'proposal', 'lost']),
    lostReason: z.string().trim().max(200).nullish(),
  })
  .refine((s) => s.status !== 'lost' || s.lostReason, { message: 'Informe o motivo da perda', path: ['lostReason'] });
export type LeadStatusInput = z.infer<typeof leadStatusInput>;

export const leadAssignInput = z.object({ sellerId: z.string().uuid().nullable() });
export const leadNoteInput = z.object({ text: z.string().trim().min(1).max(2000) });
export const leadTaskInput = z.object({
  title: z.string().trim().min(2).max(200),
  dueAt: isoDateTime,
  assignedTo: z.string().uuid().nullish(),
});
export type LeadTaskInput = z.infer<typeof leadTaskInput>;

export const rewardInput = z.object({
  status: z.enum(['due', 'paid', 'cancelled']),
  amount: z.coerce.number().min(0).max(1_000_000).nullish(),
  /** Conta da baixa ao marcar paga; sem informar, a conta padrão do financeiro. */
  accountId: z.string().uuid().nullish(),
});

export const referrerInput = z
  .object({
    kind: z.enum(['customer', 'seller']),
    customerId: z.string().uuid().nullish(),
    userId: z.string().uuid().nullish(),
  })
  .refine((r) => (r.kind === 'customer' ? !!r.customerId : !!r.userId), { message: 'Escolha quem indica', path: ['customerId'] });

/** Canal de anúncio (Meta Lead Ads ou formulário de lead do Google Ads). */
export const channelInput = z
  .object({
    kind: z.enum(['meta', 'google']),
    name: z.string().trim().min(2).max(80),
    mode: z.enum(['simulated', 'api']).default('simulated'),
    pageId: z
      .string()
      .trim()
      .regex(/^\d{5,30}$/, 'Id da página: só números')
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || null),
    formIds: z.array(z.string().trim().regex(/^\d{5,30}$/, 'Id do formulário: só números')).max(30).default([]),
    /** Vazio = mantém o atual. */
    accessToken: z.string().trim().max(1000).nullish(),
    /** Google: vazio = mantém a atual (ou gera uma ao criar). */
    webhookKey: z.string().trim().max(200).nullish(),
    assetType: z.enum(leadAssetTypes).nullish(),
    active: z.boolean().default(true),
  })
  .refine((c) => c.kind !== 'meta' || c.pageId, { message: 'Informe o id da página do Facebook', path: ['pageId'] });
export type ChannelInput = z.infer<typeof channelInput>;

/** Simulador público: o que o visitante envia (JSON). */
export const publicLeadInput = z.object({
  name: z.string().trim().min(3, 'Informe o nome completo').max(120),
  phone,
  email: email.nullish().or(z.literal('')).transform((v) => v || null),
  city: z.string().trim().min(2, 'Informe a cidade').max(80),
  state: uf,
  assetType: z.enum(leadAssetTypes),
  creditValue: z.coerce.number().positive().max(100_000_000),
  termMonths: z.coerce.number().int().min(1).max(420),
  consent: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar o uso dos dados para receber o contato' }) }),
  consentVersion: z.string().max(20),
  /** Código do link de indicação (?ind=). */
  ref: z.string().trim().max(20).nullish(),
  /** utm_*, gclid, fbclid lidos do endereço da página. */
  utm: z.record(z.string().max(200)).default({}),
  /** Armadilha para robôs: campo escondido que pessoas não preenchem. */
  website: z.string().max(500).optional(),
  /** Quando o formulário foi aberto (ms): envio rápido demais é de robô. */
  startedAt: z.coerce.number().optional(),
});
export type PublicLeadInput = z.infer<typeof publicLeadInput>;

/** Chaves de atribuição aceitas do endereço da página. */
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

export const LEAD_CONSENT_VERSION = 'v1';

/** Texto do aceite no simulador (guardado com o lead). */
export function leadConsentText(o: { company: string; retentionMonths: number; privacyEmail: string | null }): string {
  const contact = o.privacyEmail ? ` pelo e-mail ${o.privacyEmail}` : ' pelos canais da empresa';
  return [
    `Autorizo ${o.company} a usar meu nome, telefone, e-mail e cidade para entrar em contato comigo (telefone, WhatsApp ou e-mail) sobre esta simulação de consórcio e me apresentar propostas.`,
    'Meus dados não serão vendidos nem repassados para outras finalidades; podem ser compartilhados com a administradora do consórcio só se eu decidir contratar.',
    `Se eu não contratar, os dados ficam guardados por até ${o.retentionMonths} meses e então são anonimizados.`,
    `Posso pedir acesso, correção ou exclusão dos meus dados, ou revogar esta autorização, a qualquer momento${contact}.`,
  ].join(' ');
}

/** Perfil de taxa de um plano (sem o nome da administradora), para o simulador público. */
export interface PlanProfile {
  assetType: LeadAssetType;
  termMonths: number;
  adminFeePercent: number;
  reserveFundPercent: number;
  insurancePercent: number;
  minCredit: number;
  maxCredit: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Parcela estimada para o crédito e prazo escolhidos, pelos planos cadastrados do mesmo tipo e
 * prazo (o mais próximo, se não houver o exato): menor e maior parcela entre eles.
 */
export function estimateInstallment(profiles: PlanProfile[], assetType: LeadAssetType, credit: number, termMonths: number): { min: number; max: number; termMonths: number } | null {
  const same = profiles.filter((p) => p.assetType === assetType);
  if (!same.length || !(credit > 0)) return null;
  const nearest = same.reduce((best, p) => (Math.abs(p.termMonths - termMonths) < Math.abs(best - termMonths) ? p.termMonths : best), same[0]!.termMonths);
  const values = same
    .filter((p) => p.termMonths === nearest)
    .map((p) => round2((credit * (1 + (p.adminFeePercent + p.reserveFundPercent) / 100)) / p.termMonths + (credit * p.insurancePercent) / 100));
  return { min: Math.min(...values), max: Math.max(...values), termMonths: nearest };
}

/** Simulador público: marca da empresa, linhas com faixa de crédito e prazos, e o texto do aceite. */
export interface PublicSimulator {
  company: { name: string; logoUrl: string | null; brandColor: string | null };
  lines: { assetType: LeadAssetType; minCredit: number; maxCredit: number; terms: number[] }[];
  profiles: PlanProfile[];
  consent: { version: string; text: string };
  /** Quem indicou (pelo ?ind=), para a página agradecer. */
  referrer: { name: string; reward: string | null } | null;
}

export interface LeadListItem {
  id: string;
  number: number;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  assetType: LeadAssetType | null;
  creditValue: number | null;
  termMonths: number | null;
  estimatedInstallment: number | null;
  source: LeadSource;
  campaign: string | null;
  status: LeadStatus;
  lostReason: string | null;
  statusChangedAt: string;
  seller: { id: string; name: string } | null;
  referrer: { id: string; name: string } | null;
  rewardStatus: RewardStatus;
  rewardAmount: number | null;
  quotaId: string | null;
  customerId: string | null;
  /** Próxima tarefa de retorno em aberto. */
  nextTask: { id: string; title: string; dueAt: string } | null;
  /** Última decisão da consulta de crédito deste lead (se o módulo estiver contratado). */
  credit: { decision: 'pending' | 'approved' | 'rejected'; score: number | null } | null;
  anonymized: boolean;
  createdAt: string;
}

export interface LeadTask {
  id: string;
  leadId: string;
  leadName: string;
  leadNumber: number;
  title: string;
  dueAt: string;
  assignedTo: { id: string; name: string } | null;
  doneAt: string | null;
}

export interface LeadDetail extends LeadListItem {
  utm: Record<string, string>;
  formId: string | null;
  adId: string | null;
  contactBasis: ContactBasis;
  consent: { version: string; text: string; acceptedAt: string } | null;
  notes: string | null;
  quota: { id: string; number: number; status: string; planName: string; institution: string } | null;
  events: { id: string; kind: string; text: string | null; user: string | null; createdAt: string }[];
  tasks: LeadTask[];
  /** Mensagem pronta para o WhatsApp (modelo das configurações já preenchido). */
  whatsappText: string;
}

export interface ConversionRow {
  key: string;
  label: string;
  total: number;
  /** Saíram de "novo" (alguém falou com a pessoa). */
  contacted: number;
  proposals: number;
  won: number;
  lost: number;
  /** Crédito das cotas vendidas a partir destes leads. */
  wonCredit: number;
  /** won / total, em %. */
  conversion: number;
}

export interface LeadsReport {
  from: string;
  to: string;
  totals: ConversionRow;
  bySource: ConversionRow[];
  bySeller: ConversionRow[];
  byCampaign: ConversionRow[];
  /** Por que os leads foram perdidos. */
  lostReasons: { reason: string; count: number }[];
}

export interface Referrer {
  id: string;
  code: string;
  kind: 'customer' | 'seller';
  name: string;
  customerId: string | null;
  userId: string | null;
  active: boolean;
  /** Endereço do link de indicação. */
  url: string;
  leads: number;
  won: number;
  rewardsDue: number;
  rewardsPaid: number;
}

export interface LeadChannel {
  id: string;
  kind: 'meta' | 'google';
  name: string;
  mode: 'simulated' | 'api';
  pageId: string | null;
  formIds: string[];
  hasAccessToken: boolean;
  hasWebhookKey: boolean;
  assetType: LeadAssetType | null;
  active: boolean;
  lastLeadAt: string | null;
  /** Endereço a configurar na plataforma (Google: por canal; Meta: o do app, único). */
  webhookUrl: string;
  leads: number;
}

/** Preenche o modelo de mensagem do WhatsApp ({{nome}}, {{vendedor}}, {{empresa}}, {{tipo}}, {{credito}}, {{prazo}}, {{parcela}}). */
export function fillWhatsappTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '').replace(/\s+([.,!?])/g, '$1').trim();
}
