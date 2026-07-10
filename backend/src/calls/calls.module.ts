import { Module } from '@nestjs/common';
import { CallsProxyService } from './calls-proxy.service';
import { CallsProxyController, TelephonySettingsController } from './calls-proxy.controller';
import { PrismaModule } from '../database/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  providers: [CallsProxyService],
  controllers: [CallsProxyController, TelephonySettingsController],
})
export class CallsModule {}
