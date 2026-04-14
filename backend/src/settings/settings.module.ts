import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { PrismaModule } from '../database/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, RedisModule, AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
