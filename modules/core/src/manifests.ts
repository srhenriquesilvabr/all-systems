import { defineModule } from '@all/module-sdk';

export const OWNER_ROLE = 'core.owner';

export const authManifest = defineModule({
  key: 'core.auth',
  name: 'Login',
  layer: 'core',
  version: '1.0.0',
});

/** Manual dentro do sistema: aberto a todos, mostra os ramos contratados pela empresa. */
export const helpManifest = defineModule({
  key: 'core.help',
  name: 'Manual',
  layer: 'core',
  version: '1.0.0',
  menu: [{ label: 'Manual', path: '/manual', icon: 'book-open' }],
});

/**
 * Cadastro e marca da empresa (logo e cor do painel). Módulo core novo: a reconciliação do boot
 * (ADR-011) o ativa nas empresas existentes, e o dono já tem a permissão (o dono tem todas).
 */
export const companyManifest = defineModule({
  key: 'core.company',
  name: 'Dados da empresa',
  layer: 'core',
  version: '1.0.0',
  permissions: [{ key: 'core.company.manage', label: 'Editar dados da empresa, logo e cor do painel' }],
  menu: [{ label: 'Dados da empresa', path: '/configuracoes/empresa', icon: 'building', permission: 'core.company.manage', group: 'Configurações' }],
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
    { key: 'core.access.settings', label: 'Configurar os módulos contratados (ex.: chave Pix)' },
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

/** Clusterização de clientes (etapa 1: RFM com regras). */
export const segmentationManifest = defineModule({
  key: 'core.segmentation',
  name: 'Segmentação de clientes',
  layer: 'core',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance'],
  permissions: [
    { key: 'core.segmentation.read', label: 'Ver segmentos de clientes e exportar listas' },
    { key: 'core.segmentation.manage', label: 'Recalcular os segmentos' },
  ],
  menu: [{ label: 'Segmentos', path: '/segmentos', icon: 'target', permission: 'core.segmentation.read' }],
});

/**
 * Pessoas da equipe: um cadastro só para profissional da agenda, colaborador do RH e usuário do
 * sistema. Dado pessoal sensível (CPF, endereço, currículo): permissões próprias e auditoria.
 */
export const teamManifest = defineModule({
  key: 'core.team',
  name: 'Equipe',
  layer: 'core',
  version: '1.0.0',
  dependsOn: ['core.users'],
  events: { publishes: ['core.team.member_ended'] },
  permissions: [
    { key: 'core.team.read', label: 'Ver a equipe e os dados pessoais (CPF, endereço, currículo)' },
    { key: 'core.team.manage', label: 'Cadastrar e editar pessoas da equipe' },
  ],
  menu: [{ label: 'Equipe', path: '/equipe', icon: 'id-card', permission: 'core.team.read' }],
});

// A ordem define a ordem no menu: "Dados da empresa" abre o grupo Configurações.
export const coreManifests = [authManifest, helpManifest, companyManifest, usersManifest, accessManifest, auditManifest, customersManifest, financeManifest, segmentationManifest, teamManifest];
