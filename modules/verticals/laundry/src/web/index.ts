import { defineWebModule } from '@all/module-sdk/web';
import { LaundryOrderPage } from './LaundryOrderPage';
import { LogisticsPage } from './LogisticsPage';
import { MyRoutePage } from './MyRoutePage';
import { NewLaundryOrderPage } from './NewLaundryOrderPage';
import { PrintLabelsPage, PrintReceiptPage } from './PrintPages';
import { ProductionPage } from './ProductionPage';
import { LaundryReportsPage } from './ReportsPage';
import { ServicesPage } from './ServicesPage';

export const laundryWeb = defineWebModule({
  key: 'laundry',
  manual: () => import('./manual').then((m) => m.manual),
  routes: [
    { path: 'lavanderia/ordens/nova', permission: 'laundry.orders.write', Component: NewLaundryOrderPage },
    { path: 'lavanderia/ordens/:id', permission: 'laundry.orders.read', Component: LaundryOrderPage },
    { path: 'lavanderia/ordens/:id/etiquetas', permission: 'laundry.orders.read', Component: PrintLabelsPage },
    { path: 'lavanderia/ordens/:id/comprovante', permission: 'laundry.orders.read', Component: PrintReceiptPage },
    { path: 'lavanderia/producao', permission: 'laundry.orders.status', Component: ProductionPage },
    { path: 'lavanderia/logistica', permission: 'laundry.logistics.manage', Component: LogisticsPage },
    { path: 'lavanderia/minhas-rotas', permission: 'laundry.logistics.drive', Component: MyRoutePage },
    { path: 'lavanderia/relatorios', permission: 'laundry.reports.read', Component: LaundryReportsPage },
    { path: 'lavanderia/servicos', permission: 'laundry.catalog.manage', Component: ServicesPage },
  ],
});
