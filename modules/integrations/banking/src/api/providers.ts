import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  consortiumInstallment,
  monthlyFromYearly,
  quote,
  type Applicant,
  type ConnectionAdapter,
  type ConnectionMode,
  type ConsortiumPlanOffer,
  type ManualPlanInput,
  type CreditProduct,
  type Offer,
  type ProposalStatus,
  type SimulationInput,
} from '../contracts';

/** Conexão já decifrada, como os provedores a recebem. */
export interface ResolvedConnection {
  id: string;
  name: string;
  catalogKey: string | null;
  mode: ConnectionMode;
  adapter: ConnectionAdapter;
  products: CreditProduct[];
  baseUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  vehicleMonthlyRate: number;
  realEstateYearlyRate: number;
  tacFee: number;
  manualPlans: ManualPlanInput[];
}

export interface SubmitPayload {
  reference: string;
  product: CreditProduct;
  amount: number;
  termMonths: number;
  system?: 'price' | 'sac';
  applicant: Applicant;
  details: Record<string, unknown>;
  offer: Offer | null;
}

export interface StatusResult {
  status: ProposalStatus;
  message?: string | null;
  result?: Record<string, unknown>;
}

export interface BankProvider {
  simulate(c: ResolvedConnection, input: SimulationInput): Promise<Offer>;
  submit(c: ResolvedConnection, p: SubmitPayload): Promise<{ externalId: string } & StatusResult>;
  status(c: ResolvedConnection, externalId: string, p: SubmitPayload): Promise<StatusResult>;
  consortiumPlans(c: ResolvedConnection): Promise<ConsortiumPlanOffer[]>;
}

function offerFrom(c: ResolvedConnection, input: SimulationInput, q: ReturnType<typeof quote>): Offer {
  return {
    connectionId: c.id,
    institution: c.name,
    product: input.product,
    amount: input.amount,
    termMonths: input.termMonths,
    system: q.system,
    monthlyRate: q.monthlyRate,
    yearlyRate: q.yearlyRate,
    firstInstallment: q.firstInstallment,
    lastInstallment: q.lastInstallment,
    totalPaid: q.totalPaid,
    cetYearly: q.cetYearly,
    fees: q.fees,
  };
}

/**
 * Instituição simulada: taxas configuradas na conexão e decisão automática pela regra de
 * comprometimento de renda (parcela até 30% da renda declarada). Para demonstração,
 * treinamento e testes; não fala com banco nenhum.
 */
@Injectable()
export class SimulatedProvider implements BankProvider {
  async simulate(c: ResolvedConnection, input: SimulationInput): Promise<Offer> {
    const realEstate = input.product === 'real_estate_financing';
    const q = quote({
      amount: input.amount,
      termMonths: input.termMonths,
      monthlyRate: realEstate ? monthlyFromYearly(c.realEstateYearlyRate / 100) : c.vehicleMonthlyRate / 100,
      system: input.system ?? (realEstate ? 'sac' : 'price'),
      tac: c.tacFee,
      // Financiamento habitacional não tem IOF; o de veículo, sim.
      iof: !realEstate,
    });
    return offerFrom(c, input, q);
  }

  async submit(c: ResolvedConnection, p: SubmitPayload) {
    const externalId = `SIM-${createHash('sha256').update(`${c.id}:${p.reference}`).digest('hex').slice(0, 10).toUpperCase()}`;
    return { externalId, status: 'under_review' as const, message: 'Proposta recebida para análise (simulação)' };
  }

  async status(_c: ResolvedConnection, externalId: string, p: SubmitPayload): Promise<StatusResult> {
    if (p.product === 'consortium') {
      // Adesão: a administradora devolve grupo e cota.
      const n = parseInt(externalId.slice(4, 8), 16);
      return { status: 'approved', message: 'Adesão aceita (simulação)', result: { groupCode: `G${String(1000 + (n % 900)).padStart(4, '0')}`, quotaNumber: String((n % 400) + 1).padStart(3, '0') } };
    }
    const installment = p.offer?.firstInstallment ?? 0;
    const income = p.applicant.monthlyIncome ?? 0;
    if (!income || installment > income * 0.3) {
      return { status: 'rejected', message: 'Parcela acima de 30% da renda declarada (simulação)', result: { maxInstallment: Math.round(income * 0.3 * 100) / 100 } };
    }
    return { status: 'approved', message: 'Crédito aprovado (simulação)', result: { approvedAmount: p.amount, firstInstallment: installment } };
  }

