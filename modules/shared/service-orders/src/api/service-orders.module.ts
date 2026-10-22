import { NotificationsModule } from '@all/notifications';
import { Module } from '@nestjs/common';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';
import { ServiceOrderWorkflows } from './workflows';

@Module({
  imports: [NotificationsModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService, ServiceOrderWorkflows],
  exports: [ServiceOrdersService, ServiceOrderWorkflows],
})
export class ServiceOrdersModule {}
