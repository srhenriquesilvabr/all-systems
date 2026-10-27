import { NotificationsModule } from '@all/notifications';
import { ServiceOrdersModule } from '@all/service-orders';
import { Module } from '@nestjs/common';
import { LaundryCatalogController } from './catalog.controller';
import { LaundryCatalogService } from './catalog.service';
import { LaundryLogisticsController } from './logistics.controller';
import { LaundryLogisticsService } from './logistics.service';
import { LaundryOrdersController } from './orders.controller';
import { LaundryOrdersService } from './orders.service';
import { LaundryReportsService } from './reports.service';
import { LaundryServicesController } from './services.controller';
import { LaundryServicesService } from './services.service';

@Module({
  imports: [ServiceOrdersModule, NotificationsModule],
  controllers: [LaundryServicesController, LaundryCatalogController, LaundryOrdersController, LaundryLogisticsController],
  providers: [LaundryServicesService, LaundryCatalogService, LaundryOrdersService, LaundryReportsService, LaundryLogisticsService],
})
export class LaundryModule {}
