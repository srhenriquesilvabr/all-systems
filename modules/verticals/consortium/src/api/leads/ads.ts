import { Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { LeadAssetType } from '../../contracts';

/**
 * Entradas de leads de anúncio. Tudo o que depende do formato das plataformas fica aqui, atrás de
 * funções pequenas, para trocar sem mexer no funil.
 *
 * Meta Lead Ads: um único webhook para o app da Palmer (campo `leadgen` das páginas inscritas). A
 * notificação traz só ids (página, formulário, anúncio, lead); os dados do lead são lidos depois
 * pela Graph API com o token da página da empresa. A confirmar com a Meta no cadastro do app:
 * permissões (`leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`),
 * revisão do app, versão da Graph API e a inscrição da página no app (`subscribed_apps`).
 *
 * Google Ads (formulário de lead): webhook por canal, com a chave configurada no formulário do
 * anúncio (`google_key`). O corpo traz `lead_id`, `user_column_data` e ids de campanha/formulário.
 * A confirmar com o Google: versão do payload e os `column_id` usados nos formulários da empresa.
 */

export const metaLeadsConfig = () => ({
  graphUrl: process.env.META_GRAPH_URL ?? 'https://graph.facebook.com/v21.0',
  /** Segredo do app na Meta: valida a assinatura (X-Hub-Signature-256) dos webhooks. */
  appSecret: process.env.META_APP_SECRET ?? '',
  /** Token combinado na configuração do webhook do app (verificação hub.challenge). */
  verifyToken: process.env.META_LEADS_VERIFY_TOKEN ?? '',
});

/** Dados de um lead já no nosso formato, vindos de qualquer plataforma. */
export interface AdLead {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  formId: string | null;
  adId: string | null;
  campaign: string | null;
  /** Respostas que não têm campo próprio (perguntas personalizadas do formulário). */
  extra: Record<string, string>;
  test: boolean;
}

/** Notificação `leadgen` do webhook da Meta (só ids). */
export interface MetaLeadNotice {
  pageId: string;
  leadgenId: string;
  formId: string | null;
  adId: string | null;
  createdTime: number | null;
}

/** Lê as notificações `leadgen` do corpo do webhook (entry[].changes[] com field = "leadgen"). */
export function metaNotices(body: unknown): MetaLeadNotice[] {
  const out: MetaLeadNotice[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries as { id?: unknown; changes?: { field?: unknown; value?: Record<string, unknown> }[] }[]) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen' || !change.value) continue;
      const v = change.value;
      const leadgenId = str(v.leadgen_id);
      const pageId = str(v.page_id) ?? str(entry.id);
      if (!leadgenId || !pageId) continue;
      out.push({ pageId, leadgenId, formId: str(v.form_id), adId: str(v.ad_id), createdTime: typeof v.created_time === 'number' ? v.created_time : null });
    }
  }
  return out;
}

