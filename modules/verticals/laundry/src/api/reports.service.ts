import { TenantDb } from '@all/core';
import { customers, users } from '@all/core/schema';
import { soItems, soOrders } from '@all/service-orders/schema';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { LaundryReport } from '../contracts';
import { laundryItemDetails, laundryPieceEvents, laundryServices } from '../db/schema';
import { LAUNDRY_WORKFLOW, laundryWorkflow } from './workflow';

/** Datas do período (YYYY-MM-DD) interpretadas no fuso do negócio, com o dia final inteiro. */
const start = (date: string) => sql`(${date}::date)::timestamp at time zone 'America/Sao_Paulo'`;
const end = (date: string) => sql`((${date}::date + 1)::timestamp at time zone 'America/Sao_Paulo')`;

@Injectable()
export class LaundryReportsService {
  constructor(private readonly tdb: TenantDb) {}

  report(from: string, to: string): Promise<LaundryReport> {
    return this.tdb.run(async (tx) => {
      const laundry = eq(soOrders.workflow, LAUNDRY_WORKFLOW);
      const closedInRange = and(laundry, eq(soOrders.status, 'delivered'), gte(soOrders.closedAt, start(from)), lt(soOrders.closedAt, end(to)));
      const eventsInRange = and(gte(laundryPieceEvents.createdAt, start(from)), lt(laundryPieceEvents.createdAt, end(to)));

      const [delivered, overdue, events, byService, byOperator] = await Promise.all([
        tx
          .select({
            total: count(),
            withDueDate: sql<number>`count(*) filter (where ${soOrders.dueAt} is not null)::int`,
            onTime: sql<number>`count(*) filter (where ${soOrders.closedAt} <= ${soOrders.dueAt})::int`,
            avgHours: sql<string | null>`avg(extract(epoch from ${soOrders.closedAt} - ${soOrders.receivedAt}) / 3600)`,
          })
          .from(soOrders)
          .where(closedInRange),
        tx
          .select({ id: soOrders.id, number: soOrders.number, customerName: customers.name, dueAt: soOrders.dueAt, status: soOrders.status })
          .from(soOrders)
          .innerJoin(customers, eq(customers.id, soOrders.customerId))
          .where(and(laundry, sql`${soOrders.status} not in ('delivered', 'cancelled')`, lt(soOrders.dueAt, sql`now()`)))
          .orderBy(soOrders.dueAt)
          .limit(20),
        tx
          .select({
            ready: sql<number>`count(*) filter (where ${laundryPieceEvents.kind} = 'status' and ${laundryPieceEvents.toStatus} = 'ready')::int`,
            reworks: sql<number>`count(*) filter (where ${laundryPieceEvents.kind} = 'rework')::int`,
            incidents: sql<number>`count(*) filter (where ${laundryPieceEvents.kind} = 'incident')::int`,
          })
          .from(laundryPieceEvents)
          .where(eventsInRange),
        // Receita contratada no período (ordens recebidas no período, exceto canceladas).
        tx
          .select({
            serviceName: laundryServices.name,
            quantity: sql<string>`sum(${soItems.quantity})`,
            revenue: sql<string>`sum(${soItems.total})`,
          })
          .from(laundryItemDetails)
          .innerJoin(soItems, eq(soItems.id, laundryItemDetails.itemId))
          .innerJoin(soOrders, eq(soOrders.id, laundryItemDetails.orderId))
          .innerJoin(laundryServices, eq(laundryServices.id, laundryItemDetails.serviceId))
          .where(and(gte(soOrders.receivedAt, start(from)), lt(soOrders.receivedAt, end(to)), sql`${soOrders.status} <> 'cancelled'`))
          .groupBy(laundryServices.name)
          .orderBy(desc(sql`3`)),
        tx
          .select({ userName: sql<string>`coalesce(${users.name}, 'Sistema')`, moves: count() })
          .from(laundryPieceEvents)
          .leftJoin(users, eq(users.id, laundryPieceEvents.userId))
          .where(and(eventsInRange, sql`${laundryPieceEvents.kind} in ('status', 'rework')`))
          .groupBy(sql`1`)
          .orderBy(desc(sql`2`)),
      ]);

      const d = delivered[0]!;
      const statusLabel = (key: string) => laundryWorkflow.statuses.find((s) => s.key === key)?.label ?? key;
      return {
        period: { from, to },
        delivered: { total: d.total, onTime: d.onTime, withDueDate: d.withDueDate, avgHours: d.avgHours === null ? null : Math.round(Number(d.avgHours) * 10) / 10 },
        overdueOpen: overdue.map((o) => ({ ...o, dueAt: o.dueAt!.toISOString(), status: statusLabel(o.status) })),
        piecesReady: events[0]!.ready,
        reworks: events[0]!.reworks,
        incidents: events[0]!.incidents,
        byService: byService.map((s) => ({ serviceName: s.serviceName, quantity: Number(s.quantity), revenue: Number(s.revenue) })),
        byOperator,
      };
    });
  }
}
