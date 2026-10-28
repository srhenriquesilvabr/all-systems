import { AuditService, coreSchema, CustomerDataRegistry, CustomersService, ModuleSettingsService, TenantDb } from '@all/core';
import { uuidv7, type Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  bureauProviderLabel,
  consentText,
  CREDIT_BUREAU,
  maskDocument,
  parseDocument,
  queryPurposeLabel,
  type BureauProvider,
  type BureauStatus,
  type CreditQuery,
  type DecisionInput,
  type QueryInput,
} from '../contracts';
import { cbConsents, cbQueries } from '../db/schema';
import type { CreditBureauSettings } from '../manifest';
import { BoaVistaAdapter, BureauError, IMPLEMENTED_PROVIDERS, QuodAdapter, SerasaExperianAdapter, SimulatedBureau, type CreditBureauAdapter } from './providers';

type QueryRow = typeof cbQueries.$inferSelect;
type ConsentRow = typeof cbConsents.$inferSelect;
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const monthStart = () => sql`date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`;
const queriedByUser = alias(coreSchema.users, 'cb_queried_by');
const decidedByUser = alias(coreSchema.users, 'cb_decided_by');
const recordedByUser = alias(coreSchema.users, 'cb_recorded_by');

/**
 * Consulta de crédito: grava a autorização do cliente, chama o birô (adaptador), guarda o resumo,
 * o custo e quem consultou, e registra a decisão (seguir/reprovar). Tudo vai para a auditoria.
 */
