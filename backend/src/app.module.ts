import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
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
  ],
  controllers: [AppController],
})
export class AppModule {}
