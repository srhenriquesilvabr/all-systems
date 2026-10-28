import { defineWebModule } from '@all/module-sdk/web';
import { BureauSettingsPage, QueriesPage, QueryPage } from './QueriesPage';

export const creditBureauWeb = defineWebModule({
  key: 'integration.credit_bureau',
  routes: [
    { path: 'credito/consultas', permission: 'integration.credit_bureau.read', Component: QueriesPage },
    { path: 'credito/consultas/:id', permission: 'integration.credit_bureau.read', Component: QueryPage },
    { path: 'configuracoes/consulta-de-credito', permission: 'core.access.settings', Component: BureauSettingsPage },
  ],
});

// Painel usado pelas verticais (ex.: consórcio, na venda da cota e no lead).
export { CreditCheckPanel, CreditQueryForm, CreditResult, useBureauEnabled, useBureauStatus, type CreditCheckDefaults } from './CreditCheckPanel';
