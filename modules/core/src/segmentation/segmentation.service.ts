import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db';
import { ScheduledJobs } from '../events/jobs';
import { customers } from '../customers/schema';
import { customerFeatures } from './schema';

const MODULE = 'core.segmentation';

export type Segment = (typeof customerFeatures.$inferSelect)['segment'];

export interface SegmentSummary {
  segment: Segment;
  customers: number;
  monetary: number;
  avgRecencyDays: number;
}

export interface CustomerRfm {
  customer: { id: string; name: string; phone: string | null; email: string | null };
  segment: Segment;
  r: number;
  f: number;
  m: number;
  recencyDays: number;
  frequency: number;
  monetary: number;
  lastPurchaseOn: string;
  firstPurchaseOn: string;
}

/** Nota 1–5 pela posição relativa (percent_rank). Com um cliente só, nota neutra (3). */
const score = (column: ReturnType<typeof sql>) =>
  sql`(case when count(*) over () = 1 then 3 else least(5, 1 + floor(percent_rank() over (order by ${column}) * 5)) end)::int`;

@Injectable()
export class SegmentationService implements OnModuleInit {
  constructor(
    private readonly tdb: TenantDb,
    private readonly jobs: ScheduledJobs,
  ) {}

  onModuleInit() {
    // Uma vez por dia basta: os segmentos mudam devagar. "Recalcular agora" existe na tela.
    this.jobs.every('core.segmentation', 24 * 60 * 60_000, () => this.recomputeAll());
  }

  async recomputeAll() {
    for (const tenantId of await this.jobs.tenantsWithModule(MODULE)) {
      await requestContext.run({ tenantId }, () => this.tdb.run((tx) => this.recomputeInTx(tx, tenantId)));
    }
  }

  recompute() {
    const { tenantId } = requestContext.requireTenant();
    return this.tdb.run(async (tx) => {
      await this.recomputeInTx(tx, tenantId);
      return this.summaryInTx(tx);
    });
  }

  /**
   * RFM com regras (etapa 1 da clusterização): notas de 1 a 5 pela posição dentro da empresa
   * (empates ficam na mesma nota) e segmento por regra fixa, explicável ao dono do negócio.
   * Frequência conta origens distintas: as 3 parcelas de um pacote são uma compra só.
   */
  private async recomputeInTx(tx: Tx, tenantId: string) {
    await tx.execute(sql`
      with today as (select (now() at time zone 'America/Sao_Paulo')::date as d),
      paid as (
        select customer_id, source_type, coalesce(source_id, id::text) as source, paid_at, amount
        from fin_entries
        where kind = 'income' and status = 'paid' and customer_id is not null and paid_at is not null
      ),
      agg as (
        select customer_id,
          min(paid_at) as first_on,
          max(paid_at) as last_on,
          count(distinct (source_type, source)) filter (where paid_at > (select d from today) - 365) as frequency,
          coalesce(sum(amount) filter (where paid_at > (select d from today) - 365), 0) as monetary
        from paid
        group by customer_id
      ),
      scored as (
        select agg.*,
          ((select d from today) - last_on) as recency_days,
          ${score(sql`last_on`)} as r,
          ${score(sql`frequency`)} as f,
          ${score(sql`monetary`)} as m
        from agg
      ),
      upserted as (
        insert into customer_features
          (tenant_id, customer_id, first_purchase_on, last_purchase_on, recency_days, frequency, monetary, r, f, m, segment, computed_at)
        select ${tenantId}, customer_id, first_on, last_on, recency_days, frequency, monetary, r, f, m,
          case
            when r >= 4 and f >= 4 and m >= 4 then 'champions'
            when r <= 2 and f >= 3 then 'at_risk'
            when f >= 4 then 'loyal'
            when r >= 4 and frequency <= 1 and first_on > (select d from today) - 60 then 'new'
            when r >= 3 then 'promising'
            when r = 2 then 'hibernating'
            else 'lost'
          end,
          now()
        from scored
        on conflict (tenant_id, customer_id) do update set
          first_purchase_on = excluded.first_purchase_on,
          last_purchase_on = excluded.last_purchase_on,
          recency_days = excluded.recency_days,
          frequency = excluded.frequency,
          monetary = excluded.monetary,
          r = excluded.r, f = excluded.f, m = excluded.m,
          segment = excluded.segment,
          computed_at = excluded.computed_at
        returning customer_id
      )
      -- Quem não tem mais recebimento (ex.: lançamentos cancelados) sai da segmentação.
      delete from customer_features
      where tenant_id = ${tenantId} and customer_id not in (select customer_id from upserted)`);
  }

  summary() {
    return this.tdb.run((tx) => this.summaryInTx(tx));
  }

  private async summaryInTx(tx: Tx) {
    const [segments, totals] = await Promise.all([
      tx
        .select({
          segment: customerFeatures.segment,
          customers: sql<number>`count(*)::int`,
          monetary: sql<string>`sum(${customerFeatures.monetary})`,
          avgRecencyDays: sql<number>`round(avg(${customerFeatures.recencyDays}))::int`,
        })
        .from(customerFeatures)
        .groupBy(customerFeatures.segment),
      tx
        .select({
          customers: sql<number>`(select count(*)::int from ${customers} where ${customers.anonymizedAt} is null)`,
          segmented: sql<number>`(select count(*)::int from ${customerFeatures})`,
          computedAt: sql<string | null>`(select max(${customerFeatures.computedAt}) from ${customerFeatures})`,
        })
        .from(sql`(select 1) as one`),
    ]);
    const t = totals[0]!;
    return {
      segments: segments.map((s) => ({ segment: s.segment, customers: s.customers, monetary: Number(s.monetary), avgRecencyDays: s.avgRecencyDays })) as SegmentSummary[],
      customers: t.customers,
      withoutPurchases: t.customers - t.segmented,
      computedAt: t.computedAt ? new Date(t.computedAt).toISOString() : null,
    };
  }

  list(opts: { segment?: Segment; limit: number }): Promise<CustomerRfm[]> {
    return this.tdb.run(async (tx) => {
      const rows = await tx
        .select({ f: customerFeatures, customer: { id: customers.id, name: customers.name, phone: customers.phone, email: customers.email } })
        .from(customerFeatures)
        .innerJoin(customers, eq(customers.id, customerFeatures.customerId))
        .where(opts.segment ? eq(customerFeatures.segment, opts.segment) : undefined)
        .orderBy(desc(customerFeatures.monetary), asc(customers.name))
        .limit(opts.limit);
      return rows.map(({ f, customer }) => ({
        customer,
        segment: f.segment,
        r: f.r,
        f: f.f,
        m: f.m,
        recencyDays: f.recencyDays,
        frequency: f.frequency,
        monetary: Number(f.monetary),
        lastPurchaseOn: f.lastPurchaseOn,
        firstPurchaseOn: f.firstPurchaseOn,
      }));
    });
  }

  ofCustomer(customerId: string) {
    return this.tdb.run(async (tx) => {
      const [row] = await tx.select().from(customerFeatures).where(and(eq(customerFeatures.customerId, customerId)));
      return row ? { segment: row.segment, r: row.r, f: row.f, m: row.m, recencyDays: row.recencyDays, frequency: row.frequency, monetary: Number(row.monetary) } : null;
    });
  }
}
