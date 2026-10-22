import { uuidv7, type Tx } from '@all/db';
import { ModuleRegistry } from '@all/module-sdk';
import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { and, eq, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { hashToken, newToken } from '../common/crypto';
import { CoreConfig } from '../config';
import { memberships, membershipRoles, modules, rolePermissions, roles, tenantModules, tenants, userTokens, users } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { MailService } from '../mail/mail.service';
import { inviteMail } from '../mail/templates';
import { OWNER_ROLE } from '../manifests';
import { ModuleHooks } from './module-hooks';

type ModuleSource = 'package' | 'addon' | 'manual';

export interface CreateTenantInput {
  name: string;
  legalName?: string;
  document?: string;
  packageKey?: string;
  /** Módulos contratados (além do core). Dependências são ativadas automaticamente. */
  modules: string[];
  owner: { email: string; name: string; /** Só para seed/testes; o normal é o dono criar a senha pelo convite. */ password?: string };
}

/**
 * Operações de plataforma sobre tenants: criação (provisionamento) e ativação de módulos.
 * Usadas pelo CLI hoje e pelo provisionamento via Shopify (Fase 4) depois.
 */
@Injectable()
export class TenancyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenancyService.name);

  constructor(
    private readonly tdb: TenantDb,
    private readonly registry: ModuleRegistry,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: CoreConfig,
    private readonly hooks: ModuleHooks,
  ) {}

  /** Espelha os manifestos desta build na tabela `modules` e alinha os tenants existentes. */
  async onApplicationBootstrap() {
    const rows = this.registry.all().map((m) => ({ key: m.key, name: m.name, layer: m.layer, version: m.version }));
    await this.tdb.db
      .insert(modules)
      .values(rows)
      .onConflictDoUpdate({
        target: modules.key,
        set: { name: sql`excluded.name`, layer: sql`excluded.layer`, version: sql`excluded.version`, updatedAt: new Date() },
      });
    this.logger.log(`${rows.length} módulos registrados: ${rows.map((r) => r.key).join(', ')}`);
    await this.reconcileTenants();
  }

  /**
   * Quando uma build nova traz um módulo core novo, uma dependência nova ou papéis padrão
   * alterados, os tenants existentes são atualizados aqui. Só uma instância faz o trabalho
   * (advisory lock); as demais seguem o boot normalmente.
   */
  async reconcileTenants() {
    await this.tdb.db.transaction(async (lockTx) => {
      const lock = await lockTx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('all-systems:reconcile-tenants')) as ok`);
      if (!lock.rows[0]?.ok) return;

      const all = await lockTx.select({ id: tenants.id }).from(tenants).where(ne(tenants.status, 'cancelled'));
      let changed = 0;
      for (const { id: tenantId } of all) {
        await this.tdb.withScope({ tenantId }, async (tx) => {
          // Suspensos contam como presentes: a reconciliação não reativa o que foi suspenso por cobrança.
          const active = await this.usableKeys(tx, tenantId);
          const missingCore = this.registry.coreKeys().filter((k) => !active.includes(k));
          const required = this.registry.dependencyClosure([...this.registry.coreKeys(), ...active.filter((k) => this.registry.get(k))]);
          const missingDeps = [...required].filter((k) => !active.includes(k) && !missingCore.includes(k));

          if (missingCore.length) await this.enableInTx(tx, tenantId, missingCore, 'core');
          if (missingDeps.length) await this.enableInTx(tx, tenantId, missingDeps, 'dependency');
          if (missingCore.length || missingDeps.length) {
            changed++;
            await this.audit.log(tx, {
              tenantId,
              userId: null,
              action: 'modules.enabled',
              entity: 'tenant',
              entityId: tenantId,
              data: { keys: [...missingCore, ...missingDeps], reason: 'reconcile' },
            });
          }
          for (const key of required) await this.syncDefaultRoles(tx, tenantId, key);
        });
      }
      if (changed) this.logger.log(`Módulos novos ativados em ${changed} empresa(s)`);
    });
  }

  async createTenant(input: CreateTenantInput) {
    const tenantId = uuidv7();
    const email = input.owner.email.trim().toLowerCase();
    const passwordHash = input.owner.password ? await hash(input.owner.password) : null;

    const result = await this.tdb.withScope({ tenantId }, async (tx) => {
      await tx.insert(tenants).values({
        id: tenantId,
        name: input.name,
        legalName: input.legalName,
        document: input.document,
        packageKey: input.packageKey,
      });

      await this.enableInTx(tx, tenantId, this.registry.coreKeys(), 'core');
      if (input.modules.length) await this.enableInTx(tx, tenantId, input.modules, input.packageKey ? 'package' : 'manual');

      const [ownerRole] = await tx
        .insert(roles)
        .values({ tenantId, key: OWNER_ROLE, label: 'Dono', isSystem: true })
        .returning();

      let [user] = await tx.select().from(users).where(eq(users.email, email));
      user ??= (
        await tx
          .insert(users)
          .values({ email, name: input.owner.name, passwordHash, emailVerifiedAt: passwordHash ? new Date() : null })
          .returning()
      )[0]!;

      const [membership] = await tx.insert(memberships).values({ tenantId, userId: user.id }).returning();
      await tx.insert(membershipRoles).values({ tenantId, membershipId: membership!.id, roleId: ownerRole!.id });

      let inviteToken: string | undefined;
      if (!user.passwordHash) {
        inviteToken = newToken();
        await tx.insert(userTokens).values({
          userId: user.id,
          purpose: 'invite',
          tokenHash: hashToken(inviteToken),
          expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
        });
      }

      await this.audit.log(tx, {
        tenantId,
        userId: null,
        action: 'tenant.created',
        entity: 'tenant',
        entityId: tenantId,
        data: { name: input.name, modules: input.modules, owner: email },
      });
      return { tenantId, ownerUserId: user.id, inviteToken };
    });

    if (result.inviteToken) {
      this.mail.sendInBackground(inviteMail(email, input.name, `${this.config.adminUrl}/definir-senha?token=${result.inviteToken}`));
    }
    return result;
  }

  enableModules(tenantId: string, keys: string[], source: ModuleSource = 'manual') {
    return this.tdb.withScope({ tenantId }, async (tx) => {
      const enabled = await this.enableInTx(tx, tenantId, keys, source);
      await this.audit.log(tx, { tenantId, action: 'modules.enabled', entity: 'tenant', entityId: tenantId, data: { keys: enabled } });
      return enabled;
    });
  }

  async disableModule(tenantId: string, key: string) {
    const manifest = this.registry.get(key);
    if (!manifest) throw new BadRequestException(`Módulo desconhecido: ${key}`);
    if (manifest.layer === 'core') throw new BadRequestException('Módulos do core não podem ser desativados');

    return this.tdb.withScope({ tenantId }, async (tx) => {
      const active = await this.activeKeys(tx, tenantId);
      const dependents = this.registry.dependentsOf(key, active);
      if (dependents.length) {
        throw new BadRequestException(`${key} é usado por ${dependents.join(', ')}; desative-os antes`);
      }
      // Os dados do módulo são mantidos: só o acesso é bloqueado (ver ciclo de vida em 02-sistema-de-modulos).
      await tx
        .update(tenantModules)
        .set({ status: 'inactive', disabledAt: new Date() })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, key)));
      await this.audit.log(tx, { tenantId, action: 'module.disabled', entity: 'tenant', entityId: tenantId, data: { key } });
    });
  }

  listModules(tenantId: string) {
    return this.tdb.withScope({ tenantId }, (tx) =>
      tx.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId)).orderBy(tenantModules.moduleKey),
    );
  }

  /** Ativa os módulos e as dependências (dependências primeiro), com papéis padrão e o onEnable de cada um. */
  private async enableInTx(tx: Tx, tenantId: string, keys: string[], source: ModuleSource | 'core' | 'dependency') {
    const closure = this.registry.dependencyClosure(keys);
    const existing = new Map(
      (await tx.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId))).map((m) => [m.moduleKey, m]),
    );

    for (const key of closure) {
      const requested = keys.includes(key);
      const row = existing.get(key);
      if (row?.status === 'active') continue;
      if (row) {
        await tx
          .update(tenantModules)
          .set({ status: 'active', disabledAt: null, enabledAt: new Date() })
          .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, key)));
      } else {
        await tx.insert(tenantModules).values({
          tenantId,
          moduleKey: key,
          status: 'active',
          source: requested ? source : 'dependency',
        });
      }
      await this.syncDefaultRoles(tx, tenantId, key);
      await this.hooks.onEnable(tx, tenantId, key);
    }
    return [...closure];
  }

  /** Papéis padrão não são editáveis pelo tenant: ficam sempre iguais ao manifesto da build atual. */
  private async syncDefaultRoles(tx: Tx, tenantId: string, moduleKey: string) {
    for (const template of this.registry.defaultRolesOf(moduleKey)) {
      const [role] = await tx
        .insert(roles)
        .values({ tenantId, key: template.key, label: template.label, isSystem: true, moduleKey })
        .onConflictDoUpdate({ target: [roles.tenantId, roles.key], set: { label: template.label, isSystem: true, moduleKey } })
        .returning();
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role!.id));
      if (!template.permissions.length) continue;
      await tx
        .insert(rolePermissions)
        .values(template.permissions.map((permissionKey) => ({ tenantId, roleId: role!.id, permissionKey })));
    }
  }

  private async activeKeys(tx: Tx, tenantId: string) {
    const rows = await tx
      .select({ key: tenantModules.moduleKey })
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.status, 'active')));
    return rows.map((r) => r.key);
  }

  private async usableKeys(tx: Tx, tenantId: string) {
    const rows = await tx
      .select({ key: tenantModules.moduleKey })
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), ne(tenantModules.status, 'inactive')));
    return rows.map((r) => r.key);
  }
}