  async consortiumPlans(c: ResolvedConnection): Promise<ConsortiumPlanOffer[]> {
    const plan = (assetType: ConsortiumPlanOffer['assetType'], name: string, creditValue: number, termMonths: number, adminFeePercent: number): ConsortiumPlanOffer => ({
      externalId: `${c.id.slice(0, 8)}-${assetType}-${creditValue}-${termMonths}`,
      name,
      assetType,
      creditValue,
      termMonths,
      adminFeePercent,
      reserveFundPercent: 2,
      insurancePercent: 0.03,
    });
    return [
      plan('vehicle', 'Auto 60 mil', 60_000, 60, 15),
      plan('vehicle', 'Auto 100 mil', 100_000, 80, 16),
      plan('heavy', 'Pesados 300 mil', 300_000, 100, 14),
      plan('real_estate', 'Imóvel 250 mil', 250_000, 180, 18),
      plan('real_estate', 'Imóvel 500 mil', 500_000, 200, 17),
      plan('services', 'Serviços 20 mil', 20_000, 40, 20),
    ];
  }
}

/**
 * Instituição sem API (modo `manual`): a equipe envia a proposta pelo portal da administradora e
 * registra aqui a resposta (`BankingService.registerManual`). Simulação de financiamento usa as
 * taxas de referência da conexão; os planos de consórcio são os cadastrados na conexão.
 */
@Injectable()
export class ManualProvider implements BankProvider {
  constructor(private readonly simulated: SimulatedProvider) {}

  simulate(c: ResolvedConnection, input: SimulationInput): Promise<Offer> {
    return this.simulated.simulate(c, input);
  }

  async submit(c: ResolvedConnection, p: SubmitPayload) {
    // Protocolo local até a equipe informar o da administradora.
    const externalId = `MAN-${createHash('sha256').update(`${c.id}:${p.reference}`).digest('hex').slice(0, 10).toUpperCase()}`;
    return { externalId, status: 'submitted' as const, message: 'Registrada para envio manual: envie pelo portal da instituição e registre a resposta aqui' };
  }

  /** Não há onde consultar: o status só muda pelo registro da equipe. */
  async status(): Promise<StatusResult> {
    throw new Error('Conexão manual não tem consulta de status');
  }

  async consortiumPlans(c: ResolvedConnection): Promise<ConsortiumPlanOffer[]> {
    return c.manualPlans.map((p) => ({
      externalId: p.externalId || `${p.assetType}-${p.creditValue}-${p.termMonths}-${p.name}`.slice(0, 60),
      name: p.name,
      assetType: p.assetType,
      creditValue: p.creditValue,
      termMonths: p.termMonths,
      adminFeePercent: p.adminFeePercent,
      reserveFundPercent: p.reserveFundPercent ?? 0,
      insurancePercent: p.insurancePercent ?? 0,
    }));
  }
}

/** Chamadas HTTP às APIs das instituições. Isolada para ser trocada nos testes. */
@Injectable()
export class BankHttp {
  async request(method: 'GET' | 'POST', url: string, opts: { token?: string; form?: Record<string, string>; json?: unknown; basic?: string } = {}) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.basic) headers.Authorization = `Basic ${opts.basic}`;
    let body: string | undefined;
    if (opts.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20_000) });
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as any };
  }
}

/**
 * API REST de uma instituição (ou de um integrador que fala com várias), autenticada por
 * OAuth2 client credentials. O contrato está em docs/arquitetura/10-integracao-bancaria.md;
 * quem não falar exatamente esse formato entra por um adaptador próprio com esta mesma interface.
 */
