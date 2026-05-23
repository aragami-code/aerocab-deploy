import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { EdoctorPaymentService } from '../payments/edoctor-payment.service';
import { PrismaModule } from '../database/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaModule, RedisModule, AuditModule, RbacModule],
  controllers: [SettingsController],
  providers: [SettingsService, EdoctorPaymentService],
  exports: [SettingsService],
})
export class SettingsModule {}
