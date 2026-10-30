import { uuidv7, type Tx } from '@all/db';
import { ModuleRegistry } from '@all/module-sdk';
import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { hashPassword as hash } from '../common/password';
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
  status?: 'trial' | 'active';
  /** Cadastro público: e-mail ainda não confirmado, e a conta não pode pegar carona em usuário existente. */
  selfService?: boolean;
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

  async onApplicationBootstrap() {
    if (this.config.syncModulesOnBoot) await this.syncModules();
  }

  /** Espelha os manifestos desta build na tabela `modules` e alinha os tenants existentes. */
  async syncModules() {
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
      // A transação do lock fica ociosa enquanto o trabalho roda em outras conexões: o limite de
      // 20 s do app_user (0019) a derrubaria; aqui o teto sobe só para ela.
      await lockTx.execute(sql`set local idle_in_transaction_session_timeout = '10min'`);
      const lock = await lockTx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('all-systems:reconcile-tenants')) as ok`);
      if (!lock.rows[0]?.ok) return;

      const all = await lockTx.select({ id: tenants.id, name: tenants.name, slug: tenants.slug }).from(tenants).where(ne(tenants.status, 'cancelled'));
      // Empresas criadas antes do endereço público ganham um slug. Em transação própria e curta:
      // se a linha do tenant ficasse travada na transação do lock, a ativação de módulos abaixo
      // (outra conexão, FK para tenants) esperaria por ela para sempre.
      for (const t of all.filter((x) => !x.slug)) {
        await this.tdb.db.transaction(async (tx) => {
          await tx.update(tenants).set({ slug: await this.uniqueSlug(tx, t.name) }).where(eq(tenants.id, t.id));
        });
      }
      let changed = 0;
      let upgraded = 0;
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

          // Módulo atualizado (versão do manifesto mudou): roda o onEnable de novo para aplicar dados novos.
          const rows = await tx.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId));
          for (const row of rows) {
            const manifest = this.registry.get(row.moduleKey);
            if (!manifest || row.status === 'inactive' || row.version === manifest.version) continue;
            await this.hooks.onEnable(tx, tenantId, row.moduleKey);
            await tx
              .update(tenantModules)
              .set({ version: manifest.version })
              .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, row.moduleKey)));
            upgraded++;
          }
        });
      }
      if (changed) this.logger.log(`Módulos novos ativados em ${changed} empresa(s)`);
      if (upgraded) this.logger.log(`${upgraded} módulo(s) atualizados nas empresas`);
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
        status: input.status ?? 'active',
        slug: await this.uniqueSlug(tx, input.name),
      });

      await this.enableInTx(tx, tenantId, this.registry.coreKeys(), 'core');
      if (input.modules.length) await this.enableInTx(tx, tenantId, input.modules, input.packageKey ? 'package' : 'manual');

      const [ownerRole] = await tx
        .insert(roles)
        .values({ tenantId, key: OWNER_ROLE, label: 'Dono', isSystem: true })
        .returning();

      let [user] = await tx.select().from(users).where(eq(users.email, email));
      if (user && input.selfService) throw new ConflictException({ code: 'EMAIL_IN_USE', message: 'Este e-mail já tem uma conta. Entre com ele ou use outro e-mail.' });
      user ??= (
        await tx
          .insert(users)
          .values({ email, name: input.owner.name, passwordHash, emailVerifiedAt: passwordHash && !input.selfService ? new Date() : null })
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
          .set({ status: 'active', disabledAt: null, enabledAt: new Date(), version: this.registry.get(key)!.version })
          .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, key)));
      } else {
        await tx.insert(tenantModules).values({
          tenantId,
          moduleKey: key,
          status: 'active',
          source: requested ? source : 'dependency',
          version: this.registry.get(key)!.version,
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

  /** Empresas não canceladas (plataforma/CLI). */
  listTenants() {
    return this.tdb.db.select({ id: tenants.id, name: tenants.name, status: tenants.status }).from(tenants).where(ne(tenants.status, 'cancelled'));
  }

  /** Empresa pelo endereço público (agendamento online, logo), com o que as páginas públicas mostram da marca. */
  async tenantBySlug(slug: string) {
    const [tenant] = await this.tdb.db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, status: tenants.status, logoFileId: tenants.logoFileId, brandColor: tenants.brandColor })
      .from(tenants)
      .where(eq(tenants.slug, slug.toLowerCase()));
    return tenant && tenant.status !== 'cancelled' ? tenant : undefined;
  }

  private async uniqueSlug(tx: Tx, name: string) {
    const base =
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'empresa';
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      const [taken] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate));
      if (!taken) return candidate;
    }
  }

  private async usableKeys(tx: Tx, tenantId: string) {
    const rows = await tx
      .select({ key: tenantModules.moduleKey })
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), ne(tenantModules.status, 'inactive')));
    return rows.map((r) => r.key);
  }
}
