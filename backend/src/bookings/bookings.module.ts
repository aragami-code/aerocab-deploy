import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DispatchService } from './dispatch.service';
import { PricingService } from './pricing.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { RidesGateway } from './rides.gateway';
import { PrismaModule } from '../database/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PointsModule } from '../points/points.module';
import { SettingsModule } from '../settings/settings.module';
import { PromosModule } from '../promos/promos.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    NotificationsModule,
    PointsModule,
    SettingsModule,
    PromosModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, RidesGateway, DispatchService, PricingService],
  exports: [BookingsService, DispatchService, PricingService],
})
export class BookingsModule {}
