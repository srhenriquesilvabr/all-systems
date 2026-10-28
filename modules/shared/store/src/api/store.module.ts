import { NotificationsModule } from '@all/notifications';
import { SalesModule } from '@all/sales';
import { Module } from '@nestjs/common';
import { StoreCatalogService } from './catalog.service';
import { StoreOrdersService } from './orders.service';
import { StorePaymentProviders } from './payments';
import { StorePublicService } from './public.service';
import { PublicStoreController, StoreController } from './store.controller';

@Module({
  imports: [SalesModule, NotificationsModule],
  controllers: [StoreController, PublicStoreController],
  providers: [StoreCatalogService, StoreOrdersService, StorePublicService, StorePaymentProviders],
  exports: [StoreOrdersService, StorePaymentProviders],
})
export class StoreModule {}
