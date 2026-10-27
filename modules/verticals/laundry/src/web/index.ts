import { defineWebModule } from '@all/module-sdk/web';
import { LaundryOrderPage } from './LaundryOrderPage';
import { NewLaundryOrderPage } from './NewLaundryOrderPage';
import { PrintLabelsPage, PrintReceiptPage } from './PrintPages';
import { ProductionPage } from './ProductionPage';
import { LaundryReportsPage } from './ReportsPage';
import { ServicesPage } from './ServicesPage';

export const laundryWeb = defineWebModule({
  key: 'laundry',
  routes: [
    { path: 'lavanderia/ordens/nova', permission: 'laundry.orders.write', Component: NewLaundryOrderPage },
    { path: 'lavanderia/ordens/:id', permission: 'laundry.orders.read', Component: LaundryOrderPage },
    { path: 'lavanderia/ordens/:id/etiquetas', permission: 'laundry.orders.read', Component: PrintLabelsPage },
    { path: 'lavanderia/ordens/:id/comprovante', permission: 'laundry.orders.read', Component: PrintReceiptPage },
    { path: 'lavanderia/producao', permission: 'laundry.orders.status', Component: ProductionPage },
    { path: 'lavanderia/relatorios', permission: 'laundry.reports.read', Component: LaundryReportsPage },
    { path: 'lavanderia/servicos', permission: 'laundry.catalog.manage', Component: ServicesPage },
  ],
});
