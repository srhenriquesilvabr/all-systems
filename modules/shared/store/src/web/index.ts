import { defineWebModule } from '@all/module-sdk/web';
import { ListingsPage } from './ListingsPage';
import { NewOrderPage, OrderPage, OrdersPage } from './OrdersPage';
import { StoreSettingsPage } from './SettingsPage';

// O admin não usa /loja/... (esse prefixo é da vitrine pública, sem login).
export const storeWeb = defineWebModule({
  key: 'store',
  routes: [
    { path: 'lojinha/pedidos', permission: 'store.orders.read', Component: OrdersPage },
    { path: 'lojinha/pedidos/novo', permission: 'store.orders.manage', Component: NewOrderPage },
    { path: 'lojinha/pedidos/:id', permission: 'store.orders.read', Component: OrderPage },
    { path: 'lojinha/anuncios', permission: 'store.catalog.manage', Component: ListingsPage },
    { path: 'configuracoes/lojinha', permission: 'store.settings.manage', Component: StoreSettingsPage },
  ],
});

// Vitrine pública (fora do login), montada pelo admin em /loja/:slug.
export { PublicStorePage } from './PublicStorePage';
