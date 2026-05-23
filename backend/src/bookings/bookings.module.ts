import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DispatchService } from './dispatch.service';
import { PricingService } from './pricing.service';
import { BookingsController } from './bookings.controller';
import { TrackingPublicController } from './tracking-public.controller';
import { BookingsService } from './bookings.service';
import { BookingsScheduler } from './bookings.scheduler';
import { RidesGateway } from './rides.gateway';
import { PrismaModule } from '../database/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PointsModule } from '../points/points.module';
import { SettingsModule } from '../settings/settings.module';
import { PromosModule } from '../promos/promos.module';
import { FlightsModule } from '../flights/flights.module';
import { AirportsModule } from '../airports/airports.module';
import { AuditModule } from '../audit/audit.module';
import { ForfaitsModule } from '../forfaits/forfaits.module';
import { ZonesModule } from '../zones/zones.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    NotificationsModule,
    PointsModule,
    SettingsModule,
    PromosModule,
    FlightsModule,
    AirportsModule,
    AuditModule,
    ForfaitsModule,
    ZonesModule,
    PaymentsModule,
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [BookingsController, TrackingPublicController],
  providers: [BookingsService, RidesGateway, DispatchService, PricingService, BookingsScheduler],
  exports: [BookingsService, DispatchService, PricingService, RidesGateway],
})
export class BookingsModule {}
