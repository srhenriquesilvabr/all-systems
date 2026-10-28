import { defineModule } from '@all/module-sdk';
import { schedulingSettings } from './contracts';

const vars = ['agendamento.id', 'agendamento.data', 'agendamento.hora', 'agendamento.servicos', 'agendamento.profissional', 'agendamento.total'];
// Série (horário com repetição): uma mensagem só, com todas as datas.
const seriesVars = [...vars, 'agendamento.datas', 'agendamento.quantidade'];

export const schedulingManifest = defineModule({
  key: 'shared.scheduling',
  name: 'Agenda',
  layer: 'shared',
  description: 'Agenda de profissionais e serviços, com agendamento online.',
  icon: 'calendar',
  version: '1.0.0',
  dependsOn: ['core.customers', 'core.finance', 'core.team', 'shared.notifications'],
  optionalDependsOn: ['integration.whatsapp'],
  events: { publishes: ['shared.scheduling.status_changed'], subscribes: ['integration.whatsapp.reply'] },
  permissions: [
    { key: 'shared.scheduling.read', label: 'Ver a agenda' },
    { key: 'shared.scheduling.write', label: 'Marcar, remarcar e cancelar horários' },
    { key: 'shared.scheduling.status', label: 'Registrar chegada, atendimento e conclusão' },
    { key: 'shared.scheduling.payments', label: 'Registrar pagamentos de atendimentos' },
    { key: 'shared.scheduling.manage', label: 'Configurar profissionais, serviços, horários e agendamento online' },
  ],
  menu: [
    { label: 'Agenda', path: '/agenda', icon: 'calendar', permission: 'shared.scheduling.read' },
    { label: 'Profissionais e horários', path: '/agenda/profissionais', icon: 'users', permission: 'shared.scheduling.manage', group: 'Agenda' },
    { label: 'Serviços da agenda', path: '/agenda/servicos', icon: 'tag', permission: 'shared.scheduling.manage', group: 'Agenda' },
  ],
  settings: schedulingSettings,
  notificationTemplates: [
    {
      key: 'shared.scheduling.booked',
      label: 'Horário marcado',
      variables: vars,
      email: {
        subject: 'Horário marcado: {{agendamento.data}} às {{agendamento.hora}}',
        body: 'Olá, {{cliente.nome}}!\n\nSeu horário está marcado:\n{{agendamento.servicos}}\nCom: {{agendamento.profissional}}\nDia {{agendamento.data}} às {{agendamento.hora}}\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Seu horário está marcado: {{agendamento.servicos}} com {{agendamento.profissional}}, dia {{agendamento.data}} às {{agendamento.hora}}. — {{empresa.nome}}',
        meta: { name: 'agendamento_marcado', params: ['cliente.nome', 'agendamento.servicos', 'agendamento.profissional', 'agendamento.data', 'agendamento.hora'] },
      },
    },
    {
      key: 'shared.scheduling.reminder',
      label: 'Lembrete do horário (com confirmação)',
      variables: vars,
      email: {
        subject: 'Lembrete: {{agendamento.data}} às {{agendamento.hora}}',
        body: 'Olá, {{cliente.nome}}!\n\nLembrando do seu horário:\n{{agendamento.servicos}}\nCom: {{agendamento.profissional}}\nDia {{agendamento.data}} às {{agendamento.hora}}\n\nSe não puder vir, avise para liberarmos o horário.\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Lembrete do seu horário: {{agendamento.servicos}} com {{agendamento.profissional}}, dia {{agendamento.data}} às {{agendamento.hora}}. Você confirma? — {{empresa.nome}}',
        meta: { name: 'lembrete_agendamento', params: ['cliente.nome', 'agendamento.servicos', 'agendamento.profissional', 'agendamento.data', 'agendamento.hora'] },
        buttons: [
          { label: 'Confirmar', payload: 'scheduling:confirm:{{agendamento.id}}' },
          { label: 'Cancelar', payload: 'scheduling:cancel:{{agendamento.id}}' },
        ],
      },
    },
    {
      key: 'shared.scheduling.rescheduled',
      label: 'Horário remarcado',
      variables: vars,
      email: {
        subject: 'Horário remarcado: {{agendamento.data}} às {{agendamento.hora}}',
        body: 'Olá, {{cliente.nome}}!\n\nSeu horário foi remarcado para {{agendamento.data}} às {{agendamento.hora}} ({{agendamento.servicos}} com {{agendamento.profissional}}).\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Seu horário foi remarcado para {{agendamento.data}} às {{agendamento.hora}} ({{agendamento.servicos}} com {{agendamento.profissional}}). — {{empresa.nome}}',
      },
    },
    {
      key: 'shared.scheduling.cancelled',
      label: 'Horário cancelado',
      variables: vars,
      email: {
        subject: 'Horário cancelado',
        body: 'Olá, {{cliente.nome}}.\n\nSeu horário de {{agendamento.data}} às {{agendamento.hora}} ({{agendamento.servicos}}) foi cancelado. Quando quiser, é só marcar de novo.\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}. Seu horário de {{agendamento.data}} às {{agendamento.hora}} ({{agendamento.servicos}}) foi cancelado. Quando quiser, é só marcar de novo. — {{empresa.nome}}',
      },
    },
    {
      key: 'shared.scheduling.series_booked',
      label: 'Horários marcados (com repetição)',
      variables: seriesVars,
      email: {
        subject: '{{agendamento.quantidade}} horários marcados, às {{agendamento.hora}}',
        body: 'Olá, {{cliente.nome}}!\n\nSeus horários estão marcados:\n{{agendamento.servicos}}\nCom: {{agendamento.profissional}}\nÀs {{agendamento.hora}}, nos dias {{agendamento.datas}}\n\nVocê recebe um lembrete antes de cada um.\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}! Seus horários estão marcados: {{agendamento.servicos}} com {{agendamento.profissional}}, às {{agendamento.hora}}, nos dias {{agendamento.datas}}. Você recebe um lembrete antes de cada um. — {{empresa.nome}}',
      },
    },
    {
      key: 'shared.scheduling.series_cancelled',
      label: 'Horários cancelados (série)',
      variables: seriesVars,
      email: {
        subject: 'Horários cancelados',
        body: 'Olá, {{cliente.nome}}.\n\nOs seus horários das {{agendamento.hora}} ({{agendamento.servicos}}) nos dias {{agendamento.datas}} foram cancelados. Quando quiser, é só marcar de novo.\n\n{{empresa.nome}}',
      },
      whatsapp: {
        body: 'Olá, {{cliente.nome}}. Os seus horários das {{agendamento.hora}} ({{agendamento.servicos}}) nos dias {{agendamento.datas}} foram cancelados. Quando quiser, é só marcar de novo. — {{empresa.nome}}',
      },
    },
  ],
});
