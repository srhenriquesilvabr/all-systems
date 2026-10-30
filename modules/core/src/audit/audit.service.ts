import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { auditLogs, users } from '../db/schema';
import { TenantDb } from '../db/tenant-db';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  data?: unknown;
  /** Só para operações fora de requisição (CLI, provisionamento). */
  tenantId?: string;
  userId?: string | null;
}

export interface AuditFilters {
  limit: number;
  before?: Date;
  /** Período em dias (AAAA-MM-DD), no fuso de São Paulo. */
  from?: string;
  to?: string;
  action?: string;
  /** Id do usuário ou "system" (ações automáticas, sem usuário). */
  userId?: string;
  /** Busca no código da ação, no tipo e no id do registro e nos detalhes gravados. */
  q?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly tdb: TenantDb) {}

  /** Grava na mesma transação da alteração: se ela falhar, o registro de auditoria também some. */
  async log(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = requestContext.get();
    const tenantId = entry.tenantId ?? ctx.tenantId;
    if (!tenantId) throw new Error('Auditoria sem tenant');
    await tx.insert(auditLogs).values({
      tenantId,
      userId: entry.userId === undefined ? (ctx.userId ?? null) : entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      data: entry.data ?? null,
      ip: ctx.ip,
    });
  }

  list(opts: AuditFilters) {
    return this.tdb.run((tx) =>
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entity: auditLogs.entity,
          entityId: auditLogs.entityId,
          data: auditLogs.data,
          ip: auditLogs.ip,
          createdAt: auditLogs.createdAt,
          user: { id: users.id, name: users.name, email: users.email },
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(auditWhere(opts))
        .orderBy(desc(auditLogs.createdAt))
        .limit(opts.limit),
    );
  }

  /** O que preenche os filtros da tela: só as ações e as pessoas que já aparecem na trilha desta empresa. */
  filterOptions() {
    return this.tdb.run(async (tx) => {
      const [actions, people] = await Promise.all([
        tx.selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(asc(auditLogs.action)),
        tx
          .selectDistinct({ id: users.id, name: users.name, email: users.email })
          .from(auditLogs)
          .innerJoin(users, eq(users.id, auditLogs.userId))
          .orderBy(asc(users.name)),
      ]);
      return { actions: actions.map((a) => a.action), users: people };
    });
  }

  /** Histórico de um registro (lançamento, conta, folha…), do mais novo para o mais antigo. */
  forEntity(entity: string, entityId: string, limit = 100) {
    return this.tdb.run((tx) =>
      tx
        .select({ id: auditLogs.id, action: auditLogs.action, data: auditLogs.data, createdAt: auditLogs.createdAt, user: { id: users.id, name: users.name } })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(and(eq(auditLogs.entity, entity), eq(auditLogs.entityId, entityId)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit),
    );
  }
}

function auditWhere(f: AuditFilters): SQL | undefined {
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
  return and(
    f.before ? lt(auditLogs.createdAt, f.before) : undefined,
    // Dias no fuso do negócio, sem cortar o fim da noite do último dia.
    f.from ? sql`${auditLogs.createdAt} >= (${f.from}::date)::timestamp at time zone 'America/Sao_Paulo'` : undefined,
    f.to ? sql`${auditLogs.createdAt} < ((${f.to}::date) + 1)::timestamp at time zone 'America/Sao_Paulo'` : undefined,
    f.action ? eq(auditLogs.action, f.action) : undefined,
    f.userId === 'system' ? isNull(auditLogs.userId) : f.userId ? eq(auditLogs.userId, f.userId) : undefined,
    like ? or(ilike(auditLogs.action, like), ilike(auditLogs.entity, like), ilike(auditLogs.entityId, like), sql`${auditLogs.data}::text ilike ${like}`) : undefined,
  );
}
