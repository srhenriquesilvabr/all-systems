import type { Tx } from '@all/db';
import { requestContext } from '@all/module-sdk';
import { Injectable } from '@nestjs/common';
import { desc, eq, lt } from 'drizzle-orm';
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

  list(opts: { limit: number; before?: Date }) {
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
        .where(opts.before ? lt(auditLogs.createdAt, opts.before) : undefined)
        .orderBy(desc(auditLogs.createdAt))
        .limit(opts.limit),
    );
  }
}
