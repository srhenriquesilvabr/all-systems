import { defineWebModule } from '@all/module-sdk/web';
import { CustomerOrdersTab } from './CustomerOrdersTab';
import { NewOrderPage } from './NewOrderPage';
import { OrderPage } from './OrderPage';
import { OrdersPage } from './OrdersPage';

export const serviceOrdersWeb = defineWebModule({
  key: 'shared.service-orders',
  routes: [
    { path: 'ordens', permission: 'shared.service-orders.read', Component: OrdersPage },
    { path: 'ordens/nova', permission: 'shared.service-orders.write', Component: NewOrderPage },
    { path: 'ordens/:id', permission: 'shared.service-orders.read', Component: OrderPage },
  ],
  customerTabs: [{ key: 'orders', label: 'Ordens de serviço', permission: 'shared.service-orders.read', Component: CustomerOrdersTab }],
});

// Peças reaproveitadas pelas telas das verticais (ex.: ordem da lavanderia).
export { newOrderPath, OrderRows, orderPath, ordersKey, PaymentBadge, StatusBadge, useWorkflows } from './shared';
export { PaymentModal, Transitions } from './OrderPage';
export { paymentMethodLabel, paymentMethods, type PaymentMethod } from '../contracts';
export { CustomerSearch, type CustomerOption } from '@all/module-sdk/web';