@Injectable()
export class RestProvider implements BankProvider {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly http: BankHttp) {}

  private async token(c: ResolvedConnection): Promise<string> {
    const cached = this.tokens.get(c.id);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    const basic = Buffer.from(`${c.clientId ?? ''}:${c.clientSecret ?? ''}`).toString('base64');
    const res = await this.http.request('POST', `${c.baseUrl}/oauth/token`, { basic, form: { grant_type: 'client_credentials' } });
    if (!res.ok || !res.body.access_token) throw new BankApiError(c, 'autenticação', res.status);
    this.tokens.set(c.id, { token: res.body.access_token, expiresAt: Date.now() + Number(res.body.expires_in ?? 300) * 1000 });
    return res.body.access_token;
  }

  private async call(c: ResolvedConnection, method: 'GET' | 'POST', path: string, json?: unknown) {
    const res = await this.http.request(method, `${c.baseUrl}${path}`, { token: await this.token(c), json });
    if (!res.ok) throw new BankApiError(c, path, res.status, res.body?.message);
    return res.body;
  }

  async simulate(c: ResolvedConnection, input: SimulationInput): Promise<Offer> {
    const b = await this.call(c, 'POST', '/v1/simulations', input);
    return {
      connectionId: c.id,
      institution: c.name,
      product: input.product,
      amount: input.amount,
      termMonths: input.termMonths,
      system: b.system ?? input.system ?? 'price',
      monthlyRate: Number(b.monthlyRate),
      yearlyRate: Number(b.yearlyRate ?? (1 + Number(b.monthlyRate)) ** 12 - 1),
      firstInstallment: Number(b.firstInstallment),
      lastInstallment: Number(b.lastInstallment ?? b.firstInstallment),
      totalPaid: Number(b.totalPaid),
      cetYearly: Number(b.cetYearly),
      fees: { iof: Number(b.fees?.iof ?? 0), tac: Number(b.fees?.tac ?? 0) },
    };
  }

  async submit(c: ResolvedConnection, p: SubmitPayload) {
    const b = await this.call(c, 'POST', '/v1/proposals', p);
    return { externalId: String(b.id), status: normalizeStatus(b.status), message: b.message ?? null, result: b.result ?? {} };
  }

  async status(c: ResolvedConnection, externalId: string): Promise<StatusResult> {
    const b = await this.call(c, 'GET', `/v1/proposals/${encodeURIComponent(externalId)}`);
    return { status: normalizeStatus(b.status), message: b.message ?? null, result: b.result ?? {} };
  }

  async consortiumPlans(c: ResolvedConnection): Promise<ConsortiumPlanOffer[]> {
    const b = await this.call(c, 'GET', '/v1/consortium/plans');
    return (b.plans ?? b ?? []) as ConsortiumPlanOffer[];
  }
}

export class BankApiError extends Error {
  constructor(
    readonly connection: ResolvedConnection,
    readonly operation: string,
    readonly httpStatus: number,
    detail?: string,
  ) {
    super(`${connection.name}: falha em ${operation} (HTTP ${httpStatus})${detail ? `: ${detail}` : ''}`);
  }
}

/** Status da instituição → nosso vocabulário. Desconhecido conta como "em análise". */
export function normalizeStatus(s: unknown): ProposalStatus {
  const v = String(s ?? '').toLowerCase();
  if (['approved', 'aprovada', 'aprovado'].includes(v)) return 'approved';
  if (['rejected', 'denied', 'recusada', 'reprovada', 'negada'].includes(v)) return 'rejected';
  if (['cancelled', 'canceled', 'cancelada'].includes(v)) return 'cancelled';
  if (['contracted', 'signed', 'contratada', 'paid', 'liberada'].includes(v)) return 'contracted';
  if (['submitted', 'received', 'enviada', 'recebida'].includes(v)) return 'submitted';
  return 'under_review';
}

/** Para a tela de demonstração: parcela de consórcio sem chamar a administradora. */
export { consortiumInstallment };
