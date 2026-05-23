import { Module, forwardRef } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { BookingsModule } from '../bookings/bookings.module';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [forwardRef(() => BookingsModule), SettingsModule, PaymentsModule],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
