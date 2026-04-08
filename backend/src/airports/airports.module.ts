import { Module } from '@nestjs/common';
import { AirportsService } from './airports.service';
import { AirportsController } from './airports.controller';

@Module({
  imports: [],
  controllers: [AirportsController],
  providers: [AirportsService],
  exports: [AirportsService],
})
export class AirportsModule {}
