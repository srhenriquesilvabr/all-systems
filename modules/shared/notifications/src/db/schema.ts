import { id, tenantId, tenantIsolation } from '@all/db';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Textos personalizados pelo tenant. Sem linha aqui, vale o texto padrão do manifesto do módulo. */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('notification_templates_key').on(t.tenantId, t.key), tenantIsolation()],
);

/** Cada mensagem enviada (ou não enviada, e por quê). */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id'),
    channel: text('channel', { enum: ['email'] }).notNull(),
    templateKey: text('template_key').notNull(),
    recipient: text('recipient'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: ['queued', 'sent', 'failed', 'skipped'] }).notNull(),
    /** Motivo de "skipped" (sem e-mail, cliente pediu para não receber) ou erro de envio. */
    detail: text('detail'),
    relatedEntity: text('related_entity'),
    relatedId: text('related_id'),
    sentAt: ts('sent_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notifications_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('notifications_customer_idx').on(t.customerId),
    tenantIsolation(),
  ],
);
