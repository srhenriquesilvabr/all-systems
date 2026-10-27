import { defineWebModule } from '@all/module-sdk/web';
import { WhatsAppSettingsPage } from './WhatsAppSettingsPage';

export const whatsappWeb = defineWebModule({
  key: 'integration.whatsapp',
  routes: [{ path: 'configuracoes/whatsapp', permission: 'core.access.settings', Component: WhatsAppSettingsPage }],
});
