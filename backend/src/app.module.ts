import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { PrismaModule } from './database/prisma.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    // 0.B6 — Rate limiting différencié par type d'endpoint
    ThrottlerModule.forRoot([
      { name: 'otp',    ttl: 60000, limit: 5  },  // OTP: 5 req/min
      { name: 'auth',   ttl: 60000, limit: 20 },  // Auth: 20 req/min
      { name: 'admin',  ttl: 60000, limit: 60 },  // Admin: 60 req/min
      { name: 'global', ttl: 60000, limit: 100 }, // Global: 100 req/min
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
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
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
