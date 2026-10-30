import { NotificationsModule } from '@all/notifications';
import { SalesModule } from '@all/sales';
import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { PublicBookingController, SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [NotificationsModule, SalesModule],
  controllers: [SchedulingController, PublicBookingController],
  providers: [SchedulingService, BookingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
