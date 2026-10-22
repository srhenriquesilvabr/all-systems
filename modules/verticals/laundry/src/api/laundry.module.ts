import { Module } from '@nestjs/common';
import { LaundryServicesController } from './services.controller';
import { LaundryServicesService } from './services.service';

@Module({
  controllers: [LaundryServicesController],
  providers: [LaundryServicesService],
})
export class LaundryModule {}
