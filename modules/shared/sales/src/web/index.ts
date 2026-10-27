import { defineWebModule } from '@all/module-sdk/web';
import { PosPage } from './PosPage';
import { ProductsPage } from './ProductsPage';
import { SalesPage } from './SalesPage';

export const salesWeb = defineWebModule({
  key: 'shared.sales',
  routes: [
    { path: 'pdv', permission: 'shared.sales.sell', Component: PosPage },
    { path: 'vendas', permission: 'shared.sales.read', Component: SalesPage },
    { path: 'produtos', permission: 'shared.sales.products', Component: ProductsPage },
  ],
});

export { useProducts, salesKey, brl } from './hooks';
