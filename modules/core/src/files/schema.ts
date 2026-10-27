import { id, tenantId, tenantIsolation } from '@all/db';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants, users } from '../db/schema';

/** Metadados dos arquivos; o conteúdo fica no storage (disco em dev, S3 em produção). */
export const files = pgTable(
  'files',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** Dono lógico do arquivo, ex.: ('laundry_item', <id do item>). */
    ownerEntity: text('owner_entity').notNull(),
    ownerId: text('owner_id').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('files_owner_idx').on(t.tenantId, t.ownerEntity, t.ownerId), tenantIsolation()],
);
