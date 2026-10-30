import { defineModule } from '@all/module-sdk';
import { z } from 'zod';

export const RECRUITING = 'recruiting';

export const recruitingSettings = z
  .object({
    /** Página pública de vagas (/vagas/<slug>) e feed do Indeed. */
    publicPage: z.boolean().default(true),
    /** Meses que os dados do candidato ficam no banco de talentos depois da última candidatura. */
    retentionMonths: z.coerce.number().int().min(1).max(60).default(12),
    /** Canal para pedidos do titular (LGPD), mostrado no consentimento. */
    privacyEmail: z.string().trim().email('E-mail inválido').max(254).or(z.literal('')).default(''),
    /**
     * auto: nota de aderência pela IA (Anthropic) quando o servidor tem a chave; sem ela, estimativa
     * por palavras-chave. heuristic: sempre a estimativa, sem enviar o currículo a terceiros.
     */
    analysis: z.enum(['auto', 'heuristic']).default('auto'),
    /** Modelo da Anthropic usado na análise. */
    aiModel: z
      .string()
      .trim()
      .regex(/^claude-[a-z0-9.-]+$/, 'Modelo inválido (ex.: claude-opus-5-5)')
      .default('claude-opus-5-5'),
    /**
     * off: sem Gupy. api: publica pela API da Gupy com o token da empresa.
     * simulated: registra como publicada sem chamar a Gupy (demonstração e testes).
     */
    gupyMode: z.enum(['off', 'api', 'simulated']).default('off'),
    gupyToken: z.string().trim().max(2000).default(''),
    /** Ids do cadastro da empresa na Gupy, exigidos para criar vagas (a confirmar com a Gupy). */
    gupyDepartmentId: z.string().trim().max(40).default(''),
    gupyRoleId: z.string().trim().max(40).default(''),
    gupyBranchId: z.string().trim().max(40).default(''),
  })
  .refine((s) => s.gupyMode !== 'api' || s.gupyToken, { message: 'Para publicar pela API da Gupy, informe o token', path: ['gupyToken'] });
export type RecruitingSettings = z.infer<typeof recruitingSettings>;

/**
 * Head hunter: vagas (próprias ou das empresas-clientes), página pública com candidatura e
 * consentimento LGPD, banco de talentos, funil por etapas, nota de aderência (IA ou estimativa),
 * feed do Indeed e publicação na Gupy. Contratável por qualquer ramo; feito para consultorias de RH.
 */
export const recruitingManifest = defineModule({
  key: RECRUITING,
  name: 'Head hunter',
  layer: 'shared',
  description: 'Vagas, página de candidatura, banco de talentos, funil com nota de aderência por IA e publicação no Indeed e na Gupy.',
  icon: 'headhunter',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.team'],
  permissions: [
    { key: 'recruiting.jobs.read', label: 'Ver vagas e o funil de candidatos' },
    { key: 'recruiting.jobs.manage', label: 'Criar, editar, publicar e encerrar vagas' },
    { key: 'recruiting.candidates.read', label: 'Ver candidatos, currículos e notas (dado pessoal)' },
    { key: 'recruiting.candidates.manage', label: 'Cadastrar candidatos, mover no funil, anotar, reprovar e contratar' },
    { key: 'recruiting.candidates.privacy', label: 'Exportar e excluir dados de candidatos (LGPD)' },
  ],
  defaultRoles: [
    {
      key: 'recruiting.recruiter',
      label: 'Recrutador',
      permissions: ['recruiting.jobs.read', 'recruiting.jobs.manage', 'recruiting.candidates.read', 'recruiting.candidates.manage'],
    },
    // Exportar e excluir dados de candidatos é pedido de titular (LGPD): fica com quem responde pelo
    // recrutamento, não com todo recrutador. As duas ações ficam na auditoria.
    {
      key: 'recruiting.manager',
      label: 'Gestor(a) de recrutamento',
      permissions: ['recruiting.jobs.read', 'recruiting.jobs.manage', 'recruiting.candidates.read', 'recruiting.candidates.manage', 'recruiting.candidates.privacy'],
    },
    { key: 'recruiting.viewer', label: 'Visualizador de recrutamento', permissions: ['recruiting.jobs.read', 'recruiting.candidates.read'] },
  ],
  menu: [
    { label: 'Vagas', path: '/recrutamento/vagas', icon: 'briefcase', permission: 'recruiting.jobs.read' },
    { label: 'Banco de talentos', path: '/recrutamento/candidatos', icon: 'user-search', permission: 'recruiting.candidates.read' },
    { label: 'Head hunter', path: '/configuracoes/head-hunter', icon: 'headhunter', permission: 'core.access.settings', group: 'Configurações' },
  ],
  settings: recruitingSettings,
  secretSettings: ['gupyToken'],
  events: { publishes: ['recruiting.application.submitted', 'recruiting.job.sync'] },
});
