import { defineModule } from '@all/module-sdk';
import { z } from 'zod';

export const consortiumSettings = z.object({
  /** Comissão da corretora sobre o valor do crédito, paga pela administradora na adesão. */
  commissionPercent: z.coerce.number().min(0).max(20).default(2),
  /** Cota cancelada até N meses depois de ativa: a comissão é estornada (0 = nunca). */
  reversalMonths: z.coerce.number().int().min(0).max(60).default(6),
  /** Aviso ao cliente quando uma parcela passa de N dias em atraso (0 = não avisar). */
  lateNoticeDays: z.coerce.number().int().min(0).max(90).default(5),

  // ---- Captação de clientes ----
  /** Simulador público com a marca da empresa (/consorcio/<empresa>), que gera leads. */
  publicSimulator: z.boolean().default(true),
  /** Canal para pedidos do titular (LGPD), mostrado no aceite do simulador. */
  privacyEmail: z.string().trim().email('E-mail inválido').max(254).or(z.literal('')).default(''),
  /** Meses que os dados de um lead que não comprou ficam guardados antes de anonimizar. */
  leadRetentionMonths: z.coerce.number().int().min(1).max(60).default(24),
  /** Distribui os leads novos entre os vendedores da lista, um de cada vez. */
  leadRoundRobin: z.boolean().default(false),
  leadSellerIds: z.array(z.string().uuid()).max(50).default([]),
  /** Mensagem pronta do WhatsApp. Variáveis: {{nome}}, {{vendedor}}, {{empresa}}, {{tipo}}, {{credito}}, {{prazo}}, {{parcela}}. */
  leadWhatsappMessage: z
    .string()
    .trim()
    .min(10)
    .max(1000)
    .default('Olá, {{nome}}! Aqui é {{vendedor}}, da {{empresa}}. Recebi sua simulação de consórcio de {{tipo}} de {{credito}} em {{prazo}} meses (parcela estimada de {{parcela}}). Posso te ajudar a escolher o melhor plano?'),
  /** Indicação premiada: texto mostrado na página do link (ex.: "R$ 200 por cota ativa") e valor padrão. */
  referralReward: z.string().trim().max(200).default(''),
  referralRewardAmount: z.coerce.number().min(0).max(100_000).default(0),
  /** Com a consulta de crédito contratada: a venda da cota exige consulta aprovada do CPF/CNPJ (últimos 30 dias). */
  requireCreditApproval: z.boolean().default(false),
});
export type ConsortiumSettings = z.infer<typeof consortiumSettings>;

/**
 * Corretora de consórcio: simulação de planos, venda de cotas pelas administradoras, assembleias e
 * contemplação, e captação de clientes (simulador público, anúncios, indicação, funil de leads).
 */
