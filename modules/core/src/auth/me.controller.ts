import { ModuleRegistry, requestContext } from '@all/module-sdk';
import { Controller, Get } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants, users } from '../db/schema';
import { TenantDb } from '../db/tenant-db';
import { AuthService } from './auth.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly tdb: TenantDb,
    private readonly registry: ModuleRegistry,
    private readonly auth: AuthService,
  ) {}

  /** Tudo que o admin precisa para montar a sessão: usuário, empresa, módulos, permissões e menu. */
  @Get()
  async me() {
    const ctx = requestContext.require();
    const [user] = await this.tdb.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, ctx.userId));
    const [tenant] = await this.tdb.db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const moduleKeys = [...(ctx.modules ?? [])];
    const permissions = ctx.permissions ?? new Set<string>();

    return {
      user,
      tenant,
      tenants: await this.auth.tenantsOf(ctx.userId),
      modules: moduleKeys.map((key) => {
        const m = this.registry.get(key)!;
        return { key: m.key, name: m.name, layer: m.layer, description: m.description, icon: m.icon };
      }),
      permissions: [...permissions].sort(),
      isOwner: !!ctx.isOwner,
      menu: this.registry.menuFor(moduleKeys, permissions),
    };
  }
}
