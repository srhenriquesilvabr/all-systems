export { storeManifest } from './manifest';
export { StoreModule } from './api/store.module';
export { StoreOrdersService } from './api/orders.service';
// Ponto de extensão do pagamento online (ver src/api/payments.ts).
export { StorePaymentProviders, type CheckoutContext, type StorePaymentProvider } from './api/payments';
export { sniffImage } from './api/shared';
export * from './contracts';
export * as storeSchema from './db/schema';
