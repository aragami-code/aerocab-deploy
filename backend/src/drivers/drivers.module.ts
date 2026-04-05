import { Module, forwardRef } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [forwardRef(() => BookingsModule)],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
