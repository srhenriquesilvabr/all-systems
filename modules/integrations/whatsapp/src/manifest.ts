import { defineModule } from '@all/module-sdk';
import { z } from 'zod';

export const whatsappSettings = z
  .object({
    /**
     * manual: sem API; a mensagem fica pronta com um link para a equipe enviar pelo WhatsApp da empresa.
     * cloud_api: API oficial da Meta (WhatsApp Business Platform), envio automático e botões de resposta.
     * simulated: para testes; registra como enviada sem mandar nada.
     */
    mode: z.enum(['manual', 'cloud_api', 'simulated']).default('manual'),
    phoneNumberId: z.string().trim().max(40).default(''),
    accessToken: z.string().trim().max(1000).default(''),
    /** Número exibido para a equipe, ex.: (48) 99999-0000. */
    displayPhone: z.string().trim().max(30).default(''),
    languageCode: z.string().trim().max(10).default('pt_BR'),
  })
  .refine((s) => s.mode !== 'cloud_api' || (s.phoneNumberId && s.accessToken), {
    message: 'Para usar a API oficial, informe o ID do número e o token de acesso',
    path: ['accessToken'],
  });
export type WhatsAppSettings = z.infer<typeof whatsappSettings>;

export const whatsappManifest = defineModule({
  key: 'integration.whatsapp',
  name: 'WhatsApp',
  layer: 'integration',
  description: 'Mensagens e lembretes pelo WhatsApp, com confirmação do cliente.',
  icon: 'message',
  version: '1.0.0',
  settings: whatsappSettings,
  secretSettings: ['accessToken'],
  menu: [{ label: 'WhatsApp', path: '/configuracoes/whatsapp', icon: 'message', permission: 'core.access.settings', group: 'Configurações' }],
  events: { publishes: ['integration.whatsapp.reply'] },
});
