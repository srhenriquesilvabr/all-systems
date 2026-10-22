import type { Tx } from '@all/db';
import { ModuleRegistry, requestContext } from '@all/module-sdk';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { memberships, membershipRoles, rolePermissions, roles, tenantModules, tenants } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { OWNER_ROLE } from '../manifests';

export type ModuleStatus = 'active' | 'suspended';

export interface ResolvedAccess {
  membershipId: string;
  tenantStatus: 'trial' | 'active' | 'suspended' | 'cancelled';
  isOwner: boolean;
  /** Módulos utilizáveis (ativos ou suspensos) do tenant. */
  modules: Map<string, ModuleStatus>;
  /** Permissões efetivas = permissões dos papéis ∩ permissões dos módulos utilizáveis. */
  permissions: Set<string>;
}

@Injectable()
export class AccessService {
  constructor(
    private readonly tdb: TenantDb,
    private readonly registry: ModuleRegistry,
    private readonly audit: AuditService,
  ) {}

  /** Monta o acesso do usuário no tenant. `null` = não é membro ativo. */
  resolve(tenantId: string, userId: string): Promise<ResolvedAccess | null> {
    return this.tdb.withScope({ tenantId, userId }, async (tx) => {
      const [membership] = await tx
        .select({ id: memberships.id, status: memberships.status, tenantStatus: tenants.status })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
      if (!membership || membership.status !== 'active') return null;

      const moduleRows = await tx
        .select({ key: tenantModules.moduleKey, status: tenantModules.status })
        .from(tenantModules)
        .where(eq(tenantModules.tenantId, tenantId));
      const modules = new Map<string, ModuleStatus>();
      for (const m of moduleRows) {
        if (m.status !== 'inactive' && this.registry.get(m.key)) modules.set(m.key, m.status);
      }

      const roleRows = await tx
        .select({ key: roles.key, permission: rolePermissions.permissionKey })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .where(eq(membershipRoles.membershipId, membership.id));

      const available = new Set(this.registry.permissionsOf(modules.keys()).map((p) => p.key));
      const isOwner = roleRows.some((r) => r.key === OWNER_ROLE);
      const permissions = isOwner
        ? available
        : new Set(roleRows.map((r) => r.permission).filter((p): p is string => !!p && available.has(p)));

      return { membershipId: membership.id, tenantStatus: membership.tenantStatus, isOwner, modules, permissions };
    });
  }

  /** Permissões que podem ser atribuídas neste tenant, agrupadas pelo módulo dono. */
  permissionCatalog() {
    const active = requestContext.require().modules ?? new Set<string>();
    return [...active]
      .map((key) => this.registry.get(key)!)
      .filter((m) => m.permissions?.length)
      .map((m) => ({ module: { key: m.key, name: m.name, layer: m.layer }, permissions: m.permissions! }));
  }

  listRoles() {
    return this.tdb.run(async (tx) => {
      const rows = await tx.select().from(roles).orderBy(roles.isSystem, roles.label);
      const perms = await tx.select().from(rolePermissions);
      const members = await tx
        .select({ roleId: membershipRoles.roleId, total: count() })
        .from(membershipRoles)
        .groupBy(membershipRoles.roleId);
      return rows.map((r) => ({
        id: r.id,
        key: r.key,
        label: r.label,
        isSystem: r.isSystem,
        isOwner: r.key === OWNER_ROLE,
        moduleKey: r.moduleKey,
        permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permissionKey),
        memberCount: members.find((m) => m.roleId === r.id)?.total ?? 0,
      }));
    });
  }

  createRole(input: { label: string; permissions: string[] }) {
    this.assertAssignable(input.permissions);
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const key = `custom.${slugify(input.label)}-${Date.now().toString(36)}`;
      const [role] = await tx.insert(roles).values({ tenantId, key, label: input.label }).returning();
      if (input.permissions.length) {
        await tx
          .insert(rolePermissions)
          .values(input.permissions.map((permissionKey) => ({ tenantId, roleId: role!.id, permissionKey })));
      }
      await this.audit.log(tx, { action: 'role.created', entity: 'role', entityId: role!.id, data: input });
      return role!;
    });
  }

  updateRole(id: string, input: { label?: string; permissions?: string[] }) {
    if (input.permissions) this.assertAssignable(input.permissions);
    const { tenantId } = requestContext.require();
    return this.tdb.run(async (tx) => {
      const role = await this.findEditable(tx, id);
      if (input.label) await tx.update(roles).set({ label: input.label }).where(eq(roles.id, id));
      if (input.permissions) {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        if (input.permissions.length) {
          await tx
            .insert(rolePermissions)
            .values(input.permissions.map((permissionKey) => ({ tenantId, roleId: id, permissionKey })));
        }
      }
      await this.audit.log(tx, { action: 'role.updated', entity: 'role', entityId: id, data: { before: role.label, ...input } });
    });
  }

  deleteRole(id: string) {
    return this.tdb.run(async (tx) => {
      const role = await this.findEditable(tx, id);
      await tx.delete(roles).where(eq(roles.id, id));
      await this.audit.log(tx, { action: 'role.deleted', entity: 'role', entityId: id, data: { label: role.label } });
    });
  }

  /** Garante que os papéis existem no tenant (o RLS já esconde os de outros tenants). */
  async assertRolesExist(tx: Tx, roleIds: string[]) {
    if (!roleIds.length) return [];
    const found = await tx.select().from(roles).where(inArray(roles.id, roleIds));
    if (found.length !== new Set(roleIds).size) throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'Papel inexistente' });
    return found;
  }

  private async findEditable(tx: Tx, id: string) {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id));
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Papel não encontrado' });
    if (role.isSystem) {
      throw new BadRequestException({ code: 'SYSTEM_ROLE', message: 'Papéis padrão não podem ser alterados. Crie um papel novo.' });
    }
    return role;
  }

  private assertAssignable(permissions: string[]) {
    const assignable = new Set(this.permissionCatalog().flatMap((g) => g.permissions.map((p) => p.key)));
    const invalid = permissions.filter((p) => !assignable.has(p));
    if (invalid.length) {
      throw new BadRequestException({ code: 'INVALID_PERMISSION', message: `Permissões indisponíveis: ${invalid.join(', ')}` });
    }
  }
}

function slugify(label: string) {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'papel'
  );
}