@Injectable()
export class CreditBureauService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly customerData: CustomerDataRegistry,
    private readonly simulated: SimulatedBureau,
    private readonly serasa: SerasaExperianAdapter,
    private readonly boaVista: BoaVistaAdapter,
    private readonly quod: QuodAdapter,
  ) {}

  onModuleInit() {
    this.customerData.register({
      moduleKey: CREDIT_BUREAU,
      export: async (tx, customerId) =>
        (await tx.select().from(cbQueries).where(eq(cbQueries.customerId, customerId))).map((q) => ({
          provider: q.provider,
          simulated: q.simulated,
          score: q.score,
          summary: q.summary,
          decision: q.decision,
          createdAt: q.createdAt,
        })),
      // A consulta e a autorização ficam (registro da operação e prova do consentimento); os dados pessoais saem.
      anonymize: async (tx, customerId) => {
        await tx.update(cbQueries).set({ document: '', subjectName: 'Anonimizado', summary: null }).where(eq(cbQueries.customerId, customerId));
        await tx.update(cbConsents).set({ document: '', subjectName: 'Anonimizado', evidence: null }).where(eq(cbConsents.customerId, customerId));
      },
    });
  }

  status(): Promise<BureauStatus> {
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const s = await this.settings.getInTx<CreditBureauSettings>(tx, CREDIT_BUREAU);
      const [tenant] = await tx.select({ name: coreSchema.tenants.name }).from(coreSchema.tenants).where(eq(coreSchema.tenants.id, tenantId));
      const month = await this.monthUsageInTx(tx);
      return {
        provider: s.provider,
        providerName: bureauProviderLabel[s.provider],
        simulated: s.provider === 'simulated',
        company: tenant?.name ?? '',
        costPerQueryPf: s.costPerQueryPf,
        costPerQueryPj: s.costPerQueryPj,
        monthlyLimit: s.monthlyLimit,
        suggestedMinScore: s.suggestedMinScore,
        month,
        adapterPending: !IMPLEMENTED_PROVIDERS.includes(s.provider),
      };
    });
  }

  /**
   * Consulta um CPF/CNPJ. Exige a autorização do cliente (gravada antes, com o texto exato); a
   * consulta que falha no birô também fica no histórico, com o erro.
   */
  async query(input: QueryInput): Promise<CreditQuery> {
    const { tenantId, userId } = requestContext.require();
    const doc = parseDocument(input.document);
    if (!doc) throw new BadRequestException({ code: 'INVALID_DOCUMENT', message: 'CPF ou CNPJ inválido' });
    if (input.consent.givenAt > localToday()) throw new BadRequestException({ code: 'CONSENT_IN_FUTURE', message: 'A data da autorização não pode ser no futuro' });

    const { s, company } = await this.tdb.run(async (tx) => {
      const s = await this.settings.getInTx<CreditBureauSettings>(tx, CREDIT_BUREAU);
      if (s.monthlyLimit) {
        const { count } = await this.monthUsageInTx(tx);
        if (count >= s.monthlyLimit) throw new HttpException({ code: 'MONTHLY_LIMIT', message: `Limite de ${s.monthlyLimit} consultas no mês atingido (configurações da consulta de crédito)` }, HttpStatus.TOO_MANY_REQUESTS);
      }
      if (input.customerId) {
        const c = await this.customers.findInTx(tx, input.customerId);
        if (!c || c.anonymizedAt) throw new BadRequestException({ code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado' });
      }
      const [tenant] = await tx.select({ name: coreSchema.tenants.name }).from(coreSchema.tenants).where(eq(coreSchema.tenants.id, tenantId));
      return { s, company: tenant?.name ?? '' };
    });

    const reference = uuidv7();
    let result: Awaited<ReturnType<CreditBureauAdapter['query']>> | null = null;
    let error: string | null = null;
    try {
      result = await this.adapter(s.provider).query({ provider: s.provider, baseUrl: s.baseUrl, clientId: s.clientId, clientSecret: s.clientSecret }, { document: doc.document, documentType: doc.type, purpose: input.purpose, reference });
    } catch (err) {
      if (err instanceof BureauError) error = err.message;
      else if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'TypeError') error = 'O birô não respondeu; tente de novo em alguns minutos';
      else throw err;
    }

    const id = await this.tdb.run(async (tx) => {
      const [consent] = await tx
        .insert(cbConsents)
        .values({
          tenantId,
          document: doc.document,
          documentType: doc.type,
          subjectName: input.subjectName,
          customerId: input.customerId ?? null,
          purpose: input.purpose,
          method: input.consent.method,
          givenAt: input.consent.givenAt,
          evidence: input.consent.evidence ?? null,
          text: consentText({ company, provider: s.provider, purpose: input.purpose, documentType: doc.type }),
          version: input.consent.version,
          recordedBy: userId,
        })
        .returning();
      const cost = result ? (doc.type === 'cpf' ? s.costPerQueryPf : s.costPerQueryPj) : 0;
      const [row] = await tx
        .insert(cbQueries)
        .values({
          id: reference,
          tenantId,
          consentId: consent!.id,
          document: doc.document,
          documentType: doc.type,
          subjectName: input.subjectName,
          customerId: input.customerId ?? null,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          provider: s.provider,
          simulated: s.provider === 'simulated',
          status: result ? 'done' : 'error',
          error,
          externalId: result?.externalId ?? null,
          score: result?.score ?? null,
          riskBand: result?.riskBand ?? null,
          summary: result?.summary ?? null,
          cost: cost.toFixed(2),
          queriedBy: userId,
        })
        .returning();
      await this.audit.log(tx, {
        action: 'credit_bureau.query',
        entity: 'cb_query',
        entityId: row!.id,
        data: { document: maskDocument(doc.document), provider: s.provider, purpose: input.purpose, status: row!.status, consentMethod: input.consent.method },
      });
      if (input.customerId && result) {
        await this.customers.addTimeline(tx, {
          customerId: input.customerId,
          moduleKey: CREDIT_BUREAU,
          type: 'credit.query',
          title: `Consulta de crédito (${bureauProviderLabel[s.provider]}) para ${queryPurposeLabel[input.purpose]}`,
          entity: 'cb_query',
          entityId: row!.id,
        });
      }
      return row!.id;
    });
    return this.get(id, false);
  }

  list(opts: { document?: string; customerId?: string; sourceType?: string; sourceId?: string; from?: string; to?: string }): Promise<CreditQuery[]> {
    const doc = opts.document ? parseDocument(opts.document)?.document ?? opts.document.replace(/\D/g, '') : undefined;
    return this.tdb.run(async (tx) => {
      const s = await this.settings.getInTx<CreditBureauSettings>(tx, CREDIT_BUREAU);
      const rows = await this.baseQuery(tx)
        .where(
          and(
            doc ? eq(cbQueries.document, doc) : undefined,
            opts.customerId ? eq(cbQueries.customerId, opts.customerId) : undefined,
            opts.sourceType ? eq(cbQueries.sourceType, opts.sourceType) : undefined,
            opts.sourceId ? eq(cbQueries.sourceId, opts.sourceId) : undefined,
            opts.from ? gte(cbQueries.createdAt, sql`(${opts.from}::date)::timestamp at time zone 'America/Sao_Paulo'`) : undefined,
            opts.to ? lt(cbQueries.createdAt, sql`((${opts.to}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`) : undefined,
          ),
        )
        .orderBy(desc(cbQueries.createdAt))
        .limit(200);
      return rows.map((r) => toQuery(r, s.suggestedMinScore));
    });
  }

  /** Detalhe da consulta. Abrir o resultado (dado pessoal) vai para a auditoria. */
  get(id: string, logView = true): Promise<CreditQuery> {
    return this.tdb.run(async (tx) => {
      const s = await this.settings.getInTx<CreditBureauSettings>(tx, CREDIT_BUREAU);
      const [row] = await this.baseQuery(tx).where(eq(cbQueries.id, id));
      if (!row) throw new NotFoundException({ code: 'QUERY_NOT_FOUND', message: 'Consulta não encontrada' });
      if (logView) await this.audit.log(tx, { action: 'credit_bureau.query.viewed', entity: 'cb_query', entityId: id });
      return toQuery(row, s.suggestedMinScore);
    });
  }

  /** Seguir com a venda ou reprovar, com observação. Pode ser revista (fica na auditoria). */
  decide(id: string, input: DecisionInput): Promise<CreditQuery> {
    const { userId } = requestContext.require();
    return this.tdb
      .run(async (tx) => {
        const [q] = await tx.select().from(cbQueries).where(eq(cbQueries.id, id)).for('update');
        if (!q) throw new NotFoundException({ code: 'QUERY_NOT_FOUND', message: 'Consulta não encontrada' });
        if (q.status !== 'done') throw new BadRequestException({ code: 'QUERY_FAILED', message: 'A consulta não teve resultado: consulte de novo antes de decidir' });
        await tx.update(cbQueries).set({ decision: input.decision, decisionNote: input.note ?? null, decidedBy: userId, decidedAt: new Date() }).where(eq(cbQueries.id, id));
        await this.audit.log(tx, { action: 'credit_bureau.decision', entity: 'cb_query', entityId: id, data: { from: q.decision, to: input.decision, note: input.note ?? null } });
      })
      .then(() => this.get(id, false));
  }

  /**
   * Para as verticais (ex.: venda da cota com análise obrigatória): a última consulta com resultado
   * deste documento nos últimos `days` dias, na transação de quem chama.
   */
  async latestForDocumentInTx(tx: Tx, document: string, days: number): Promise<{ id: string; decision: QueryRow['decision']; score: number | null; createdAt: Date } | null> {
    const doc = parseDocument(document)?.document;
    if (!doc) return null;
    const [row] = await tx
      .select({ id: cbQueries.id, decision: cbQueries.decision, score: cbQueries.score, createdAt: cbQueries.createdAt })
      .from(cbQueries)
      .where(and(eq(cbQueries.document, doc), eq(cbQueries.status, 'done'), gte(cbQueries.createdAt, sql`now() - make_interval(days => ${days})`)))
      .orderBy(desc(cbQueries.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** Últimas decisões por origem (ex.: leads de uma lista), para mostrar sem abrir cada consulta. */
  async decisionsForSourcesInTx(tx: Tx, sourceType: string, sourceIds: string[]) {
    if (!sourceIds.length) return new Map<string, { decision: QueryRow['decision']; score: number | null }>();
    const rows = await tx
      .select({ sourceId: cbQueries.sourceId, decision: cbQueries.decision, score: cbQueries.score, createdAt: cbQueries.createdAt })
      .from(cbQueries)
      .where(and(eq(cbQueries.sourceType, sourceType), inArray(cbQueries.sourceId, sourceIds), eq(cbQueries.status, 'done')))
      .orderBy(desc(cbQueries.createdAt));
    const out = new Map<string, { decision: QueryRow['decision']; score: number | null }>();
    for (const r of rows) if (r.sourceId && !out.has(r.sourceId)) out.set(r.sourceId, { decision: r.decision, score: r.score });
    return out;
  }

  private async monthUsageInTx(tx: Tx) {
    const [m] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number), cost: sql<number>`coalesce(sum(${cbQueries.cost}), 0)`.mapWith(Number) })
      .from(cbQueries)
      .where(and(gte(cbQueries.createdAt, monthStart()), eq(cbQueries.status, 'done')));
    return { count: m?.count ?? 0, cost: m?.cost ?? 0 };
  }

  private adapter(provider: BureauProvider): CreditBureauAdapter {
    switch (provider) {
      case 'serasa_experian':
        return this.serasa;
      case 'boa_vista':
        return this.boaVista;
      case 'quod':
        return this.quod;
      default:
        return this.simulated;
    }
  }

  private baseQuery(tx: Tx) {
    return tx
      .select({ q: cbQueries, c: cbConsents, queriedBy: queriedByUser.name, decidedBy: decidedByUser.name, recordedBy: recordedByUser.name })
      .from(cbQueries)
      .innerJoin(cbConsents, eq(cbConsents.id, cbQueries.consentId))
      .leftJoin(queriedByUser, eq(queriedByUser.id, cbQueries.queriedBy))
      .leftJoin(decidedByUser, eq(decidedByUser.id, cbQueries.decidedBy))
      .leftJoin(recordedByUser, eq(recordedByUser.id, cbConsents.recordedBy))
      .$dynamic();
  }
}

function toQuery(row: { q: QueryRow; c: ConsentRow; queriedBy: string | null; decidedBy: string | null; recordedBy: string | null }, suggestedMinScore: number): CreditQuery {
  const { q, c } = row;
  return {
    id: q.id,
    document: q.document,
    documentType: q.documentType,
    subjectName: q.subjectName,
    customerId: q.customerId,
    sourceType: q.sourceType,
    sourceId: q.sourceId,
    provider: q.provider,
    simulated: q.simulated,
    status: q.status,
    error: q.error,
    externalId: q.externalId,
    score: q.score,
    riskBand: q.riskBand,
    summary: q.summary,
    suggestedMinScore,
    cost: Number(q.cost),
    decision: q.decision,
    decisionNote: q.decisionNote,
    decidedBy: row.decidedBy,
    decidedAt: q.decidedAt?.toISOString() ?? null,
    queriedBy: row.queriedBy,
    createdAt: q.createdAt.toISOString(),
    consent: { purpose: c.purpose, method: c.method, givenAt: c.givenAt, evidence: c.evidence, text: c.text, version: c.version, recordedBy: row.recordedBy },
  };
}
