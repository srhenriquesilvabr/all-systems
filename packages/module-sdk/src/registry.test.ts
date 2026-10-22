import { describe, expect, it } from 'vitest';
import { defineModule } from './manifest';
import { ModuleRegistry } from './registry';

const customers = defineModule({
  key: 'core.customers',
  name: 'Clientes',
  layer: 'core',
  version: '1.0.0',
  permissions: [{ key: 'core.customers.read', label: 'Ver clientes' }],
});
const orders = defineModule({
  key: 'shared.orders',
  name: 'OS',
  layer: 'shared',
  version: '1.0.0',
  dependsOn: ['core.customers'],
});
const laundry = defineModule({
  key: 'laundry',
  name: 'Lavanderia',
  layer: 'vertical',
  version: '1.0.0',
  dependsOn: ['shared.orders'],
  permissions: [
    { key: 'laundry.read', label: 'Ver' },
    { key: 'laundry.admin', label: 'Administrar' },
  ],
  defaultRoles: [{ key: 'laundry.op', label: 'Operador', permissions: ['laundry.read', 'core.customers.read'] }],
  menu: [
    { label: 'Ordens', path: '/l', permission: 'laundry.read' },
    { label: 'Admin', path: '/a', permission: 'laundry.admin' },
  ],
});

describe('ModuleRegistry', () => {
  it('resolve dependências transitivas', () => {
    const r = new ModuleRegistry([customers, orders, laundry]);
    expect([...r.dependencyClosure(['laundry'])].sort()).toEqual(['core.customers', 'laundry', 'shared.orders']);
  });

  it('rejeita dependência não instalada', () => {
    expect(() => new ModuleRegistry([orders])).toThrow(/não está instalado/);
  });

  it('rejeita core dependendo de vertical', () => {
    const bad = defineModule({ key: 'core.x', name: 'x', layer: 'core', version: '1', dependsOn: ['laundry'] });
    expect(() => new ModuleRegistry([customers, orders, laundry, bad])).toThrow(/não pode depender/);
  });

  it('rejeita ciclo', () => {
    const a = defineModule({ key: 'shared.a', name: 'a', layer: 'shared', version: '1', dependsOn: ['shared.b'] });
    const b = defineModule({ key: 'shared.b', name: 'b', layer: 'shared', version: '1', dependsOn: ['shared.a'] });
    expect(() => new ModuleRegistry([a, b])).toThrow(/circular/);
  });

  it('rejeita permissão sem o prefixo do módulo', () => {
    const bad = defineModule({
      key: 'gym',
      name: 'g',
      layer: 'vertical',
      version: '1',
      permissions: [{ key: 'laundry.x', label: 'x' }],
    });
    expect(() => new ModuleRegistry([bad])).toThrow(/deve começar/);
  });

  it('rejeita papel padrão com permissão de módulo fora das dependências', () => {
    const gym = defineModule({
      key: 'gym',
      name: 'g',
      layer: 'vertical',
      version: '1',
      defaultRoles: [{ key: 'gym.r', label: 'r', permissions: ['laundry.read'] }],
    });
    expect(() => new ModuleRegistry([customers, orders, laundry, gym])).toThrow(/não declara como dependência/);
  });

  it('filtra o menu por permissão', () => {
    const r = new ModuleRegistry([customers, orders, laundry]);
    expect(r.menuFor(['laundry'], new Set(['laundry.read'])).map((m) => m.label)).toEqual(['Ordens']);
  });
});
