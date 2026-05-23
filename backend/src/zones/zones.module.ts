import { Module } from '@nestjs/common';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { PrismaModule } from '../database/prisma.module';
import { AirportsModule } from '../airports/airports.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, AirportsModule, SettingsModule],
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