export const consortiumManifest = defineModule({
  key: 'consortium',
  name: 'Consórcio',
  layer: 'vertical',
  description: 'Simulador de planos, cotas e assembleias.',
  icon: 'ticket',
  version: '1.1.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'integration.banking', 'shared.sales'],
  optionalDependsOn: ['integration.whatsapp', 'integration.credit_bureau'],
  permissions: [
    { key: 'consortium.read', label: 'Ver planos, cotas e assembleias' },
    { key: 'consortium.sell', label: 'Vender cotas (enviar adesão)' },
    { key: 'consortium.manage', label: 'Sincronizar planos, lançar assembleias, grupos e comissões' },
    { key: 'consortium.track', label: 'Acompanhar cotas: parcelas pagas, lances e uso do crédito' },
    { key: 'consortium.leads.read', label: 'Ver leads, o funil e as tarefas de retorno' },
    { key: 'consortium.leads.work', label: 'Atender leads: mover no funil, anotar, agendar retorno e chamar no WhatsApp' },
    { key: 'consortium.leads.manage', label: 'Cadastrar e importar leads, distribuir para vendedores, indicações, canais de anúncio e relatório de conversão' },
  ],
  settings: consortiumSettings,
  defaultRoles: [
    {
      key: 'consortium.seller',
      label: 'Consultor(a)',
      permissions: [
        'consortium.read',
        'consortium.sell',
        'consortium.track',
        'consortium.leads.read',
        'consortium.leads.work',
        'integration.banking.simulate',
        'integration.banking.propose',
        'core.customers.read',
        'core.customers.write',
      ],
    },
    {
      key: 'consortium.manager',
      label: 'Gestor(a)',
      permissions: [
        'consortium.read',
        'consortium.sell',
        'consortium.manage',
        'consortium.track',
        'consortium.leads.read',
        'consortium.leads.work',
        'consortium.leads.manage',
        'integration.banking.simulate',
        'integration.banking.propose',
        'core.customers.read',
        'core.customers.write',
      ],
    },
  ],
  menu: [
    { label: 'Simulador', path: '/consorcio', icon: 'calculator', permission: 'consortium.read' },
    { label: 'Cotas', path: '/consorcio/cotas', icon: 'ticket', permission: 'consortium.read' },
    { label: 'Inadimplência', path: '/consorcio/inadimplencia', icon: 'alarm', permission: 'consortium.read' },
    { label: 'Assembleias', path: '/consorcio/assembleias', icon: 'gavel', permission: 'consortium.read' },
    { label: 'Grupos', path: '/consorcio/grupos', icon: 'users', permission: 'consortium.read' },
    { label: 'Comissões', path: '/consorcio/comissoes', icon: 'percent', permission: 'consortium.manage' },
    { label: 'Leads', path: '/consorcio/leads', icon: 'target', permission: 'consortium.leads.read' },
    { label: 'Indicações', path: '/consorcio/indicacoes', icon: 'handshake', permission: 'consortium.leads.manage' },
    { label: 'Conversão', path: '/consorcio/conversao', icon: 'chart', permission: 'consortium.leads.manage' },
    { label: 'Anúncios (Meta/Google)', path: '/consorcio/canais', icon: 'message', permission: 'consortium.leads.manage' },
    { label: 'Captação de clientes', path: '/configuracoes/captacao', icon: 'target', permission: 'core.access.settings', group: 'Configurações' },
  ],
  notificationTemplates: [
    {
      key: 'consortium.active',
      label: 'Adesão aceita',
      variables: ['cota.grupo', 'cota.numero', 'cota.credito', 'cota.parcela'],
      email: {
        subject: 'Sua cota de consórcio está ativa',
        body: 'Olá, {{cliente.nome}}!\n\nSua adesão foi aceita: grupo {{cota.grupo}}, cota {{cota.numero}}, crédito de {{cota.credito}} e parcela de {{cota.parcela}}.\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Sua cota está ativa: grupo {{cota.grupo}}, cota {{cota.numero}}, crédito {{cota.credito}}, parcela {{cota.parcela}}. — {{empresa.nome}}',
        meta: { name: 'consorcio_ativo', params: ['cliente.nome', 'cota.grupo', 'cota.numero', 'cota.credito', 'cota.parcela'] },
      },
    },
    {
      key: 'consortium.contemplated',
      label: 'Cota contemplada',
      variables: ['cota.grupo', 'cota.numero', 'cota.credito', 'cota.forma'],
      email: {
        subject: 'Parabéns: sua cota foi contemplada!',
        body: 'Olá, {{cliente.nome}}!\n\nSua cota {{cota.numero}} do grupo {{cota.grupo}} foi contemplada por {{cota.forma}}. O crédito de {{cota.credito}} está disponível. Vamos conversar sobre os próximos passos?\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Parabéns, {{cliente.nome}}! Sua cota {{cota.numero}} (grupo {{cota.grupo}}) foi contemplada por {{cota.forma}}. Crédito de {{cota.credito}} liberado. — {{empresa.nome}}',
        meta: { name: 'consorcio_contemplado', params: ['cliente.nome', 'cota.numero', 'cota.grupo', 'cota.forma', 'cota.credito'] },
      },
    },
    {
      key: 'consortium.installment_late',
      label: 'Parcela em atraso',
      variables: ['cota.grupo', 'cota.numero', 'parcela.numero', 'parcela.valor', 'parcela.vencimento', 'parcela.dias', 'parcela.atrasadas'],
      email: {
        subject: 'Parcela do consórcio em atraso',
        body: 'Olá, {{cliente.nome}}!\n\nConsta em aberto a parcela {{parcela.numero}} da sua cota {{cota.numero}} (grupo {{cota.grupo}}), de {{parcela.valor}}, vencida em {{parcela.vencimento}} (há {{parcela.dias}} dias). Parcelas em atraso: {{parcela.atrasadas}}.\n\nO pagamento é feito direto à administradora. Se já pagou, desconsidere e nos envie o comprovante: cota em atraso não concorre nas assembleias.\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! A parcela {{parcela.numero}} da sua cota {{cota.numero}} (grupo {{cota.grupo}}), de {{parcela.valor}}, venceu em {{parcela.vencimento}} e consta em aberto há {{parcela.dias}} dias. Se já pagou, envie o comprovante por aqui. — {{empresa.nome}}',
        meta: { name: 'consorcio_parcela_atraso', params: ['cliente.nome', 'parcela.numero', 'cota.numero', 'cota.grupo', 'parcela.valor', 'parcela.vencimento', 'parcela.dias'] },
      },
    },
  ],
  events: { publishes: ['consortium.lead.meta_received'], subscribes: ['integration.banking.proposal_updated', 'consortium.lead.meta_received'] },
});
