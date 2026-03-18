import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { AdminModule } from './admin/admin.module';
import { FlightsModule } from './flights/flights.module';
import { AccessModule } from './access/access.module';
import { ChatModule } from './chat/chat.module';
import { RatingsModule } from './ratings/ratings.module';
import { BookingsModule } from './bookings/bookings.module';
import { PointsModule } from './points/points.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    DriversModule,
    AdminModule,
    FlightsModule,
    AccessModule,
    ChatModule,
    RatingsModule,
    BookingsModule,
    PointsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
