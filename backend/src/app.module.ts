import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { PrismaModule } from './database/prisma.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { AdminModule } from './admin/admin.module';
import { FlightsModule } from './flights/flights.module';
import { ChatModule } from './chat/chat.module';
import { RatingsModule } from './ratings/ratings.module';
import { BookingsModule } from './bookings/bookings.module';
import { PointsModule } from './points/points.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { PaymentsModule } from './payments/payments.module';
import { AirportsModule } from './airports/airports.module';
import { ReportsModule } from './reports/reports.module';
import { PromosModule } from './promos/promos.module';
import { AuditModule } from './audit/audit.module';
import { UploadsModule } from './uploads/uploads.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { ForfaitsModule } from './forfaits/forfaits.module';
import { ZonesModule } from './zones/zones.module';
import { BotModule } from './bot/bot.module';
import { KycModule } from './kyc/kyc.module';
import { SosModule } from './sos/sos.module';
import { CallsModule } from './calls/calls.module';
import { MetricsModule } from './metrics/metrics.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { CountriesModule } from './countries/countries.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { FavoritesModule } from './favorites/favorites.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    MetricsModule,
    // 0.B6 — Rate limiting différencié par type d'endpoint
    ThrottlerModule.forRoot([
      // Limites configurables par env (THROTTLE_*_LIMIT) ; défauts = valeurs prod/dev actuelles.
      { name: 'otp',    ttl: 60000, limit: parseInt(process.env.THROTTLE_OTP_LIMIT    ?? (process.env.NODE_ENV === 'production' ? '10'  : '50'),   10) || 10 },
      { name: 'auth',   ttl: 60000, limit: parseInt(process.env.THROTTLE_AUTH_LIMIT   ?? (process.env.NODE_ENV === 'production' ? '120' : '200'),  10) || 120 },
      { name: 'admin',  ttl: 60000, limit: parseInt(process.env.THROTTLE_ADMIN_LIMIT  ?? (process.env.NODE_ENV === 'production' ? '300' : '600'),  10) || 300 },
      { name: 'global', ttl: 60000, limit: parseInt(process.env.THROTTLE_GLOBAL_LIMIT ?? (process.env.NODE_ENV === 'production' ? '500' : '1000'), 10) || 500 },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    TenancyModule,
    RedisModule,
    AuthModule,
    UsersModule,
    DriversModule,
    AdminModule,
    FlightsModule,
    ChatModule,
    RatingsModule,
    BookingsModule,
    PointsModule,
    NotificationsModule,
    SettingsModule,
    PaymentsModule,
    AirportsModule,
    ReportsModule,
    PromosModule,
    AuditModule,
    UploadsModule,
    CleanupModule,
    ForfaitsModule,
    ZonesModule,
    BotModule,
    KycModule,
    SosModule,
    CallsModule,
    AnnouncementsModule,
    CountriesModule,
    LoyaltyModule,
    FavoritesModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
