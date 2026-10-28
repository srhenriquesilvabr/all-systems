import { CURRENT_TENANT, CURRENT_USER, id, tenantId, tenantIsolation } from '@all/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Address } from '../customers/schema';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Plataforma: sem RLS. Acessadas antes de existir um tenant no contexto (login)
// ou para operações da própria plataforma (catálogo de módulos).
// ---------------------------------------------------------------------------

export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    /** Nome fantasia: o que aparece no admin, nas páginas públicas e nas mensagens. */
    name: text('name').notNull(),
    /** Endereço público da empresa (ex.: agendamento online em /agendar/<slug>). */
    slug: text('slug').unique(),
    legalName: text('legal_name'),
    /** CPF (11 dígitos) ou CNPJ (14 caracteres; o CNPJ novo pode ter letras), sem pontuação. */
    document: text('document'),
    stateRegistration: text('state_registration'),
    municipalRegistration: text('municipal_registration'),
    email: text('email'),
    /** Telefone/WhatsApp em E.164. */
    phone: text('phone'),
    website: text('website'),
    /** Só o usuário, sem @. */
    instagram: text('instagram'),
    address: jsonb('address').$type<Address>(),
    /**
     * Logo, guardado em `files` (dono `company_logo`). Sem FK: `files` é tabela de tenant (RLS)
     * e importa este arquivo; quem mantém o vínculo é o serviço da empresa.
     */
    logoFileId: uuid('logo_file_id'),
    /** Cor principal do painel (#rrggbb, minúsculas). Nulo = padrão Palmer. */
    brandColor: text('brand_color'),
    status: text('status', { enum: ['trial', 'active', 'suspended', 'cancelled'] })
      .notNull()
      .default('active'),
    packageKey: text('package_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check('tenants_brand_color_chk', sql`brand_color ~ '^#[0-9a-f]{6}$'`)],
);

/** Espelho dos manifestos instalados; sincronizado no boot da API. */
export const modules = pgTable('modules', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  layer: text('layer').notNull(),
  version: text('version').notNull(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Sempre em minúsculas. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** Nulo enquanto o convite não foi aceito. */
    passwordHash: text('password_hash'),
    emailVerifiedAt: ts('email_verified_at'),
    lastLoginAt: ts('last_login_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const userTokens = pgTable('user_tokens', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose', { enum: ['password_reset', 'invite'] }).notNull(),
  /** SHA-256 do token. O token em si só existe no e-mail. */
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Todos os tokens gerados por rotação a partir do mesmo login. */
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_family_idx').on(t.familyId), index('refresh_tokens_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Tenant: RLS por tenant_id.
// ---------------------------------------------------------------------------

export const tenantModules = pgTable(
  'tenant_modules',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key')
      .notNull()
      .references(() => modules.key),
    status: text('status', { enum: ['active', 'suspended', 'inactive'] }).notNull(),
    source: text('source', { enum: ['core', 'package', 'addon', 'dependency', 'manual'] }).notNull(),
    settings: jsonb('settings').notNull().default({}),
    /** Versão do manifesto cujo onEnable já rodou; diferente da atual = roda de novo (upgrade). */
    version: text('version'),
    enabledAt: ts('enabled_at').notNull().defaultNow(),
    disabledAt: ts('disabled_at'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.moduleKey] }), tenantIsolation()],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_key').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    // O usuário enxerga as próprias memberships em qualquer tenant (para escolher em qual entrar),
    // mas só pode gravar dentro do tenant do escopo.
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: sql.raw(`"tenant_id" = ${CURRENT_TENANT} or "user_id" = ${CURRENT_USER}`),
      withCheck: sql.raw(`"tenant_id" = ${CURRENT_TENANT}`),
    }),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** Papéis vindos de manifesto (e o dono). Não podem ser editados nem excluídos. */
    isSystem: boolean('is_system').notNull().default(false),
    moduleKey: text('module_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_tenant_key').on(t.tenantId, t.key), tenantIsolation()],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] }), tenantIsolation()],
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.roleId] }), tenantIsolation()],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt), tenantIsolation()],
);