/** Assinatura do webhook da Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo, segredo do app). */
export function validMetaSignature(raw: Buffer, header: string | undefined, secret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const received = Buffer.from(header.slice('sha256='.length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Comparação de chaves em tempo constante. */
export function sameKey(a: string, b: string) {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

/**
 * Converte o `field_data` da Meta. Campos padrão dos formulários instantâneos: full_name,
 * first_name, last_name, email, phone_number, city, state. Perguntas personalizadas vão para `extra`
 * (o nome delas é o que a empresa definiu no formulário — mapear um campo próprio, ex. valor da
 * carta, fica a confirmar com cada formulário).
 */
export function fromMetaLead(notice: Pick<MetaLeadNotice, 'leadgenId' | 'formId' | 'adId'>, lead: { field_data?: { name?: string; values?: unknown[] }[]; campaign_name?: string; ad_id?: string; form_id?: string; is_organic?: boolean }): AdLead {
  const fields = new Map<string, string>();
  for (const f of lead.field_data ?? []) {
    const v = f.values?.map((x) => String(x)).filter(Boolean).join(', ');
    if (f.name && v) fields.set(f.name.toLowerCase(), v);
  }
  const take = (k: string) => {
    const v = fields.get(k) ?? null;
    fields.delete(k);
    return v;
  };
  const first = take('first_name');
  const last = take('last_name');
  const name = take('full_name') ?? ([first, last].filter(Boolean).join(' ') || 'Lead sem nome');
  return {
    externalId: notice.leadgenId,
    name,
    phone: take('phone_number'),
    email: take('email')?.toLowerCase() ?? null,
    city: take('city'),
    state: take('state'),
    formId: lead.form_id ?? notice.formId,
    adId: lead.ad_id ?? notice.adId,
    campaign: lead.campaign_name ?? null,
    extra: Object.fromEntries(fields),
    test: false,
  };
}

/**
 * Converte o corpo do webhook do formulário de lead do Google Ads. `user_column_data` traz
 * `column_id` (FULL_NAME, FIRST_NAME, LAST_NAME, EMAIL, PHONE_NUMBER, CITY, REGION…) e o valor.
 */
export function fromGoogleLead(body: Record<string, unknown>): AdLead | null {
  const leadId = str(body.lead_id);
  if (!leadId) return null;
  const fields = new Map<string, string>();
  for (const c of (Array.isArray(body.user_column_data) ? body.user_column_data : []) as { column_id?: string; column_name?: string; string_value?: string }[]) {
    const key = (c.column_id ?? c.column_name ?? '').toUpperCase();
    if (key && c.string_value) fields.set(key, c.string_value.trim());
  }
  const take = (k: string) => {
    const v = fields.get(k) ?? null;
    fields.delete(k);
    return v;
  };
  const first = take('FIRST_NAME');
  const last = take('LAST_NAME');
  return {
    externalId: leadId,
    name: take('FULL_NAME') ?? ([first, last].filter(Boolean).join(' ') || 'Lead sem nome'),
    phone: take('PHONE_NUMBER'),
    email: take('EMAIL')?.toLowerCase() ?? null,
    city: take('CITY'),
    state: take('REGION'),
    formId: str(body.form_id),
    adId: str(body.creative_id),
    campaign: str(body.campaign_id) ? `Google Ads ${str(body.campaign_id)}` : null,
    extra: Object.fromEntries(fields),
    test: body.is_test === true,
  };
}

/** Chamada à Graph API da Meta. Isolada para ser trocada nos testes. */
@Injectable()
export class MetaGraphHttp {
  async get(url: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  }
}

/** Lê o lead pela Graph API (modo `api`) ou gera um de demonstração (modo `simulated`). */
@Injectable()
export class MetaLeadsAdapter {
  constructor(private readonly http: MetaGraphHttp) {}

  async fetch(mode: 'simulated' | 'api', notice: MetaLeadNotice, token: string | null): Promise<AdLead> {
    if (mode === 'simulated') return simulatedLead(notice.leadgenId, notice.formId, notice.adId);
    if (!token) throw new Error('Canal do Meta sem token da página');
    // Campos do objeto Lead a confirmar com a versão da Graph API em uso.
    const url = `${metaLeadsConfig().graphUrl}/${encodeURIComponent(notice.leadgenId)}?fields=created_time,field_data,ad_id,form_id,campaign_name,is_organic`;
    const res = await this.http.get(url, token);
    if (!res.ok) throw new Error(`Graph API respondeu HTTP ${res.status}${res.body?.error?.message ? `: ${res.body.error.message}` : ''}`);
    return fromMetaLead(notice, res.body ?? {});
  }
}

const FIRST = ['Ana', 'Bruno', 'Camila', 'Diego', 'Fernanda', 'Gustavo', 'Helena', 'Igor', 'Juliana', 'Marcos', 'Patrícia', 'Rafael'];
const LAST = ['Souza', 'Oliveira', 'Lima', 'Pereira', 'Costa', 'Almeida', 'Ribeiro', 'Martins'];
const CITIES = [
  ['São Paulo', 'SP'],
  ['Campinas', 'SP'],
  ['Curitiba', 'PR'],
  ['Belo Horizonte', 'MG'],
  ['Florianópolis', 'SC'],
] as const;

/** Lead de demonstração (dados fictícios, e-mail @example.com) a partir do id. */
export function simulatedLead(id: string, formId: string | null = null, adId: string | null = null): AdLead {
  const h = createHash('sha256').update(id).digest();
  const [city, state] = CITIES[h[3]! % CITIES.length]!;
  const name = `${FIRST[h[0]! % FIRST.length]} ${LAST[h[1]! % LAST.length]}`;
  return {
    externalId: id,
    name,
    phone: `+55119${String(60000000 + (h.readUInt32BE(4) % 39999999)).padStart(8, '0')}`,
    email: `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')}.${h.toString('hex').slice(0, 4)}@example.com`,
    city,
    state,
    formId,
    adId,
    campaign: 'Campanha de demonstração',
    extra: {},
    test: true,
  };
}

/** Tipo de bem citado nas respostas do formulário (ex.: "imóvel"), se houver. */
export function assetFromAnswers(extra: Record<string, string>): LeadAssetType | null {
  const text = Object.values(extra).join(' ').toLowerCase();
  if (/im[oó]v|casa|apartamento|terreno/.test(text)) return 'real_estate';
  if (/caminh|pesad|trator|ônibus|onibus/.test(text)) return 'heavy';
  if (/servi[cç]o|reforma|viagem|estudo/.test(text)) return 'services';
  if (/carro|auto|moto|ve[ií]culo/.test(text)) return 'vehicle';
  return null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
