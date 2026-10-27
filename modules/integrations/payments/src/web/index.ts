import { defineWebModule } from '@all/module-sdk/web';
import { PixSettingsPage } from './PixSettingsPage';

export const paymentsWeb = defineWebModule({
  key: 'integration.payments',
  routes: [{ path: 'configuracoes/pix', permission: 'core.access.settings', Component: PixSettingsPage }],
});
