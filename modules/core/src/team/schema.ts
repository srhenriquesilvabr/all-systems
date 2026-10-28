import { id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import { date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Address } from '../customers/schema';
import { tenants, users } from '../db/schema';
import { files } from '../files/schema';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Pessoas da equipe (dado pessoal sensível: acesso com `core.team.*`). Uma pessoa só para todos os
 * papéis dela na empresa: profissional da agenda, colaborador do RH, usuário do sistema.
 */
export const teamMembers = pgTable(
  'team_members',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    /** Só dígitos. Único na empresa quando preenchido. */
    cpf: text('cpf'),
    rg: text('rg'),
    birthDate: date('birth_date', { mode: 'string' }),
    /** Minúsculas. */
    email: text('email'),
    /** E.164 (+5511999998888). Cadastros vindos do RH antigo podem ter o texto digitado. */
    phone: text('phone'),
    address: jsonb('address').$type<Address>(),
    photoFileId: uuid('photo_file_id').references(() => files.id, { onDelete: 'set null' }),
    linkedinUrl: text('linkedin_url'),
    resumeFileId: uuid('resume_file_id').references(() => files.id, { onDelete: 'set null' }),
    /** Início na empresa (a admissão do RH preenche). */
    startedOn: date('started_on', { mode: 'string' }),
    /** Encerramento (a rescisão do RH preenche). Depois dele, a pessoa sai da agenda. */
    endedOn: date('ended_on', { mode: 'string' }),
    /** Quando o encerramento já passado foi avisado aos módulos (evento core.team.member_ended). */
    endNotifiedAt: ts('end_notified_at'),
    /** Login do sistema, se a pessoa usa o admin. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('team_members_tenant_cpf_key').on(t.tenantId, t.cpf).where(sql`cpf is not null`),
    index('team_members_tenant_name_idx').on(t.tenantId, t.firstName, t.lastName),
    index('team_members_tenant_user_idx').on(t.tenantId, t.userId),
    tenantIsolation(),
  ],
);

/** Nome completo em SQL (para ordenar, buscar e juntar em consultas de outros módulos). */
export const teamMemberName = sql<string>`trim(${teamMembers.firstName} || ' ' || coalesce(${teamMembers.lastName}, ''))`;
