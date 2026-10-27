import { id, tenantId, tenantIsolation } from '@all/db';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Textos personalizados pelo tenant, por canal. Sem linha aqui, vale o texto padrão do manifesto. */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    channel: text('channel', { enum: ['email', 'whatsapp'] }).notNull().default('email'),
    /** Só e-mail tem assunto. */
    subject: text('subject'),
    body: text('body').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('notification_templates_key_channel').on(t.tenantId, t.key, t.channel), tenantIsolation()],
);

export interface NotificationMeta {
  /** Template aprovado na Meta, com os parâmetros já preenchidos. */
  template?: { name: string; params: string[] };
  buttons?: { label: string; payload: string }[];
}

/** Cada mensagem enviada (ou não enviada, e por quê), por canal. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id'),
    channel: text('channel', { enum: ['email', 'whatsapp'] }).notNull(),
    templateKey: text('template_key').notNull(),
    recipient: text('recipient'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    /** `manual`: aguardando alguém da equipe enviar pelo link (WhatsApp sem API). */
    status: text('status', { enum: ['queued', 'sent', 'manual', 'failed', 'skipped'] }).notNull(),
    /** Motivo de "skipped" (sem contato, cliente pediu para não receber) ou erro de envio. */
    detail: text('detail'),
    externalId: text('external_id'),
    actionUrl: text('action_url'),
    meta: jsonb('meta').$type<NotificationMeta>(),
    relatedEntity: text('related_entity'),
    relatedId: text('related_id'),
    sentAt: ts('sent_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notifications_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('notifications_customer_idx').on(t.customerId),
    index('notifications_related_idx').on(t.tenantId, t.relatedEntity, t.relatedId),
    tenantIsolation(),
  ],
);
