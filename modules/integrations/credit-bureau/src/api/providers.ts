import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { bureauProviderLabel, type BureauProvider, type BureauSummary, type DocumentType, type QueryPurpose, type RiskBand } from '../contracts';

/** Configuração da empresa já decifrada, como os adaptadores a recebem. */
export interface BureauConfig {
  provider: BureauProvider;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface BureauRequest {
  document: string;
  documentType: DocumentType;
  purpose: QueryPurpose;
  /** Nosso id da consulta (para o birô, se ele aceitar uma referência). */
  reference: string;
}

export interface BureauResult {
  externalId: string | null;
  /** Score de 0 a 1000 (o adaptador converte a escala do birô, se for diferente). */
  score: number | null;
  riskBand: RiskBand | null;
  summary: BureauSummary;
}

/** Adaptador de um birô. O resto do módulo (consentimento, custo, histórico, decisão) não muda. */
export interface CreditBureauAdapter {
  query(c: BureauConfig, r: BureauRequest): Promise<BureauResult>;
}

/** Erro legível do birô (vira a mensagem da consulta com status "erro"). */
export class BureauError extends Error {}

/** Faixa de risco a partir do score (0 a 1000), a mesma para todos os birôs na tela. */
export function riskBandOf(score: number | null): RiskBand | null {
  if (score == null) return null;
  if (score >= 700) return 'low';
  if (score >= 500) return 'medium';
  if (score >= 300) return 'high';
  return 'very_high';
}

/**
 * Birô simulado: score e pendências gerados do documento (sempre o mesmo resultado para o mesmo
 * documento), para demonstração e treinamento. Não consulta ninguém.
 */
@Injectable()
export class SimulatedBureau implements CreditBureauAdapter {
  async query(_c: BureauConfig, r: BureauRequest): Promise<BureauResult> {
    const h = createHash('sha256').update(`bureau:${r.document}`).digest();
    const score = 150 + Math.round((h.readUInt16BE(0) / 65535) * 800);
    const negatives = score >= 650 ? 0 : score >= 450 ? 1 + (h[2]! % 2) : 2 + (h[2]! % 4);
    const protests = score >= 500 ? 0 : h[3]! % 3;
    const amount = (n: number, seed: number) => (n ? Math.round((n * (300 + (seed % 50) * 97)) * 100) / 100 : 0);
    return {
      externalId: `SIM-${h.toString('hex').slice(0, 10).toUpperCase()}`,
      score,
      riskBand: riskBandOf(score),
      summary: {
        negativeRecords: { count: negatives, totalAmount: amount(negatives, h[4]!) },
        protests: { count: protests, totalAmount: amount(protests, h[5]!) },
        bouncedChecks: score < 350 ? h[6]! % 2 : 0,
        alerts: score < 300 ? ['Várias pendências recentes (simulação)'] : [],
      },
    };
  }
}

/** Chamadas HTTP aos birôs. Isolada para ser trocada nos testes (e usada pelos adaptadores reais). */
@Injectable()
export class BureauHttp {
  async request(method: 'GET' | 'POST', url: string, opts: { headers?: Record<string, string>; json?: unknown; form?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
    let body: string | undefined;
    if (opts.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) });
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as unknown };
  }
}

/**
 * Esqueleto de um birô real. Os nomes de endpoints, a autenticação e os campos de retorno só chegam
 * com o contrato: até lá a consulta falha com "a confirmar" (nada é inventado). Ao implementar:
 *   1. autenticar (modelo do contrato) usando `BureauHttp` com `baseUrl`, `clientId` e `clientSecret`;
 *   2. chamar o produto contratado (score + pendências) para o CPF/CNPJ;
 *   3. mapear o retorno para `BureauResult` (score 0–1000, contagens e valores de negativações,
 *      protestos e cheques sem fundo) e guardar o protocolo em `externalId`;
 *   4. tratar "documento não encontrado" e indisponibilidade como `BureauError` com texto legível.
 */
abstract class PendingBureau implements CreditBureauAdapter {
  protected abstract readonly provider: Exclude<BureauProvider, 'simulated'>;
  /** O que falta confirmar com este birô (aparece no erro e na documentação). */
  protected abstract readonly pending: string[];

  constructor(protected readonly http: BureauHttp) {}

  async query(c: BureauConfig, _r: BureauRequest): Promise<BureauResult> {
    if (!c.baseUrl || !c.clientId || !c.clientSecret) throw new BureauError(`${bureauProviderLabel[this.provider]}: informe a URL e as credenciais do contrato nas configurações`);
    throw new BureauError(`${bureauProviderLabel[this.provider]}: adaptador ainda não implementado — a confirmar com o birô: ${this.pending.join('; ')}`);
  }
}

/** Serasa Experian. A confirmar no contrato: produto (score + pendências PF/PJ), autenticação e campos de retorno. */
@Injectable()
export class SerasaExperianAdapter extends PendingBureau {
  protected readonly provider = 'serasa_experian' as const;
  protected readonly pending = ['produto contratado e endpoint', 'modelo de autenticação', 'mapeamento do score e das pendências'];
  constructor(http: BureauHttp) {
    super(http);
  }
}

/** Boa Vista (Equifax). A confirmar no contrato: produto, autenticação e campos de retorno. */
@Injectable()
export class BoaVistaAdapter extends PendingBureau {
  protected readonly provider = 'boa_vista' as const;
  protected readonly pending = ['produto contratado e endpoint', 'modelo de autenticação', 'mapeamento do score e das pendências'];
  constructor(http: BureauHttp) {
    super(http);
  }
}

/** Quod. A confirmar no contrato: produto, autenticação e campos de retorno. */
@Injectable()
export class QuodAdapter extends PendingBureau {
  protected readonly provider = 'quod' as const;
  protected readonly pending = ['produto contratado e endpoint', 'modelo de autenticação', 'mapeamento do score e das pendências'];
  constructor(http: BureauHttp) {
    super(http);
  }
}

/** Birôs com adaptador já implementado (hoje nenhum real: só o simulado). */
export const IMPLEMENTED_PROVIDERS: BureauProvider[] = ['simulated'];
