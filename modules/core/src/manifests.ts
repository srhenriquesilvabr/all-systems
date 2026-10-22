import { defineModule } from '@all/module-sdk';

export const OWNER_ROLE = 'core.owner';

export const authManifest = defineModule({
  key: 'core.auth',
  name: 'Login',
  layer: 'core',
  version: '1.0.0',
});

export const usersManifest = defineModule({
  key: 'core.users',
  name: 'Usuários',
  layer: 'core',
  version: '1.0.0',
  dependsOn: ['core.auth'],
  permissions: [
    { key: 'core.users.read', label: 'Ver usuários' },
    { key: 'core.users.manage', label: 'Convidar, desativar e alterar papéis de usuários' },
  ],
  menu: [{ label: 'Usuários', path: '/configuracoes/usuarios', icon: 'users', permission: 'core.users.read', group: 'Configurações' }],
});

export const accessManifest = defineModule({
  key: 'core.access',
  name: 'Permissões',
  layer: 'core',
  version: '1.0.0',
  dependsOn: ['core.users'],
  permissions: [
    { key: 'core.access.read', label: 'Ver papéis e permissões' },
    { key: 'core.access.manage', label: 'Criar e editar papéis' },
  ],
  menu: [{ label: 'Papéis', path: '/configuracoes/papeis', icon: 'shield', permission: 'core.access.read', group: 'Configurações' }],
});

export const auditManifest = defineModule({
  key: 'core.audit',
  name: 'Auditoria',
  layer: 'core',
  version: '1.0.0',
  permissions: [{ key: 'core.audit.read', label: 'Ver trilha de auditoria' }],
  menu: [{ label: 'Auditoria', path: '/configuracoes/auditoria', icon: 'history', permission: 'core.audit.read', group: 'Configurações' }],
});

export const customersManifest = defineModule({
  key: 'core.customers',
  name: 'Clientes',
  layer: 'core',
  version: '1.0.0',
  permissions: [
    { key: 'core.customers.read', label: 'Ver clientes' },
    { key: 'core.customers.write', label: 'Cadastrar e editar clientes' },
    { key: 'core.customers.privacy', label: 'Exportar e anonimizar dados de clientes (LGPD)' },
    { key: 'core.customers.fields', label: 'Configurar campos extras do cadastro' },
  ],
  menu: [
    { label: 'Clientes', path: '/clientes', icon: 'contact', permission: 'core.customers.read' },
    { label: 'Campos de clientes', path: '/configuracoes/campos-de-clientes', icon: 'list', permission: 'core.customers.fields', group: 'Configurações' },
  ],
});

export const financeManifest = defineModule({
  key: 'core.finance',
  name: 'Financeiro',
  layer: 'core',
  version: '1.0.0',
  dependsOn: ['core.customers'],
  permissions: [
    { key: 'core.finance.read', label: 'Ver financeiro e relatórios' },
    { key: 'core.finance.write', label: 'Lançar, dar baixa e cancelar lançamentos' },
    { key: 'core.finance.manage', label: 'Gerenciar contas e categorias' },
  ],
  menu: [
    { label: 'Visão geral', path: '/financeiro', icon: 'chart', permission: 'core.finance.read', group: 'Financeiro' },
    { label: 'Lançamentos', path: '/financeiro/lancamentos', icon: 'receipt', permission: 'core.finance.read', group: 'Financeiro' },
    { label: 'Contas e categorias', path: '/financeiro/cadastros', icon: 'wallet', permission: 'core.finance.manage', group: 'Financeiro' },
  ],
});

export const coreManifests = [authManifest, usersManifest, accessManifest, auditManifest, customersManifest, financeManifest];
