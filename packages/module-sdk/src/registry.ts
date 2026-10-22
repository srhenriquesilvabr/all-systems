import type { MenuItem, ModuleManifest, NotificationTemplateDef, PermissionDef, RoleTemplate } from './manifest';

const LAYER_RANK = { core: 0, shared: 1, integration: 1, vertical: 2 } as const;

/**
 * Catálogo dos módulos instalados nesta build. Valida os manifestos no boot:
 * se algo estiver inconsistente, a aplicação nem sobe.
 */
export class ModuleRegistry {
  private readonly byKey = new Map<string, ModuleManifest>();
  private readonly permissionOwner = new Map<string, string>();

  constructor(manifests: ModuleManifest[]) {
    for (const m of manifests) {
      if (this.byKey.has(m.key)) throw new Error(`Módulo duplicado: ${m.key}`);
      this.byKey.set(m.key, m);
    }
    for (const m of manifests) this.validateDependencies(m);
    for (const m of manifests) this.assertNoCycle(m.key, []);
    for (const m of manifests) this.registerPermissions(m);
    for (const m of manifests) this.validateRoles(m);
  }

  private validateDependencies(m: ModuleManifest) {
    for (const dep of m.dependsOn ?? []) {
      const target = this.byKey.get(dep);
      if (!target) throw new Error(`${m.key} depende de ${dep}, que não está instalado`);
      if (LAYER_RANK[target.layer] > LAYER_RANK[m.layer]) {
        throw new Error(`${m.key} (${m.layer}) não pode depender de ${dep} (${target.layer})`);
      }
    }
  }

  private assertNoCycle(key: string, path: string[]) {
    if (path.includes(key)) throw new Error(`Dependência circular: ${[...path, key].join(' -> ')}`);
    for (const dep of this.byKey.get(key)?.dependsOn ?? []) this.assertNoCycle(dep, [...path, key]);
  }

  private registerPermissions(m: ModuleManifest) {
    for (const p of m.permissions ?? []) {
      if (!p.key.startsWith(`${m.key}.`)) throw new Error(`Permissão ${p.key} deve começar com "${m.key}."`);
      if (this.permissionOwner.has(p.key)) throw new Error(`Permissão duplicada: ${p.key}`);
      this.permissionOwner.set(p.key, m.key);
    }
    for (const t of m.notificationTemplates ?? []) {
      if (!t.key.startsWith(`${m.key}.`)) throw new Error(`Template ${t.key} deve começar com "${m.key}."`);
    }
  }

  private validateRoles(m: ModuleManifest) {
    const reachable = this.dependencyClosure([m.key]);
    for (const role of m.defaultRoles ?? []) {
      for (const perm of role.permissions) {
        const owner = this.permissionOwner.get(perm);
        if (!owner) throw new Error(`Papel ${role.key} usa permissão inexistente: ${perm}`);
        if (!reachable.has(owner)) {
          throw new Error(`Papel ${role.key} usa ${perm}, de um módulo que ${m.key} não declara como dependência`);
        }
      }
    }
  }

  all(): ModuleManifest[] {
    return [...this.byKey.values()];
  }

  get(key: string): ModuleManifest | undefined {
    return this.byKey.get(key);
  }

  /** Módulos `core`: sempre ativos para todo tenant. */
  coreKeys(): string[] {
    return this.all()
      .filter((m) => m.layer === 'core')
      .map((m) => m.key);
  }

  /** Os módulos pedidos + todas as dependências (transitivas), dependências primeiro. */
  dependencyClosure(keys: Iterable<string>): Set<string> {
    const out = new Set<string>();
    const seen = new Set<string>();
    const visit = (key: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      const m = this.byKey.get(key);
      if (!m) throw new Error(`Módulo desconhecido: ${key}`);
      for (const dep of m.dependsOn ?? []) visit(dep);
      out.add(key);
    };
    for (const k of keys) visit(k);
    return out;
  }

  /** Módulos da lista `active` que dependem diretamente de `key`. */
  dependentsOf(key: string, active: Iterable<string>): string[] {
    return [...active].filter((k) => this.byKey.get(k)?.dependsOn?.includes(key));
  }

  permissionsOf(moduleKeys: Iterable<string>): PermissionDef[] {
    return [...moduleKeys].flatMap((k) => this.byKey.get(k)?.permissions ?? []);
  }

  moduleOfPermission(perm: string): string | undefined {
    return this.permissionOwner.get(perm);
  }

  defaultRolesOf(key: string): RoleTemplate[] {
    return this.byKey.get(key)?.defaultRoles ?? [];
  }

  notificationTemplatesOf(moduleKeys: Iterable<string>): (NotificationTemplateDef & { module: string })[] {
    return [...moduleKeys].flatMap((k) => (this.byKey.get(k)?.notificationTemplates ?? []).map((t) => ({ ...t, module: k })));
  }

  notificationTemplate(key: string): NotificationTemplateDef | undefined {
    for (const m of this.byKey.values()) {
      const found = m.notificationTemplates?.find((t) => t.key === key);
      if (found) return found;
    }
    return undefined;
  }

  /** Itens de menu dos módulos ativos, na ordem de instalação (estável, não importa a ordem do banco). */
  menuFor(moduleKeys: Iterable<string>, permissions: ReadonlySet<string>): (MenuItem & { module: string })[] {
    const active = new Set(moduleKeys);
    return [...this.byKey.keys()].filter((k) => active.has(k)).flatMap((k) =>
      (this.byKey.get(k)?.menu ?? [])
        .filter((item) => !item.permission || permissions.has(item.permission))
        .map((item) => ({ ...item, module: k })),
    );
  }
}
