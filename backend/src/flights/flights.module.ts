import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { FlightsScheduler } from './flights.scheduler';
import { PrismaModule } from '../database/prisma.module';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [FlightsController],
  providers: [FlightsService, FlightsScheduler],
  exports: [FlightsService],
})
export class FlightsModule {}
