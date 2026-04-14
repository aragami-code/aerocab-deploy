import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { FlightsScheduler } from './flights.scheduler';
import { PrismaModule } from '../database/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [PrismaModule, ConfigModule, SettingsModule, NotificationsModule, forwardRef(() => BookingsModule)],
  controllers: [FlightsController],
  providers: [FlightsService, FlightsScheduler],
  exports: [FlightsService],
})
export class FlightsModule {}
