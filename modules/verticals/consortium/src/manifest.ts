import { defineModule } from '@all/module-sdk';
import { z } from 'zod';

export const consortiumSettings = z.object({
  /** Comissão da corretora sobre o valor do crédito, paga pela administradora na adesão. */
  commissionPercent: z.coerce.number().min(0).max(20).default(2),
});
export type ConsortiumSettings = z.infer<typeof consortiumSettings>;

/** Corretora de consórcio: simulação de planos, venda de cotas pelas administradoras, assembleias e contemplação. */
export const consortiumManifest = defineModule({
  key: 'consortium',
  name: 'Consórcio',
  layer: 'vertical',
  description: 'Simulador de planos, cotas e assembleias.',
  icon: 'ticket',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'shared.notifications', 'integration.banking', 'shared.sales'],
  optionalDependsOn: ['integration.whatsapp'],
  permissions: [
    { key: 'consortium.read', label: 'Ver planos, cotas e assembleias' },
    { key: 'consortium.sell', label: 'Vender cotas (enviar adesão)' },
    { key: 'consortium.manage', label: 'Sincronizar planos e lançar assembleias' },
  ],
  settings: consortiumSettings,
  defaultRoles: [
    { key: 'consortium.seller', label: 'Consultor(a)', permissions: ['consortium.read', 'consortium.sell', 'integration.banking.simulate', 'integration.banking.propose', 'core.customers.read', 'core.customers.write'] },
    {
      key: 'consortium.manager',
      label: 'Gestor(a)',
      permissions: ['consortium.read', 'consortium.sell', 'consortium.manage', 'integration.banking.simulate', 'integration.banking.propose', 'core.customers.read', 'core.customers.write'],
    },
  ],
  menu: [
    { label: 'Simulador', path: '/consorcio', icon: 'calculator', permission: 'consortium.read' },
    { label: 'Cotas', path: '/consorcio/cotas', icon: 'ticket', permission: 'consortium.read' },
    { label: 'Assembleias', path: '/consorcio/assembleias', icon: 'gavel', permission: 'consortium.read' },
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
  ],
  events: { subscribes: ['integration.banking.proposal_updated'] },
});
