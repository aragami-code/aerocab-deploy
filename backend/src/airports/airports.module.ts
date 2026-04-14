import { Module } from '@nestjs/common';
import { AirportsService } from './airports.service';
import { AirportsController } from './airports.controller';
import { RedisModule } from '../redis/redis.module';
import { PrismaModule } from '../database/prisma.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [AirportsController],
  providers: [AirportsService],
  exports: [AirportsService],
})
export class AirportsModule {}
