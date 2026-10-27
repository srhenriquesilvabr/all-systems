import { tenants } from '@all/core/schema';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Tabelas de plataforma, sem RLS: o webhook da Meta chega sem tenant e é por elas que se
// descobre de qual empresa é a mensagem. Só o módulo do WhatsApp lê e grava aqui.

/** Número do WhatsApp (phone_number_id da Meta) → empresa. Atualizado ao salvar as configurações. */
export const whatsappNumbers = pgTable('whatsapp_numbers', {
  phoneNumberId: text('phone_number_id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Mensagens recebidas já processadas: a Meta reenvia webhooks, e cada mensagem deve contar uma vez. */
export const whatsappInbound = pgTable('whatsapp_inbound', {
  messageId: text('message_id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  fromPhone: text('from_phone').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
